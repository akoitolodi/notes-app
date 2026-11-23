/**
 * Bottom sheet for picking a folder (move note). Shared by NoteEditor & NotesListScreen.
 */
import { useState, useEffect } from 'react';
import { Folder, Check } from 'lucide-react';
import { getFoldersWithCounts } from '../store/db';

export default function FolderPickerSheet({ currentId, onPick, onClose }) {
  const [folders, setFolders] = useState([]);

  useEffect(() => {
    let live = true;
    getFoldersWithCounts().then(f => {
      if (live) setFolders(f);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Move to folder">
        <div className="export-title">Move to folder</div>
        {folders.map(f => {
          const isCurrent = f.id === currentId;
          return (
            <button
              key={f.id}
              type="button"
              className="export-btn"
              disabled={isCurrent}
              onClick={() => onPick(f)}
            >
              <Folder size={18} />
              <span className="flex-1">{f.name}</span>
              {isCurrent && <Check size={16} style={{ color: 'var(--accent-ink)' }} />}
            </button>
          );
        })}
        <button type="button" className="export-btn cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
