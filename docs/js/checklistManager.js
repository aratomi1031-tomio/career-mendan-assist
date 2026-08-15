// フェーズ連動の共通スキルチェックリスト。クリックのたびにイベントを記録する
// （繰り返しクリックも許容・記録するが、UI上は「そのフェーズ訪問での初回クリック」を
// 完了表示に使い、会話を止めずに一発で分かるようにする）。
import * as db from './db.js';

export class ChecklistManager {
  constructor({ checklistConfig, sessionId, timer }) {
    this.checklistConfig = checklistConfig; // { phaseKey: [{key,label,critical}] }
    this.sessionId = sessionId;
    this.timer = timer;
    this.checkedInCurrentVisit = new Set();
  }

  itemsForPhase(phaseKey) {
    return this.checklistConfig[phaseKey] || [];
  }

  resetVisit() {
    this.checkedInCurrentVisit = new Set();
  }

  async onItemClick(phaseKey, item) {
    await db.addChecklistEvent({
      sessionId: this.sessionId,
      phaseKey,
      itemKey: item.key,
      itemLabel: item.label,
      timestamp: Date.now(),
      elapsedMsInPhase: this.timer.getElapsedPhaseMs(),
      elapsedMsTotal: this.timer.getElapsedTotalMs(),
    });
    const isFirst = !this.checkedInCurrentVisit.has(item.key);
    this.checkedInCurrentVisit.add(item.key);
    return isFirst;
  }

  isCheckedInCurrentVisit(itemKey) {
    return this.checkedInCurrentVisit.has(itemKey);
  }
}

// 完了率 = セッション全体で最低1回はクリックされた項目数 / 設定項目数
export function computeCompletionRate(checklistConfig, checklistEvents, phaseKey) {
  const items = checklistConfig[phaseKey] || [];
  if (items.length === 0) return { rate: 0, checked: 0, total: 0 };
  const checkedKeys = new Set(
    checklistEvents.filter((e) => e.phaseKey === phaseKey).map((e) => e.itemKey)
  );
  const checked = items.filter((i) => checkedKeys.has(i.key)).length;
  return { rate: checked / items.length, checked, total: items.length };
}

export function isCriticalItemMissed(checklistConfig, checklistEvents, phaseKey, itemKey) {
  const checkedKeys = new Set(
    checklistEvents.filter((e) => e.phaseKey === phaseKey).map((e) => e.itemKey)
  );
  return !checkedKeys.has(itemKey);
}
