/**
 * LocalStorage-backed notes store (Phase 1).
 * Upgrades to IndexedDB/Dexie in Phase 2.
 */
const STORAGE_KEY = 'ai-class-notes:v1';

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { notes: [], activeNoteId: null };
  } catch { return { notes: [], activeNoteId: null }; }
}

function writeStore(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createNote(title = '', body = '', subject = 'General') {
  const now = Date.now();
  return {
    id: genId(),
    title,
    body,
    subject,
    createdAt: now,
    updatedAt: now,
    blocks: [],      // AI explanations per line
    lastScanAt: null,
  };
}

/** Compare two note bodies line-by-line; return 1-indexed line numbers that changed. */
function diffLines(oldBody, newBody) {
  const oldLines = oldBody.split('\n');
  const newLines = newBody.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const changed = [];
  for (let i = 0; i < max; i++) {
    if (oldLines[i] !== newLines[i]) changed.push(i + 1);
  }
  return changed;
}

export function useNotes() {
  const state = readStore();
  const listeners = new Set();

  function notify() { listeners.forEach(fn => fn()); }

  // Subscribe to changes
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // Get all notes
  function getNotes() { return state.notes; }

  // Get active note (or first)
  function getActiveNote() {
    if (!state.notes.length) return null;
    const id = state.activeNoteId || state.notes[0].id;
    return state.notes.find(n => n.id === id) || state.notes[0];
  }

  // Create a new note and make it active
  function newNote(subject = 'General') {
    const note = createNote('', '', subject);
    state.notes.unshift(note);
    state.activeNoteId = note.id;
    writeStore(state);
    notify();
    return note;
  }

  // Set active note
  function setActiveNote(id) {
    state.activeNoteId = id;
    writeStore(state);
    notify();
  }

  // Update note title/body
  function updateNote(id, patch) {
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx === -1) return;
    state.notes[idx] = { ...state.notes[idx], ...patch, updatedAt: Date.now() };
    writeStore(state);
    notify();
  }

  // Save note + run AI scan
  async function saveAndScan(noteId, scanFn) {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return { error: 'Note not found' };

    // Find changed lines
    const changedLines = diffLines(note.body, note.title + '\n' + note.body);

    // Call AI
    try {
      const result = await scanFn(note.body, note.subject, changedLines);

      // Merge blocks back into note
      note.blocks = result.blocks || [];
      note.lastScanAt = Date.now();
      note.updatedAt = Date.now();
      writeStore(state);
      notify();
      return { blocks: note.blocks };
    } catch (err) {
      return { error: err.message };
    }
  }

  // Delete note
  function deleteNote(id) {
    state.notes = state.notes.filter(n => n.id !== id);
    if (state.activeNoteId === id) state.activeNoteId = state.notes[0]?.id || null;
    writeStore(state);
    notify();
  }

  return {
    subscribe,
    getNotes,
    getActiveNote,
    newNote,
    setActiveNote,
    updateNote,
    saveAndScan,
    deleteNote,
  };
}

// Singleton for easy import
export const notesStore = useNotes();