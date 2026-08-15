// 設定画面：フェーズ構成・チェックリスト項目をコード編集なしで自由に編集できるようにする。
import * as db from './db.js';
import { DEFAULT_PHASES, DEFAULT_CHECKLIST } from './defaultConfig.js';

function slugify(label, existingKeys) {
  let base = 'phase-' + Math.random().toString(36).slice(2, 8);
  let key = base;
  let i = 1;
  while (existingKeys.has(key)) {
    key = `${base}-${i++}`;
  }
  return key;
}

export class SettingsManager {
  constructor(container) {
    this.container = container;
    this.phaseConfig = [];
    this.checklistConfig = {};
  }

  async load() {
    this.phaseConfig = (await db.getSetting('phaseConfig')) || DEFAULT_PHASES;
    this.checklistConfig = (await db.getSetting('checklistConfig')) || DEFAULT_CHECKLIST;
  }

  async render() {
    await this.load();
    this.container.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'settings-intro';
    intro.textContent = '面談のフェーズ構成と、各フェーズで確認する共通スキル項目を編集できます。ここでの初期値はあくまで叩き台です。ご自身の手法・組織の基準に合わせて自由に書き換えてください。';
    this.container.appendChild(intro);

    const phaseSection = document.createElement('div');
    phaseSection.className = 'settings-section';
    const phaseTitle = document.createElement('h3');
    phaseTitle.textContent = 'フェーズ構成';
    phaseSection.appendChild(phaseTitle);
    this.phaseListEl = document.createElement('div');
    this.phaseListEl.className = 'phase-edit-list';
    phaseSection.appendChild(this.phaseListEl);

    const addPhaseBtn = document.createElement('button');
    addPhaseBtn.type = 'button';
    addPhaseBtn.className = 'btn-secondary';
    addPhaseBtn.textContent = '＋ フェーズを追加';
    addPhaseBtn.addEventListener('click', () => this._addPhase());
    phaseSection.appendChild(addPhaseBtn);
    this.container.appendChild(phaseSection);

    const checklistSection = document.createElement('div');
    checklistSection.className = 'settings-section';
    const checklistTitle = document.createElement('h3');
    checklistTitle.textContent = 'チェックリスト項目';
    checklistSection.appendChild(checklistTitle);
    this.checklistListEl = document.createElement('div');
    this.checklistListEl.className = 'checklist-edit-list';
    checklistSection.appendChild(this.checklistListEl);
    this.container.appendChild(checklistSection);

    const actions = document.createElement('div');
    actions.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => this.save());
    actions.appendChild(saveBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn-secondary';
    resetBtn.textContent = '初期値に戻す';
    resetBtn.addEventListener('click', () => this._resetToDefaults());
    actions.appendChild(resetBtn);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn-secondary';
    exportBtn.textContent = '全データをバックアップ（JSON）';
    exportBtn.addEventListener('click', () => this._exportAllData());
    actions.appendChild(exportBtn);

    const importLabel = document.createElement('label');
    importLabel.className = 'btn-secondary file-input-label';
    importLabel.textContent = 'バックアップから復元';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', (e) => this._importAllData(e));
    importLabel.appendChild(importInput);
    actions.appendChild(importLabel);

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'settings-status';
    actions.appendChild(this.statusEl);

    this.container.appendChild(actions);

    this._renderPhaseList();
    this._renderChecklistList();
  }

  _renderPhaseList() {
    this.phaseListEl.innerHTML = '';
    this.phaseConfig.forEach((phase, idx) => {
      const row = document.createElement('div');
      row.className = 'phase-edit-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = phase.label;
      labelInput.addEventListener('input', () => { phase.label = labelInput.value; });
      row.appendChild(labelInput);

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.min = '1';
      minInput.value = phase.targetMinutes;
      minInput.addEventListener('input', () => { phase.targetMinutes = Number(minInput.value) || 1; });
      row.appendChild(minInput);

      const minLabel = document.createElement('span');
      minLabel.textContent = '分';
      row.appendChild(minLabel);

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = '↑';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => this._movePhase(idx, -1));
      row.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === this.phaseConfig.length - 1;
      downBtn.addEventListener('click', () => this._movePhase(idx, 1));
      row.appendChild(downBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-danger';
      removeBtn.textContent = '削除';
      removeBtn.addEventListener('click', () => this._removePhase(idx));
      row.appendChild(removeBtn);

      this.phaseListEl.appendChild(row);
    });
  }

