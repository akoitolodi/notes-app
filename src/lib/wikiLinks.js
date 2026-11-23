/**
 * [[Wiki-Links]] & Cross-Folder Backlinks — turns Notes by Bai into a
 * connected second brain across unlocked folders while respecting Vault locks.
 */

const WIKI_LINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g;

/** Extract unique target note titles referenced via [[Title]] or [[Title|Alias]]. */
export function extractWikiLinks(text) {
  const str = String(text || '');
  const seen = new Set();
  const out = [];
  let m;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(str)) !== null) {
    const target = m[1].trim();
    const key = target.toLowerCase();
    if (target && !seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

/** Find all unlocked, non-trashed notes that contain [[targetNote.title]]. */
export function findBacklinks(targetNote, allNotes = [], hiddenFolderIds = new Set()) {
  const targetTitle = String(targetNote?.title || '').trim().toLowerCase();
  if (!targetTitle) return [];

  const backlinks = [];
  for (const n of allNotes) {
    if (!n || n.trashed || n.id === targetNote.id) continue;
    if (hiddenFolderIds.has(n.folderId)) continue;
    const links = extractWikiLinks(`${n.title || ''}\n${n.body || ''}`);
    if (links.some(t => t.toLowerCase() === targetTitle)) {
      // Grab a short context snippet around the mention
      const body = String(n.body || '');
      const idx = body.toLowerCase().indexOf(`[[${targetTitle}`);
      const snippet =
        idx >= 0
          ? body.slice(Math.max(0, idx - 35), Math.min(body.length, idx + targetTitle.length + 55)).replace(/\n+/g, ' ').trim()
          : body.replace(/\n+/g, ' ').slice(0, 80).trim();
      backlinks.push({
        id: n.id,
        title: n.title || 'Untitled Note',
        folderId: n.folderId,
        snippet,
      });
    }
  }
  return backlinks;
}

/** Resolve [[linked]] titles inside a note into actual unlocked note objects (for Cross-Note RAG). */
export function resolveLinkedNotes(currentNote, allNotes = [], hiddenFolderIds = new Set()) {
  const targets = extractWikiLinks(`${currentNote?.title || ''}\n${currentNote?.body || ''}`);
  if (targets.length === 0) return [];
  const wanted = new Set(targets.map(t => t.toLowerCase()));
  const out = [];
  for (const n of allNotes) {
    if (!n || n.trashed || n.id === currentNote?.id) continue;
    if (hiddenFolderIds.has(n.folderId)) continue;
    const titleLower = String(n.title || '').trim().toLowerCase();
    if (titleLower && wanted.has(titleLower)) {
      out.push(n);
    }
  }
  return out;
}

/** Find a note matching a [[Wiki-Link]] target title (exact case-insensitive match). */
export function findNoteByWikiTitle(title, allNotes = [], hiddenFolderIds = new Set()) {
  const wanted = String(title || '').trim().toLowerCase();
  if (!wanted) return null;
  return (
    allNotes.find(
      n =>
        n &&
        !n.trashed &&
        !hiddenFolderIds.has(n.folderId) &&
        String(n.title || '').trim().toLowerCase() === wanted
    ) || null
  );
}
