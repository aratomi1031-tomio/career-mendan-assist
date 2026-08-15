// MediaRecorderラッパー。録音データは常にメモリ上のみに保持し、
// IndexedDBや外部サーバーには一切送らない。保存はユーザーの明示操作でのみ行う。
import { saveBlob } from './fileSave.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export class Recorder {
  constructor() {
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.mimeType = null;
  }

  async requestMicPermission() {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return this.mediaStream;
  }

  startRecording() {
    if (!this.mediaStream) throw new Error('マイクの許可がまだ取得されていません');
    this.mimeType = pickMimeType();
    if (this.mimeType === null) throw new Error('このブラウザは録音に対応していません');
    this.chunks = [];
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(1000);
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) return resolve(null);
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  releaseMic() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  suggestedFileName() {
    const ext = (this.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `mendan-${stamp}.${ext}`;
  }

  async saveRecording(blob, suggestedName) {
    const ext = '.' + suggestedName.split('.').pop();
    return saveBlob(blob, suggestedName, { [blob.type || 'audio/webm']: [ext] });
  }
}
