// タイムスタンプ・フェーズ自動タグ付きのクイックメモ。
import * as db from './db.js';

export class NotesManager {
  constructor({ sessionId, timer, phaseManager }) {
    this.sessionId = sessionId;
    this.timer = timer;
    this.phaseManager = phaseManager;
  }

  async addNote(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const phase = this.phaseManager.getCurrentPhase();
    const entry = {
      sessionId: this.sessionId,
      phaseKey: phase.key,
      timestamp: Date.now(),
      elapsedMsTotal: this.timer.getElapsedTotalMs(),
      text: trimmed,
    };
    await db.addNote(entry);
    return entry;
  }
}
