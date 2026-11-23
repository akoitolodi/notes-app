/**
 * Recently Deleted (trash) — shows days remaining, folder origin, read-only
 * preview sheet before restoring/deleting, and custom confirmation dialogs.
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, RotateCcw, Trash2, Eye } from 'lucide-react';
import { db, getTrash, restoreNote, purgeNote, emptyTrash } from '../store/db';
import { useDialog } from './ui/DialogProvider';
import MarkdownContent from './ui/MarkdownContent';

function daysRemaining(trashedAt) {
  if (!trashedAt) return 30;
  const elapsedDays = Math.floor((Date.now() - trashedAt) / (24 * 60 * 60 * 1000));
  return Math.max(0, 30 - elapsedDays);
}

export default function TrashScreen({ onBack, onChanged }) {
  const { confirm, toast } = useDialog();
  const [items, setItems] = useState([]);
  const [folderMap, setFolderMap] = useState({});
  const [preview, setPreview] = useState(null);

  const refresh = useCallback(async () => {
    const [trashItems, folders] = await Promise.all([getTrash(), db.folders.toArray()]);
    const fm = {};
    folders.forEach(f => {
      fm[f.id] = f.name;
    });
    setFolderMap(fm);
    setItems(trashItems);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRestore = async item => {
    await restoreNote(item.id);
    setPreview(null);
    toast(`Restored "${item.title || 'New Note'}"`);
    refresh();
    onChanged?.();
  };

  const handlePurge = async item => {
    const ok = await confirm({
      title: 'Delete forever?',
      message: `"${item.title || 'New Note'}" will be permanently erased and cannot be recovered.`,
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (!ok) return;
    await purgeNote(item.id);
    setPreview(null);
    toast('Deleted permanently');
    refresh();
    onChanged?.();
  };

  const handleEmpty = async () => {
    if (items.length === 0) return;
    const ok = await confirm({
      title: `Empty Trash?`,
      message: `Permanently delete all ${items.length} note${items.length === 1 ? '' : 's'}? This cannot be undone.`,
      confirmLabel: 'Empty Trash',
      destructive: true,
    });
    if (!ok) return;
    await emptyTrash();
    toast('Trash emptied');
    refresh();
    onChanged?.();
  };

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to folders"
        >
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">Recently Deleted</span>
        <button
          type="button"
          className="navbar-btn"
          style={{ color: items.length ? 'var(--bad)' : undefined }}
          onClick={handleEmpty}
          disabled={items.length === 0}
        >
          Empty
        </button>
      </header>

      <div className="large-title">Recently Deleted</div>

      <div className="list-group">
        {items.length === 0 ? (
          <div className="list-item list-item-static">
            <span className="list-item-subtitle">
              Trash is empty. Deleted notes stay here for 30 days before auto-purge.
            </span>
          </div>
        ) : (
          items.map(item => {
            const left = daysRemaining(item.trashedAt);
            const origin = folderMap[item.folderId] || 'General (reassigned on restore)';
            return (
              <div
                key={item.id}
                className="list-item"
                role="button"
                tabIndex={0}
                onClick={() => setPreview(item)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPreview(item);
                  }
                }}
              >
                <div className="list-item-body">
                  <div className="list-item-title">{item.title || 'New Note'}</div>
                  <div className="list-item-subtitle">
                    {left}d left · {origin}
                  </div>
                </div>
                <div className="flex items-center gap-6" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleRestore(item)}
                    title="Restore note"
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button
                    type="button"
                    className="row-icon-btn"
                    style={{ color: 'var(--bad)' }}
                    aria-label="Delete forever"
                    onClick={() => handlePurge(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {preview && (
        <div className="export-overlay" onClick={() => setPreview(null)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">
              <Eye size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              Preview · {daysRemaining(preview.trashedAt)}d left
            </div>
            <div className="explanation-card" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                {preview.title || 'New Note'}
              </div>
              <MarkdownContent text={preview.body || '_Empty note_'} />
            </div>
            <button
              type="button"
              className="export-btn"
              style={{ color: 'var(--ok)' }}
              onClick={() => handleRestore(preview)}
            >
              <RotateCcw size={18} /> Restore note
            </button>
            <button
              type="button"
              className="export-btn danger"
              onClick={() => handlePurge(preview)}
            >
              <Trash2 size={18} /> Delete forever
            </button>
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setPreview(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
