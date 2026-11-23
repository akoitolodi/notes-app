/**
 * baiDrop — Zero-Cloud Offline Share (.bai.json + Compact Share Code) & Local Wi-Fi LAN Sync.
 *
 * Security & Privacy Guarantees:
 * - Strictly EXCLUDES locked folders, Hidden Vault folders, and permanent Zero-AI `Passwords & Keys`
 *   from Local Wi-Fi LAN Sync so secrets NEVER leave your device over Wi-Fi!
 * - Portable `.bai.json` bundles let classmates share a single note (title, markdown body,
 *   flashcards, quiz) 100% offline via Bluetooth, AirDrop, Nearby Share, or QR/Share Code.
 */
import { db, createFolder, createNote } from '../store/db';

export const BAIDROP_VERSION = 1;
export const LAN_URL_KEY = 'aicn:lanSyncUrl';

export function getSavedLanSyncUrl() {
  try {
    return (localStorage.getItem(LAN_URL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveLanSyncUrl(url) {
  try {
    localStorage.setItem(LAN_URL_KEY, String(url || '').trim());
  } catch {
    // ignore
  }
}

/** Build a clean, portable `.bai.json` share bundle from a single note. */
export function buildNoteBaiBundle(note, folderName = 'Shared') {
  return {
    format: 'notes-by-bai',
    version: BAIDROP_VERSION,
    exportedAt: Date.now(),
    folderName: String(folderName || note?.subject || 'Shared').slice(0, 64),
    note: {
      title: String(note?.title || 'Shared Note'),
      subject: String(note?.subject || folderName || 'General'),
      body: String(note?.body || ''),
      flashcards: Array.isArray(note?.flashcards) ? note.flashcards.slice(0, 40) : [],
      quiz: Array.isArray(note?.quiz) ? note.quiz.slice(0, 30) : [],
    },
  };
}

/** Encode a `.bai.json` bundle into a compact copyable UTF-8-safe Base64 share code. */
export function encodeBaiShareCode(bundle) {
  const json = JSON.stringify(bundle);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `BAIDROP1:${btoa(bin)}`;
}

/** Decode either raw `.bai.json` text OR a `BAIDROP1:...` share code. */
export function decodeBaiBundle(rawInput) {
  const s = String(rawInput || '').trim();
  if (!s) throw new Error('Empty BaiDrop input');

  let jsonStr = s;
  if (s.startsWith('BAIDROP1:')) {
    const b64 = s.slice('BAIDROP1:'.length).trim();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    jsonStr = new TextDecoder().decode(bytes);
  }

  const parsed = JSON.parse(jsonStr);
  if (parsed?.format !== 'notes-by-bai' || !parsed?.note) {
    throw new Error('Not a valid Notes by Bai (.bai.json) share bundle');
  }
  return parsed;
}

/** Import a decoded BaiDrop bundle into local Dexie cleanly (never overwrites existing notes). */
export async function importNoteBaiBundle(rawOrBundle) {
  const bundle = typeof rawOrBundle === 'string' ? decodeBaiBundle(rawOrBundle) : rawOrBundle;
  if (bundle?.format !== 'notes-by-bai' || !bundle?.note) {
    throw new Error('Invalid BaiDrop bundle');
  }

  const folders = await db.folders.toArray();
  const safeFolders = folders.filter(f => !f.locked && !f.isSystemVault && f.mode !== 'vault');
  const wanted = String(bundle.folderName || bundle.note.subject || 'Shared').trim();
  let target = safeFolders.find(f => f.name.toLowerCase() === wanted.toLowerCase());
  if (!target) {
    target = safeFolders.find(f => f.name === 'General') || safeFolders[0];
    if (!target) {
      const fid = await createFolder(wanted || 'Shared', { mode: 'study', locked: false });
      target = await db.folders.get(fid);
    }
  }

  const created = await createNote(
    target.id,
    bundle.note.title || 'Shared Note',
    bundle.note.body || '',
    bundle.note.subject || target.name
  );
  if (bundle.note.flashcards?.length || bundle.note.quiz?.length) {
    await db.notes.update(created.id, {
      flashcards: bundle.note.flashcards || [],
      quiz: bundle.note.quiz || [],
    });
  }
  const fresh = await db.notes.get(created.id);
  return { note: fresh, folder: target };
}

/** Trigger browser download of a `.bai.json` file. */
export function downloadBaiFile(bundle) {
  const slug = String(bundle?.note?.title || 'note')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'note';
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.bai.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Filter unlocked, non-vault folders & notes strictly before any Local Wi-Fi LAN Sync.
 * Exported directly so unit tests verify the Zero-AI & Hidden Vault guarantee!
 */
export function filterSafeSyncPayload({ folders = [], notes = [], plannerItems = [], classSchedule = [] }) {
  const blockedFolderIds = new Set(
    folders
      .filter(f => f.locked || f.isSystemVault || f.mode === 'vault')
      .map(f => f.id)
  );
  const safeFolders = folders.filter(f => !blockedFolderIds.has(f.id));
  const safeNotes = notes.filter(
    n => !n.trashed && n.mode !== 'vault' && !blockedFolderIds.has(n.folderId)
  );
  return {
    folders: safeFolders,
    notes: safeNotes,
    plannerItems,
    classSchedule,
  };
}

/**
 * 1-Tap Local Wi-Fi PC <-> Phone Sync via same-Wi-Fi `node server.js` (`/api/lan-sync`).
 * Strictly skips locked folders and `Passwords & Keys`!
 */
export async function runLanWifiSync(serverUrl) {
  const base = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error('Enter your PC local server URL (e.g. http://192.168.1.5:3000)');
  }
  saveLanSyncUrl(base);

  const [folders, notes, plannerItems, classSchedule] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.plannerItems.toArray().catch(() => []),
    db.classSchedule.toArray().catch(() => []),
  ]);

  const safePayload = filterSafeSyncPayload({ folders, notes, plannerItems, classSchedule });

  const res = await fetch(`${base}/api/lan-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(safePayload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `LAN Sync failed (HTTP ${res.status})`);
  }

  // Merge returned folders & notes from other devices by title/updatedAt cleanly
  const remoteFolders = Array.isArray(data?.folders) ? data.folders : [];
  const remoteNotes = Array.isArray(data?.notes) ? data.notes : [];
  const remotePlanner = Array.isArray(data?.plannerItems) ? data.plannerItems : [];

  const localFoldersNow = await db.folders.toArray();
  const folderByName = new Map(localFoldersNow.map(f => [f.name.toLowerCase(), f]));
  const remoteFolderIdToLocalId = new Map();

  for (const rf of remoteFolders) {
    if (rf.locked || rf.isSystemVault || rf.mode === 'vault') continue;
    const match = folderByName.get(String(rf.name || '').toLowerCase());
    if (match) {
      remoteFolderIdToLocalId.set(rf.id, match.id);
    } else if (rf.name) {
      const newId = await createFolder(rf.name, { mode: rf.mode || 'study', locked: false });
      const created = await db.folders.get(newId);
      folderByName.set(created.name.toLowerCase(), created);
      remoteFolderIdToLocalId.set(rf.id, newId);
    }
  }

  const localNotesNow = await db.notes.toArray();
  const noteByKey = new Map(
    localNotesNow.map(n => [`${n.folderId}::${String(n.title || '').trim().toLowerCase()}`, n])
  );
  const fallbackFolder = localFoldersNow.find(f => f.name === 'General') || localFoldersNow[0];

  let mergedNotes = 0;
  for (const rn of remoteNotes) {
    if (rn.mode === 'vault' || rn.trashed) continue;
    const localFid = remoteFolderIdToLocalId.get(rn.folderId) || fallbackFolder?.id;
    const key = `${localFid}::${String(rn.title || '').trim().toLowerCase()}`;
    const existing = noteByKey.get(key);
    if (!existing) {
      await db.notes.add({
        folderId: localFid,
        title: rn.title || 'Synced Note',
        body: rn.body || '',
        subject: rn.subject || 'General',
        blocks: rn.blocks || [],
        flashcards: rn.flashcards || [],
        quiz: rn.quiz || [],
        createdAt: rn.createdAt || Date.now(),
        updatedAt: rn.updatedAt || Date.now(),
        pinned: Boolean(rn.pinned),
        trashed: false,
      });
      mergedNotes += 1;
    } else if ((rn.updatedAt || 0) > (existing.updatedAt || 0)) {
      await db.notes.update(existing.id, {
        body: rn.body || existing.body,
        flashcards: rn.flashcards || existing.flashcards,
        quiz: rn.quiz || existing.quiz,
        updatedAt: rn.updatedAt,
      });
      mergedNotes += 1;
    }
  }

  // Merge planner items by externalUid or title+dateKey
  const localPlannerNow = await db.plannerItems.toArray().catch(() => []);
  const plannerKeys = new Set(
    localPlannerNow.map(p => p.externalUid || `${p.dateKey}::${String(p.title || '').toLowerCase()}`)
  );
  let mergedPlanner = 0;
  for (const rp of remotePlanner) {
    const pk = rp.externalUid || `${rp.dateKey}::${String(rp.title || '').toLowerCase()}`;
    if (!plannerKeys.has(pk)) {
      const { id: _omit, ...rest } = rp;
      await db.plannerItems.add(rest);
      plannerKeys.add(pk);
      mergedPlanner += 1;
    }
  }

  return {
    pushedNotes: safePayload.notes.length,
    mergedNotes,
    mergedPlanner,
    syncedAt: data?.updatedAt || Date.now(),
  };
}
