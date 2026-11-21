/**
 * Bottom sheet for picking a folder (move note). Shared by the note editor
 * and the notes list long-press actions. Reuses the export-sheet styles.
 */
import { useState, useEffect } from 'react';
import { getFoldersWithCounts } from '../store/db';

export default function FolderPickerSheet({ currentId, onPick, onClose }) {
  const [folders, setFolders] = useState([]);

  useEffect(() => {
    let live = true;
    getFoldersWithCounts().then(f => live && setFolders(f));
    return () => { live = false; };
  }, []);

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-sheet" onClick={e => e.stopPropagation()}>
        <div className="export-title">Move to folder</div>
        {folders.map(f => (
          <button
            key={f.id}
            className="export-btn"
            style={f.id === currentId ? { opacity: 0.45 } : null}
            disabled={f.id === currentId}
            onClick={() => onPick(f)}
          >
            📁 {f.name}{f.id === currentId ? ' — current' : ''}
          </button>
        ))}
        <button className="export-btn cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
