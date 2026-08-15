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
    // フェーズ切替・面談終了はいずれもcurrentLogIdを読み書きする非同期処理なので、
    // このキューを介して直列実行する。連打や「切替中に終了ボタン」のような組み合わせで
    // ログの開閉が競合するのを防ぐ（単純な処理中フラグだと、切替中に来た次の指示を
    // 無視するだけで、例えばB→Cと素早く連打した場合にCへの遷移が失われてしまう）。
    this._queue = Promise.resolve();
  }

  getCurrentPhase() {
    return this.phases[this.currentIndex];
  }

  async start() {
    this.currentIndex = 0;
    await this._openLog(this.getCurrentPhase());
    this.onPhaseChange(this.getCurrentPhase());
  }

  switchPhase(phaseKey) {
    return this._enqueue(async () => {
      const idx = this.phases.findIndex((p) => p.key === phaseKey);
      if (idx === -1 || idx === this.currentIndex) return;
      await this._closeCurrentLog();
      this.currentIndex = idx;
      this.timer.restartPhaseClock();
      await this._openLog(this.getCurrentPhase());
      this.onPhaseChange(this.getCurrentPhase());
    });
  }

  finish() {
    return this._enqueue(() => this._closeCurrentLog());
  }

  _enqueue(fn) {
    const run = this._queue.then(fn);
    // 1件のエラーでキュー全体が止まらないよう、チェーンに伝播する失敗はここで吸収する
    // （呼び出し元へはrunそのものを返すのでエラーは呼び出し元にも伝わる）。
    this._queue = run.catch(() => {});
    return run;
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
