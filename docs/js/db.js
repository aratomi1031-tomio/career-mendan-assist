// IndexedDBラッパー。音声データは一切保存しない — 保存するのは
// タイマー・チェックリスト・メモなどの構造化データのみ。
import { DEFAULT_PHASES, DEFAULT_CHECKLIST } from './defaultConfig.js';

const DB_NAME = 'mendanDB';
const DB_VERSION = 1;

let dbPromise = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('phaseLogs')) {
        const s = db.createObjectStore('phaseLogs', { keyPath: 'logId', autoIncrement: true });
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('phaseKey', 'phaseKey');
      }
      if (!db.objectStoreNames.contains('checklistEvents')) {
        const s = db.createObjectStore('checklistEvents', { keyPath: 'eventId', autoIncrement: true });
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('phaseKey', 'phaseKey');
        s.createIndex('itemKey', 'itemKey');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'noteId', autoIncrement: true });
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('phaseKey', 'phaseKey');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

export async function seedDefaultsIfEmpty() {
  const db = await openDB();
  const existing = await getSetting('phaseConfig');
  if (existing) return;
  await setSetting('phaseConfig', DEFAULT_PHASES);
  await setSetting('checklistConfig', DEFAULT_CHECKLIST);
  await setSetting('appPrefs', { createdAt: Date.now() });
}

export async function getSetting(key) {
  const db = await openDB();
  const store = tx(db, 'settings', 'readonly').objectStore('settings');
  const row = await promisifyRequest(store.get(key));
  return row ? row.value : undefined;
}

export async function setSetting(key, value) {
  const db = await openDB();
  const store = tx(db, 'settings', 'readwrite').objectStore('settings');
  await promisifyRequest(store.put({ key, value }));
}

export async function createSession(session) {
  const db = await openDB();
  const store = tx(db, 'sessions', 'readwrite').objectStore('sessions');
  await promisifyRequest(store.add(session));
  return session.id;
}

export async function updateSession(id, patch) {
  const db = await openDB();
  const store = tx(db, 'sessions', 'readwrite').objectStore('sessions');
  const current = await promisifyRequest(store.get(id));
  if (!current) throw new Error(`session not found: ${id}`);
  const updated = { ...current, ...patch };
  await promisifyRequest(store.put(updated));
  return updated;
}

export async function getSession(id) {
  const db = await openDB();
  const store = tx(db, 'sessions', 'readonly').objectStore('sessions');
  return promisifyRequest(store.get(id));
}

export async function deleteSession(id) {
  const db = await openDB();
  const t = tx(db, ['sessions', 'phaseLogs', 'checklistEvents', 'notes'], 'readwrite');
  t.objectStore('sessions').delete(id);
  await deleteAllByIndex(t.objectStore('phaseLogs'), 'sessionId', id);
  await deleteAllByIndex(t.objectStore('checklistEvents'), 'sessionId', id);
  await deleteAllByIndex(t.objectStore('notes'), 'sessionId', id);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function deleteAllByIndex(store, indexName, value) {
  return new Promise((resolve, reject) => {
    const req = store.index(indexName).openCursor(IDBKeyRange.only(value));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listSessions() {
  const db = await openDB();
  const store = tx(db, 'sessions', 'readonly').objectStore('sessions');
  const all = await promisifyRequest(store.getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

function getAllByIndex(store, indexName, value) {
  return promisifyRequest(store.index(indexName).getAll(IDBKeyRange.only(value)));
}

export async function addPhaseLog(entry) {
  const db = await openDB();
  const store = tx(db, 'phaseLogs', 'readwrite').objectStore('phaseLogs');
  return promisifyRequest(store.add(entry));
}

export async function closePhaseLog(logId, exitedAt, actualDurationMs) {
  const db = await openDB();
  const store = tx(db, 'phaseLogs', 'readwrite').objectStore('phaseLogs');
  const row = await promisifyRequest(store.get(logId));
  if (!row) return;
  row.exitedAt = exitedAt;
  row.actualDurationMs = actualDurationMs;
  await promisifyRequest(store.put(row));
}

export async function listPhaseLogs(sessionId) {
  const db = await openDB();
  const store = tx(db, 'phaseLogs', 'readonly').objectStore('phaseLogs');
  return getAllByIndex(store, 'sessionId', sessionId);
}

export async function addChecklistEvent(entry) {
  const db = await openDB();
  const store = tx(db, 'checklistEvents', 'readwrite').objectStore('checklistEvents');
  return promisifyRequest(store.add(entry));
}

export async function listChecklistEvents(sessionId) {
  const db = await openDB();
  const store = tx(db, 'checklistEvents', 'readonly').objectStore('checklistEvents');
  return getAllByIndex(store, 'sessionId', sessionId);
}

export async function addNote(entry) {
  const db = await openDB();
  const store = tx(db, 'notes', 'readwrite').objectStore('notes');
  return promisifyRequest(store.add(entry));
}

export async function listNotes(sessionId) {
  const db = await openDB();
  const store = tx(db, 'notes', 'readonly').objectStore('notes');
  const rows = await getAllByIndex(store, 'sessionId', sessionId);
  return rows.sort((a, b) => a.elapsedMsTotal - b.elapsedMsTotal);
}

export async function exportAllData() {
  const db = await openDB();
  const storeNames = ['sessions', 'phaseLogs', 'checklistEvents', 'notes', 'settings'];
  const t = tx(db, storeNames, 'readonly');
  const data = {};
  for (const name of storeNames) {
    data[name] = await promisifyRequest(t.objectStore(name).getAll());
  }
  data.exportedAt = Date.now();
  data.dbVersion = DB_VERSION;
  return data;
}

export async function importAllData(data) {
  const db = await openDB();
  const storeNames = ['sessions', 'phaseLogs', 'checklistEvents', 'notes', 'settings'];
  const t = tx(db, storeNames, 'readwrite');
  for (const name of storeNames) {
    if (!Array.isArray(data[name])) continue;
    const store = t.objectStore(name);
    store.clear();
    for (const row of data[name]) store.put(row);
  }
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
