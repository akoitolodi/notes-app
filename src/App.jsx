/**
 * Root app — navigation: Folders → Notes list → Note editor → (slide-up panel).
 * Uses Dexie (IndexedDB) for real offline persistence.
 */
import { useState, useEffect, useCallback } from 'react';
import FoldersScreen from './components/FoldersScreen';
import NotesListScreen from './components/NotesListScreen';
import NoteEditor from './components/NoteEditor';
import StudyScreen from './components/StudyScreen';
import ExamSummaryScreen from './components/ExamSummaryScreen';
import { db, ensureSeeded } from './store/db';

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState('folders'); // folders | list | editor | study | exam
  const [folder, setFolder] = useState(null);
  const [note, setNote] = useState(null);

  // Seed default folders on first load — await before rendering screens
  useEffect(() => {
    ensureSeeded().finally(() => setReady(true));
  }, []);

  const handleOpenFolder = folder => {
    setFolder(folder);
    setScreen('list');
  };

  const handleOpenNote = note => {
    setNote(note);
    setScreen('editor');
  };

  const handleBack = () => {
    setScreen('folders');
    setFolder(null);
    setNote(null);
  };

  const handleBackFromEditor = async () => {
    // Clean up abandoned empty notes (created via pencil, never typed in).
    // IMPORTANT: re-read from the DB — the `note` object here is the stale
    // snapshot taken when the note was opened. A brand-new note starts empty,
    // so checking it directly would DELETE a note the user just typed + saved.
    if (note) {
      const fresh = await db.notes.get(note.id);
      if (fresh && !(fresh.title || '').trim() && !(fresh.body || '').trim()) {
        await db.notes.delete(note.id);
      }
    }
    setScreen('list');
    setNote(null);
  };

  // Refresh note from DB when returning from Study
  const handleBackFromStudy = async () => {
    if (note) {
      const fresh = await db.notes.get(note.id);
      if (fresh) {
        setNote(fresh);
        setScreen('editor');
        return;
      }
      // Note was deleted while studying — fall back to the list
    }
    setScreen('list');
    setNote(null);
  };

  const handleOpenExam = folder => {
    setFolder(folder);
    setScreen('exam');
  };

  // Render current screen
  if (!ready) {
    return (
      <div className="app-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="scan-indicator"><span className="spinner" /> Loading…</div>
      </div>
    );
  }

  return (
    <div className="app-root">
      {screen === 'folders' && (
        <FoldersScreen onOpenFolder={handleOpenFolder} onOpenExam={handleOpenExam} />
      )}
      {screen === 'list' && folder && (
        <NotesListScreen
          folder={folder}
          onOpenNote={handleOpenNote}
          onBack={handleBack}
        />
      )}
      {screen === 'editor' && note && (
        <NoteEditor
          key={note.id}
          note={note}
          onOpenStudy={async () => {
            // Re-fetch from DB so the Study screen sees the latest scan results
            const fresh = await db.notes.get(note.id);
            if (fresh) {
              setNote(fresh);
              setScreen('study');
            }
          }}
          onBackToList={handleBackFromEditor}
        />
      )}
      {screen === 'study' && note && (
        <StudyScreen note={note} onBack={handleBackFromStudy} />
      )}
      {screen === 'exam' && folder && (
        <ExamSummaryScreen folder={folder} onBack={handleBack} />
      )}
    </div>
  );
}