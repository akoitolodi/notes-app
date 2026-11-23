/**
 * Dexie (IndexedDB) database — offline-first persistence (Schema v4).
 *
 * v4 upgrades:
 * - Separate `attachments` table storing binary image Blobs outside `notes`
 *   so list/search queries stay fast and memory-light.
 * - `studyData` persistence on notes (cloze, mnemonics, weakness, card mastery).
 * - Safe folder deletion (moves notes to Trash + purges examCache) and safe
 *   note restore (falls back to General if original folder was deleted).
 * - Full JSON backup export & import.
 */
import Dexie from 'dexie';
import { isCardDue, isCardMastered, normalizeCardState } from '../lib/spacedRepetition.js';
import { isVaultUnlocked } from '../lib/vault.js';
export { diffLines, diffAndRemapBlocks } from '../../shared/lineDiff.js';

export const db = new Dexie('ai-class-notes');

db.version(1).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
});

db.version(2).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
});

db.version(3).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
});

// v4: dedicated attachments table for image Blobs (keeps notes lightweight)
db.version(4).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
  attachments: 'id, noteId, createdAt',
});

// v5: additive DeepTutor learnerMemory + online Learn Coding curriculum cache
db.version(5).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
  attachments: 'id, noteId, createdAt',
  learnerMemory: '++id, subject, topic, mastery, mistakesCount, lastPracticedAt',
  codingCache: 'key, updatedAt',
});

// v6: additive School Planner/Canvas items, Weekly Timetable, Bug Logs & Daily Activity Heatmap
db.version(6).stores({
  folders: '++id, name, createdAt',
  notes: '++id, folderId, title, updatedAt, pinned, createdAt',
  examCache: 'folderId',
  attachments: 'id, noteId, createdAt',
  learnerMemory: '++id, subject, topic, mastery, mistakesCount, lastPracticedAt',
  codingCache: 'key, updatedAt',
  plannerItems: '++id, type, dateKey, done, source, externalUid',
  classSchedule: '++id, dayOfWeek, startTime, subject',
  bugLogs: '++id, language, errorType, createdAt',
  activityLog: 'dateKey',
});

export function localDateKey(d = new Date()) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

/** Log a daily study/coding/note activity tick for the GitHub-style heatmap. */
export async function logStudyActivity(kind = 'notes', delta = 1) {
  try {
    const key = localDateKey();
    const existing = (await db.activityLog.get(key)) || {
      dateKey: key,
      count: 0,
      notes: 0,
      reviews: 0,
      coding: 0,
      exams: 0,
    };
    const next = {
      ...existing,
      count: (existing.count || 0) + delta,
      [kind]: (existing[kind] || 0) + delta,
      updatedAt: Date.now(),
    };
    await db.activityLog.put(next);
    return next;
  } catch {
    return null;
  }
}

