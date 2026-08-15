// 振り返りインサイト生成。AIによる自然文要約ではなく、決まった閾値に基づく
// 機械的なルールベース判定。閾値はここで一括管理し、後から調整しやすくする。
//
// フェーズ・チェックリストの構成は、そのセッション実施当時のスナップショット
// （session.phaseConfigSnapshot / checklistConfigSnapshot、db.getSessionConfig経由）を使う。
// 設定を後から変更しても、過去セッションの振り返り内容が変わらないようにするため。
import * as db from './db.js';
import { computeCompletionRate, isCriticalItemMissed } from './checklistManager.js';

export const RUSHED_RATIO = 0.5;
export const LONG_RATIO = 1.5;
export const OK_RATIO_LOW = 0.8;
export const OK_RATIO_HIGH = 1.2;
export const LOW_COMPLETION = 0.34;
export const TREND_RATIO_DELTA = 0.2;
export const TREND_COMPLETION_DELTA = 0.15;
export const TREND_LOOKBACK_N = 5;
export const MIN_PRIOR_SESSIONS_FOR_TREND = 2;

function aggregatePhaseActuals(phaseLogs) {
  // 同じフェーズに複数回訪問した場合は合算する
  const map = new Map();
  for (const log of phaseLogs) {
    const cur = map.get(log.phaseKey) || { actualDurationMs: 0, targetDurationMs: log.targetDurationMs };
    cur.actualDurationMs += log.actualDurationMs || 0;
    map.set(log.phaseKey, cur);
  }
  return map;
}

export async function analyzeSession(sessionId) {
  const [{ phaseConfig, checklistConfig }, phaseLogs, checklistEvents] = await Promise.all([
    db.getSessionConfig(sessionId),
    db.listPhaseLogs(sessionId),
    db.listChecklistEvents(sessionId),
  ]);

  const actuals = aggregatePhaseActuals(phaseLogs);
  const insights = [];
  const criticalWarnings = [];

  for (const phase of phaseConfig) {
    const agg = actuals.get(phase.key);
    const targetMs = phase.targetMinutes * 60 * 1000;

    // 重要チェック項目の未実施（最優先で表示）
    const items = checklistConfig[phase.key] || [];
    for (const item of items.filter((i) => i.critical)) {
      if (isCriticalItemMissed(checklistConfig, checklistEvents, phase.key, item.key)) {
        criticalWarnings.push({
          severity: 'warn',
          text: `重要: 「${item.label}」（${phase.label}）が面談中に確認できていない可能性があります。`,
        });
      }
    }

    if (agg && targetMs > 0) {
      const ratio = agg.actualDurationMs / targetMs;
      if (ratio < RUSHED_RATIO) {
        insights.push({ severity: 'warn', text: `『${phase.label}』フェーズが目標時間の半分未満でした。駆け足になっていた可能性があります。` });
      } else if (ratio > LONG_RATIO) {
        insights.push({ severity: 'info', text: `『${phase.label}』フェーズが目標時間の1.5倍を超えました。他フェーズの時間を圧迫していないか確認しましょう。` });
      } else if (ratio >= OK_RATIO_LOW && ratio <= OK_RATIO_HIGH) {
        insights.push({ severity: 'positive', text: `『${phase.label}』フェーズは概ね計画通りの時間配分でした。` });
      }
    }

    const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
    if (comp.total > 0) {
      if (comp.rate < LOW_COMPLETION) {
        insights.push({ severity: 'warn', text: `『${phase.label}』フェーズで確認できた基本行動が少なめでした（${comp.checked}/${comp.total}）。` });
      } else if (comp.rate === 1.0) {
        insights.push({ severity: 'positive', text: `『${phase.label}』フェーズは全項目を確認できました。` });
      }
    }
  }

  return [...criticalWarnings, ...insights];
}

async function computeSessionStats(sessionId) {
  const [{ phaseConfig, checklistConfig }, phaseLogs, checklistEvents] = await Promise.all([
    db.getSessionConfig(sessionId),
    db.listPhaseLogs(sessionId),
    db.listChecklistEvents(sessionId),
  ]);
  const actuals = aggregatePhaseActuals(phaseLogs);
  const perPhase = {};
  let totalMs = 0;
  for (const phase of phaseConfig) {
    const agg = actuals.get(phase.key);
    const actualMs = agg ? agg.actualDurationMs : 0;
    totalMs += actualMs;
    const targetMs = phase.targetMinutes * 60 * 1000;
    const ratio = targetMs > 0 ? actualMs / targetMs : null;
    const comp = computeCompletionRate(checklistConfig, checklistEvents, phase.key);
    perPhase[phase.key] = { ratio, rate: comp.rate };
  }
  return { perPhase, totalMs };
}

export async function analyzeTrend(sessionId, lookbackN = TREND_LOOKBACK_N) {
  const { session, phaseConfig } = await db.getSessionConfig(sessionId);
  const allSessions = await db.listSessions();
  const priorSessions = allSessions
    .filter((s) => s.status === 'completed' && s.id !== sessionId && s.startedAt < session.startedAt)
    .slice(0, lookbackN);

  if (priorSessions.length < MIN_PRIOR_SESSIONS_FOR_TREND) return [];

  const current = await computeSessionStats(sessionId);
  const priorStats = await Promise.all(priorSessions.map((s) => computeSessionStats(s.id)));

  const trends = [];

  // 過去セッションはフェーズ構成が異なる（設定変更前後をまたぐ）ことがあるため、
  // そのフェーズキーのデータを持つ過去セッションだけを対象に平均を取る。
  for (const phase of phaseConfig) {
    const ratios = priorStats
      .map((s) => s.perPhase[phase.key]?.ratio)
      .filter((r) => r !== null && r !== undefined);
    const rates = priorStats
      .map((s) => s.perPhase[phase.key]?.rate)
      .filter((r) => r !== undefined);
    const curRatio = current.perPhase[phase.key]?.ratio;
    const curRate = current.perPhase[phase.key]?.rate;

    if (ratios.length > 0 && curRatio !== null && curRatio !== undefined) {
      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      if (Math.abs(curRatio - avgRatio) > TREND_RATIO_DELTA) {
        const direction = curRatio > avgRatio ? '長め' : '短め';
        trends.push({ severity: 'info', text: `傾向: 『${phase.label}』フェーズの所要時間が直近${ratios.length}回の平均より${direction}です。` });
      }
    }

    if (rates.length > 0 && curRate !== undefined) {
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      if (Math.abs(curRate - avgRate) > TREND_COMPLETION_DELTA) {
        const direction = curRate > avgRate ? '高め' : '低め';
        trends.push({ severity: 'info', text: `傾向: 『${phase.label}』フェーズのチェック実施率が直近${rates.length}回の平均より${direction}です。` });
      }
    }
  }

  const priorTotals = priorStats.map((s) => s.totalMs);
  const avgTotal = priorTotals.reduce((a, b) => a + b, 0) / priorTotals.length;
  if (avgTotal > 0 && Math.abs(current.totalMs - avgTotal) > avgTotal * TREND_RATIO_DELTA) {
    const direction = current.totalMs > avgTotal ? '長め' : '短め';
    trends.push({ severity: 'info', text: `傾向: 面談全体の所要時間が直近${priorStats.length}回の平均より${direction}です。` });
  }

  return trends;
}