  _movePhase(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= this.phaseConfig.length) return;
    const [item] = this.phaseConfig.splice(idx, 1);
    this.phaseConfig.splice(newIdx, 0, item);
    this._renderPhaseList();
  }

  _addPhase() {
    const existingKeys = new Set(this.phaseConfig.map((p) => p.key));
    const key = slugify('新しいフェーズ', existingKeys);
    this.phaseConfig.push({ key, label: '新しいフェーズ', targetMinutes: 5 });
    this.checklistConfig[key] = [];
    this._renderPhaseList();
    this._renderChecklistList();
  }

  _removePhase(idx) {
    const [removed] = this.phaseConfig.splice(idx, 1);
    if (removed) delete this.checklistConfig[removed.key];
    this._renderPhaseList();
    this._renderChecklistList();
  }

  _renderChecklistList() {
    this.checklistListEl.innerHTML = '';
    this.phaseConfig.forEach((phase) => {
      const group = document.createElement('div');
      group.className = 'checklist-edit-group';
      const heading = document.createElement('h4');
      heading.textContent = phase.label;
      group.appendChild(heading);

      const items = this.checklistConfig[phase.key] || (this.checklistConfig[phase.key] = []);
      items.forEach((item, itemIdx) => {
        const row = document.createElement('div');
        row.className = 'checklist-edit-row';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = item.label;
        textInput.addEventListener('input', () => { item.label = textInput.value; });
        row.appendChild(textInput);

        const criticalLabel = document.createElement('label');
        criticalLabel.className = 'critical-checkbox';
        const criticalCheckbox = document.createElement('input');
        criticalCheckbox.type = 'checkbox';
        criticalCheckbox.checked = !!item.critical;
        criticalCheckbox.addEventListener('change', () => { item.critical = criticalCheckbox.checked; });
        criticalLabel.appendChild(criticalCheckbox);
        criticalLabel.appendChild(document.createTextNode('重要項目'));
        row.appendChild(criticalLabel);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-danger';
        removeBtn.textContent = '削除';
        removeBtn.addEventListener('click', () => {
          items.splice(itemIdx, 1);
          this._renderChecklistList();
        });
        row.appendChild(removeBtn);

        group.appendChild(row);
      });

      const addItemBtn = document.createElement('button');
      addItemBtn.type = 'button';
      addItemBtn.className = 'btn-secondary';
      addItemBtn.textContent = '＋ 項目を追加';
      addItemBtn.addEventListener('click', () => {
        const existingKeys = new Set(items.map((i) => i.key));
        let n = items.length + 1;
        let key = `${phase.key}-${n}`;
        while (existingKeys.has(key)) key = `${phase.key}-${++n}`;
        items.push({ key, label: '新しい項目', critical: false });
        this._renderChecklistList();
      });
      group.appendChild(addItemBtn);

      this.checklistListEl.appendChild(group);
    });
  }

  async save() {
    await db.setSetting('phaseConfig', this.phaseConfig);
    await db.setSetting('checklistConfig', this.checklistConfig);
    this.statusEl.textContent = '保存しました';
    setTimeout(() => { this.statusEl.textContent = ''; }, 2500);
  }

  async _resetToDefaults() {
    if (!confirm('フェーズ構成とチェックリストを初期値に戻します。よろしいですか？')) return;
    this.phaseConfig = JSON.parse(JSON.stringify(DEFAULT_PHASES));
    this.checklistConfig = JSON.parse(JSON.stringify(DEFAULT_CHECKLIST));
    this._renderPhaseList();
    this._renderChecklistList();
  }

  async _exportAllData() {
    const data = await db.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    a.href = url;
    a.download = `mendan-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async _importAllData(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('現在のデータをすべて上書きして、バックアップから復元します。よろしいですか？')) {
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await db.importAllData(data);
      alert('復元が完了しました。画面を再読み込みします。');
      location.reload();
    } catch (err) {
      alert('復元に失敗しました: ' + err.message);
    }
    e.target.value = '';
  }
}
