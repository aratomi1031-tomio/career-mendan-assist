import * as db from './db.js';
import { TimerEngine, formatMs } from './timer.js';
import { PhaseManager } from './phaseManager.js';
import { ChecklistManager } from './checklistManager.js';
import { NotesManager } from './notesManager.js';
import { Recorder } from './recorder.js';
import { renderSessionSummary, progressColorClass } from './ui.js';
import { HistoryView } from './historyView.js';
import { SettingsManager } from './settingsManager.js';

const screens = {
  start: document.getElementById('screen-start'),
  live: document.getElementById('screen-live'),
  summary: document.getElementById('screen-summary'),
  history: document.getElementById('screen-history'),
  settings: document.getElementById('screen-settings'),
};
const mainNav = document.getElementById('main-nav');

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  mainNav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });
  mainNav.hidden = name === 'live';
}

mainNav.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => onNavigate(btn.dataset.nav));
});

async function onNavigate(name) {
  // 面談中はナビゲーションで画面を離れさせない。CSS側で#main-nav自体を非表示にしているが、
  // startSession()内のマイク許可待ちなど、画面遷移前の一瞬に備えた保険。
  if (session) return;
  if (name === 'history') {
    showScreen('history');
    await new HistoryView(document.getElementById('history-container')).render();
  } else if (name === 'settings') {
    showScreen('settings');
    await new SettingsManager(document.getElementById('settings-container')).render();
  } else {
    showScreen('start');
  }
}

// ---- 面談準備画面 ----
const consentCheckbox = document.getElementById('consent-checkbox');
const startSessionBtn = document.getElementById('start-session-btn');
consentCheckbox.addEventListener('change', () => {
  startSessionBtn.disabled = !consentCheckbox.checked;
});

let sessionStarting = false;
startSessionBtn.addEventListener('click', async () => {
  // 連打・二重タップで面談セッション（＝タイマー）が二重に始まってしまうのを防ぐ。
  if (sessionStarting) return;
  sessionStarting = true;
  startSessionBtn.disabled = true;
  try {
    await startSession();
  } finally {
    sessionStarting = false;
    // startSession()が「フェーズ未設定」等で早期リターンした場合に備え、
    // ボタンが無効なまま固まらないよう同意チェックの状態に合わせて戻す。
    startSessionBtn.disabled = !consentCheckbox.checked;
  }
});

// ---- 面談中画面の要素 ----
const totalTimeEl = document.getElementById('total-time');
const phaseTimeEl = document.getElementById('phase-time');
const phaseTargetEl = document.getElementById('phase-target');
const currentPhaseLabelEl = document.getElementById('current-phase-label');
const phaseButtonsEl = document.getElementById('phase-buttons');
const phaseProgressBarEl = document.getElementById('phase-progress-bar');
const checklistItemsEl = document.getElementById('checklist-items');
const noteInputEl = document.getElementById('note-input');
const addNoteBtn = document.getElementById('add-note-btn');
const notesListEl = document.getElementById('notes-list');
const recordIndicator = document.getElementById('record-indicator');
const recordFallbackIndicator = document.getElementById('record-fallback-indicator');
const endSessionBtn = document.getElementById('end-session-btn');

let session = null; // { id, phaseConfig, checklistConfig, timer, phaseManager, checklistManager, notesManager, recorder, isRecording, pendingBlob, recordingSaved, recordingSavedFileName }

async function startSession() {
  if (session) {
    // ここには理論上到達しないはずだが(面談中はナビが塞がれているため)、万一前のセッションが
    // 残っていた場合に二重タイマー化(表示時計が壊れる症状)を防ぐ最後の安全網。
    session.timer.stop();
    session.recorder.releaseMic();
  }
  const phaseConfig = (await db.getSetting('phaseConfig')) || [];
  const checklistConfig = (await db.getSetting('checklistConfig')) || {};
  if (phaseConfig.length === 0) {
    alert('フェーズが1つも設定されていません。設定画面でフェーズを追加してください。');
    return;
  }

  const id = crypto.randomUUID();
  await db.createSession({
    id,
    startedAt: Date.now(),
    endedAt: null,
    status: 'in-progress',
    consentGiven: true,
    totalDurationMs: 0,
    recordingSaved: false,
    recordingSavedFileName: null,
    // このセッション実施当時のフェーズ・チェックリスト構成を保存しておく。
    // 後で設定画面を変更しても、このセッションの履歴・面談結果概要の内容は変わらない。
    phaseConfigSnapshot: phaseConfig,
    checklistConfigSnapshot: checklistConfig,
  });

  const timer = new TimerEngine(onTick);
  const phaseManager = new PhaseManager({ phases: phaseConfig, timer, sessionId: id, onPhaseChange });
  const checklistManager = new ChecklistManager({ checklistConfig, sessionId: id, timer });
  const notesManager = new NotesManager({ sessionId: id, timer, phaseManager });
  const recorder = new Recorder();

  session = {
    id, phaseConfig, checklistConfig, timer, phaseManager, checklistManager, notesManager, recorder,
    isRecording: false, pendingBlob: null, recordingSaved: false, recordingSavedFileName: null,
  };

  notesListEl.innerHTML = '';
  recordIndicator.hidden = true;
  recordFallbackIndicator.hidden = true;

  showScreen('live');
  timer.start();
  // phaseManager.start()はonPhaseChange経由でresetVisit/renderPhaseButtons/renderChecklistを呼ぶため、
  // ここで重ねて呼ぶ必要はない。
  await phaseManager.start();

  // 録音は面談開始と同時に自動で始める。マイクが使えない場合も面談自体は続行できるようにし、
  // フォールバック表示で「録音なしで進行中」であることが分かるようにする。
  try {
    await recorder.requestMicPermission();
    recorder.startRecording();
    session.isRecording = true;
    recordIndicator.hidden = false;
  } catch (err) {
    recordFallbackIndicator.hidden = false;
    alert('マイクの利用が許可されなかったため、録音なしで面談を続行します: ' + err.message);
  }
}

