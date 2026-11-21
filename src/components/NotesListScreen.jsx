/**
 * Notes list screen — title, first-line preview, date. Search bar on top,
 * pencil (new note) bottom right, swipe-left actions: pin / delete.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getNotesInFolder, searchNotes, createNote, togglePin, deleteNote } from '../store/db';

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString([], sameYear
    ? { month: 'numeric', day: 'numeric' }
    : { month: 'numeric', day: 'numeric', year: '2-digit' });
}

/** One swipeable row: translate on drag, reveal pin/delete actions. */
function NoteRow({ note, onOpen, onPin, onDelete }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(null);

  const onTouchStart = e => { startX.current = e.touches[0].clientX; };
  const onTouchMove = e => {
    if (startX.current == null) return;
    const delta = e.touches[0].clientX - startX.current;
    setDx(Math.max(-140, Math.min(0, delta)));
  };
  const onTouchEnd = () => {
    startX.current = null;
    setDx(dx < -60 ? -140 : 0); // snap open or closed
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Action buttons behind the row */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, right: 0,
        display: 'flex', alignItems: 'stretch',
      }}>
        <button
          onClick={onPin}
          style={{ border: 'none', background: '#5e5ce6', color: '#fff', width: 70, fontSize: 13, fontWeight: 600 }}
        >
          {note.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          onClick={onDelete}
          style={{ border: 'none', background: '#ff453a', color: '#fff', width: 70, fontSize: 13, fontWeight: 600 }}
        >
          Delete
        </button>
      </div>

      {/* The row itself */}
      <div
        className="list-item"
        style={{ transform: `translateX(${dx}px)`, transition: startX.current == null ? 'transform 0.2s' : 'none', cursor: 'pointer' }}
        onClick={() => { if (dx === 0) onOpen(); else setDx(0); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="list-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {note.pinned ? '📌 ' : ''}{note.title || 'New Note'}
          </div>
          <div className="list-item-subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(note.body || 'No additional text').replace(/\n/g, ' ').slice(0, 60)}
          </div>
        </div>
        <span className="list-item-subtitle" style={{ marginLeft: 8, flexShrink: 0 }}>
          {formatDate(note.updatedAt)}
        </span>
      </div>
    </div>
  );
}

export default function NotesListScreen({ folder, onOpenNote, onBack }) {
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    setNotes(await getNotesInFolder(folder.id));
  }, [folder.id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let live = true;
    if (query.trim()) {
      searchNotes(query, folder.id).then(r => live && setNotes(r));
    } else {
      refresh();
    }
    return () => { live = false; };
  }, [query, folder.id, refresh]);

  const handleNewNote = async () => {
    const note = await createNote(folder.id);
    onOpenNote(note);
  };

  const handlePin = async (e, note) => {
    e.stopPropagation();
    await togglePin(note.id);
    setNotes(await getNotesInFolder(folder.id));
  };

  const handleDelete = async (e, note) => {
    e.stopPropagation();
    if (!confirm(`Delete "${note.title || 'New Note'}"?`)) return;
    await deleteNote(note.id);
    setNotes(await getNotesInFolder(folder.id));
  };

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back to folders">
          ‹ Folders
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>{folder.name}</span>
        <button className="navbar-btn" aria-label="Search" onClick={() => setSearching(s => !s)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
        </button>
      </header>
      <div className="large-title">{folder.name}</div>

      {searching && (
        <div className="search-bar">
          <span className="search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            className="search-input"
            autoFocus
            placeholder="Search notes"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="list-group">
        {notes.length === 0 && (
          <div className="list-item">
            <span className="list-item-subtitle">
              {query ? 'No matching notes.' : 'No notes yet — tap the pencil to write one.'}
            </span>
          </div>
        )}
        {notes.map(note => (
          <NoteRow
            key={note.id}
            note={note}
            onOpen={() => onOpenNote(note)}
            onPin={e => handlePin(e, note)}
            onDelete={e => handleDelete(e, note)}
          />
        ))}
      </div>

      {/* New note — pencil, bottom right */}
      <button
        className="btn btn-primary"
        onClick={handleNewNote}
        aria-label="New note"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          width: 56,
          height: 56,
          borderRadius: '50%',
          padding: 0,
          boxShadow: '0 4px 12px var(--shadow-strong)',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
    </div>
  );
}