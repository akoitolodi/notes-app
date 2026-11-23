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

/** All folders with note counts (trashed notes excluded) + smart counts. */
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

export async function getHomeSummary() {
  const folders = await db.folders.toArray();
  const counts = {};
  let totalNotes = 0;
  let pinnedCount = 0;
  let trashCount = 0;
  const tagCounts = new Map();

  await db.notes.each(note => {
    if (note.trashed) {
      trashCount += 1;
      return;
    }
    totalNotes += 1;
    if (note.pinned) pinnedCount += 1;
    counts[note.folderId] = (counts[note.folderId] || 0) + 1;

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

  const sortedFolders = folders
    .map(f => ({ ...f, noteCount: counts[f.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { folders: sortedFolders, totalNotes, pinnedCount, trashCount, tags };
}

export async function createFolder(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Folder name cannot be empty');
  const id = await db.folders.add({ name: trimmed, createdAt: Date.now() });
  return id;
}

export async function renameFolder(id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  await db.folders.update(id, { name: trimmed });
}

/**
 * Delete a folder safely:
 * - Moves its active notes to Trash (recoverable for 30 days) instead of wiping them.
 * - Cleans up orphaned examCache for this folder.
 */
export async function deleteFolder(id, { permanent = false } = {}) {
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
  if (folderId === '__all__') {
    notes = (await db.notes.toArray()).filter(n => !n.trashed);
  } else if (folderId === '__pinned__') {
    notes = (await db.notes.toArray()).filter(n => !n.trashed && n.pinned);
  } else if (typeof folderId === 'string' && folderId.startsWith('__tag:')) {
    const tag = folderId.slice(6).toLowerCase();
    const re = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'i');
    notes = (await db.notes.toArray()).filter(
      n => !n.trashed && re.test(`${n.title || ''} ${n.body || ''}`)
    );
  } else {
    notes = (await db.notes.where('folderId').equals(folderId).toArray()).filter(n => !n.trashed);
  }
  return sortNotes(notes, sort);
}

/** Search notes across title, body, AI explanations, and terms (sorted, trashed excluded). */
export async function searchNotes(query, folderId = null, sort = 'edited') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  let pool;
  if (folderId != null && typeof folderId === 'number') {
    pool = await db.notes.where('folderId').equals(folderId).toArray();
  } else {
    pool = await db.notes.toArray();
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