function onTick({ elapsedTotalMs, elapsedPhaseMs }) {
  totalTimeEl.textContent = formatMs(elapsedTotalMs);
  phaseTimeEl.textContent = formatMs(elapsedPhaseMs);
  const phase = session.phaseManager.getCurrentPhase();
  const targetMs = phase.targetMinutes * 60 * 1000;
  const ratio = targetMs > 0 ? elapsedPhaseMs / targetMs : 0;
  phaseProgressBarEl.style.width = `${Math.min(100, ratio * 100)}%`;
  phaseProgressBarEl.className = `progress-bar-fill ${progressColorClass(ratio)}`;
}

function onPhaseChange(phase) {
  session.checklistManager.resetVisit();
  currentPhaseLabelEl.textContent = phase.label;
  phaseTargetEl.textContent = `目標 ${phase.targetMinutes}分`;
  phaseTimeEl.textContent = '00:00';
  phaseProgressBarEl.style.width = '0%';
  phaseProgressBarEl.className = 'progress-bar-fill';
  renderPhaseButtons();
  renderChecklist();
}

function renderPhaseButtons() {
  const current = session.phaseManager.getCurrentPhase();
  phaseButtonsEl.innerHTML = '';
  session.phaseConfig.forEach((phase) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = phase.label;
    btn.className = 'phase-btn' + (phase.key === current.key ? ' active' : '');
    btn.addEventListener('click', () => session.phaseManager.switchPhase(phase.key));
    phaseButtonsEl.appendChild(btn);
  });
}

function renderChecklist() {
  const phase = session.phaseManager.getCurrentPhase();
  const items = session.checklistManager.itemsForPhase(phase.key);
  checklistItemsEl.innerHTML = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'このフェーズにはチェック項目が設定されていません。';
    checklistItemsEl.appendChild(p);
    return;
  }
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'checklist-item';
    btn.textContent = (item.critical ? '⚠ ' : '') + item.label;
    btn.addEventListener('click', async () => {
      const isFirst = await session.checklistManager.onItemClick(phase.key, item);
      if (isFirst) btn.classList.add('checked');
    });
    checklistItemsEl.appendChild(btn);
  });
}

addNoteBtn.addEventListener('click', () => submitNote());
noteInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNote();
});

async function submitNote() {
  const text = noteInputEl.value;
  const entry = await session.notesManager.addNote(text);
  if (!entry) return;
  noteInputEl.value = '';
  const phase = session.phaseManager.getCurrentPhase();
  const li = document.createElement('li');
  li.textContent = `[${formatMs(entry.elapsedMsTotal)} / ${phase.label}] ${entry.text}`;
  notesListEl.prepend(li);
}

let sessionEnding = false;
endSessionBtn.addEventListener('click', async () => {
  if (!confirm('面談を終了します。よろしいですか？')) return;
  // confirm()通過後は非同期処理（録音停止・保存・DB更新）が続くため、その間に
  // 再度クリック＆確認されると、session がnull化された後にアクセスして
  // エラーになったり、終了処理が二重に走ったりする。処理中は無視する。
  if (sessionEnding) return;
  sessionEnding = true;

  try {
    if (session.isRecording) {
      const blob = await session.recorder.stopRecording();
      session.isRecording = false;
      session.pendingBlob = blob;
    }
    session.recorder.releaseMic();

    // 録音があれば、終了操作の一部として自動的に保存(ダウンロード)ダイアログを出す。
    // 保存先フォルダの選択自体はユーザー操作のまま残す(README記載のOneDrive等クラウド同期
    // フォルダを避けてもらうため、選択ステップそのものは省略しない)。
    if (session.pendingBlob) {
      let saved = false;
      while (!saved) {
        try {
          const result = await session.recorder.saveRecording(session.pendingBlob, session.recorder.suggestedFileName());
          if (result.method === 'cancelled') {
            const retry = confirm('録音の保存がキャンセルされました。もう一度保存先を選びますか？（「いいえ」を選ぶと録音データは破棄されます）');
            if (!retry) break;
          } else {
            session.recordingSaved = true;
            session.recordingSavedFileName = result.fileName;
            saved = true;
          }
        } catch (err) {
          alert('録音の保存に失敗しました。録音データは保存されませんでした: ' + err.message);
          break;
        }
      }
    }

    session.timer.stop();
    await session.phaseManager.finish();

    const totalDurationMs = session.timer.getElapsedTotalMs();
    await db.updateSession(session.id, {
      endedAt: Date.now(),
      status: 'completed',
      totalDurationMs,
      recordingSaved: session.recordingSaved,
      recordingSavedFileName: session.recordingSavedFileName,
    });

    const sessionId = session.id;
    showScreen('summary');
    const summaryContainer = document.getElementById('summary-container');
    summaryContainer.innerHTML = '読み込み中…';
    await renderSessionSummary(summaryContainer, sessionId, { readOnly: false });
    session = null;
    // 「新しい面談を始める」ボタン廃止に伴い、面談終了のタイミングで同意チェックをリセットする。
    // 次の面談は必ず同意を取り直すという既存の挙動を維持するため。
    consentCheckbox.checked = false;
    startSessionBtn.disabled = true;
  } catch (err) {
    alert('面談の終了処理中にエラーが発生しました。記録は保存できていない可能性があります。お手数ですが画面を再読み込みしてください: ' + err.message);
  } finally {
    sessionEnding = false;
  }
});

async function init() {
  await db.seedDefaultsIfEmpty();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  showScreen('start');
}

init();
