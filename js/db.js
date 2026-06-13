/* ─────────────────────────────────────────
   db.js — IndexedDB layer
   ───────────────────────────────────────── */
'use strict';

const DB_NAME    = 'piano-play';
const DB_VERSION = 1;

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('pieces')) {
        const pieces = db.createObjectStore('pieces', { keyPath: 'id' });
        pieces.createIndex('title',      'title',      { unique: false });
        pieces.createIndex('difficulty', 'difficulty', { unique: false });
        pieces.createIndex('updatedAt',  'updatedAt',  { unique: false });
      }

      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('pieceId', 'pieceId', { unique: false });
        sessions.createIndex('date',    'date',    { unique: false });
      }

      if (!db.objectStoreNames.contains('setlists')) {
        db.createObjectStore('setlists', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = ()  => reject(req.error);
  });
}

// ── Generic helpers ───────────────────────

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(storeName, mode);
    const s   = t.objectStore(storeName);
    const req = fn(s);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
      t.onerror    = () => reject(t.error);
    }
  });
}

// ── Settings ──────────────────────────────

async function getSetting(key, defaultValue = null) {
  try {
    const rec = await tx('settings', 'readonly', s => s.get(key));
    return rec ? rec.value : defaultValue;
  } catch { return defaultValue; }
}

async function setSetting(key, value) {
  return tx('settings', 'readwrite', s => s.put({ key, value }));
}

// ── Pieces ────────────────────────────────

async function getAllPieces() {
  return tx('pieces', 'readonly', s => s.getAll());
}

async function getPiece(id) {
  return tx('pieces', 'readonly', s => s.get(id));
}

async function savePiece(piece) {
  piece.updatedAt = Date.now();
  if (!piece.createdAt) piece.createdAt = piece.updatedAt;
  return tx('pieces', 'readwrite', s => s.put(piece));
}

async function deletePiece(id) {
  return tx('pieces', 'readwrite', s => s.delete(id));
}

// ── Sessions ──────────────────────────────

async function saveSession(session) {
  return tx('sessions', 'readwrite', s => s.put(session));
}

async function getSessionsForPiece(pieceId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t    = db.transaction('sessions', 'readonly');
    const idx  = t.objectStore('sessions').index('pieceId');
    const req  = idx.getAll(IDBKeyRange.only(pieceId));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getLastSessionDate(pieceId) {
  const sessions = await getSessionsForPiece(pieceId);
  if (!sessions.length) return null;
  return Math.max(...sessions.map(s => s.date));
}

// ── Setlists ──────────────────────────────

async function getAllSetlists() {
  return tx('setlists', 'readonly', s => s.getAll());
}

async function saveSetlist(setlist) {
  return tx('setlists', 'readwrite', s => s.put(setlist));
}

async function deleteSetlist(id) {
  return tx('setlists', 'readwrite', s => s.delete(id));
}

// ── Data version / migration ──────────────

const DATA_VERSION = 1;

async function migrate() {
  const stored = await getSetting('dataVersion', 0);
  if (stored >= DATA_VERSION) return;
  // Future migrations run here by version step
  await setSetting('dataVersion', DATA_VERSION);
}

// ── UUID ──────────────────────────────────

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

// Export
window.DB = { openDB, migrate, getSetting, setSetting, getAllPieces, getPiece, savePiece, deletePiece, saveSession, getSessionsForPiece, getLastSessionDate, getAllSetlists, saveSetlist, deleteSetlist, uuid };
