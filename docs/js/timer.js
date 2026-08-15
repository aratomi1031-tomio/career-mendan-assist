// 全体タイマー＋フェーズ別タイマー。performance.now()基準でドリフトを避ける。
export class TimerEngine {
  constructor(onTick) {
    this.onTick = onTick;
    this._sessionStart = null;
    this._phaseStart = null;
    this._intervalId = null;
  }

  start() {
    this._sessionStart = performance.now();
    this._phaseStart = this._sessionStart;
    this._intervalId = setInterval(() => this._tick(), 500);
    this._tick();
  }

  stop() {
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = null;
  }

  restartPhaseClock() {
    this._phaseStart = performance.now();
  }

  getElapsedTotalMs() {
    if (this._sessionStart === null) return 0;
    return Math.round(performance.now() - this._sessionStart);
  }

  getElapsedPhaseMs() {
    if (this._phaseStart === null) return 0;
    return Math.round(performance.now() - this._phaseStart);
  }

  _tick() {
    if (this.onTick) {
      this.onTick({
        elapsedTotalMs: this.getElapsedTotalMs(),
        elapsedPhaseMs: this.getElapsedPhaseMs(),
      });
    }
  }
}

export function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
