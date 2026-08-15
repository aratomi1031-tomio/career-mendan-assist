// ファイル保存の共通ヘルパー。File System Access APIが使えればフォルダ選択保存、
// 非対応ブラウザは<a download>にフォールバックする。外部への送信は一切行わない。
export async function saveBlob(blob, suggestedName, acceptTypes) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = '.' + suggestedName.split('.').pop();
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'File', accept: acceptTypes || { [blob.type || 'application/octet-stream']: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: 'picker', fileName: handle.name };
    } catch (err) {
      if (err && err.name === 'AbortError') return { method: 'cancelled' };
      // フォールバックへ
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download', fileName: suggestedName };
}

export async function saveTextFile(text, suggestedName) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  return saveBlob(blob, suggestedName, { 'text/markdown': ['.md'] });
}
