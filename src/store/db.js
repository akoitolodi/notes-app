/**
 * Dexie (IndexedDB) database — real offline persistence (Phase 2).
 * Schema: folders (one per subject) → notes → AI blocks stored as JSON on the note.
 */
import Dexie from 'dexie';

export const db = new Dexie('ai-class-notes');

db.version(1).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
});

// v2: cache AI exam summaries per folder (avoids re-calling the AI every open)
db.version(2).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
});

/** Create default folders on first run. */
export async function ensureSeeded() {
  const count = await db.folders.count();
  if (count === 0) {
    await db.folders.bulkAdd([
      { name: 'General', createdAt: Date.now() },
      { name: 'Notes', createdAt: Date.now() },
    ]);
  }
}

/** All folders with note counts (trashed notes don't count). */
export async function getFoldersWithCounts() {
  const folders = await db.folders.toArray();
  const counts = {};
  await db.notes.each(note => {
    if (note.trashed) return;
    counts[note.folderId] = (counts[note.folderId] || 0) + 1;
  });
  return folders
    .map(f => ({ ...f, noteCount: counts[f.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name) {
  const id = await db.folders.add({ name: name.trim(), createdAt: Date.now() });
  return id;
}

export async function renameFolder(id, name) {
  await db.folders.update(id, { name: name.trim() });
}

export async function deleteFolder(id) {
  // Delete folder and all its notes
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.notes.where('folderId').equals(id).delete();
    await db.folders.delete(id);
  });
}

/** Notes inside a folder, trashed notes excluded. sort: 'edited' | 'created' | 'title'. */
export async function getNotesInFolder(folderId, sort = 'edited') {
  const notes = (await db.notes.where('folderId').equals(folderId).toArray())
    .filter(n => !n.trashed);
  return notes.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (sort === 'created') return b.createdAt - a.createdAt;
    if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
    return b.updatedAt - a.updatedAt;
  });
}

/** Search notes by title or body text (case-insensitive), trashed excluded. */
export async function searchNotes(query, folderId = null) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  let pool;
  if (folderId != null) {
    pool = await db.notes.where('folderId').equals(folderId).toArray();
  } else {
    pool = await db.notes.toArray();
  }
  return pool.filter(
    n =>
      !n.trashed &&
      ((n.title || '').toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q))
  );
}

export async function createNote(folderId, title = '', body = '') {
  const now = Date.now();
  const id = await db.notes.add({
    folderId,
    title,
    body,
    blocks: [],
    flashcards: [],
    quiz: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    lastScanAt: null,
  });
  return db.notes.get(id);
}

export async function getNote(id) {
  return db.notes.get(id);
}

export async function updateNote(id, patch) {
  await db.notes.update(id, { ...patch, updatedAt: Date.now() });
  return db.notes.get(id);
}

export async function togglePin(id) {
  const note = await db.notes.get(id);
  if (!note) return;
  await db.notes.update(id, { pinned: !note.pinned });
}

/** Move a note to another folder. */
export async function moveNote(id, folderId) {
  await db.notes.update(id, { folderId, updatedAt: Date.now() });
}

/** Duplicate a note (text + AI blocks). Returns the new note. */
export async function duplicateNote(id) {
  const src = await db.notes.get(id);
  if (!src) return null;
  const now = Date.now();
  const { id: _omit, ...rest } = src;
  const newId = await db.notes.add({
    ...rest,
    title: src.title ? `${src.title} (copy)` : '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
  return db.notes.get(newId);
}

// ---------- Trash (Recently Deleted) ----------
// Deleting moves a note to the trash; it is purged for real after 30 days.

export async function deleteNote(id) {
  await db.notes.update(id, { trashed: true, trashedAt: Date.now() });
}

export async function restoreNote(id) {
  await db.notes.update(id, { trashed: false, trashedAt: null });
}

export async function purgeNote(id) {
  await db.notes.delete(id);
}

export async function getTrash() {
  const items = await db.notes.filter(n => n.trashed).toArray();
  return items.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
}

export async function getTrashCount() {
  return db.notes.filter(n => n.trashed).count();
}

export async function emptyTrash() {
  await db.notes.filter(n => n.trashed).delete();
}

/** Hard-delete trashed notes older than `days` (default 30). */
export async function purgeOldTrash(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  await db.notes.filter(n => n.trashed && (n.trashedAt || 0) < cutoff).delete();
}

/** Compare two bodies line-by-line; return 1-indexed changed lines. */
export function diffLines(oldBody, newBody) {
  const oldLines = (oldBody || '').split('\n');
  const newLines = (newBody || '').split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const changed = [];
  for (let i = 0; i < max; i++) {
    if (oldLines[i] !== newLines[i]) changed.push(i + 1);
  }
  return changed;
}