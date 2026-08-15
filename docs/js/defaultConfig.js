// 初期フェーズ構成・チェックリスト定義（叩き台）。
// 設定画面から自由に編集できるので、ここは初回起動時のシード値に過ぎない。

export const DEFAULT_PHASES = [
  { key: 'rapport', label: '関係構築', targetMinutes: 5 },
  { key: 'assessment', label: '問題の把握', targetMinutes: 15 },
  { key: 'goalsetting', label: '目標設定', targetMinutes: 15 },
  { key: 'action', label: '方策の実行', targetMinutes: 10 },
  { key: 'evaluation', label: '結果の評価', targetMinutes: 5 },
];

export const DEFAULT_CHECKLIST = {
  rapport: [
    { key: 'r1', label: '傾聴・受容的態度で応対した', critical: false },
    { key: 'r2', label: '相手の話を遮らず最後まで聞いた', critical: false },
    { key: 'r3', label: 'ラポール（信頼関係）形成を意識した働きかけをした', critical: false },
  ],
  assessment: [
    { key: 'a1', label: '開かれた質問で状況を深掘りした', critical: false },
    { key: 'a2', label: '相談者の発言を要約・言い換えて理解を確認した', critical: false },
    { key: 'a3', label: '感情の反射（気持ちを言語化して返す）を行った', critical: false },
    { key: 'a4', label: '課題を本人の言葉で確認した', critical: true },
  ],
  goalsetting: [
    { key: 'g1', label: 'ありたい姿・将来像を本人の言葉で確認した', critical: true },
    { key: 'g2', label: '課題を本人と共有できた', critical: true },
    { key: 'g3', label: '目標を具体的・現実的な形に落とし込んだ', critical: false },
  ],
  action: [
    { key: 'ac1', label: '次のアクション（行動計画）を具体的に決めた', critical: false },
    { key: 'ac2', label: '行動の障害・懸念点を一緒に検討した', critical: false },
    { key: 'ac3', label: '相談者自身の言葉で行動計画を確認した', critical: false },
  ],
  evaluation: [
    { key: 'e1', label: '面談全体の振り返りを相談者と共有した', critical: false },
    { key: 'e2', label: '次回面談の予定・フォローアップを確認した', critical: false },
    { key: 'e3', label: '相談者の感想・納得感を確認した', critical: false },
  ],
};
