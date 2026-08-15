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
startSessionBtn.addEventListener('click', () => startSession());

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
const recordBtn = document.getElementById('record-btn');
const recordIndicator = document.getElementById('record-indicator');
const saveRecordingBtn = document.getElementById('save-recording-btn');
const endSessionBtn = document.getElementById('end-session-btn');

let session = null; // { id, phaseConfig, checklistConfig, timer, phaseManager, checklistManager, notesManager, recorder, isRecording, pendingBlob, hasUnsavedBlob, recordingSaved, recordingSavedFileName }

async function startSession() {
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
  });

  const timer = new TimerEngine(onTick);
  const phaseManager = new PhaseManager({ phases: phaseConfig, timer, sessionId: id, onPhaseChange });
  const checklistManager = new ChecklistManager({ checklistConfig, sessionId: id, timer });
  const notesManager = new NotesManager({ sessionId: id, timer, phaseManager });
  const recorder = new Recorder();

  session = {
    id, phaseConfig, checklistConfig, timer, phaseManager, checklistManager, notesManager, recorder,
    isRecording: false, pendingBlob: null, hasUnsavedBlob: false, recordingSaved: false, recordingSavedFileName: null,
  };

  notesListEl.innerHTML = '';
  recordBtn.disabled = false;
  recordBtn.textContent = '● 録音開始';
  recordIndicator.hidden = true;
  saveRecordingBtn.hidden = true;

  showScreen('live');
  timer.start();
  await phaseManager.start();
  checklistManager.resetVisit();
  renderPhaseButtons();
  renderChecklist();
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

recordBtn.addEventListener('click', async () => {
  if (!session.isRecording) {
    try {
      await session.recorder.requestMicPermission();
      session.recorder.startRecording();
      session.isRecording = true;
      recordBtn.textContent = '■ 録音停止';
      recordIndicator.hidden = false;
      saveRecordingBtn.hidden = true;
    } catch (err) {
      alert('マイクの利用許可が得られませんでした: ' + err.message);
    }
  } else {
    const blob = await session.recorder.stopRecording();
    session.isRecording = false;
    session.pendingBlob = blob;
    session.hasUnsavedBlob = true;
    recordBtn.textContent = '● 録音開始';
    recordBtn.disabled = true; // 1セッション1回のみ
    recordIndicator.hidden = true;
    saveRecordingBtn.hidden = false;
  }
});

saveRecordingBtn.addEventListener('click', async () => {
  const result = await session.recorder.saveRecording(session.pendingBlob, session.recorder.suggestedFileName());
  if (result.method === 'cancelled') return;
  session.recordingSaved = true;
  session.recordingSavedFileName = result.fileName;
  session.hasUnsavedBlob = false;
  saveRecordingBtn.hidden = true;
  alert('録音を保存しました。');
});

endSessionBtn.addEventListener('click', async () => {
  if (!confirm('面談を終了します。よろしいですか？')) return;

  if (session.isRecording) {
    const blob = await session.recorder.stopRecording();
    session.isRecording = false;
    session.pendingBlob = blob;
    session.hasUnsavedBlob = true;
  }

  if (session.hasUnsavedBlob) {
    if (confirm('録音データがまだ保存されていません。保存しますか？（「いいえ」を選ぶと録音データは破棄されます）')) {
      const result = await session.recorder.saveRecording(session.pendingBlob, session.recorder.suggestedFileName());
      if (result.method !== 'cancelled') {
        session.recordingSaved = true;
        session.recordingSavedFileName = result.fileName;
      }
    }
  }

  session.recorder.releaseMic();
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
});

document.getElementById('new-session-btn').addEventListener('click', () => {
  consentCheckbox.checked = false;
  startSessionBtn.disabled = true;
  showScreen('start');
});

async function init() {
  await db.seedDefaultsIfEmpty();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  showScreen('start');
}

init();
