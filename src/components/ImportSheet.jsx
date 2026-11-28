/**
 * ImportSheet — Phone-First Universal Material Importer:
 * 1. Multi-File Upload (.pdf, .pptx, .docx, .md, .txt) — 100% offline extraction (supports batch selection!)
 * 2. Paste Canvas Page / Public Google Docs or Slides Link (HTML -> Markdown OR live Google export!)
 * 3. Batch Multi-Screenshot OCR (select up to 10 slide/handout screenshots -> one combined note/module)
 *
 * Destination: Save as a Note in a Folder OR Save directly into a Course Module (AI-indexed immediately!).
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
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
  BookOpen,
  Eye,
} from 'lucide-react';
import {
  db,
  createNote,
  updateNote,
  saveFileAttachment,
  saveCourseMaterialWithChunks,
  logStudyActivity,
} from '../store/db';
import { isVaultUnlocked } from '../lib/vault';
import { extractDocument, structureImportedTextWithAI } from '../lib/docImporter';
import { detectDocKind } from '../lib/docViewerParser';
import { htmlToCleanMarkdown } from '../lib/htmlToMarkdown';
import { getPublicGoogleExportUrl, importPublicGoogleLink } from '../lib/courseExtras';
import { matchSharedFileToCourse } from '../lib/canvasFiles';
import { ocrImage } from '../lib/aiFeatures';
import { compressImage } from './ImageManager';
import { useDialog } from './ui/DialogProvider';

const DocumentViewerModal = lazy(() => import('./DocumentViewerModal'));
const SchedulePdfImportSheet = lazy(() => import('./course/SchedulePdfImportSheet'));

export default function ImportSheet({
  defaultFolderId = null,
  initialFile = null,
  initialPastedText = '',
  initialTitle = '',
  onImported,
  onImportedToCourse = null,
  onImportedSchedule = null,
  onClose,
}) {
  const { toast } = useDialog();
  const [mode, setMode] = useState(initialPastedText ? 'paste' : 'file'); // file | paste | ocr
  const [folders, setFolders] = useState([]);
  const [courses, setCourses] = useState([]);
  const [destination, setDestination] = useState('note'); // 'note' | 'course'
  const [folderId, setFolderId] = useState(
    typeof defaultFolderId === 'number' ? defaultFolderId : ''
  );
  const [courseId, setCourseId] = useState('');
  const [moduleName, setModuleName] = useState('Module 1');
  const [moduleManuallyEdited, setModuleManuallyEdited] = useState(false);
  const [autoMatchedCourseName, setAutoMatchedCourseName] = useState('');

  // Mode 1: Multi-File
  const [selectedFiles, setSelectedFiles] = useState(() => (initialFile ? [initialFile] : []));
  // Mode 2: Rich Canvas Page Paste OR Public Google Docs/Slides Link
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
  const [previewDoc, setPreviewDoc] = useState(null);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);

  const fileInputRef = useRef(null);
  const ocrInputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const unlocked = isVaultUnlocked();
    Promise.all([db.folders.toArray(), db.courses.toArray().catch(() => [])])
      .then(([list, crsList]) => {
        const visible = list.filter(f => !f.isSystemVault && f.mode !== 'vault' && (unlocked || !f.locked));
        const sorted = [...visible].sort((a, b) => a.name.localeCompare(b.name));
        setFolders(sorted);
        if (typeof defaultFolderId !== 'number' && sorted.length > 0) {
          const general = sorted.find(f => f.name === 'General') || sorted[0];
          setFolderId(general.id);
        }
        const activeCourses = crsList.filter(c => !c.archived);
        setCourses(activeCourses);
        if (activeCourses.length > 0) {
          if (initialFile) {
            setDestination('course');
            const matched = matchSharedFileToCourse(initialFile.name, initialTitle, activeCourses);
            if (matched.course) {
              setCourseId(matched.course.id);
              setAutoMatchedCourseName(matched.course.nickname || matched.course.code || matched.course.name);
            } else {
              setCourseId(activeCourses[0].id);
            }
            if (matched.suggestedModule) {
              setModuleName(matched.suggestedModule);
            }
          } else {
            setCourseId(activeCourses[0].id);
          }
        }
      })
      .catch(() => {});
    return () => abortRef.current?.abort();
  }, [defaultFolderId, initialFile]);

  const handleFilePick = e => {
    const list = Array.from(e.target.files || []).slice(0, 12);
    if (list.length === 0) return;
    setSelectedFiles(list);
    setError(null);
    if (courses.length > 0) {
      const matched = matchSharedFileToCourse(list[0].name, initialTitle, courses);
      if (matched.course) {
        setCourseId(matched.course.id);
        setAutoMatchedCourseName(matched.course.nickname || matched.course.code || matched.course.name);
      } else {
        setAutoMatchedCourseName('');
      }
      if (matched.suggestedModule && !moduleManuallyEdited) {
        setModuleName(matched.suggestedModule);
      }
    }
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
    if (plain && getPublicGoogleExportUrl(plain.trim())) {
      return; // let plain Google Docs/Slides link paste as-is for live import
    }
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

  const saveResultItem = async ({
    title,
    rawMarkdown,
    kind = 'pdf',
    fileName = '',
    fileObj = null,
    pageCount = 1,
    signal,
  }) => {
    const targetCourse = courses.find(c => c.id === Number(courseId));
    const targetFolder = folders.find(f => f.id === Number(folderId)) || folders[0];
    const subjectName =
      destination === 'course' && targetCourse
        ? targetCourse.nickname || targetCourse.name
        : targetFolder?.name || 'General';

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

    if (destination === 'course' && targetCourse) {
      await saveCourseMaterialWithChunks({
        courseId: targetCourse.id,
        moduleName: moduleName.trim() || 'Module 1',
        title: title || 'Imported Material',
        kind,
        fileName,
        extractedText: finalBody,
        pageCount,
        fileBlob: fileObj,
        mime: fileObj?.type || '',
      });
      await logStudyActivity('notes', 1);
      return { savedToCourse: targetCourse };
    }

    const created = await createNote(
      targetFolder?.id ?? null,
      title || 'Imported Material',
      finalBody,
      subjectName
    );
    if (fileObj) {
      try {
        const meta = await saveFileAttachment(created.id, fileObj, {
          kind,
          mime: fileObj.type || '',
          name: fileObj.name || fileName || title,
          pageCount,
        });
        await updateNote(created.id, { files: [meta] });
        created.files = [meta];
      } catch {
        // Non-fatal: keep imported note text even if binary exceeds limit
      }
    }
    await logStudyActivity('notes', 1);
    return { created, targetFolder: targetFolder || { id: '__all__', name: 'All Notes' } };
  };

  const handleImport = async () => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress(null);

    try {
      let lastResult = null;
      let count = 0;

      if (mode === 'file') {
        if (selectedFiles.length === 0) return;
        for (let idx = 0; idx < selectedFiles.length; idx++) {
          if (controller.signal.aborted) return;
          const f = selectedFiles[idx];
          setStatus(
            selectedFiles.length > 1
              ? `Reading file ${idx + 1}/${selectedFiles.length}: ${f.name}…`
              : 'Reading file offline…'
          );
          const extracted = await extractDocument(f, {
            onProgress: p => {
              setProgress(p);
              setStatus(
                p.phase === 'slides'
                  ? `Reading slide ${p.current}/${p.total}…`
                  : p.phase === 'docx'
                    ? 'Reading Word document…'
                    : `Reading page ${p.current}/${p.total}…`
              );
            },
          });
          if (controller.signal.aborted) return;
          lastResult = await saveResultItem({
            title: extracted.title,
            rawMarkdown: extracted.rawMarkdown,
            kind: extracted.kind,
            fileName: f.name,
            fileObj: f,
            pageCount: extracted.pageCount,
            signal: controller.signal,
          });
          count += 1;
        }
      } else if (mode === 'paste') {
        const trimmed = pasteMarkdown.trim();
        if (!trimmed) throw new Error('Paste a Canvas module page or a public Google Docs/Slides link first.');
        const googleInfo = getPublicGoogleExportUrl(trimmed);
        if (googleInfo) {
          setStatus(`Fetching public ${googleInfo.kind}…`);
          const gRes = await importPublicGoogleLink(trimmed);
          lastResult = await saveResultItem({
            title: pasteTitle.trim() || gRes.title,
            rawMarkdown: gRes.extractedText,
            kind: gRes.kind,
            pageCount: gRes.pageCount,
            signal: controller.signal,
          });
          count = 1;
        } else {
          const cleanMd = htmlToCleanMarkdown(pasteMarkdown, pasteMarkdown);
          const title =
            pasteTitle.trim() ||
            cleanMd.split('\n')[0].replace(/^#+\s*/, '').slice(0, 64) ||
            'Canvas Module Page';
          lastResult = await saveResultItem({
            title,
            rawMarkdown: cleanMd,
            kind: 'page',
            pageCount: 1,
            signal: controller.signal,
          });
          count = 1;
        }
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
        lastResult = await saveResultItem({
          title: ocrTitle.trim() || `Scanned Handout (${ocrFiles.length} pages)`,
          rawMarkdown: parts.join('\n\n'),
          kind: 'ocr',
          pageCount: ocrFiles.length,
          signal: controller.signal,
        });
        count = 1;
      }

      if (lastResult?.savedToCourse) {
        toast(
          `Indexed ${count} item${count === 1 ? '' : 's'} into ${lastResult.savedToCourse.nickname || lastResult.savedToCourse.code} (${moduleName || 'Module 1'})!`,
          { type: 'success' }
        );
        if (onImportedToCourse) {
          onImportedToCourse(lastResult.savedToCourse);
        } else {
          onClose?.();
        }
      } else if (lastResult?.created) {
        toast(
          count > 1
            ? `Imported ${count} files into ${lastResult.targetFolder.name}!`
            : `Imported "${lastResult.created.title}" into ${lastResult.targetFolder.name}`,
          { type: 'success' }
        );
        onImported?.(lastResult.created, lastResult.targetFolder);
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
    ((mode === 'file' && selectedFiles.length > 0) ||
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
              className="icon-btn"
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
            <FileUp size={13} style={{ marginRight: 4 }} /> Files
          </button>
          <button
            type="button"
            className={`view-switch-btn${mode === 'paste' ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setMode('paste')}
          >
            <ClipboardPaste size={13} style={{ marginRight: 4 }} /> Page / Link
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

        {/* MODE 1: MULTI-FILE PICKER (.pdf, .pptx, .docx, .md, .txt) */}
        {mode === 'file' && (
          <>
            <button
              type="button"
              className={`import-dropzone${selectedFiles.length > 0 ? ' has-file' : ''}`}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="import-dropzone-icon">
                {selectedFiles.length > 0 ? <FileText size={22} /> : <FileUp size={22} />}
              </span>
              <div className="import-dropzone-title">
                {selectedFiles.length === 1
                  ? selectedFiles[0].name
                  : selectedFiles.length > 1
                    ? `${selectedFiles.length} files selected`
                    : 'Choose .pdf, .pptx, .docx, .md, or .txt (multi-select)'}
              </div>
              <div className="import-dropzone-sub">
                {selectedFiles.length > 0
                  ? 'Tap to change selection · Extracts 100% offline on this phone'
                  : 'Select 1 or multiple handouts at once from Downloads'}
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.ppt,.pptx,.docx,.md,.markdown,.txt,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              style={{ display: 'none' }}
              onChange={handleFilePick}
            />
          </>
        )}

        {/* MODE 2: PASTE CANVAS MODULE PAGE OR PUBLIC GOOGLE DOC/SLIDES LINK */}
        {mode === 'paste' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="ai-input"
              style={{ marginTop: 0 }}
              placeholder="Title (auto-detected if left blank)"
              value={pasteTitle}
              onChange={e => setPasteTitle(e.target.value)}
              disabled={busy}
            />
            <textarea
              className="ai-input"
              style={{ marginTop: 0, minHeight: 106 }}
              placeholder="Paste a copied Canvas Module page OR paste a public Google Docs / Google Slides link (docs.google.com/...)!"
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
              placeholder="Title (e.g. Week 3 View-Only Slides)"
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
                Extracts all screenshots into 1 clean note or module
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

        {/* Destination Picker: Save to Course Module (AI-Indexed) vs Save as Note */}
        {courses.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="view-switcher">
              <button
                type="button"
                disabled={busy}
                className={`view-switch-btn${destination === 'course' ? ' active' : ''}`}
                onClick={() => setDestination('course')}
              >
                <BookOpen size={13} style={{ marginRight: 4 }} /> Course Module (AI)
              </button>
              <button
                type="button"
                disabled={busy}
                className={`view-switch-btn${destination === 'note' ? ' active' : ''}`}
                onClick={() => setDestination('note')}
              >
                <Folder size={13} style={{ marginRight: 4 }} /> Regular Note
              </button>
            </div>
          </div>
        )}

        {destination === 'course' && courses.length > 0 ? (
          <div>
            {autoMatchedCourseName && (
              <div className="import-automatch-badge" style={{ marginTop: 10 }}>
                <Sparkles size={11} /> Auto-matched to <strong>{autoMatchedCourseName}</strong>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8, marginTop: autoMatchedCourseName ? 6 : 10 }}>
              <select
                className="ai-input"
                style={{ marginTop: 0 }}
                value={courseId}
                disabled={busy}
                onChange={e => {
                  setCourseId(Number(e.target.value));
                  setAutoMatchedCourseName('');
                }}
                aria-label="Target Course"
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nickname || c.code || c.name}
                  </option>
                ))}
              </select>
              <input
                className="ai-input"
                style={{ marginTop: 0 }}
                placeholder="Module 1"
                value={moduleName}
                disabled={busy}
                onChange={e => {
                  setModuleManuallyEdited(true);
                  setModuleName(e.target.value);
                }}
              />
            </div>
          </div>
        ) : (
          folders.length > 0 && (
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
          )
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
          <button type="button" className="btn btn-secondary flex-1" onClick={handleCancel}>
            {busy ? 'Stop' : 'Cancel'}
          </button>
          {mode === 'file' && selectedFiles.length === 1 && !busy && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: '0 0 auto' }}
              onClick={() => {
                const f = selectedFiles[0];
                setPreviewDoc({
                  title: f.name,
                  fileName: f.name,
                  kind: detectDocKind(f.name, f.type),
                  mime: f.type || '',
                  file: f,
                  size: f.size,
                });
              }}
            >
              <Eye size={16} /> View Now
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={!canSubmit}
            onClick={handleImport}
          >
            <FileUp size={16} /> {busy ? 'Importing…' : destination === 'course' ? 'Save to Course' : 'Import Note'}
          </button>
        </div>
        {mode === 'file' &&
          selectedFiles.length === 1 &&
          /\.pdf$/i.test(selectedFiles[0]?.name || '') &&
          !busy && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setScheduleSheetOpen(true)}
            >
              Is this a Class Schedule / COR PDF? Import Courses &amp; Timetable →
            </button>
          )}
      </div>
      {scheduleSheetOpen && selectedFiles[0] && (
        <Suspense fallback={null}>
          <SchedulePdfImportSheet
            initialFile={selectedFiles[0]}
            onImported={res => {
              setScheduleSheetOpen(false);
              onImportedSchedule ? onImportedSchedule(res) : onClose?.();
            }}
            onClose={() => setScheduleSheetOpen(false)}
          />
        </Suspense>
      )}
      {previewDoc && (
        <Suspense fallback={null}>
          <DocumentViewerModal
            doc={previewDoc}
            onClose={() => setPreviewDoc(null)}
            onSaveAsNote={() => {
              setPreviewDoc(null);
              handleImport();
            }}
          />
        </Suspense>
      )}
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
