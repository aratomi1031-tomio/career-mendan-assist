// 画面間で共有する描画ヘルパー。
import * as db from './db.js';
import { formatMs } from './timer.js';
import { computeCompletionRate } from './checklistManager.js';
import { CC_CL_PROMPT } from './promptReference.js';
import { saveBlob } from './fileSave.js';

export function progressColorClass(ratio) {
  if (ratio === null || ratio === undefined) return '';
  if (ratio <= 0.8) return 'progress-green';
  if (ratio <= 1.2) return 'progress-yellow';
  return 'progress-red';
}

function aggregatePhaseActuals(phaseLogs) {
  const map = new Map();
  for (const log of phaseLogs) {
    const cur = map.get(log.phaseKey) || { actualDurationMs: 0, targetDurationMs: log.targetDurationMs };
    cur.actualDurationMs += log.actualDurationMs || 0;
    map.set(log.phaseKey, cur);
  }
  return map;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTimeForFile(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function buildSummaryText({ session, phaseConfig, checklistConfig, phaseLogs, checklistEvents, notes }) {
  const actuals = aggregatePhaseActuals(phaseLogs);
  const lines = [];
  lines.push('面談結果概要');
  lines.push('');
  lines.push(`面談日時: ${formatDateTime(session.startedAt)}`);
  lines.push(`面談時間: ${formatMs(session.totalDurationMs || 0)}`);
  lines.push('');
  lines.push('【フェーズ別時間配分】');
  for (const phase of phaseConfig) {
    const agg = actuals.get(phase.key);
    const targetMs = phase.targetMinutes * 60 * 1000;
    const actualMs = agg ? agg.actualDurationMs : 0;
    const ratio = targetMs > 0 ? actualMs / targetMs : null;
    const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
    const ratioText = ratio !== null ? `${Math.round(ratio * 100)}%` : '-';
    lines.push(`${phase.label} / 目標${phase.targetMinutes}分 / 実績${formatMs(actualMs)} / 差分${ratioText} / チェック${comp.checked}/${comp.total}`);
  }
  lines.push('');
  lines.push('【メモ】');
  if (notes.length === 0) {
    lines.push('(記録されたメモはありません)');
  } else {
    for (const n of notes) {
      const phaseLabel = (phaseConfig.find((p) => p.key === n.phaseKey) || {}).label || n.phaseKey;
      lines.push(`[${formatMs(n.elapsedMsTotal)} / ${phaseLabel}] ${n.text}`);
    }
  }
  return lines.join('\n');
}

function buildSummaryPanel({ session, phaseConfig, checklistConfig, phaseLogs, checklistEvents, notes }) {
  const actuals = aggregatePhaseActuals(phaseLogs);
  const panel = document.createElement('div');
  panel.className = 'tab-panel';

  const header = document.createElement('div');
  header.className = 'summary-header';
  header.innerHTML = `<p>面談時間: <strong>${formatMs(session.totalDurationMs || 0)}</strong></p>`;
  panel.appendChild(header);

  const table = document.createElement('table');
  table.className = 'summary-table';
  table.innerHTML = '<thead><tr><th>フェーズ</th><th>目標</th><th>実績</th><th>差分</th><th>チェック</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const phase of phaseConfig) {
    const agg = actuals.get(phase.key);
    const targetMs = phase.targetMinutes * 60 * 1000;
    const actualMs = agg ? agg.actualDurationMs : 0;
    const ratio = targetMs > 0 ? actualMs / targetMs : null;
    const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${phase.label}</td>
      <td>${phase.targetMinutes}分</td>
      <td>${formatMs(actualMs)}</td>
      <td class="${progressColorClass(ratio)}">${ratio !== null ? Math.round(ratio * 100) + '%' : '-'}</td>
      <td>${comp.checked}/${comp.total}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  panel.appendChild(table);

  if (notes.length > 0) {
    const notesBox = document.createElement('div');
    notesBox.className = 'notes-box';
    const h = document.createElement('h4');
    h.textContent = 'メモ';
    notesBox.appendChild(h);
    const ul = document.createElement('ul');
    notes.forEach((n) => {
      const phaseLabel = (phaseConfig.find((p) => p.key === n.phaseKey) || {}).label || n.phaseKey;
      const li = document.createElement('li');
      li.textContent = `[${formatMs(n.elapsedMsTotal)} / ${phaseLabel}] ${n.text}`;
      ul.appendChild(li);
    });
    notesBox.appendChild(ul);
    panel.appendChild(notesBox);
  }

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = '面談結果概要ダウンロード（.txt）';
  saveBtn.addEventListener('click', async () => {
    const text = buildSummaryText({ session, phaseConfig, checklistConfig, phaseLogs, checklistEvents, notes });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    await saveBlob(blob, `mendan-kekka-gaiyou-${formatDateTimeForFile(session.startedAt)}.txt`, { 'text/plain': ['.txt'] });
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  return panel;
}

function buildResultPanel() {
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  panel.hidden = true;

  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent = 'このアプリは音声の文字起こし・話者分離を行いません。別途取得した文字起こしテキストと、以下のプロンプトをAI(Claude等)に渡すことで、CC/CL発言を1分刻みで整理できます。';
  panel.appendChild(intro);

  const promptPre = document.createElement('pre');
  promptPre.className = 'prompt-reference';
  promptPre.textContent = CC_CL_PROMPT;
  panel.appendChild(promptPre);

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = '逐語プロンプトをテキストで保存（.txt）';
  saveBtn.addEventListener('click', async () => {
    const blob = new Blob([CC_CL_PROMPT], { type: 'text/plain;charset=utf-8' });
    await saveBlob(blob, '逐語プロンプト_参考.txt', { 'text/plain': ['.txt'] });
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  return panel;
}

export async function renderSessionSummary(container, sessionId, opts = {}) {
  const [{ session, phaseConfig, checklistConfig }, phaseLogs, checklistEvents, notes] = await Promise.all([
    db.getSessionConfig(sessionId),
    db.listPhaseLogs(sessionId),
    db.listChecklistEvents(sessionId),
    db.listNotes(sessionId),
  ]);

  container.innerHTML = '';

  const summaryPanel = buildSummaryPanel({ session, phaseConfig, checklistConfig, phaseLogs, checklistEvents, notes });
  const resultPanel = buildResultPanel();

  const tabs = document.createElement('div');
  tabs.className = 'summary-tabs';
  const summaryTabBtn = document.createElement('button');
  summaryTabBtn.type = 'button';
  summaryTabBtn.className = 'tab-btn active';
  summaryTabBtn.textContent = '面談結果概要';
  const resultTabBtn = document.createElement('button');
  resultTabBtn.type = 'button';
  resultTabBtn.className = 'tab-btn';
  resultTabBtn.textContent = '逐語プロンプト（参考）';
  tabs.appendChild(summaryTabBtn);
  tabs.appendChild(resultTabBtn);

  function activateTab(name) {
    summaryTabBtn.classList.toggle('active', name === 'summary');
    resultTabBtn.classList.toggle('active', name === 'result');
    summaryPanel.hidden = name !== 'summary';
    resultPanel.hidden = name !== 'result';
  }
  summaryTabBtn.addEventListener('click', () => activateTab('summary'));
  resultTabBtn.addEventListener('click', () => activateTab('result'));

  container.appendChild(tabs);
  container.appendChild(summaryPanel);
  container.appendChild(resultPanel);
}
