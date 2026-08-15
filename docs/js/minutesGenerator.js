// 議事録ドラフトのMarkdown生成。記録された構造化データのみから機械的に組み立てる
// （AIによる自然文要約ではない。最終的な確認・編集は人手で行うことを前提とする）。
//
// フェーズ・チェックリストの構成は、そのセッション実施当時のスナップショット
// （session.phaseConfigSnapshot / checklistConfigSnapshot）を使う。設定画面で
// 後からフェーズ名や項目を変更しても、過去の議事録の内容が変わってしまわないようにするため。
import * as db from './db.js';
import { computeCompletionRate } from './checklistManager.js';
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
  const [{ session, phaseConfig, checklistConfig }, phaseLogs, checklistEvents, notes, insights, trends] = await Promise.all([
    db.getSessionConfig(sessionId),
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

  lines.push(`## フェーズ別の記録`);
  lines.push('');
  for (const phase of phaseConfig) {
    lines.push(`### ${phase.label}`);
    const phaseNotes = notes
      .filter((n) => n.phaseKey === phase.key)
      .sort((a, b) => a.elapsedMsTotal - b.elapsedMsTotal);
    if (phaseNotes.length === 0) {
      lines.push('（記録されたメモはありません）');
    } else {
      for (const n of phaseNotes) lines.push(`- [${formatMs(n.elapsedMsTotal)}] ${n.text}`);
    }

    const items = checklistConfig[phase.key] || [];
    if (items.length > 0) {
      const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
      lines.push('');
      lines.push(`チェック実施: ${comp.checked}/${comp.total}`);
      const checkedKeys = new Set(
        checklistEvents.filter((e) => e.phaseKey === phase.key).map((e) => e.itemKey)
      );
      const criticalItems = items.filter((i) => i.critical);
      if (criticalItems.length > 0) {
        for (const ci of criticalItems) {
          lines.push(`- ${checkedKeys.has(ci.key) ? '✅' : '❌'} ${ci.label}`);
        }
      }
    }
    lines.push('');
  }

  lines.push(`## 次回に向けて`);
  lines.push('');
  const warnItems = insights.filter((i) => i.severity === 'warn');
  if (warnItems.length > 0) {
    for (const w of warnItems) lines.push(`- ${w.text}`);
  } else {
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
