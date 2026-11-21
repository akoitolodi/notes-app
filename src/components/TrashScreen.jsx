/**
 * Recently Deleted (trash). Restore or delete forever; empty all.
 * Notes are auto-purged after 30 days (purgeOldTrash runs on app boot).
 */
import { useState, useEffect, useCallback } from 'react';
import { getTrash, restoreNote, purgeNote, emptyTrash } from '../store/db';

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

export default function TrashScreen({ onBack }) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    setItems(await getTrash());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRestore = async item => {
    await restoreNote(item.id);
    refresh();
  };

  const handlePurge = async item => {
    if (!confirm(`Delete "${item.title || 'New Note'}" forever?`)) return;
    await purgeNote(item.id);
    refresh();
  };

  const handleEmpty = async () => {
    if (items.length === 0) return;
    if (!confirm(`Permanently delete all ${items.length} note(s)?`)) return;
    await emptyTrash();
    refresh();
  };

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back to folders">
          ‹ Folders
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>Recently Deleted</span>
        <button
          className="navbar-btn"
          style={{ width: 'auto', fontSize: 14 }}
          onClick={handleEmpty}
          disabled={items.length === 0}
          aria-label="Empty trash"
        >
          Empty
        </button>
      </header>
      <div className="large-title">Recently Deleted</div>

      <div className="list-group">
        {items.length === 0 && (
          <div className="list-item">
            <span className="list-item-subtitle">Trash is empty. Deleted notes stay here for 30 days.</span>
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="list-item">
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div className="list-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.title || 'New Note'}
              </div>
              <div className="list-item-subtitle">
                Deleted {fmtDate(item.trashedAt)} · {(item.body || '').replace(/\n/g, ' ').slice(0, 40)}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: 13, marginLeft: 8, flexShrink: 0 }}
              onClick={() => handleRestore(item)}
            >
              Restore
            </button>
            <button
              className="btn"
              style={{ padding: '6px 12px', fontSize: 13, marginLeft: 6, flexShrink: 0, background: 'transparent', color: '#ff453a' }}
              onClick={() => handlePurge(item)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
