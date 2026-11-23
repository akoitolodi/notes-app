/**
 * Folders screen — iOS Notes style. One folder per subject with note counts.
 * New folder via + button; long-press (or edit mode) to rename/delete.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getFoldersWithCounts, createFolder, deleteFolder, renameFolder, searchNotes, getTrashCount } from '../store/db';

export default function FoldersScreen({ onOpenFolder, onOpenExam, onOpenNote, onOpenTrash, onOpenSettings }) {
  const [folders, setFolders] = useState([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const pressTimer = useRef(null);
  // Global search (all folders)
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [folderMap, setFolderMap] = useState({});
  const [trashCount, setTrashCount] = useState(0);

  // Long-press (500ms) opens the rename/delete actions — double-click
  // doesn't exist on touch screens.
  const startLongPress = id => {
    cancelLongPress();
    pressTimer.current = setTimeout(() => setEditingId(id), 500);
  };
  const cancelLongPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  useEffect(() => () => cancelLongPress(), []);

  const refresh = useCallback(async () => {
    setFolders(await getFoldersWithCounts());
    setTrashCount(await getTrashCount());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Global search across every folder
  useEffect(() => {
    let live = true;
    if (searching && query.trim()) {
      searchNotes(query, null).then(async r => {
        if (!live) return;
        const fm = {};
        (await db.folders.toArray()).forEach(f => { fm[f.id] = f.name; });
        setFolderMap(fm);
        setResults(r);
      });
    } else {
      setResults([]);
    }
    return () => { live = false; };
  }, [query, searching]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createFolder(newName);
    setNewName('');
    setShowNewFolder(false);
    refresh();
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this folder and all its notes?')) return;
    await deleteFolder(id);
    refresh();
  };

  const handleRename = async (e, id) => {
    e.stopPropagation();
    const name = prompt('Rename folder');
    if (name && name.trim()) {
      await renameFolder(id, name);
      refresh();
    }
    setEditingId(null);
  };

  return (
    <div className="screen" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="navbar safe-top">
        <span style={{ width: 44 }} />
        <span className="navbar-title">Folders</span>
        <div className="flex items-center">
          <button className="navbar-btn" aria-label="Search all notes" onClick={() => setSearching(s => !s)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          <button className="navbar-btn" aria-label="Settings" onClick={onOpenSettings}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
          <button className="navbar-btn" aria-label="New folder" onClick={() => setShowNewFolder(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </header>
      <div className="large-title">Folders</div>

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
            placeholder="Search all notes"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      )}

      {searching && query.trim() && (
        <div className="list-group">
          {results.length === 0 && (
            <div className="list-item"><span className="list-item-subtitle">No matching notes.</span></div>
          )}
          {results.map(n => (
            <div
              key={n.id}
              className="list-item"
              style={{ cursor: 'pointer' }}
              onClick={() => onOpenNote(n, { id: n.folderId, name: folderMap[n.folderId] })}
            >
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="list-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {n.title || 'New Note'}
                </div>
                <div className="list-item-subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(n.body || 'No additional text').replace(/\n/g, ' ').slice(0, 50)}
                </div>
              </div>
              <span className="list-item-chevron" style={{ marginLeft: 8, fontSize: 13 }}>
                {folderMap[n.folderId] || ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {showNewFolder && (
        <div className="list-group" style={{ padding: 12 }}>
          <input
            className="search-input"
            style={{ paddingLeft: 16 }}
            autoFocus
            placeholder="Folder name (e.g. Biology)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-8 mt-8">
            <button className="btn btn-primary flex-1" onClick={handleCreate} disabled={!newName.trim()}>Create</button>
            <button className="btn btn-secondary" onClick={() => { setShowNewFolder(false); setNewName(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="list-group">
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={onOpenTrash}>
          <span style={{ marginRight: 12, fontSize: 22 }}>🗑</span>
          <div className="flex-1">
            <div className="list-item-title">Recently Deleted</div>
            <div className="list-item-subtitle">Kept 30 days</div>
          </div>
          {trashCount > 0 && <span className="list-item-chevron">{trashCount}</span>}
        </div>
      </div>

      <div className="list-group">
        {folders.length === 0 && (
          <div className="list-item"><span className="list-item-subtitle">No folders yet — tap + to add one.</span></div>
        )}
        {folders.map(folder => (
          <div
            key={folder.id}
            className="list-item"
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenFolder(folder)}
            onTouchStart={() => startLongPress(folder.id)}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onDoubleClick={() => setEditingId(folder.id)}
          >
            <span style={{ marginRight: 12, fontSize: 22 }}>📁</span>
            <div className="flex-1" onDoubleClick={() => setEditingId(folder.id)}>
              <div className="list-item-title">{folder.name}</div>
              <div className="list-item-subtitle">{folder.noteCount} note{folder.noteCount === 1 ? '' : 's'}</div>
            </div>
            {editingId === folder.id ? (
              <>
                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 14 }} onClick={e => handleRename(e, folder.id)}>Rename</button>
                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 14, color: 'var(--bad)' }} onClick={e => handleDelete(e, folder.id)}>Delete</button>
              </>
            ) : (
              <div className="flex items-center gap-8">
                <button
                  className="btn btn-ghost"
                  style={{ padding: '6px 10px', fontSize: 13 }}
                  onClick={e => { e.stopPropagation(); onOpenExam?.(folder); }}
                  title="Exam summary"
                >
                  📝 Exam
                </button>
                <span className="list-item-chevron">›</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}