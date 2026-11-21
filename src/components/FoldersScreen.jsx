/**
 * Folders screen — iOS Notes style. One folder per subject with note counts.
 * New folder via + button; long-press (or edit mode) to rename/delete.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getFoldersWithCounts, createFolder, deleteFolder, renameFolder } from '../store/db';

export default function FoldersScreen({ onOpenFolder, onOpenExam }) {
  const [folders, setFolders] = useState([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const pressTimer = useRef(null);

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
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
        <button className="navbar-btn" aria-label="New folder" onClick={() => setShowNewFolder(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>
      <div className="large-title">Folders</div>

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
                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 14, color: '#ff453a' }} onClick={e => handleDelete(e, folder.id)}>Delete</button>
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