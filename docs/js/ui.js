// 画面間で共有する描画ヘルパー。
import * as db from './db.js';
import { formatMs } from './timer.js';
import { computeCompletionRate } from './checklistManager.js';
import { analyzeSession, analyzeTrend } from './reflectionEngine.js';
import { buildMinutes, exportMarkdown } from './minutesGenerator.js';

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

export async function renderSessionSummary(container, sessionId, opts = {}) {
  const [{ session, phaseConfig, checklistConfig }, phaseLogs, checklistEvents, notes, insights, trends] = await Promise.all([
    db.getSessionConfig(sessionId),
    db.listPhaseLogs(sessionId),
    db.listChecklistEvents(sessionId),
    db.listNotes(sessionId),
    analyzeSession(sessionId),
    analyzeTrend(sessionId),
  ]);

  const actuals = aggregatePhaseActuals(phaseLogs);
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'summary-header';
  header.innerHTML = `<p>面談時間: <strong>${formatMs(session.totalDurationMs || 0)}</strong></p>`;
  container.appendChild(header);

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
  container.appendChild(table);

  if (insights.length > 0 || trends.length > 0) {
    const insightsBox = document.createElement('div');
    insightsBox.className = 'insights-box';
    const h = document.createElement('h4');
    h.textContent = '振り返りインサイト';
    insightsBox.appendChild(h);
    const ul = document.createElement('ul');
    [...insights, ...trends].forEach((i) => {
      const li = document.createElement('li');
      li.className = `insight-${i.severity}`;
      li.textContent = i.text;
      ul.appendChild(li);
    });
    insightsBox.appendChild(ul);
    container.appendChild(insightsBox);
  }

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
    container.appendChild(notesBox);
  }

  const actions = document.createElement('div');
  actions.className = 'summary-actions';

  const minutesBtn = document.createElement('button');
  minutesBtn.type = 'button';
  minutesBtn.className = 'btn-primary';
  minutesBtn.textContent = '議事録ドラフトを生成';
  const minutesPreview = document.createElement('pre');
  minutesPreview.className = 'minutes-preview';
  minutesBtn.addEventListener('click', async () => {
    const md = await buildMinutes(sessionId);
    minutesPreview.textContent = md;
    minutesPreview.style.display = 'block';
    downloadBtn.style.display = 'inline-block';
    downloadBtn.dataset.md = md;
  });
  actions.appendChild(minutesBtn);

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn-secondary';
  downloadBtn.textContent = '議事録をダウンロード（.md）';
  downloadBtn.style.display = 'none';
  downloadBtn.addEventListener('click', async () => {
    await exportMarkdown(sessionId, downloadBtn.dataset.md);
  });
  actions.appendChild(downloadBtn);

  container.appendChild(actions);
  container.appendChild(minutesPreview);
}
