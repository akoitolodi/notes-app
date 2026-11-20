/**
 * Note editor — iOS Notes style.
 * Large title, clean body, Save button top-right, toolbar above keyboard.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { scanNote } from '../api/scan';
import { updateNote, diffLines } from '../store/db';

export default function NoteEditor({ note, onScanComplete }) {
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  const textareaRef = useRef(null);
  const savedBodyRef = useRef(note?.body || '');
  const savedTitleRef = useRef(note?.title || '');

  // Re-init when a different note is opened
  useEffect(() => {
    setTitle(note?.title || '');
    setBody(note?.body || '');
    savedBodyRef.current = note?.body || '';
    savedTitleRef.current = note?.title || '';
    setScanError(null);
  }, [note?.id]);

  const handleSave = useCallback(async () => {
    // Persist to IndexedDB
    await updateNote(note.id, { title, body });

    // Find changed lines (compare to last saved body)
    const changedLines = diffLines(savedBodyRef.current, body);

    setIsScanning(true);
    setScanError(null);

    try {
      const result = await scanNote(body, note.subject || 'General', changedLines);
      savedBodyRef.current = body;
      savedTitleRef.current = title;
      // Store blocks with the note
      await updateNote(note.id, { blocks: result.blocks || [] });
      onScanComplete?.(result.blocks || []);
    } catch (err) {
      setScanError(err.message);
    } finally {
      setIsScanning(false);
    }
  }, [title, body, note, onScanComplete]);

  // Auto-focus body on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="editor safe-bottom">
      <button
        className="btn btn-primary editor-save"
        onClick={handleSave}
        disabled={isScanning}
        aria-label={isScanning ? 'Scanning…' : 'Save'}
      >
        {isScanning ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Scanning…
          </>
        ) : (
          'Save'
        )}
      </button>

      {scanError && (
        <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>
          <span className="sr-only">Error:</span>
          {scanError}
        </div>
      )}

      <input
        type="text"
        className="editor-title"
        placeholder="Title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        aria-label="Note title"
      />

      <textarea
        ref={textareaRef}
        className="editor-body"
        placeholder="Start typing your notes…"
        value={body}
        onChange={e => setBody(e.target.value)}
        aria-label="Note body"
      />

      <div className="toolbar">
        <div className="toolbar-group">
          <button className="toolbar-btn" aria-label="Bold" title="Bold">
            <svg viewBox="0 0 24 24"><path d="M8 4h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8V4zm0 14h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H8v12zm0-8h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8v-8z"/></svg>
          </button>
          <button className="toolbar-btn" aria-label="Italic" title="Italic">
            <svg viewBox="0 0 24 24"><path d="M10 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6v-4h4v-4h-4v-4h4v-4h-4V4z"/></svg>
          </button>
          <button className="toolbar-btn" aria-label="Underline" title="Underline">
            <svg viewBox="0 0 24 24"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M4 20h16"/></svg>
          </button>
        </div>
        <div className="toolbar-group">
          <button className="toolbar-btn" aria-label="Checklist" title="Checklist">
            <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </button>
          <button className="toolbar-btn" aria-label="List" title="List">
            <svg viewBox="0 0 24 24"><path d="M11 12H3"/><path d="M11 6H3"/><path d="M11 18H3"/><path d="M19 6H15"/><path d="M19 12H15"/><path d="M19 18H15"/></svg>
          </button>
          <button className="toolbar-btn" aria-label="Table" title="Table">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}