/** Return the last N days of activity cells (oldest -> today) for the study heatmap. */
export async function getActivityHeatmap(days = 112) {
  const rows = await db.activityLog.toArray().catch(() => []);
  const byKey = new Map(rows.map(r => [r.dateKey, r]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateKey(d);
    const rec = byKey.get(key);
    out.push({
      dateKey: key,
      dayOfWeek: d.getDay(),
      count: rec?.count || 0,
      notes: rec?.notes || 0,
      reviews: rec?.reviews || 0,
      coding: rec?.coding || 0,
      exams: rec?.exams || 0,
    });
  }
  return out;
}

/** Check whether a note has any meaningful user content (text, images, or drawings). */
export function noteHasContent(note) {
  if (!note) return false;
  if ((note.title || '').trim()) return true;
  if ((note.body || '').trim()) return true;
  if (Array.isArray(note.images) && note.images.length > 0) return true;
  const strokes = Array.isArray(note.drawings)
    ? note.drawings
    : note.drawings?.strokes || [];
  if (strokes.length > 0) return true;
  return false;
}

/** Sort notes consistently (pinned first, then edited / created / title). */
export function sortNotes(notes, sort = 'edited') {
  return [...notes].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (sort === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

export const SYSTEM_VAULT_FOLDER_NAME = 'Passwords & Keys';

/** Create default folders on first run + always ensure the fixed Zero-AI "Passwords & Keys" vault folder exists. */
export async function ensureSeeded() {
  const count = await db.folders.count();
  if (count === 0) {
    await db.folders.bulkAdd([
      { name: 'General', mode: 'study', locked: false, createdAt: Date.now() },
      { name: 'Notes', mode: 'study', locked: false, createdAt: Date.now() },
      {
        name: SYSTEM_VAULT_FOLDER_NAME,
        mode: 'vault',
        locked: true,
        isSystemVault: true,
        createdAt: Date.now(),
      },
    ]);
    return;
  }

  const all = await db.folders.toArray();
  const existingVault = all.find(
    f => f.isSystemVault || f.name.toLowerCase() === SYSTEM_VAULT_FOLDER_NAME.toLowerCase()
  );
  if (!existingVault) {
    await db.folders.add({
      name: SYSTEM_VAULT_FOLDER_NAME,
      mode: 'vault',
      locked: true,
      isSystemVault: true,
      createdAt: Date.now(),
    });
  } else if (!existingVault.isSystemVault || existingVault.mode !== 'vault' || !existingVault.locked) {
    await db.folders.update(existingVault.id, {
      mode: 'vault',
      locked: true,
      isSystemVault: true,
    });
  }
}

/** All folders with note counts (trashed notes excluded; locked folders hidden when vault is locked). */
export async function getFoldersWithCounts({ includeLocked = false } = {}) {
  const folders = await db.folders.toArray();
  const unlocked = includeLocked || isVaultUnlocked();
  const counts = {};
  await db.notes.each(note => {
    if (note.trashed) return;
    counts[note.folderId] = (counts[note.folderId] || 0) + 1;
  });
  return folders
    .filter(f => unlocked || !f.locked)
    .map(f => ({ ...f, noteCount: counts[f.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Return Set of folder IDs currently hidden because they are locked and vault is locked. */
export async function getHiddenLockedFolderIds({ forceAll = false } = {}) {
  if (!forceAll && isVaultUnlocked()) return new Set();
  const folders = await db.folders.toArray();
  return new Set(folders.filter(f => Boolean(f.locked)).map(f => f.id));
}

/** Return Set of folder IDs that are Zero-AI Vault folders (never sent to AI even when unlocked). */
export async function getZeroAiFolderIds() {
  const folders = await db.folders.toArray();
  return new Set(folders.filter(f => f.mode === 'vault' || f.isSystemVault).map(f => f.id));
}

export async function getHomeSummary() {
  const folders = await db.folders.toArray();
  const unlocked = isVaultUnlocked();
  const hiddenIds = new Set(
    unlocked ? [] : folders.filter(f => Boolean(f.locked)).map(f => f.id)
  );
  const noFlashcardFolderIds = new Set(
    folders.filter(f => f.mode === 'journal' || f.mode === 'vault' || f.isSystemVault).map(f => f.id)
  );

  const counts = {};
  let totalNotes = 0;
  let pinnedCount = 0;
  let trashCount = 0;
  let dueCardsCount = 0;
  let totalCardsCount = 0;
  const now = Date.now();
  const tagCounts = new Map();

  await db.notes.each(note => {
    if (note.trashed) {
      trashCount += 1;
      return;
    }
    counts[note.folderId] = (counts[note.folderId] || 0) + 1;

    // Strictly hide locked folders' notes from smart views, tags, and Daily Review
    if (hiddenIds.has(note.folderId)) return;

    totalNotes += 1;
    if (note.pinned) pinnedCount += 1;

    const skipCards =
      note.mode === 'journal' ||
      note.mode === 'vault' ||
      noFlashcardFolderIds.has(note.folderId);
    if (!skipCards && Array.isArray(note.flashcards) && note.flashcards.length > 0) {
      const progress = note.studyData?.cardProgress || {};
      for (let i = 0; i < note.flashcards.length; i++) {
        totalCardsCount += 1;
        if (isCardDue(progress[i], now)) dueCardsCount += 1;
      }
    }

    const seen = new Set();
    const combined = `${note.title || ''} ${note.body || ''}`;
    combined.replace(/#([A-Za-z0-9_-]+)/g, (m, t) => {
      const lower = t.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
      return m;
    });
  });

  const allWithCounts = folders
    .map(f => ({ ...f, noteCount: counts[f.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Public (unlocked) folders vs Hidden Vault folders (only visible when vault is unlocked!)
  const publicFolders = allWithCounts.filter(f => !f.locked);
  const vaultFolders = allWithCounts
    .filter(f => Boolean(f.locked))
    .sort((a, b) => (b.isSystemVault ? 1 : 0) - (a.isSystemVault ? 1 : 0) || a.name.localeCompare(b.name));

  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    folders: publicFolders,
    vaultFolders: unlocked ? vaultFolders : [],
    hiddenVaultCount: vaultFolders.length,
    totalNotes,
    pinnedCount,
    trashCount,
    dueCardsCount,
    totalCardsCount,
    hasLockedFolders: vaultFolders.length > 0,
    tags,
  };
}

export async function createFolder(name, opts = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Folder name cannot be empty');
  const id = await db.folders.add({
    name: trimmed,
    mode: opts.mode || 'study',
    locked: Boolean(opts.locked),
    isSystemVault: Boolean(opts.isSystemVault),
    createdAt: Date.now(),
  });
  return id;
}

export async function renameFolder(id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const folder = await db.folders.get(id);
  if (folder?.isSystemVault) {
    throw new Error('Passwords & Keys is a fixed vault folder and cannot be renamed.');
  }
  await db.folders.update(id, { name: trimmed });
}

export async function updateFolder(id, patch) {
  if (!id || !patch || typeof patch !== 'object') return null;
  const folder = await db.folders.get(id);
  if (!folder) return null;
  if (folder.isSystemVault) {
    // Fixed Passwords & Keys folder is permanently locked and Zero-AI
    const safePatch = { ...patch, mode: 'vault', locked: true, isSystemVault: true };
    await db.folders.update(id, safePatch);
    return db.folders.get(id);
  }
  await db.folders.update(id, patch);
  return db.folders.get(id);
}

/**
 * Delete a folder safely:
 * - Fixed Passwords & Keys system vault folder cannot be deleted.
 * - Moves its active notes to Trash (recoverable for 30 days) instead of wiping them.
 * - Cleans up orphaned examCache for this folder.
 */
export async function deleteFolder(id, { permanent = false } = {}) {
  const folder = await db.folders.get(id);
  if (folder?.isSystemVault) {
    throw new Error('Passwords & Keys is a permanent vault folder and cannot be deleted.');
  }
  const now = Date.now();
  await db.transaction('rw', db.folders, db.notes, db.examCache, db.attachments, async () => {
    const folderNotes = await db.notes.where('folderId').equals(id).toArray();
    if (permanent) {
      for (const n of folderNotes) {
        await db.attachments.where('noteId').equals(n.id).delete();
      }
      await db.notes.where('folderId').equals(id).delete();
    } else {
      for (const n of folderNotes) {
        if (!n.trashed) {
          await db.notes.update(n.id, { trashed: true, trashedAt: now, pinned: false });
        }
      }
    }
    await db.examCache.delete(id);
    await db.folders.delete(id);
  });
}

/** Notes inside a folder, or smart virtual views ('__all__', '__pinned__', '__tag:<name>'). */
export async function getNotesInFolder(folderId, sort = 'edited') {
  let notes;
  if (folderId === '__all__' || folderId === '__pinned__' || (typeof folderId === 'string' && folderId.startsWith('__tag:'))) {
    const hiddenIds = await getHiddenLockedFolderIds();
    const pool = (await db.notes.toArray()).filter(n => !n.trashed && !hiddenIds.has(n.folderId));
    if (folderId === '__all__') {
      notes = pool;
    } else if (folderId === '__pinned__') {
      notes = pool.filter(n => n.pinned);
    } else {
      const tag = folderId.slice(6).toLowerCase();
      const re = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'i');
      notes = pool.filter(n => re.test(`${n.title || ''} ${n.body || ''}`));
    }
  } else {
    notes = (await db.notes.where('folderId').equals(folderId).toArray()).filter(n => !n.trashed);
  }
  return sortNotes(notes, sort);
}

/** Search notes across title, body, AI explanations, and terms (sorted, trashed & locked excluded). */
export async function searchNotes(query, folderId = null, sort = 'edited') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  let pool;
  if (folderId != null && typeof folderId === 'number') {
    pool = await db.notes.where('folderId').equals(folderId).toArray();
  } else {
    const hiddenIds = await getHiddenLockedFolderIds();
    pool = (await db.notes.toArray()).filter(n => !hiddenIds.has(n.folderId));
  }
  const matches = pool.filter(n => {
    if (n.trashed) return false;
    if (folderId === '__pinned__' && !n.pinned) return false;
    if (typeof folderId === 'string' && folderId.startsWith('__tag:')) {
      const tag = folderId.slice(6).toLowerCase();
      if (!`${n.title || ''} ${n.body || ''}`.toLowerCase().includes(`#${tag}`)) return false;
    }
    if ((n.title || '').toLowerCase().includes(q)) return true;
    if ((n.body || '').toLowerCase().includes(q)) return true;
    if ((n.summary || '').toLowerCase().includes(q)) return true;
    if (Array.isArray(n.blocks)) {
      for (const b of n.blocks) {
        if ((b.explanation || '').toLowerCase().includes(q)) return true;
        if (Array.isArray(b.terms) && b.terms.some(t => (t.term || '').toLowerCase().includes(q))) {
          return true;
        }
      }
    }
    return false;
  });
  return sortNotes(matches, sort);
}

export async function createNote(folderId, title = '', body = '', subject = '') {
  let targetFolderId = folderId;
  if (typeof targetFolderId !== 'number') {
    await ensureSeeded();
    const first = await db.folders.orderBy('id').first();
    targetFolderId = first?.id;
  }
  let resolvedSubject = subject;
  if (!resolvedSubject && typeof targetFolderId === 'number') {
    const f = await db.folders.get(targetFolderId);
    if (f?.name) resolvedSubject = f.name;
  }
  const now = Date.now();
  const id = await db.notes.add({
    folderId: targetFolderId,
    title,
    body,
    subject: resolvedSubject || 'General',
    blocks: [],
    flashcards: [],
    quiz: [],
    studyData: {},
    images: [], // [{ id, mime?, dataUrl? (legacy) }]
    drawings: { refWidth: 0, strokes: [] },
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

export async function moveNote(id, folderId) {
  await db.notes.update(id, { folderId, updatedAt: Date.now() });
}

/** Duplicate a note (including cloned attachments in db.attachments). */
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

  // Clone attachment blobs so deleting one copy never breaks the other
  if (Array.isArray(src.images) && src.images.length > 0) {
    const clonedImages = [];
    for (let i = 0; i < src.images.length; i++) {
      const img = src.images[i];
      if (img.storedInDb) {
        const rec = await db.attachments.get(img.id);
        if (rec) {
          const newImgId = `img-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`;
          await db.attachments.add({
            id: newImgId,
            noteId: newId,
            blob: rec.blob,
            mime: rec.mime,
            createdAt: now,
          });
          clonedImages.push({ id: newImgId, mime: rec.mime, storedInDb: true });
          continue;
        }
      }
      clonedImages.push({ ...img });
    }
    await db.notes.update(newId, { images: clonedImages });
  }

  return db.notes.get(newId);
}

// ---------- Attachments (Dexie v4 Blob storage) ----------

export function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(',');
  const mimeMatch = /data:([^;]+);/i.exec(header || '');
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

/** Store an image dataUrl into db.attachments and return lightweight metadata for note.images[]. */
export async function saveImageAttachment(noteId, dataUrl) {
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (typeof Blob !== 'undefined' && typeof atob !== 'undefined' && String(dataUrl).startsWith('data:')) {
    try {
      const { blob, mime } = dataUrlToBlob(dataUrl);
      await db.attachments.put({ id, noteId, blob, mime, createdAt: Date.now() });
      return { id, mime, storedInDb: true };
    } catch {
      // Fallback to inline storage if Blob unsupported
    }
  }
  return { id, dataUrl };
}

/** Resolve any image entry (v4 Blob attachment or legacy inline dataUrl) to a dataUrl. */
export async function resolveImageDataUrl(img) {
  if (!img) return null;
  if (img.dataUrl) return img.dataUrl;
  if (img.storedInDb && img.id) {
    const rec = await db.attachments.get(img.id);
    if (rec?.blob) return blobToDataUrl(rec.blob);
  }
  return null;
}

/** Resolve any image entry to a Blob (for fast Object URL rendering). */
export async function resolveImageBlob(img) {
  if (!img) return null;
  if (img.storedInDb && img.id) {
    const rec = await db.attachments.get(img.id);
    if (rec?.blob) return rec.blob;
  }
  if (img.dataUrl) {
    return dataUrlToBlob(img.dataUrl).blob;
  }
  return null;
}

export async function deleteImageAttachment(imgId) {
  try {
    await db.attachments.delete(imgId);
  } catch {
    // non-fatal
  }
}

// ---------- Trash (Recently Deleted) ----------

export async function deleteNote(id) {
  await db.notes.update(id, { trashed: true, trashedAt: Date.now(), pinned: false });
}

/** Restore a note; if its original folder was deleted, reassign to General / first folder. */
export async function restoreNote(id) {
  const note = await db.notes.get(id);
  if (!note) return;
  let folderId = note.folderId;
  const folderExists = typeof folderId === 'number' && (await db.folders.get(folderId));
  if (!folderExists) {
    await ensureSeeded();
    const general = (await db.folders.where('name').equals('General').first()) || (await db.folders.orderBy('id').first());
    folderId = general?.id;
  }
  await db.notes.update(id, { trashed: false, trashedAt: null, folderId });
}

export async function purgeNote(id) {
  await db.transaction('rw', db.notes, db.attachments, async () => {
    await db.attachments.where('noteId').equals(id).delete();
    await db.notes.delete(id);
  });
}

export async function getTrash() {
  const items = await db.notes.filter(n => n.trashed).toArray();
  return items.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
}

export async function getTrashCount() {
  return db.notes.filter(n => n.trashed).count();
}

export async function emptyTrash() {
  const trashed = await db.notes.filter(n => n.trashed).toArray();
  await db.transaction('rw', db.notes, db.attachments, async () => {
    for (const n of trashed) {
      await db.attachments.where('noteId').equals(n.id).delete();
    }
    await db.notes.filter(n => n.trashed).delete();
  });
}

/** Hard-delete trashed notes older than `days` (default 30). */
export async function purgeOldTrash(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const expired = await db.notes.filter(n => n.trashed && (n.trashedAt || 0) < cutoff).toArray();
  if (expired.length === 0) return;
  await db.transaction('rw', db.notes, db.attachments, async () => {
    for (const n of expired) {
      await db.attachments.where('noteId').equals(n.id).delete();
      await db.notes.delete(n.id);
    }
  });
}

// ---------- Full Backup & Restore ----------

export async function exportBackup() {
  const folders = await db.folders.toArray();
  const rawNotes = await db.notes.toArray();
  const examCache = await db.examCache.toArray();

  // Inline any v4 Blob attachments as dataUrls for portable JSON export
  const notes = [];
  for (const n of rawNotes) {
    const resolvedImages = [];
    for (const img of n.images || []) {
      const dataUrl = await resolveImageDataUrl(img);
      if (dataUrl) resolvedImages.push({ id: img.id, dataUrl });
    }
    notes.push({ ...n, images: resolvedImages });
  }

  return {
    app: 'ai-class-notes',
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    folders,
    notes,
    examCache,
  };
}

/**
 * Import a backup JSON object.
 * mode: 'merge' (default — adds imported folders/notes alongside existing ones)
 *    or 'replace' (clears current data first).
 */
export async function importBackup(payload, { mode = 'merge' } = {}) {
  if (!payload || payload.app !== 'ai-class-notes' || !Array.isArray(payload.folders) || !Array.isArray(payload.notes)) {
    throw new Error('Invalid backup file format.');
  }

  let foldersAdded = 0;
  let notesAdded = 0;

  await db.transaction('rw', db.folders, db.notes, db.examCache, db.attachments, async () => {
    if (mode === 'replace') {
      await db.attachments.clear();
      await db.examCache.clear();
      await db.notes.clear();
      await db.folders.clear();
    }

    const existingFolders = await db.folders.toArray();
    const byName = new Map(existingFolders.map(f => [f.name.toLowerCase(), f.id]));
    const folderIdMap = new Map();

    for (const f of payload.folders) {
      const name = String(f?.name || 'Imported').trim();
      const key = name.toLowerCase();
      if (mode === 'merge' && byName.has(key)) {
        folderIdMap.set(f.id, byName.get(key));
      } else {
        const newId = await db.folders.add({ name, createdAt: f.createdAt || Date.now() });
        folderIdMap.set(f.id, newId);
        byName.set(key, newId);
        foldersAdded += 1;
      }
    }

    let fallbackFolderId = [...folderIdMap.values()][0];
    if (!fallbackFolderId) {
      fallbackFolderId = await db.folders.add({ name: 'General', createdAt: Date.now() });
    }

    for (const n of payload.notes) {
      const { id: _oldId, images: rawImages = [], ...rest } = n;
      const mappedFolderId = folderIdMap.get(n.folderId) || fallbackFolderId;
      const newNoteId = await db.notes.add({
        ...rest,
        folderId: mappedFolderId,
        images: [],
        createdAt: n.createdAt || Date.now(),
        updatedAt: n.updatedAt || Date.now(),
      });

      const savedImages = [];
      for (const img of rawImages) {
        if (img?.dataUrl) {
          savedImages.push(await saveImageAttachment(newNoteId, img.dataUrl));
        }
      }
      if (savedImages.length > 0) {
        await db.notes.update(newNoteId, { images: savedImages });
      }
      notesAdded += 1;
    }
  });

  await ensureSeeded();
  return { foldersAdded, notesAdded };
}

// ---------- Cross-Folder SM-2 Spaced Repetition Helpers ----------

/**
 * Scan all non-trashed notes across every folder and collect due flashcards
 * ordered with overdue/lapsed cards first, then unreviewed cards.
 */
export async function getDueFlashcards(now = Date.now()) {
  const [folders, notes] = await Promise.all([db.folders.toArray(), db.notes.toArray()]);
  const unlocked = isVaultUnlocked();
  const folderById = new Map(folders.map(f => [f.id, f]));

  const dueCards = [];
  const allCards = [];
  let masteredCount = 0;
  let nextDueAt = null;

  for (const note of notes) {
    if (note.trashed || !Array.isArray(note.flashcards) || note.flashcards.length === 0) continue;
    const f = folderById.get(note.folderId);
    if (!unlocked && f?.locked) continue;
    if (
      note.mode === 'journal' ||
      note.mode === 'vault' ||
      f?.mode === 'journal' ||
      f?.mode === 'vault' ||
      f?.isSystemVault
    )
      continue;

    const progress = note.studyData?.cardProgress || {};
    const folderName = f?.name || note.subject || 'General';

    for (let i = 0; i < note.flashcards.length; i++) {
      const card = note.flashcards[i];
      if (!card || (!card.q && !card.a)) continue;
      const rawState = progress[i];
      const state = normalizeCardState(rawState);
      if (isCardMastered(rawState)) masteredCount += 1;

      const entry = {
        key: `${note.id}:${i}`,
        noteId: note.id,
        noteTitle: note.title || 'Untitled Note',
        folderId: note.folderId,
        folderName,
        cardIndex: i,
        card,
        state,
      };
      allCards.push(entry);

      if (isCardDue(rawState, now)) {
        dueCards.push(entry);
      } else if (state.nextReviewAt > now) {
        if (nextDueAt === null || state.nextReviewAt < nextDueAt) {
          nextDueAt = state.nextReviewAt;
        }
      }
    }
  }

  // Prioritize learning/lapsed cards, then earliest overdue, then new cards
  dueCards.sort((a, b) => {
    const aLapsed = a.state.status === 'learning' ? 0 : a.state.nextReviewAt > 0 ? 1 : 2;
    const bLapsed = b.state.status === 'learning' ? 0 : b.state.nextReviewAt > 0 ? 1 : 2;
    if (aLapsed !== bLapsed) return aLapsed - bLapsed;
    return (a.state.nextReviewAt || 0) - (b.state.nextReviewAt || 0);
  });

  return {
    dueCards,
    allCards,
    totalCards: allCards.length,
    dueCount: dueCards.length,
    masteredCount,
    nextDueAt,
  };
}

/**
 * Persist an SM-2 card review state on a note WITHOUT modifying updatedAt
 * so reviewing flashcards never disturbs the note edit timeline.
 */
export async function saveCardReviewResult(noteId, cardIndex, nextCardState) {
  const note = await db.notes.get(noteId);
  if (!note) return;
  const studyData = note.studyData && typeof note.studyData === 'object' ? { ...note.studyData } : {};
  const cardProgress =
    studyData.cardProgress && typeof studyData.cardProgress === 'object'
      ? { ...studyData.cardProgress }
      : {};
  cardProgress[cardIndex] = nextCardState;
  studyData.cardProgress = cardProgress;
  await db.notes.update(noteId, { studyData });
}
