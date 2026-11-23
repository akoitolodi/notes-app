/**
 * Notes list screen — axis-locked swipe actions (only one open at a time),
 * fixed long-press vs click handling, desktop action menu, search clear on close,
 * preserved search filter on pin/delete, and bottom clearance for FAB.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ArrowUpDown,
  Search,
  X,
  Pin,
  PinOff,
  Trash2,
  Copy,
  FolderInput,
  Paperclip,
  SquarePen,
  MoreHorizontal,
  Check,
} from 'lucide-react';
import {
  getNotesInFolder,
  searchNotes,
  createNote,
  togglePin,
  deleteNote,
  duplicateNote,
  moveNote,
} from '../store/db';
import FolderPickerSheet from './FolderPickerSheet';
import { useDialog } from './ui/DialogProvider';

const SORT_KEY = 'aicn:sort';

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: '2-digit' }
  );
}

function tagsFor(note) {
  const set = new Set();
  `${note.title || ''} ${note.body || ''}`.replace(/#([A-Za-z0-9_-]+)/g, (m, t) => {
    set.add(t);
    return m;
  });
  return [...set].slice(0, 3);
}

function hasAttachments(note) {
  if (Array.isArray(note.images) && note.images.length > 0) return true;
  const strokes = Array.isArray(note.drawings)
    ? note.drawings
    : note.drawings?.strokes || [];
  return strokes.length > 0;
}

function NoteRow({
  note,
  active,
  isSwipedOpen,
  onSwipeOpen,
  onOpen,
  onPin,
  onDelete,
  onMore,
  onTagTap,
}) {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const startRef = useRef(null); // { x, y, locked: null | 'h' | 'v' }
  const pressTimer = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const target = isSwipedOpen ? -144 : 0;
    dxRef.current = target;
    setDx(target);
  }, [isSwipedOpen]);

  const cancelLongPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  useEffect(() => () => cancelLongPress(), []);

  const onTouchStart = e => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, baseDx: dxRef.current, locked: null };
    suppressClickRef.current = false;
    cancelLongPress();
    pressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      onMore(note);
    }, 500);
  };

  const onTouchMove = e => {
    const s = startRef.current;
    if (!s) return;
    const t = e.touches[0];
    const deltaX = t.clientX - s.x;
    const deltaY = t.clientY - s.y;

    if (Math.hypot(deltaX, deltaY) > 8) cancelLongPress();

    // Lock gesture axis cleanly so vertical scroll never drags rows sideways
    if (!s.locked && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      s.locked = Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? 'h' : 'v';
    }
    if (s.locked !== 'h') return;

    suppressClickRef.current = true;
    const next = Math.max(-144, Math.min(0, s.baseDx + deltaX));
    dxRef.current = next;
    setDx(next);
  };

  const onTouchEnd = () => {
    cancelLongPress();
    const s = startRef.current;
    startRef.current = null;
    if (!s || s.locked !== 'h') return;
    const shouldOpen = dxRef.current < -64;
    const snapped = shouldOpen ? -144 : 0;
    dxRef.current = snapped;
    setDx(snapped);
    onSwipeOpen(shouldOpen ? note.id : null);
  };

  const tags = tagsFor(note);
  const preview = (note.body || 'No additional text').replace(/\n+/g, ' ').trim().slice(0, 75);

  return (
    <div className="swipe-row-wrap">
      <div
        className="swipe-actions"
        style={{ visibility: dx < -1 ? 'visible' : 'hidden' }}
        aria-hidden={dx >= -1}
      >
        <button
          type="button"
          className="swipe-action-btn swipe-action-pin"
          onClick={e => {
            onSwipeOpen(null);
            onPin(e);
          }}
        >
          {note.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          <span>{note.pinned ? 'Unpin' : 'Pin'}</span>
        </button>
        <button
          type="button"
          className="swipe-action-btn swipe-action-del"
          onClick={e => {
            onSwipeOpen(null);
            onDelete(e);
          }}
        >
          <Trash2 size={16} />
          <span>Delete</span>
        </button>
      </div>

      <div
        className={`list-item${active ? ' selected' : ''}`}
        role="button"
        tabIndex={0}
        style={{
          transform: `translateX(${dx}px)`,
          transition: startRef.current?.locked === 'h' ? 'none' : 'transform 0.2s ease',
        }}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (dxRef.current !== 0) {
            onSwipeOpen(null);
            return;
          }
          onOpen();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={e => {
          e.preventDefault();
          onMore(note);
        }}
      >
        <div className="list-item-body">
          <div className="list-item-title">
            {note.pinned && <Pin size={14} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {note.title || 'New Note'}
            </span>
            {hasAttachments(note) && (
              <Paperclip size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            )}
          </div>
          <div className="list-item-subtitle">{preview}</div>
          {tags.length > 0 && (
            <div className="flex gap-6" style={{ marginTop: 5, flexWrap: 'wrap' }}>
              {tags.map(t => (
                <button
                  key={t}
                  type="button"
                  className="tag-pill"
                  onClick={e => {
                    e.stopPropagation();
                    onTagTap(t);
                  }}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="list-item-meta">
          <span>{formatDate(note.updatedAt)}</span>
          <button
            type="button"
            className="row-icon-btn"
            aria-label={`More actions for ${note.title || 'note'}`}
            onClick={e => {
              e.stopPropagation();
              onMore(note);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotesListScreen({
  folder,
  activeNoteId = null,
  refreshKey = 0,
  onOpenNote,
  onBack,
}) {
  const { confirm, toast } = useDialog();
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem(SORT_KEY) || 'edited';
    } catch {
      return 'edited';
    }
  });
  const [openSwipeId, setOpenSwipeId] = useState(null);
  const [actionNote, setActionNote] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [sortOpen, setSortOpen] = useState(false);

  const loadNotes = useCallback(async () => {
    if (query.trim()) {
      return searchNotes(query, folder.id, sort);
    }
    return getNotesInFolder(folder.id, sort);
  }, [folder.id, sort, query]);

  const refresh = useCallback(async () => {
    setNotes(await loadNotes());
  }, [loadNotes]);

  useEffect(() => {
    let live = true;
    const delay = query.trim() ? 140 : 0;
    const t = setTimeout(() => {
      loadNotes().then(r => {
        if (live) setNotes(r);
      });
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [loadNotes, refreshKey]);

  const toggleSearch = () => {
    setSearching(prev => {
      if (prev) setQuery('');
      return !prev;
    });
  };

  const handleNewNote = async () => {
    const tagPrefix =
      typeof folder.id === 'string' && folder.id.startsWith('__tag:')
        ? `#${folder.id.slice(6)}\n`
        : '';
    const note = await createNote(
      typeof folder.id === 'number' ? folder.id : null,
      '',
      tagPrefix,
      folder.isSmart ? 'General' : folder.name
    );
    onOpenNote(note);
  };

  const handlePin = async (e, note) => {
    e.stopPropagation();
    await togglePin(note.id);
    refresh();
  };

  const handleDelete = async (e, note) => {
    e?.stopPropagation?.();
    const ok = await confirm({
      title: `Delete "${note.title || 'New Note'}"?`,
      message: 'It will stay in Recently Deleted for 30 days.',
      confirmLabel: 'Move to Trash',
      destructive: true,
    });
    if (!ok) return;
    await deleteNote(note.id);
    toast('Moved to Recently Deleted');
    refresh();
  };

  const applySort = s => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // ignore
    }
    setSortOpen(false);
  };

  const handleDuplicate = async () => {
    const src = actionNote;
    setActionNote(null);
    await duplicateNote(src.id);
    toast('Note duplicated');
    refresh();
  };

  const handleMove = async f => {
    const src = moveTarget;
    setMoveTarget(null);
    await moveNote(src.id, f.id);
    toast(`Moved to ${f.name}`);
    refresh();
  };

  const SORT_LABEL = {
    edited: 'Date edited',
    created: 'Date created',
    title: 'Title (A–Z)',
  };

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to folders"
        >
          <ChevronLeft size={20} /> Folders
        </button>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="navbar-btn"
            aria-label="Sort notes"
            onClick={() => setSortOpen(true)}
          >
            <ArrowUpDown size={18} />
          </button>
          <button
            type="button"
            className={`navbar-btn${searching ? ' navbar-btn-active' : ''}`}
            aria-label="Search notes"
            onClick={toggleSearch}
          >
            <Search size={19} />
          </button>
        </div>
      </header>

      <div className="large-title">{folder.name}</div>

      {searching && (
        <div className="search-bar">
          <div className="search-input-wrap">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              className="search-input"
              autoFocus
              placeholder={`Search in ${folder.name}`}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggleSearch}>
            Cancel
          </button>
        </div>
      )}

      <div className="list-group">
        {notes.length === 0 ? (
          <div className="list-item list-item-static">
            <span className="list-item-subtitle">
              {query.trim()
                ? 'No matching notes.'
                : 'No notes yet — tap the compose button to write one.'}
            </span>
          </div>
        ) : (
          notes.map(note => (
            <NoteRow
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              isSwipedOpen={openSwipeId === note.id}
              onSwipeOpen={setOpenSwipeId}
              onOpen={() => onOpenNote(note)}
              onPin={e => handlePin(e, note)}
              onDelete={e => handleDelete(e, note)}
              onMore={n => setActionNote(n)}
              onTagTap={t => {
                setSearching(true);
                setQuery('#' + t);
              }}
            />
          ))
        )}
      </div>

      {/* Note Action Sheet */}
      {actionNote && (
        <div className="export-overlay" onClick={() => setActionNote(null)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">{actionNote.title || 'New Note'}</div>
            <button
              type="button"
              className="export-btn"
              onClick={async () => {
                await togglePin(actionNote.id);
                setActionNote(null);
                refresh();
              }}
            >
              {actionNote.pinned ? <PinOff size={18} /> : <Pin size={18} />}
              {actionNote.pinned ? 'Unpin note' : 'Pin note'}
            </button>
            <button type="button" className="export-btn" onClick={handleDuplicate}>
              <Copy size={18} /> Duplicate
            </button>
            <button
              type="button"
              className="export-btn"
              onClick={() => {
                setMoveTarget(actionNote);
                setActionNote(null);
              }}
            >
              <FolderInput size={18} /> Move to folder…
            </button>
            <button
              type="button"
              className="export-btn danger"
              onClick={() => {
                const n = actionNote;
                setActionNote(null);
                handleDelete(null, n);
              }}
            >
              <Trash2 size={18} /> Delete
            </button>
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setActionNote(null)}
            >
              Cancel
            </button>
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

      {/* Sort sheet */}
      {sortOpen && (
        <div className="export-overlay" onClick={() => setSortOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Sort by</div>
            {Object.entries(SORT_LABEL).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className="export-btn"
                style={sort === v ? { fontWeight: 700, color: 'var(--accent-ink)' } : null}
                onClick={() => applySort(v)}
              >
                {sort === v ? <Check size={17} /> : <span style={{ width: 17 }} />}
                {label}
              </button>
            ))}
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setSortOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="fab"
        onClick={handleNewNote}
        aria-label="New note"
        title="New note"
      >
        <SquarePen size={22} />
      </button>
    </div>
  );
}
