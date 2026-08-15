// フェーズ状態管理。フェーズ切り替えのたびにphaseLogsへ1行記録する。
// 同じフェーズに複数回入っても構わない（訪問ごとに新しい行）。
import * as db from './db.js';

export class PhaseManager {
  constructor({ phases, timer, sessionId, onPhaseChange }) {
    this.phases = phases; // [{key, label, targetMinutes}]
    this.timer = timer;
    this.sessionId = sessionId;
    this.onPhaseChange = onPhaseChange || (() => {});
    this.currentIndex = 0;
    this.currentLogId = null;
    this._switching = false;
  }

  getCurrentPhase() {
    return this.phases[this.currentIndex];
  }

  async start() {
    this.currentIndex = 0;
    await this._openLog(this.getCurrentPhase());
    this.onPhaseChange(this.getCurrentPhase());
  }

  async switchPhase(phaseKey) {
    // 切り替え処理（DB書き込みを挟む非同期処理）の最中に別のフェーズボタンを
    // 連打されると、ログの開閉やcurrentIndexの更新が競合してしまうため、
    // 処理中の呼び出しは無視する。
    if (this._switching) return;
    const idx = this.phases.findIndex((p) => p.key === phaseKey);
    if (idx === -1 || idx === this.currentIndex) return;
    this._switching = true;
    try {
      await this._closeCurrentLog();
      this.currentIndex = idx;
      this.timer.restartPhaseClock();
      await this._openLog(this.getCurrentPhase());
      this.onPhaseChange(this.getCurrentPhase());
    } finally {
      this._switching = false;
    }
  }

  async finish() {
    await this._closeCurrentLog();
  }

  async _openLog(phase) {
    this.currentLogId = await db.addPhaseLog({
      sessionId: this.sessionId,
      phaseKey: phase.key,
      phaseLabel: phase.label,
      targetDurationMs: phase.targetMinutes * 60 * 1000,
      enteredAt: Date.now(),
      exitedAt: null,
      actualDurationMs: 0,
    });
  }

  async _closeCurrentLog() {
    if (this.currentLogId === null) return;
    await db.closePhaseLog(this.currentLogId, Date.now(), this.timer.getElapsedPhaseMs());
    this.currentLogId = null;
  }
}
