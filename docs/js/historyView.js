// 過去セッション一覧・閲覧（自己の成長トラッキング用）。
import * as db from './db.js';
import { formatMs } from './timer.js';
import { renderSessionSummary } from './ui.js';

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class HistoryView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    const sessions = await db.listSessions();
    this.container.innerHTML = '';

    if (sessions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'まだ保存された面談セッションはありません。';
      this.container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'history-list';
    sessions.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'history-row';

      const info = document.createElement('div');
      info.className = 'history-row-info';
      const statusLabel = s.status === 'completed' ? '完了' : '未完了（途中で終了）';
      const statusClass = s.status === 'completed' ? 'history-status-completed' : 'history-status-incomplete';
      // 未完了セッションはtotalDurationMsが0のまま記録されている場合があるため、
      // 「0秒の面談だった」と誤解されないよう文言を分ける。
      const durationLabel = (s.status === 'completed' || s.totalDurationMs > 0)
        ? formatMs(s.totalDurationMs || 0)
        : '時間の記録なし';
      info.innerHTML = `<strong>${formatDateTime(s.startedAt)}</strong> — <span class="${statusClass}">${statusLabel}</span> / ${durationLabel}`;
      row.appendChild(info);

      const btnRow = document.createElement('div');

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-secondary';
      viewBtn.textContent = '詳細';
      viewBtn.addEventListener('click', () => this._showDetail(s.id));
      btnRow.appendChild(viewBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-danger';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        if (!confirm('このセッションの記録を削除します。よろしいですか？')) return;
        await db.deleteSession(s.id);
        this.render();
      });
      btnRow.appendChild(delBtn);

      row.appendChild(btnRow);
      list.appendChild(row);
    });
    this.container.appendChild(list);

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'history-detail';
    this.container.appendChild(this.detailEl);
  }

  async _showDetail(sessionId) {
    this.detailEl.innerHTML = '読み込み中…';
    await renderSessionSummary(this.detailEl, sessionId, { readOnly: true });
  }
}
