/**
 * Notes list screen — title, first-line preview, date. Search bar on top,
 * pencil (new note) bottom right, swipe-left actions: pin / delete.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getNotesInFolder, searchNotes, createNote, togglePin, deleteNote,
  duplicateNote, moveNote,
} from '../store/db';
import FolderPickerSheet from './FolderPickerSheet';

const SORT_KEY = 'aicn:sort'; // 'edited' | 'created' | 'title'

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

/** Unique #tags in a note (max 3 shown). */
function tagsFor(note) {
  const set = new Set();
  ((note.title || '') + ' ' + (note.body || '')).replace(
    /#([A-Za-z0-9_-]+)/g,
    (m, t) => { set.add(t); return m; }
  );
  return [...set].slice(0, 3);
}

/** One swipeable row: translate on drag, reveal pin/delete actions. */
function NoteRow({ note, onOpen, onPin, onDelete, onLongPress, onTagTap }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(null);
  const pressTimer = useRef(null);
  const moved = useRef(false);

  const startLongPress = () => {
    moved.current = false;
    pressTimer.current = setTimeout(() => onLongPress(note), 500);
  };
  const cancelLongPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const onTouchStart = e => { startX.current = e.touches[0].clientX; startLongPress(); };
  const onTouchMove = e => {
    cancelLongPress();
    if (startX.current == null) return;
    const delta = e.touches[0].clientX - startX.current;
    if (Math.abs(delta) > 8) moved.current = true;
    setDx(Math.max(-140, Math.min(0, delta)));
  };
  const onTouchEnd = () => {
    cancelLongPress();
    startX.current = null;
    setDx(dx < -60 ? -140 : 0); // snap open or closed
  };

  const tags = tagsFor(note);

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
        onClick={() => { if (dx === 0) { if (!moved.current) onOpen(); } else setDx(0); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => onLongPress(note)}
      >
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="list-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {note.pinned ? '📌 ' : ''}{note.title || 'New Note'}
          </div>
          <div className="list-item-subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(note.body || 'No additional text').replace(/\n/g, ' ').slice(0, 60)}
          </div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {tags.map(t => (
                <span
                  key={t}
                  className="tag-pill"
                  onClick={e => { e.stopPropagation(); onTagTap(t); }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
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
  const [sort, setSort] = useState(() => {
    try { return localStorage.getItem(SORT_KEY) || 'edited'; } catch { return 'edited'; }
  });
  const [actionNote, setActionNote] = useState(null); // long-pressed note
  const [moveTarget, setMoveTarget] = useState(null); // note being moved
  const [sortOpen, setSortOpen] = useState(false);

  const refresh = useCallback(async () => {
    setNotes(await getNotesInFolder(folder.id, sort));
  }, [folder.id, sort]);

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
    setNotes(await getNotesInFolder(folder.id, sort));
  };

  const handleDelete = async (e, note) => {
    e.stopPropagation();
    if (!confirm(`Delete "${note.title || 'New Note'}"? It will stay in Recently Deleted for 30 days.`)) return;
    await deleteNote(note.id);
    setNotes(await getNotesInFolder(folder.id, sort));
  };

  const applySort = s => {
    setSort(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* private mode */ }
    setSortOpen(false);
  };

  const handleDuplicate = async () => {
    const src = actionNote;
    setActionNote(null);
    await duplicateNote(src.id);
    refresh();
  };

  const handleMove = async f => {
    const src = moveTarget;
    setMoveTarget(null);
    await moveNote(src.id, f.id);
    refresh();
  };

  const SORT_LABEL = { edited: 'Date edited', created: 'Date created', title: 'Title' };

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back to folders">
          ‹ Folders
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>{folder.name}</span>
        <div className="flex items-center">
          <button className="navbar-btn" aria-label="Sort notes" onClick={() => setSortOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 4v13M7 17l-3-3M7 17l3-3" /><path d="M17 20V7M17 7l-3 3M17 7l3 3" />
            </svg>
          </button>
          <button className="navbar-btn" aria-label="Search" onClick={() => setSearching(s => !s)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </div>
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
            onLongPress={n => setActionNote(n)}
            onTagTap={t => { setSearching(true); setQuery('#' + t); }}
          />
        ))}
      </div>

      {/* Long-press actions */}
      {actionNote && (
        <div className="export-overlay" onClick={() => setActionNote(null)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">{actionNote.title || 'New Note'}</div>
            <button className="export-btn" onClick={async () => { await togglePin(actionNote.id); setActionNote(null); refresh(); }}>
              📌 {actionNote.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button className="export-btn" onClick={handleDuplicate}>⧉ Duplicate</button>
            <button className="export-btn" onClick={() => { setMoveTarget(actionNote); setActionNote(null); }}>
              📁 Move to folder…
            </button>
            <button
              className="export-btn"
              style={{ color: '#ff453a' }}
              onClick={async () => {
                const n = actionNote;
                setActionNote(null);
                if (!confirm(`Delete "${n.title || 'New Note'}"? It will stay in Recently Deleted for 30 days.`)) return;
                await deleteNote(n.id);
                refresh();
              }}
            >
              🗑 Delete
            </button>
            <button className="export-btn cancel" onClick={() => setActionNote(null)}>Cancel</button>
          </div>
        </div>
      )}

      {moveTarget && (
        <FolderPickerSheet
          currentId={moveTarget.folderId}
          onPick={handleMove}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {/* Sort options */}
      {sortOpen && (
        <div className="export-overlay" onClick={() => setSortOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Sort by</div>
            {Object.entries(SORT_LABEL).map(([v, label]) => (
              <button
                key={v}
                className="export-btn"
                style={sort === v ? { fontWeight: 700 } : null}
                onClick={() => applySort(v)}
              >
                {sort === v ? '✓ ' : ''}{label}
              </button>
            ))}
            <button className="export-btn cancel" onClick={() => setSortOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

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