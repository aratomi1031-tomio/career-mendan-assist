// 議事録ドラフトのMarkdown生成。記録された構造化データのみから機械的に組み立てる
// （AIによる自然文要約ではない。最終的な確認・編集は人手で行うことを前提とする）。
import * as db from './db.js';
import { computeCompletionRate, isCriticalItemMissed } from './checklistManager.js';
import { analyzeSession, analyzeTrend } from './reflectionEngine.js';
import { formatMs } from './timer.js';
import { saveTextFile } from './fileSave.js';

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

export async function buildMinutes(sessionId) {
  const [session, phaseConfig, checklistConfig, phaseLogs, checklistEvents, notes, insights, trends] = await Promise.all([
    db.getSession(sessionId),
    db.getSetting('phaseConfig'),
    db.getSetting('checklistConfig'),
    db.listPhaseLogs(sessionId),
    db.listChecklistEvents(sessionId),
    db.listNotes(sessionId),
    analyzeSession(sessionId),
    analyzeTrend(sessionId),
  ]);

  const actuals = aggregatePhaseActuals(phaseLogs);
  const lines = [];

  lines.push(`# 面談議事録（ドラフト）`);
  lines.push('');
  lines.push(`- 日時: ${formatDateTime(session.startedAt)}`);
  lines.push(`- 面談時間: ${formatMs(session.totalDurationMs || 0)}`);
  lines.push(`- 相談者からの同意: ${session.consentGiven ? '取得済み' : '未確認'}`);
  lines.push(`- 録音ファイル: ${session.recordingSaved ? (session.recordingSavedFileName || '保存済み') : '未保存'}`);
  lines.push('');

  lines.push(`## フェーズ別タイムテーブル`);
  lines.push('');
  lines.push('| フェーズ | 目標 | 実績 | 差分 |');
  lines.push('|---|---|---|---|');
  for (const phase of phaseConfig) {
    const agg = actuals.get(phase.key);
    const targetMs = phase.targetMinutes * 60 * 1000;
    const actualMs = agg ? agg.actualDurationMs : 0;
    const deltaPct = targetMs > 0 ? Math.round((actualMs / targetMs) * 100) : 0;
    lines.push(`| ${phase.label} | ${phase.targetMinutes}分 | ${formatMs(actualMs)} | ${deltaPct}% |`);
  }
  lines.push('');

  function notesForPhase(phaseKey) {
    return notes.filter((n) => n.phaseKey === phaseKey);
  }

  function renderNotesSection(title, phaseKeys, criticalCheckLabel) {
    lines.push(`## ${title}`);
    lines.push('');
    const relevant = phaseKeys.flatMap((k) => notesForPhase(k));
    if (relevant.length === 0) {
      lines.push('（記録されたメモはありません）');
    } else {
      for (const n of relevant.sort((a, b) => a.elapsedMsTotal - b.elapsedMsTotal)) {
        lines.push(`- [${formatMs(n.elapsedMsTotal)}] ${n.text}`);
      }
    }
    if (criticalCheckLabel) {
      const { phaseKey, itemKey, label } = criticalCheckLabel;
      const missed = isCriticalItemMissed(checklistConfig, checklistEvents, phaseKey, itemKey);
      lines.push('');
      lines.push(`${label}: ${missed ? '❌ 未実施' : '✅ 実施済み'}`);
    }
    lines.push('');
  }

  const assessmentCritical = (checklistConfig.assessment || []).find((i) => i.critical);
  renderNotesSection(
    '相談者の状況・課題',
    ['assessment'],
    assessmentCritical ? { phaseKey: 'assessment', itemKey: assessmentCritical.key, label: '課題確認チェック' } : null
  );

  const goalCritical = (checklistConfig.goalsetting || []).find((i) => i.critical);
  renderNotesSection(
    '目標（ありたい姿）',
    ['goalsetting'],
    goalCritical ? { phaseKey: 'goalsetting', itemKey: goalCritical.key, label: 'ありたい姿確認チェック' } : null
  );

  renderNotesSection('方策・次のアクション', ['action'], null);

  lines.push(`## チェックリスト実施状況`);
  lines.push('');
  lines.push('| フェーズ | 実施率 |');
  lines.push('|---|---|');
  for (const phase of phaseConfig) {
    const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
    lines.push(`| ${phase.label} | ${comp.checked}/${comp.total} |`);
  }
  lines.push('');

  lines.push(`## 次回に向けて`);
  lines.push('');
  const evalNotes = notesForPhase('evaluation');
  if (evalNotes.length > 0) {
    for (const n of evalNotes) lines.push(`- [${formatMs(n.elapsedMsTotal)}] ${n.text}`);
  }
  const warnItems = insights.filter((i) => i.severity === 'warn');
  for (const w of warnItems) lines.push(`- ${w.text}`);
  if (evalNotes.length === 0 && warnItems.length === 0) {
    lines.push('（特記事項なし）');
  }
  lines.push('');

  if (trends.length > 0) {
    lines.push(`## 傾向（直近セッションとの比較）`);
    lines.push('');
    for (const t of trends) lines.push(`- ${t.text}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('※本ドラフトは記録データから機械的に生成したものです。内容の確認・加筆修正のうえご利用ください。');

  return lines.join('\n');
}

export function suggestedMinutesFileName(session) {
  const d = new Date(session.startedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `gijiroku-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
}

export async function exportMarkdown(sessionId, mdOverride) {
  const md = mdOverride || (await buildMinutes(sessionId));
  const session = await db.getSession(sessionId);
  const fileName = suggestedMinutesFileName(session);
  return saveTextFile(md, fileName);
}
