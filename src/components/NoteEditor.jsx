/**
 * Note editor — iOS Notes style, with the full explanation layer (Phase 3).
 *
 * Modes:
 *   edit — title + textarea + Save (the core loop)
 *   read — rendered lines with explanations, panel view (tap line → slide-up panel)
 *
 * "Explain simpler" / "Give example" re-scan a single line via /api/scan-line.
 * Panel view is the only view mode (inline/swipe removed in v1.2.0).
 * Full-note annotation overlay: pen, highlighter, eraser, arrow, line, text.
 * 12-color palette + custom color picker, 3 stroke sizes per tool.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { scanNote } from '../api/scan';
import { scanLine } from '../api/scanLine';
import { updateNote, moveNote } from '../store/db';
import StrokeLayer, { PALETTE, TOOLS, SIZES, SIZE_LABEL } from './StrokeLayer';
import ImageStrip, { pickImage, compressImage } from './ImageManager';
import { buildNotePDF, saveNotePDF } from '../lib/pdf';
import { Capacitor } from '@capacitor/core';
import ChatSheet from './ChatSheet';
import { summarizeNote, ocrImage, findRelatedNotes } from '../lib/aiFeatures';
import SlideUpPanel from './SlideUpPanel';
import FolderPickerSheet from './FolderPickerSheet';
import {
  renderLineText,
  MistakeBox,
  NoteLine as NoteLineComponent,
} from './InlineComponents';

const HINT_KEY = 'aicn:showHint';

export default function NoteEditor({ note, folderName, onOpenStudy, onBackToList, onOpenNote }) {
  const [mode, setMode] = useState(() => {
    const isNew = !(note?.title || '').trim() && !(note?.body || '').trim();
    return isNew ? 'edit' : 'read';
  });
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [subject, setSubject] = useState(note?.subject || 'General');
  const [blocks, setBlocks] = useState(note?.blocks || []);
  const [flashcards, setFlashcards] = useState(note?.flashcards || []);
  const [quiz, setQuiz] = useState(note?.quiz || []);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [expandedInline, setExpandedInline] = useState({});
  const [busyLine, setBusyLine] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    const map = {};
    (note?.blocks || []).forEach(b => { if (b.mistakeIgnored) map[b.id] = true; });
    return map;
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [printPayload, setPrintPayload] = useState(null);
  const [toast, setToast] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [folderLabel, setFolderLabel] = useState(folderName || '');
  const [images, setImages] = useState(note?.images || []);
  // Drawings doc: { refWidth, strokes }. Legacy beta.1 format was a plain
  // array of strokes — migrate it here so old notes keep working.
  const [drawings, setDrawings] = useState(() => {
    const d = note?.drawings;
    if (Array.isArray(d)) return { refWidth: 0, strokes: d };
    if (d && Array.isArray(d.strokes)) return d;
    return { refWidth: 0, strokes: [] };
  });

  // ---------- AI additions (chat, summary, OCR, related notes) ----------
  const [chatOpen, setChatOpen] = useState(false);
  const [summary, setSummary] = useState(note?.summary || '');
  const [summarizing, setSummarizing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [related, setRelated] = useState(null); // null | [] | [{note, reason}]
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [relatedBusy, setRelatedBusy] = useState(false);

  const handleSummarize = useCallback(async (force = false) => {
    if (summarizing) return;
    if (summary && !force) return;
    if (!body.trim()) { showToast('Write the note first'); return; }
    setSummarizing(true);
    try {
      const s = await summarizeNote({ note: body, subject, style: 'default' });
      setSummary(s);
      await updateNote(note.id, { summary: s });
    } catch (err) {
      showToast(`Summary failed: ${err.message}`);
    } finally {
      setSummarizing(false);
    }
  }, [body, subject, summary, note, summarizing]);

  const handleOcrScan = useCallback(async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    try {
      const raw = await pickImage('camera');
      if (!raw) { setOcrBusy(false); return; }
      showToast('Reading the photo…');
      const dataUrl = await compressImage(raw);
      const text = await ocrImage({ imageDataUrl: dataUrl, subject });
      if (text && text.trim()) {
        const newBody = (body ? body + '\n' : '') + text.trim();
        setBody(newBody);
        savedRef.current = { ...savedRef.current, body: newBody };
        await updateNote(note.id, { body: newBody });
        showToast('Text added to note ✅');
      } else {
        showToast('No text found in the photo');
      }
    } catch (err) {
      showToast(`Scan failed: ${err.message}`);
    } finally {
      setOcrBusy(false);
    }
  }, [ocrBusy, body, subject, note]);

  const handleRelated = useCallback(async () => {
    if (relatedBusy) return;
    setRelatedOpen(true);
    if (related) return; // already fetched this session
    setRelatedBusy(true);
    try {
      const others = (await import('../store/db')).db;
      const all = await others.notes.where('folderId').equals(note.folderId).toArray();
      const usable = all.filter(n => n.id !== note.id && !n.trashed && (n.body || '').trim());
      if (usable.length === 0) { setRelated([]); setRelatedBusy(false); return; }
      const links = await findRelatedNotes({
        currentNote: { title, body },
        otherNotes: usable.map(n => ({ id: n.id, title: n.title, body: n.body })),
      });
      setRelated(links.map(l => ({ ...l.note, reason: l.reason })));
    } catch (err) {
      showToast(`Related notes failed: ${err.message}`);
      setRelatedOpen(false);
    } finally {
      setRelatedBusy(false);
    }
  }, [related, relatedBusy, note, title, body]);
  const [showHint, setShowHint] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) === 'true'; } catch { return false; }
  });

  // Undo/redo history for the note body
  const undoRef = useRef({ stack: [note?.body || ''], index: 0, timer: null });
  const restoringRef = useRef(false);

  const textareaRef = useRef(null);
  const savedRef = useRef({ title: note?.title || '', body: note?.body || '' });
  const initialNoteId = useRef(note?.id);

  // Annotation state — used in READ mode only (full-page overlay)
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState('medium');

  // Re-init when a *different* note is opened
  useEffect(() => {
    if (note?.id === initialNoteId.current) return;
    setTitle(note?.title || '');
    setBody(note?.body || '');
    setSubject(note?.subject || 'General');
    setBlocks(note?.blocks || []);
    setImages(note?.images || []);
    const d = note?.drawings;
    setDrawings(Array.isArray(d) ? { refWidth: 0, strokes: d }
      : (d && Array.isArray(d.strokes)) ? d : { refWidth: 0, strokes: [] });
    setDrawMode(false);
    setSummary(note?.summary || '');
    setRelated(null);
    setFlashcards(note?.flashcards || []);
    setQuiz(note?.quiz || []);
    savedRef.current = { title: note?.title || '', body: note?.body || '' };
    setScanError(null);
    setMode('read');
  }, [note?.id]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el && mode === 'edit') {
      el.style.height = 'auto';
      el.style.height = `${Math.max(300, el.scrollHeight)}px`;
    }
  }, [body, mode]);

  // Persist hint preference
  useEffect(() => {
    localStorage.setItem(HINT_KEY, showHint.toString());
  }, [showHint]);

  const handleSave = useCallback(async ({ rescan = true } = {}) => {
    const noteIsEmpty = !body.trim() && !title.trim();
    if (noteIsEmpty) {
      await updateNote(note.id, { title, body, subject });
      savedRef.current = { title, body };
      setMode('read');
      return;
    }

    const oldLines = savedRef.current.body.split('\n');
    const newLines = body.split('\n');
    const changedLines = [];
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) changedLines.push(i + 1);
    }

    if (rescan === false || (changedLines.length === 0 && blocks.length > 0)) {
      await updateNote(note.id, { title, body, subject });
      savedRef.current = { title, body };
      setMode('read');
      return;
    }

    const covered = new Set();
    blocks.forEach(b => {
      const m = /^line-(\d+)$/.exec(b.id);
      const n = m ? parseInt(m[1], 10) : -1;
      if (n > 0 && n <= newLines.length && b.text === newLines[n - 1]) covered.add(n);
    });
    const linesToScan = [...new Set([...changedLines])].filter(n => !covered.has(n));

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanNote(body, subject, linesToScan);
      savedRef.current = { title, body };
      const fresh = result.blocks || [];

      const merged = blocks
        .filter(b => {
          const m = /^line-(\d+)$/.exec(b.id);
          const n = m ? parseInt(m[1], 10) : -1;
          return !linesToScan.includes(n) && b.text === newLines[n - 1];
        })
        .concat(fresh)
        .sort((a, b) => {
          const na = parseInt((/^line-(\d+)$/.exec(a.id) || [])[1] || 9999, 10);
          const nb = parseInt((/^line-(\d+)$/.exec(b.id) || [])[1] || 9999, 10);
          return na - nb;
        });

      setBlocks(merged);
      setFlashcards(result.flashcards?.length ? result.flashcards : flashcards);
      setQuiz(result.quiz?.length ? result.quiz : quiz);
      await updateNote(note.id, {
        title, body, subject,
        blocks: merged, images, drawings,
        flashcards: result.flashcards?.length ? result.flashcards : flashcards,
        quiz: result.quiz?.length ? result.quiz : quiz,
      });
      setMode('read');
    } catch (err) {
      setScanError(err.message);
      try {
        await updateNote(note.id, { title, body, subject, images, drawings });
      } catch {/* keep error visible */}
    } finally {
      setIsScanning(false);
    }
  }, [title, body, subject, note, blocks, flashcards, quiz, images, drawings]);

  const handleLineRequest = useCallback(async (lineId, request) => {
    const block = blocks.find(b => b.id === lineId);
    if (!block || busyLine) return;
    setBusyLine(lineId);
    try {
      const { explanation } = await scanLine(body, block.text, request);
      const field = request === 'simpler' ? 'simpler' : 'example';
      const updated = blocks.map(b =>
        b.id === lineId ? { ...b, [field]: explanation, show: field } : b
      );
      setBlocks(updated);
      setExpandedInline(prev => ({ ...prev, [lineId]: field }));
      await updateNote(note.id, { blocks: updated });
    } catch (err) {
      setScanError(err.message);
    } finally {
      setBusyLine(null);
    }
  }, [blocks, body, note, busyLine]);

  /** Tap ANY line: open its explanation — fetching it on demand if missing. */
  const handleLineTap = useCallback(async (block, lineIdx) => {
    const lineText = (body.split('\n')[lineIdx] || '').trim();
    // Empty / punctuation-only lines have nothing to explain
    if (!lineText || !/[a-zA-Z0-9\u00C0-\uFFFF]/.test(lineText)) return;
    setPanelOpen(true);
    if (block) {
      setSelectedLineId(block.id);
      return;
    }
    // No explanation yet → create a placeholder and fetch it now
    const id = `line-${lineIdx + 1}`;
    const placeholder = { id, text: lineText, explanation: '', terms: [], mistake: null };
    setBlocks(prev => [...prev, placeholder]);
    setSelectedLineId(id);
    setBusyLine(id);
    try {
      const result = await scanNote(body, subject, [lineIdx + 1]);
      const fresh = (result.blocks || []).find(b => b.id === id);
      if (fresh) {
        setBlocks(prev => prev.map(b => (b.id === id ? fresh : b)));
        // Persist the new block alongside existing ones
        const updated = blocks.filter(b => b.id !== id).concat([
          ...blocks.filter(b => b.id !== id),
          fresh,
        ]);
        await updateNote(note.id, { blocks: updated });
      } else {
        // AI skipped the line — show that honestly
        setBlocks(prev => prev.map(b => (b.id === id ? { ...b, explanation: 'The AI could not explain this line. Try rephrasing it.' } : b)));
      }
    } catch (err) {
      setBlocks(prev => prev.map(b => (b.id === id ? { ...b, explanation: `Failed: ${err.message}` } : b)));
    } finally {
      setBusyLine(null);
    }
  }, [blocks, body, subject, note, busyLine]);

  const handleShowOriginal = useCallback(async lineId => {
    const updated = blocks.map(b => (b.id === lineId ? { ...b, show: 'main' } : b));
    setBlocks(updated);
    setExpandedInline(prev => ({ ...prev, [lineId]: 'main' }));
    await updateNote(note.id, { blocks: updated });
  }, [blocks, note]);

  const dismissMistake = useCallback(async lineId => {
    setDismissed(prev => ({ ...prev, [lineId]: true }));
    const updated = blocks.map(b => b.id === lineId ? { ...b, mistakeIgnored: true } : b);
    setBlocks(updated);
    await updateNote(note.id, { blocks: updated });
  }, [blocks, note]);

  const applyCorrection = useCallback(async (block, mistake) => {
    if (!mistake?.correction) return;
    const lineMatch = /^line-(\d+)$/.exec(block.id);
    if (!lineMatch) return;
    const lineIndex = parseInt(lineMatch[1], 10) - 1;
    const newLines = body.split('\n');
    if (lineIndex < 0 || lineIndex >= newLines.length) return;
    newLines[lineIndex] = mistake.correction;
    const newBody = newLines.join('\n');
    setBody(newBody);
    const updated = blocks.map(b => b.id === block.id ? { ...b, mistake: null } : b);
    setBlocks(updated);
    await updateNote(note.id, { body: newBody, blocks: updated });
    setDismissed(prev => ({ ...prev, [block.id]: true }));
  }, [body, blocks, note]);

  const noteText = `${title || 'New Note'}\n\n${body}`;

  const copyToClipboard = async text => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta); return ok;
      } catch { return false; }
    }
  };

  const showToast = useCallback(msg => { setToast(msg); setTimeout(() => setToast(null), 2200); }, []);

  const handleShareText = async () => {
    setExportOpen(false);
    if (navigator.share) {
      try { await navigator.share({ title: title || 'New Note', text: noteText }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    const ok = await copyToClipboard(noteText);
    showToast(ok ? 'Copied to clipboard' : 'Sharing not available here');
  };

  const handleCopyText = async () => {
    setExportOpen(false);
    const ok = await copyToClipboard(noteText);
    showToast(ok ? 'Copied to clipboard' : 'Copy failed');
  };

  const handlePrintPdf = withExpl => {
    setExportOpen(false);
    setPrintPayload({ title: title || 'New Note', body, withExpl });
  };

  // ---------- Real PDF export (works in the APK — no print dialog) ----------
  const [exporting, setExporting] = useState(false);
  const isNative = Capacitor.isNativePlatform?.();

  const handleExportPDF = async withExpl => {
    setExportOpen(false);
    setExporting(true);
    try {
      const doc = await buildNotePDF({
        title: title || 'New Note',
        body,
        blocks,
        images,
        drawings,
        withExplanations: withExpl,
      });
      const how = await saveNotePDF(doc, title || 'note');
      showToast(how === 'shared'
        ? 'PDF ready — pick where to save or send it'
        : 'PDF downloaded');
    } catch (err) {
      showToast(`PDF failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleMove = async f => {
    setMoveOpen(false);
    await moveNote(note.id, f.id);
    setFolderLabel(f.name);
    showToast(`Moved to ${f.name}`);
  };

  const pushHistory = value => {
    const h = undoRef.current;
    if (h.timer) clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      if (h.stack[h.index] === value) return;
      h.stack = h.stack.slice(0, h.index + 1).concat(value);
      if (h.stack.length > 100) h.stack.shift();
      h.index = h.stack.length - 1;
    }, 400);
  };

  const undo = () => {
    const h = undoRef.current;
    if (h.index > 0) { h.index -= 1; restoringRef.current = true; setBody(h.stack[h.index]); }
  };

  const redo = () => {
    const h = undoRef.current;
    if (h.index < h.stack.length - 1) { h.index += 1; restoringRef.current = true; setBody(h.stack[h.index]); }
  };

  const handleBodyChange = e => {
    const v = e.target.value;
    setBody(v);
    if (restoringRef.current) restoringRef.current = false;
    else pushHistory(v);
  };

  const CHECK_RE = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/;

  const toggleChecklist = useCallback(async lineIdx => {
    const ls = body.split('\n');
    const m = CHECK_RE.exec(ls[lineIdx]);
    if (!m) return;
    ls[lineIdx] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`;
    const newBody = ls.join('\n');
    setBody(newBody);
    savedRef.current = { ...savedRef.current, body: newBody };
    await updateNote(note.id, { body: newBody });
  }, [body, note]);

  const addImage = useCallback(async dataUrl => {
    const img = { id: `img-${Date.now()}`, dataUrl };
    const next = [...images, img];
    setImages(next);
    await updateNote(note.id, { images: next });
  }, [images, note]);

  const removeImage = useCallback(async imgId => {
    const next = images.filter(i => i.id !== imgId);
    setImages(next);
    await updateNote(note.id, { images: next });
  }, [images, note]);

  const updateDrawings = useCallback(async doc => {
    setDrawings(doc);
    try { await updateNote(note.id, { drawings: doc }); }
    catch { /* keep local state; strokes persist on next save */ }
  }, [note]);

  // Print dialog
  useEffect(() => {
    if (!printPayload) return;
    const t = setTimeout(() => {
      try { window.print(); } catch { showToast('Printing not supported here'); }
      setPrintPayload(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printPayload, showToast]);

  const explBlocks = blocks.filter(b => b.explanation || b.simpler || b.example);

  const printPortal = (printPayload && typeof document !== 'undefined' && document.body)
    ? createPortal(
        <div className="print-root">
          <h1 className="print-title">{printPayload.title}</h1>
          <div className="print-meta">
            {new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          {/* Images in PDF */}
          {images.length > 0 && (
            <div className="print-images">
              {images.map(img => (
                <img key={img.id} src={img.dataUrl} alt="note image" style={{ maxWidth: '45%', margin: 4, borderRadius: 4 }} />
              ))}
            </div>
          )}

          {/* Drawings in PDF (StrokeLayer read-only) */}
          {drawings?.strokes?.length > 0 && (
            <div className="print-drawing" style={{ marginBottom: 16 }}>
              <StrokeLayer drawing={drawings} editable={false} />
            </div>
          )}

          <div className="print-body">
            {printPayload.body.split('\n').map((l, i) => (
              <p key={i} className="print-line">{l || '\u00A0'}</p>
            ))}
          </div>
          {printPayload.withExpl && explBlocks.length > 0 && (
            <>
              <h2 className="print-h2">Explanations</h2>
              {explBlocks.map(b => (
                <div key={b.id} className="print-block">
                  <p className="print-line-text">{b.text}</p>
                  <p className="print-expl">
                    {b.show === 'simpler' && b.simpler ? b.simpler
                    : b.show === 'example' && b.example ? b.example
                    : b.explanation}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>,
        document.body
      )
    : null;

  // ---------- Edit mode ----------
  if (mode === 'edit') {
    return (
      <div className="screen">
        <header className="navbar safe-top">
          <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }}
            onClick={() => {
              const dirty = title !== savedRef.current.title || body !== savedRef.current.body;
              if (dirty) { updateNote(note.id, { title, body, subject }); savedRef.current = { title, body }; }
              setMode('read');
            }} aria-label="Back to notes list">
            ‹ Notes
          </button>
          <span className="navbar-title" style={{ fontSize: 15 }}>Edit</span>
          <div className="flex items-center">
            <button className="navbar-btn" onClick={undo} aria-label="Undo" style={{ fontSize: 20 }}>↺</button>
            <button className="navbar-btn" onClick={redo} aria-label="Redo" style={{ fontSize: 20 }}>↻</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={isScanning} style={{ padding: '6px 14px', fontSize: 15 }}>
              {isScanning ? (<><span className="spinner" style={{ width: 14, height: 14 }} /> Scanning…</>) : 'Save'}
            </button>
          </div>
        </header>

        <div className="editor safe-bottom">
          {scanError && <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{scanError}</div>}
          <input type="text" className="editor-title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} aria-label="Note title" />
          <input type="text" className="editor-subject" placeholder="Subject (e.g. Biology)" value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject" />

          {/* Compact attachment row — photos only; drawing happens in read mode */}
          <div className="attachment-row">
            <button className="attach-btn" aria-label="Take photo" onClick={async () => { const raw = await pickImage('camera'); if (raw) addImage(await compressImage(raw)); }}>📷</button>
            <button className="attach-btn" aria-label="Choose from library" onClick={async () => { const raw = await pickImage('library'); if (raw) addImage(await compressImage(raw)); }}>🖼</button>
            <button className="attach-btn" aria-label="Scan text from photo" disabled={ocrBusy} onClick={handleOcrScan}>{ocrBusy ? '⏳' : '📝'}</button>
            <span className="attach-label">{ocrBusy ? 'Reading the photo…' : 'Add photos — 📝 scans text from a photo'}</span>
          </div>

          {/* Image strip (only shows existing) */}
          <ImageStrip images={images} onAdd={addImage} onRemove={removeImage} showAdd={false} />

          <textarea ref={textareaRef} className="editor-body" placeholder="Start typing your notes…  (- [ ] makes a checklist, #tag marks topics)" value={body} onChange={handleBodyChange} aria-label="Note body" autoFocus />
        </div>
      </div>
    );
  }

  // ---------- Read mode ----------
  const lines = body.split('\n');
  const blockByLine = {};
  blocks.forEach(b => {
    const m = /^line-(\d+)$/.exec(b.id);
    if (!m) return;
    const n = parseInt(m[1], 10) - 1;
    if (n >= 0 && n < lines.length && b.text === lines[n]) blockByLine[n] = b;
  });
  const hasStudy = flashcards.length + quiz.length > 0;

  const lineHasExpl = i => { const b = blockByLine[i]; return b && (b.explanation || b.simpler || b.example); };
  const lineMistake = i => blockByLine[i]?.mistake || null;

  const notePage = (
    <div className={`editor safe-bottom${drawMode ? ' draw-padding' : ''}`}>
      {/* Full-note wrapper: relative so the annotation overlay covers EVERYTHING */}
      <div className="note-page-wrap">
        <div className="read-title">{title || 'New Note'}</div>
        <button className="folder-chip" onClick={() => setMoveOpen(true)} aria-label="Move to folder">
          📁 {folderLabel || 'Folder'} <span className="folder-chip-chevron">›</span>
        </button>

        {/* AI summary card */}
        {(summary || summarizing) && (
          <div className="summary-card">
            <div className="summary-head">
              <span className="summary-label">✨ Summary</span>
              {!summarizing && (
                <button className="summary-regen" onClick={() => handleSummarize(true)} aria-label="Regenerate summary">↻</button>
              )}
            </div>
            {summarizing ? (
              <div className="scan-indicator" style={{ padding: '4px 0' }}><span className="spinner" style={{ width: 14, height: 14 }} /> Summarizing…</div>
            ) : (
              <div className="summary-text">{summary}</div>
            )}
          </div>
        )}

        {/* Images */}
        {images.length > 0 && <ImageStrip images={images} readOnly />}

        {/* Summarize trigger when no summary yet */}
        {!summary && !summarizing && body.trim() && (
          <button className="summarize-chip" onClick={() => handleSummarize(false)}>
            ✨ Summarize this note
          </button>
        )}

        <div className="note-lines">
          {lines.map((_, i) => (
            <NoteLineComponent
              key={i} i={i} lines={lines} blockByLine={blockByLine}
              lineHasExpl={lineHasExpl} lineMistake={lineMistake}
              onLineTap={handleLineTap}
              onToggleChecklist={toggleChecklist}
              onLineRequest={handleLineRequest}
              showOriginal={handleShowOriginal}
              applyCorrection={applyCorrection}
              dismissMistake={dismissMistake}
              busyLine={busyLine}
              dismissed={dismissed}
              showHint={showHint}
            />
          ))}
        </div>

        {/* Related notes */}
        <button className="related-trigger" onClick={handleRelated} disabled={relatedBusy}>
          {relatedBusy ? '⏳ Looking…' : '🔗 Find related notes'}
        </button>

        {/* Full-page annotation overlay — covers the ENTIRE note content.
            Editable only in draw mode; otherwise display-only and tappable-through. */}
        {(drawMode || drawings.strokes.length > 0) && (
          <StrokeLayer
            drawing={drawings}
            editable={drawMode}
            tool={tool}
            color={color}
            size={size}
            onChange={updateDrawings}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBackToList} aria-label="Back to notes list">‹ Notes</button>
        <span className="navbar-title" style={{ fontSize: 15, opacity: 0 }}>{'\u00A0'}</span>
        <div className="flex items-center gap-8">
          <button className="navbar-btn" onClick={() => setChatOpen(true)} aria-label="Chat with this note">💬</button>
          <button className={`navbar-btn${drawMode ? ' navbar-btn-active' : ''}`} onClick={() => { setDrawMode(m => { if (!m) setPanelOpen(false); return !m; }); }} aria-label="Annotate note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
            </svg>
          </button>
          <button className="navbar-btn" onClick={() => setExportOpen(true)} aria-label="Share or export">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
            </svg>
          </button>
          <button className="navbar-btn" onClick={() => setMode('edit')} aria-label="Edit note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
          </button>
          {hasStudy && <button className="navbar-btn" onClick={onOpenStudy} aria-label="Study">📚</button>}
        </div>
      </header>

      {scanError && <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{scanError}</div>}

      {notePage}

      {/* Annotation toolbar — fixed at bottom, only in draw mode */}
      {drawMode && (
        <div className="annotate-bar">
          <div className="tool-group">
            {TOOLS.map(([t, icon, label]) => (
              <button key={t} className={`tool-btn${tool === t ? ' active' : ''}`} onClick={() => setTool(t)} aria-label={label}>
                {icon}
              </button>
            ))}
          </div>
          <div className="tool-group">
            {SIZES.map(s => (
              <button key={s} className={`size-btn${size === s ? ' active' : ''}`} onClick={() => setSize(s)} aria-label={`Size ${SIZE_LABEL[s]}`}>{SIZE_LABEL[s]}</button>
            ))}
          </div>
          <div className="tool-group">
            {PALETTE.map(c => (
              <button key={c} className={`color-swatch${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
            ))}
            <input type="color" value={color} onChange={e => setColor(e.target.value)} title="Custom color" className="color-input" />
          </div>
          <span className="annotate-hint">2 fingers = scroll</span>
          <button className="draw-close" onClick={() => setDrawMode(false)} aria-label="Done">Done</button>
        </div>
      )}

      <SlideUpPanel
        open={panelOpen} onClose={() => setPanelOpen(false)}
        blocks={blocks} selectedLineId={selectedLineId}
        onSelectLine={setSelectedLineId}
        onExplainSimpler={id => handleLineRequest(id, 'simpler')}
        onGiveExample={id => handleLineRequest(id, 'example')}
        onShowOriginal={handleShowOriginal}
        busyLineId={busyLine}
      />

      {exportOpen && (
        <div className="export-overlay" onClick={() => setExportOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Share & Export</div>
            <button className="export-btn" onClick={handleShareText}>📤 Share note as text</button>
            <button className="export-btn" onClick={handleCopyText}>📋 Copy note text</button>
            <button className="export-btn" disabled={exporting} onClick={() => handleExportPDF(false)}>
              {exporting ? '⏳ Building PDF…' : '📄 Export PDF'}
            </button>
            {explBlocks.length > 0 && (
              <button className="export-btn" disabled={exporting} onClick={() => handleExportPDF(true)}>
                {exporting ? '⏳ Building PDF…' : '📄 PDF with explanations'}
              </button>
            )}
            {!isNative && (
              <button className="export-btn" onClick={() => handlePrintPdf(false)}>🖨 Print / system PDF</button>
            )}
            <button className="export-btn cancel" onClick={() => setExportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {moveOpen && <FolderPickerSheet currentId={note.folderId} onPick={handleMove} onClose={() => setMoveOpen(false)} />}

      {relatedOpen && (
        <div className="export-overlay" onClick={() => setRelatedOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            <div className="export-title">Related notes</div>
            {related === null && <div className="scan-indicator"><span className="spinner" /> Looking…</div>}
            {related && related.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}><div className="empty-text">No related notes found in this folder.</div></div>
            )}
            {related && related.map(r => (
              <button key={r.id} className="export-btn" onClick={() => { setRelatedOpen(false); onOpenNote?.(r); }}>
                📄 {r.title || 'New Note'}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{r.reason}</div>
              </button>
            ))}
            <button className="export-btn cancel" onClick={() => setRelatedOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {chatOpen && (
        <ChatSheet
          note={{ ...note, body, title, chat: note.chat }}
          subject={subject}
          onClose={() => setChatOpen(false)}
          onSave={async msgs => {
            await updateNote(note.id, { chat: msgs });
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      {printPortal}
    </div>
  );
}
