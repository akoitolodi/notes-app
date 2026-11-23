/**
 * ImportSheet — Universal Material Importer:
 * 1. File Upload (.pdf, .pptx, .docx, .md, .txt) — 100% offline extraction + optional AI structuring
 * 2. Paste Canvas Page / Module (rich HTML -> clean Markdown keeping headings, tables, code & links)
 * 3. Batch Multi-Screenshot OCR (select up to 10 slide/handout screenshots -> one combined note)
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
  ClipboardPaste,
  Images,
} from 'lucide-react';
import { db, createNote, logStudyActivity } from '../store/db';
import { isVaultUnlocked } from '../lib/vault';
import { extractDocument, structureImportedTextWithAI } from '../lib/docImporter';
import { htmlToCleanMarkdown } from '../lib/htmlToMarkdown';
import { ocrImage } from '../lib/aiFeatures';
import { compressImage } from './ImageManager';
import { useDialog } from './ui/DialogProvider';

export default function ImportSheet({
  defaultFolderId = null,
  initialFile = null,
  initialPastedText = '',
  initialTitle = '',
  onImported,
  onClose,
}) {
  const { toast } = useDialog();
  const [mode, setMode] = useState(initialPastedText ? 'paste' : 'file'); // file | paste | ocr
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(
    typeof defaultFolderId === 'number' ? defaultFolderId : ''
  );

  // Mode 1: File
  const [selectedFile, setSelectedFile] = useState(initialFile);
  // Mode 2: Rich Canvas Page Paste
  const [pasteTitle, setPasteTitle] = useState(initialTitle || '');
  const [pasteMarkdown, setPasteMarkdown] = useState(initialPastedText || '');
  // Mode 3: Batch Multi-Screenshot OCR
  const [ocrFiles, setOcrFiles] = useState([]);
  const [ocrTitle, setOcrTitle] = useState('');

  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const ocrInputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const unlocked = isVaultUnlocked();
    db.folders
      .toArray()
      .then(list => {
        const visible = list.filter(f => !f.isSystemVault && f.mode !== 'vault' && (unlocked || !f.locked));
        const sorted = [...visible].sort((a, b) => a.name.localeCompare(b.name));
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

  const handleOcrFilesPick = e => {
    const list = Array.from(e.target.files || []).slice(0, 10);
    if (list.length === 0) return;
    setOcrFiles(list);
    setError(null);
    if (!ocrTitle.trim()) {
      setOcrTitle(`Scanned Slides (${list.length} images)`);
    }
  };

  const handleRichPaste = e => {
    const html = e.clipboardData?.getData('text/html');
    const plain = e.clipboardData?.getData('text/plain');
    if (html && /<[a-z]/i.test(html)) {
      e.preventDefault();
      const cleaned = htmlToCleanMarkdown(html, plain);
      setPasteMarkdown(prev => (prev ? `${prev}\n\n${cleaned}` : cleaned));
      if (!pasteTitle.trim()) {
        const firstH = /^#+\s+(.+)$/m.exec(cleaned) || /^(.{4,80})$/m.exec(cleaned);
        if (firstH) setPasteTitle(firstH[1].replace(/[*_`]/g, '').trim().slice(0, 72));
      }
      toast('Converted Canvas HTML into clean Markdown!', { type: 'success' });
    }
  };

  const finishSaveNote = async ({ title, rawMarkdown, targetFolder, signal }) => {
    const subjectName = targetFolder?.name || 'General';
    let finalBody = rawMarkdown;
    if (useAi && rawMarkdown.trim()) {
      try {
        finalBody = await structureImportedTextWithAI({
          title,
          rawMarkdown,
          subject: subjectName,
          signal,
          onStatus: msg => setStatus(msg),
        });
      } catch (aiErr) {
        if (aiErr?.isCancelled) throw aiErr;
        toast(`AI structuring skipped (${aiErr.message}) — saved offline text.`, { type: 'info' });
        finalBody = rawMarkdown;
      }
    }

    const created = await createNote(
      targetFolder?.id ?? null,
      title || 'Imported Material',
      finalBody,
      subjectName
    );
    await logStudyActivity('notes', 1);
    toast(`Imported "${title || 'Material'}" into ${subjectName}`, { type: 'success' });
    onImported?.(created, targetFolder || { id: '__all__', name: 'All Notes' });
  };

  const handleImport = async () => {
    if (busy) return;
    const targetFolder = folders.find(f => f.id === Number(folderId)) || folders[0];
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress(null);

    try {
      if (mode === 'file') {
        if (!selectedFile) return;
        setStatus('Reading file offline…');
        const extracted = await extractDocument(selectedFile, {
          onProgress: p => {
            setProgress(p);
            setStatus(
              p.phase === 'slides'
                ? `Reading slide ${p.current} of ${p.total}…`
                : p.phase === 'docx'
                  ? 'Reading Word document…'
                  : `Reading page ${p.current} of ${p.total}…`
            );
          },
        });
        if (controller.signal.aborted) return;
        await finishSaveNote({
          title: extracted.title,
          rawMarkdown: extracted.rawMarkdown,
          targetFolder,
          signal: controller.signal,
        });
      } else if (mode === 'paste') {
        const cleanMd = htmlToCleanMarkdown(pasteMarkdown, pasteMarkdown);
        if (!cleanMd) throw new Error('Paste a Canvas module page or text first.');
        const title =
          pasteTitle.trim() ||
          cleanMd.split('\n')[0].replace(/^#+\s*/, '').slice(0, 64) ||
          'Canvas Module Page';
        await finishSaveNote({
          title,
          rawMarkdown: cleanMd,
          targetFolder,
          signal: controller.signal,
        });
      } else if (mode === 'ocr') {
        if (ocrFiles.length === 0) throw new Error('Choose at least 1 screenshot or slide photo.');
        const parts = [];
        for (let i = 0; i < ocrFiles.length; i++) {
          if (controller.signal.aborted) return;
          setProgress({ current: i + 1, total: ocrFiles.length });
          setStatus(`Running OCR on screenshot ${i + 1} of ${ocrFiles.length}…`);
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Could not read image'));
            r.readAsDataURL(ocrFiles[i]);
          });
          const compressed = await compressImage(dataUrl);
          const text = await ocrImage(compressed, controller.signal);
          if (text && text.trim()) {
            parts.push(`## Slide / Page ${i + 1}\n${text.trim()}`);
          }
        }
        if (parts.length === 0) throw new Error('No text could be recognized from the selected images.');
        await finishSaveNote({
          title: ocrTitle.trim() || `Scanned Handout (${ocrFiles.length} pages)`,
          rawMarkdown: parts.join('\n\n'),
          targetFolder,
          signal: controller.signal,
        });
      }
    } catch (err) {
      if (!err?.isCancelled) {
        setError(err?.message || 'Import failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (busy) {
      abortRef.current?.abort();
      setBusy(false);
      setStatus('');
    } else {
      onClose?.();
    }
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  const canSubmit =
    !busy &&
    ((mode === 'file' && Boolean(selectedFile)) ||
      (mode === 'paste' && Boolean(pasteMarkdown.trim())) ||
      (mode === 'ocr' && ocrFiles.length > 0));

  const modal = (
    <div className="export-overlay" onClick={busy ? undefined : onClose}>
      <div className="export-sheet import-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
          <div className="export-title" style={{ marginBottom: 0 }}>
            Import Materials
          </div>
          {!busy && (
            <button
              type="button"
              className="navbar-btn"
              onClick={onClose}
              aria-label="Close import"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* 3-Tab Import Mode Switcher */}
        <div className="view-switcher" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`view-switch-btn${mode === 'file' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setMode('file')}
          >
            <FileUp size={13} style={{ marginRight: 4 }} /> File
          </button>
          <button
            type="button"
            className={`view-switch-btn${mode === 'paste' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setMode('paste')}
          >
            <ClipboardPaste size={13} style={{ marginRight: 4 }} /> Canvas Page
          </button>
          <button
            type="button"
            className={`view-switch-btn${mode === 'ocr' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setMode('ocr')}
          >
            <Images size={13} style={{ marginRight: 4 }} /> Multi-OCR
          </button>
        </div>

        {/* MODE 1: FILE PICKER (.pdf, .pptx, .docx, .md, .txt) */}
        {mode === 'file' && (
          <>
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
                {selectedFile ? selectedFile.name : 'Choose a .pdf, .pptx, .docx, .md, or .txt file'}
              </div>
              <div className="import-dropzone-sub">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(selectedFile.size > 1024 * 1024 ? 0 : 1)} KB · Tap to change`
                  : 'Extracts PDF pages, PowerPoint slides & Word docs 100% offline'}
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              style={{ display: 'none' }}
              onChange={handleFilePick}
            />
          </>
        )}

        {/* MODE 2: PASTE CANVAS MODULE PAGE (HTML -> MARKDOWN) */}
        {mode === 'paste' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="ai-input"
              style={{ marginTop: 0 }}
              placeholder="Module / Page title (auto-detected if left blank)"
              value={pasteTitle}
              onChange={e => setPasteTitle(e.target.value)}
              disabled={busy}
            />
            <textarea
              className="ai-input"
              style={{ marginTop: 0, minHeight: 112 }}
              placeholder="On Canvas, press Select All → Copy on a Module page, then paste right here! Headings, lists, tables & links convert cleanly to Markdown."
              value={pasteMarkdown}
              onPaste={handleRichPaste}
              onChange={e => setPasteMarkdown(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {/* MODE 3: BATCH MULTI-SCREENSHOT OCR */}
        {mode === 'ocr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="ai-input"
              style={{ marginTop: 0 }}
              placeholder="Note title (e.g. Week 3 View-Only Slides)"
              value={ocrTitle}
              onChange={e => setOcrTitle(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className={`import-dropzone${ocrFiles.length > 0 ? ' has-file' : ''}`}
              disabled={busy}
              onClick={() => ocrInputRef.current?.click()}
            >
              <span className="import-dropzone-icon">
                <Images size={22} />
              </span>
              <div className="import-dropzone-title">
                {ocrFiles.length > 0
                  ? `${ocrFiles.length} screenshot${ocrFiles.length === 1 ? '' : 's'} selected`
                  : 'Select up to 10 slide/handout screenshots'}
              </div>
              <div className="import-dropzone-sub">
                Uses your AI Vision model to extract all screenshots into 1 clean note
              </div>
            </button>
            <input
              ref={ocrInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleOcrFilesPick}
            />
          </div>
        )}

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

        {/* Extraction Mode Toggle */}
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
              <div className="import-mode-sub">0 API calls · Fast &amp; free</div>
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
              <div className="import-mode-sub">Clean study notes &amp; tags</div>
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
            disabled={!canSubmit}
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
