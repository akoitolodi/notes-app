/**
 * ImportSheet — import .pdf, .pptx, .md, or .txt lecture slides & handouts into a note.
 * Defaults to Instant Offline Extraction (0 API calls) with an optional "Structure with AI" toggle.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  FileUp,
  FileText,
  Sparkles,
  Zap,
  X,
  Folder,
  AlertCircle,
} from 'lucide-react';
import { db, createNote } from '../store/db';
import { extractDocument, structureImportedTextWithAI } from '../lib/docImporter';
import { useDialog } from './ui/DialogProvider';

export default function ImportSheet({
  defaultFolderId = null,
  onImported,
  onClose,
}) {
  const { toast } = useDialog();
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(
    typeof defaultFolderId === 'number' ? defaultFolderId : ''
  );
  const [selectedFile, setSelectedFile] = useState(null);
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null); // { current, total }
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    db.folders
      .toArray()
      .then(list => {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        setFolders(sorted);
        if (typeof defaultFolderId !== 'number' && sorted.length > 0) {
          const general = sorted.find(f => f.name === 'General') || sorted[0];
          setFolderId(general.id);
        }
      })
      .catch(() => {});
    return () => abortRef.current?.abort();
  }, [defaultFolderId]);

  const handleFilePick = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedFile(f);
    setError(null);
  };

  const handleImport = async () => {
    if (!selectedFile || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setProgress(null);
    setStatus('Reading file offline…');

    try {
      const extracted = await extractDocument(selectedFile, {
        onProgress: p => {
          setProgress(p);
          setStatus(
            p.phase === 'slides'
              ? `Reading slide ${p.current} of ${p.total}…`
              : `Reading page ${p.current} of ${p.total}…`
          );
        },
      });

      if (controller.signal.aborted) return;

      const targetFolder = folders.find(f => f.id === Number(folderId)) || folders[0];
      const subjectName = targetFolder?.name || 'General';
      let finalBody = extracted.rawMarkdown;

      if (useAi) {
        setProgress(null);
        finalBody = await structureImportedTextWithAI({
          title: extracted.title,
          rawMarkdown: extracted.rawMarkdown,
          subject: subjectName,
          signal: controller.signal,
          onStatus: setStatus,
        });
      }

      if (controller.signal.aborted) return;

      const created = await createNote(
        targetFolder?.id ?? null,
        extracted.title,
        finalBody,
        subjectName
      );

      toast(
        `Imported "${extracted.title}" (${extracted.pageCount} ${
          extracted.kind === 'pptx' ? 'slide' : 'page'
        }${extracted.pageCount === 1 ? '' : 's'})`,
        { type: 'success' }
      );
      onImported?.(created, targetFolder || { id: '__all__', name: 'All Notes' });
    } catch (err) {
      if (err?.isCancelled || controller.signal.aborted) {
        setStatus('');
      } else {
        setError(err?.message || 'Could not import this file.');
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleCancel = () => {
    if (busy) {
      abortRef.current?.abort();
      setBusy(false);
      setStatus('');
      setProgress(null);
    } else {
      onClose?.();
    }
  };

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  const modal = (
    <div className="export-overlay" onClick={() => !busy && onClose?.()}>
      <div
        className="export-sheet import-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import PDF or Slides"
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <div className="export-title" style={{ marginBottom: 0, textAlign: 'left' }}>
            Import PDF, Slides or Text
          </div>
          {!busy && (
            <button
              type="button"
              className="navbar-btn"
              aria-label="Close import dialog"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* File Picker Zone */}
        <button
          type="button"
          className={`import-dropzone${selectedFile ? ' has-file' : ''}`}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="import-dropzone-icon">
            {selectedFile ? <FileText size={22} /> : <FileUp size={22} />}
          </span>
          <div className="import-dropzone-title">
            {selectedFile ? selectedFile.name : 'Choose a .pdf, .pptx, .md, or .txt file'}
          </div>
          <div className="import-dropzone-sub">
            {selectedFile
              ? `${(selectedFile.size / 1024).toFixed(selectedFile.size > 1024 * 1024 ? 0 : 1)} KB · Tap to change`
              : 'Extracts text, slide bullets & speaker notes 100% offline on this device'}
          </div>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.pptx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown"
          style={{ display: 'none' }}
          onChange={handleFilePick}
        />

        {/* Target Folder */}
        {folders.length > 0 && (
          <div className="import-field">
            <label className="settings-label" htmlFor="import-folder-select">
              <Folder size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Save into folder
            </label>
            <select
              id="import-folder-select"
              className="ai-input"
              value={folderId}
              disabled={busy}
              onChange={e => setFolderId(Number(e.target.value))}
            >
              {folders.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Extraction Mode Toggle (Offline 0-call default vs AI Structured) */}
        <div className="import-mode-grid">
          <button
            type="button"
            disabled={busy}
            className={`import-mode-btn${!useAi ? ' active' : ''}`}
            onClick={() => setUseAi(false)}
          >
            <Zap size={16} />
            <div>
              <div className="import-mode-title">Instant Offline</div>
              <div className="import-mode-sub">0 API calls · Fast & free</div>
            </div>
          </button>
          <button
            type="button"
            disabled={busy}
            className={`import-mode-btn${useAi ? ' active' : ''}`}
            onClick={() => setUseAi(true)}
          >
            <Sparkles size={16} />
            <div>
              <div className="import-mode-title">Structure with AI</div>
              <div className="import-mode-sub">Clean study notes & tags</div>
            </div>
          </button>
        </div>

        {/* Status / Progress */}
        {busy && (
          <div style={{ marginTop: 12 }}>
            <div className="scan-indicator" style={{ padding: '4px 0' }}>
              <span className="spinner" /> {status || 'Importing…'}
            </div>
            {pct !== null && (
              <div className="progress-bar-track" style={{ marginTop: 6, marginBottom: 0 }}>
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="inline-mistake" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-8" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={handleCancel}
          >
            {busy ? 'Stop' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={!selectedFile || busy}
            onClick={handleImport}
          >
            <FileUp size={16} /> {busy ? 'Importing…' : 'Import Note'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
