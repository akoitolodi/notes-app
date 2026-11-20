/**
 * Root app component — single-screen editor for Phase 1.
 * Handles: editor, slide-up panel, note persistence.
 */
import { useState, useEffect, useCallback } from 'react';
import NoteEditor from './components/NoteEditor';
import SlideUpPanel from './components/SlideUpPanel';
import { notesStore } from './store/useNotes';

export default function App() {
  const [note, setNote] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);

  // Load note on mount
  useEffect(() => {
    const unsubscribe = notesStore.subscribe(() => {
      const active = notesStore.getActiveNote();
      setNote(active);
    });
    // Initial load
    const active = notesStore.getActiveNote();
    if (!active) {
      const newNote = notesStore.newNote('General');
      setNote(newNote);
    } else {
      setNote(active);
    }
    return unsubscribe;
  }, []);

  const handleSave = useCallback(updated => {
    notesStore.updateNote(note.id, updated);
    setNote({ ...note, ...updated });
  }, [note]);

  const handleScanComplete = useCallback(blocks => {
    // Update local note with blocks
    const updated = { ...note, blocks };
    setNote(updated);
    setSelectedLineId(blocks[0]?.id || null);
    setPanelOpen(true);
  }, [note]);

  const handleLineSelect = useCallback(id => {
    setSelectedLineId(id);
  }, []);

  const handleExplainSimpler = useCallback(async lineId => {
    const block = note.blocks.find(b => b.id === lineId);
    if (!block) return;
    // For Phase 1, just show a placeholder — Phase 3 adds re-scan per line
    alert(`"Explain simpler" for: ${block.text.slice(0, 50)}…`);
  }, [note.blocks]);

  const handleGiveExample = useCallback(async lineId => {
    const block = note.blocks.find(b => b.id === lineId);
    if (!block) return;
    alert(`"Give example" for: ${block.text.slice(0, 50)}…`);
  }, [note.blocks]);

  if (!note) return null; // Loading

  return (
    <div className="screen">
      {/* Navbar */}
      <header className="navbar safe-top">
        <span className="navbar-title">Notes</span>
        <button className="navbar-btn" aria-label="New note" onClick={() => {
          const newNote = notesStore.newNote('General');
          setNote(newNote);
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
      </header>

      {/* Large title area */}
      <div className="large-title safe-top" style={{ paddingTop: '12px' }}>
        {note.title || 'New Note'}
      </div>

      {/* Editor */}
      <NoteEditor
        note={note}
        onSave={handleSave}
        onScanComplete={handleScanComplete}
      />

      {/* Slide-up panel */}
      <SlideUpPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        blocks={note.blocks || []}
        selectedLineId={selectedLineId}
        onSelectLine={handleLineSelect}
        onExplainSimpler={handleExplainSimpler}
        onGiveExample={handleGiveExample}
      />
    </div>
  );
}