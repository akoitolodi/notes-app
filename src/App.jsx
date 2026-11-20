/**
 * Root app — navigation: Folders → Notes list → Note editor → (slide-up panel).
 * Uses Dexie (IndexedDB) for real offline persistence.
 */
import { useState, useEffect, useCallback } from 'react';
import FoldersScreen from './components/FoldersScreen';
import NotesListScreen from './components/NotesListScreen';
import NoteEditor from './components/NoteEditor';
import SlideUpPanel from './components/SlideUpPanel';
import { db, ensureSeeded } from './store/db';
import { updateNote } from './store/db';

export default function App() {
  const [screen, setScreen] = useState('folders'); // folders | list | editor
  const [folder, setFolder] = useState(null);
  const [note, setNote] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);

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

  const handleScanComplete = useCallback(async blocks => {
    if (note) {
      await updateNote(note.id, { blocks });
      setNote({ ...note, blocks });
    }
    setSelectedLineId(blocks[0]?.id || null);
    setPanelOpen(true);
  }, [note]);

  const handleLineSelect = useCallback(id => {
    setSelectedLineId(id);
  }, []);

  const handleExplainSimpler = useCallback(async lineId => {
    const block = note?.blocks?.find(b => b.id === lineId);
    if (!block) return;
    alert(`"Explain simpler" for: ${block.text.slice(0, 50)}…`);
  }, [note?.blocks]);

  const handleGiveExample = useCallback(async lineId => {
    const block = note?.blocks?.find(b => b.id === lineId);
    if (!block) return;
    alert(`"Give example" for: ${block.text.slice(0, 50)}…`);
  }, [note?.blocks]);

  // Render current screen
  return (
    <div className="screen">
      {screen === 'folders' && (
        <FoldersScreen onOpenFolder={handleOpenFolder} />
      )}
      {screen === 'list' && folder && (
        <NotesListScreen
          folder={folder}
          onOpenNote={handleOpenNote}
          onBack={handleBack}
        />
      )}
      {screen === 'editor' && note && (
        <NoteEditor note={note} onScanComplete={handleScanComplete} />
      )}

      {/* Slide-up panel (works on the editor screen) */}
      <SlideUpPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        blocks={note?.blocks || []}
        selectedLineId={selectedLineId}
        onSelectLine={handleLineSelect}
        onExplainSimpler={handleExplainSimpler}
        onGiveExample={handleGiveExample}
      />
    </div>
  );
}