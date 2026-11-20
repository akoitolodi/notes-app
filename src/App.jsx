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
  const [screen, setScreen] = useState('folders'); // folders | list | editor | study | exam
  const [folder, setFolder] = useState(null);
  const [note, setNote] = useState(null);

  // Seed default folders on first load
  useEffect(() => {
    ensureSeeded();
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

  const handleBackFromEditor = () => {
    setScreen('list');
    setNote(null);
  };

  // Refresh note from DB when returning from Study
  const handleBackFromStudy = async () => {
    if (note) {
      const fresh = await db.notes.get(note.id);
      setNote(fresh);
    }
    setScreen('editor');
  };

  const handleOpenExam = folder => {
    setFolder(folder);
    setScreen('exam');
  };

  // Render current screen
  return (
    <div className="screen">
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
          onOpenStudy={() => setScreen('study')}
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