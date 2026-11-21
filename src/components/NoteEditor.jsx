/**
 * Note editor — iOS Notes style, with the full explanation layer (Phase 3).
 *
 * Modes:
 *   edit — title + textarea + Save (the core loop)
 *   read — rendered lines with explanations, in one of three views:
 *     panel  — tap a line → slide-up panel (default)
 *     inline — collapsed explanation under each line, tap to expand
 *     swipe  — swipe left to a second page listing every explanation
 *
 * "Explain simpler" / "Give example" re-scan a single line via /api/scan-line.
 * The chosen view is remembered (localStorage).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { scanNote } from '../api/scan';
import { scanLine } from '../api/scanLine';
import { updateNote, moveNote } from '../store/db';
import SlideUpPanel from './SlideUpPanel';
import FolderPickerSheet from './FolderPickerSheet';

const VIEW_KEY = 'ai-class-notes:view';

export default function NoteEditor({ note, folderName, onOpenStudy, onBackToList }) {
  const [mode, setMode] = useState(() => {
    // New (empty) notes open straight into editing, like iOS Notes.
    // Existing notes open in read mode.
    const isNew = !(note?.title || '').trim() && !(note?.body || '').trim();
    return isNew ? 'edit' : 'read';
  }); // read | edit
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [subject, setSubject] = useState(note?.subject || 'General');
  const [blocks, setBlocks] = useState(note?.blocks || []);
  const [flashcards, setFlashcards] = useState(note?.flashcards || []);
  const [quiz, setQuiz] = useState(note?.quiz || []);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'panel'; }
    catch { return 'panel'; }
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [expandedInline, setExpandedInline] = useState({}); // lineId -> variant shown
  const [busyLine, setBusyLine] = useState(null); // lineId while re-scanning
  const [dismissed, setDismissed] = useState(() => {
    // Restore persisted 'Ignore' choices
    const map = {};
    (note?.blocks || []).forEach(b => { if (b.mistakeIgnored) map[b.id] = true; });
    return map;
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [printPayload, setPrintPayload] = useState(null); // {title, body, withExpl}
  const [toast, setToast] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [folderLabel, setFolderLabel] = useState(folderName || '');

  // Undo/redo history for the note body (typed edits are debounced in)
  const undoRef = useRef({ stack: [note?.body || ''], index: 0, timer: null });
  const restoringRef = useRef(false);

  const textareaRef = useRef(null);
  const savedRef = useRef({ title: note?.title || '', body: note?.body || '' });
  const initialNoteId = useRef(note?.id);

  // Re-init when a *different* note is opened. Skip the very first run:
  // it would override the initial 'edit' mode chosen for new (empty) notes.
  useEffect(() => {
    if (note?.id === initialNoteId.current) return;
    setTitle(note?.title || '');
    setBody(note?.body || '');
    setSubject(note?.subject || 'General');
    setBlocks(note?.blocks || []);
    setFlashcards(note?.flashcards || []);
    setQuiz(note?.quiz || []);
    savedRef.current = { title: note?.title || '', body: note?.body || '' };
    setScanError(null);
    setMode('read');
  }, [note?.id]);

  // Auto-grow the textarea like iOS Notes (min 300px, grows with content)
  useEffect(() => {
    const el = textareaRef.current;
    if (el && mode === 'edit') {
      el.style.height = 'auto';
      el.style.height = `${Math.max(300, el.scrollHeight)}px`;
    }
  }, [body, mode]);

  const persistView = v => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const handleSave = useCallback(async ({ rescan = true } = {}) => {
    // Never scan an empty note
    const noteIsEmpty = !body.trim() && !title.trim();
    if (noteIsEmpty) {
      await updateNote(note.id, { title, body, subject });
      savedRef.current = { title, body };
      setMode('read');
      return;
    }

    // Which lines changed since the last saved copy?
    const oldLines = savedRef.current.body.split('\n');
    const newLines = body.split('\n');
    const changedLines = [];
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) changedLines.push(i + 1);
    }

    // Cost control: nothing changed and we already have explanations → skip AI
    if (rescan === false || (changedLines.length === 0 && blocks.length > 0)) {
      await updateNote(note.id, { title, body, subject });
      savedRef.current = { title, body };
      setMode('read');
      return;
    }

    // Also (re)scan lines that have no saved explanation yet
    const covered = new Set();
    blocks.forEach(b => {
      const m = /^line-(\d+)$/.exec(b.id);
      if (m && b.text === newLines[parseInt(m[1], 10) - 1]) covered.add(parseInt(m[1], 10));
    });
    const linesToScan = [...new Set([...changedLines])]
      .filter(n => !covered.has(n));

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanNote(body, subject, linesToScan);
      savedRef.current = { title, body };
      const fresh = result.blocks || [];

      // Merge: keep saved blocks for untouched lines (incl. simpler/example/show),
      // take fresh blocks for scanned lines. Match by line id AND text.
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
        title,
        body,
        subject,
        blocks: merged,
        flashcards: result.flashcards?.length ? result.flashcards : flashcards,
        quiz: result.quiz?.length ? result.quiz : quiz,
      });
      setMode('read');
    } catch (err) {
      // Scan failed: show the error, but STILL persist the typed text so the
      // note is never lost (savedRef stays stale on purpose so the next
      // successful Save re-scans the changed lines).
      setScanError(err.message);
      try {
        await updateNote(note.id, { title, body, subject });
      } catch {/* keep the error visible; text remains in the editor */}
    } finally {
      setIsScanning(false);
    }
  }, [title, body, subject, note, blocks, flashcards, quiz]);

  /** Re-scan one line: request = 'simpler' | 'example' */
  const handleLineRequest = useCallback(async (lineId, request) => {
    const block = blocks.find(b => b.id === lineId);
    if (!block || busyLine) return;
    setBusyLine(lineId);
    try {
      const { explanation } = await scanLine(body, block.text, request);
      const field = request === 'simpler' ? 'simpler' : 'example';
      const updated = blocks.map(b =>
        b.id === lineId
          ? { ...b, [field]: explanation, show: field }
          : b
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

  /** Switch a block back to its original explanation. */
  const handleShowOriginal = useCallback(async lineId => {
    const updated = blocks.map(b => (b.id === lineId ? { ...b, show: 'main' } : b));
    setBlocks(updated);
    setExpandedInline(prev => ({ ...prev, [lineId]: 'main' }));
    await updateNote(note.id, { blocks: updated });
  }, [blocks, note]);

  /** Persist a dismissed mistake so it stays hidden after reload. */
  const dismissMistake = useCallback(async lineId => {
    setDismissed(prev => ({ ...prev, [lineId]: true }));
    const updated = blocks.map(b =>
      b.id === lineId ? { ...b, mistakeIgnored: true } : b
    );
    setBlocks(updated);
    await updateNote(note.id, { blocks: updated });
  }, [blocks, note]);

  /** Accept a mistake's suggested fix: replaces that line in the body. */
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
    // Clear the mistake flag and persist
    const updated = blocks.map(b => (b.id === block.id ? { ...b, mistake: null } : b));
    setBlocks(updated);
    await updateNote(note.id, { body: newBody, blocks: updated });
    setDismissed(prev => ({ ...prev, [block.id]: true }));
  }, [body, blocks, note]);

  // ---------- Share / Export ----------
  const noteText = `${title || 'New Note'}\n\n${body}`;

  const copyToClipboard = async text => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  };

  const showToast = useCallback(msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const handleShareText = async () => {
    setExportOpen(false);
    if (navigator.share) {
      try {
        await navigator.share({ title: title || 'New Note', text: noteText });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // user closed the share sheet
        // fall through to clipboard
      }
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

  // ---------- Move to folder ----------
  const handleMove = async f => {
    setMoveOpen(false);
    await moveNote(note.id, f.id);
    setFolderLabel(f.name);
    showToast(`Moved to ${f.name}`);
  };

  // ---------- Undo / redo (edit mode) ----------
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
    if (h.index > 0) {
      h.index -= 1;
      restoringRef.current = true;
      setBody(h.stack[h.index]);
    }
  };

  const redo = () => {
    const h = undoRef.current;
    if (h.index < h.stack.length - 1) {
      h.index += 1;
      restoringRef.current = true;
      setBody(h.stack[h.index]);
    }
  };

  const handleBodyChange = e => {
    const v = e.target.value;
    setBody(v);
    if (restoringRef.current) restoringRef.current = false;
    else pushHistory(v);
  };

  // ---------- Checklists & hashtags (read mode) ----------
  const CHECK_RE = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/;

  const renderLineText = text => {
    if (!text) return '\u00A0';
    const parts = text.split(/(#[A-Za-z0-9_-]+)/);
    if (parts.length === 1) return text;
    return parts.map((p, i) =>
      p.length > 1 && p[0] === '#'
        ? <span key={i} className="hashtag">{p}</span>
        : p
    );
  };

  // Fire the print dialog (system dialog → "Save as PDF") once the print
  // view is mounted, then clean it up.
  useEffect(() => {
    if (!printPayload) return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        showToast('Printing not supported here');
      }
      setPrintPayload(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printPayload, showToast]);

  const explBlocks = blocks.filter(b => b.explanation || b.simpler || b.example);
  const printPortal = printPayload
    ? createPortal(
        <div className="print-root">
          <h1 className="print-title">{printPayload.title}</h1>
          <div className="print-meta">
            {new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
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
                    {b.show === 'simpler' && b.simpler
                      ? b.simpler
                      : b.show === 'example' && b.example
                        ? b.example
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
          <button
            className="navbar-btn"
            style={{ width: 'auto', paddingLeft: 0 }}
            onClick={() => {
              // Don't silently drop unsaved edits: persist text (without a scan)
              const dirty = title !== savedRef.current.title || body !== savedRef.current.body;
              if (dirty) {
                updateNote(note.id, { title, body, subject });
                savedRef.current = { title, body };
              }
              setMode('read');
            }}
            aria-label="Back to notes list"
          >
            ‹ Notes
          </button>
          <span className="navbar-title" style={{ fontSize: 15 }}>Edit</span>
          <div className="flex items-center">
            <button className="navbar-btn" onClick={undo} aria-label="Undo" style={{ fontSize: 20 }}>↺</button>
            <button className="navbar-btn" onClick={redo} aria-label="Redo" style={{ fontSize: 20 }}>↻</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isScanning}
              style={{ padding: '6px 14px', fontSize: 15 }}
            >
              {isScanning ? (<><span className="spinner" style={{ width: 14, height: 14 }} /> Scanning…</>) : 'Save'}
            </button>
          </div>
        </header>

        <div className="editor safe-bottom">
          {scanError && (
            <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{scanError}</div>
          )}
          <input
            type="text" className="editor-title" placeholder="Title"
            value={title} onChange={e => setTitle(e.target.value)} aria-label="Note title"
          />
          <input
            type="text" className="editor-subject" placeholder="Subject (e.g. Biology)"
            value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject"
          />
          <textarea
            ref={textareaRef}
            className="editor-body" placeholder="Start typing your notes…  (- [ ] makes a checklist, #tag marks topics)"
            value={body} onChange={handleBodyChange} aria-label="Note body"
            autoFocus
          />
        </div>
      </div>
    );
  }

  // ---------- Read mode ----------
  const lines = body.split('\n');
  const blockByLine = {}; // line index (0-based) -> block, only when text still matches
  blocks.forEach(b => {
    const m = /^line-(\d+)$/.exec(b.id);
    if (!m) return;
    const n = parseInt(m[1], 10) - 1;
    if (n >= 0 && n < lines.length && b.text === lines[n]) blockByLine[n] = b;
  });
  const hasStudy = flashcards.length + quiz.length > 0;

  const lineHasExpl = i => {
    const b = blockByLine[i];
    return b && (b.explanation || b.simpler || b.example);
  };
  const lineMistake = i => blockByLine[i]?.mistake || null;

  const activeVariant = block => {
    // Which explanation text to show for a block right now.
    // block.show is persisted ('simpler' | 'example' | 'main') so panel and
    // swipe views display variants without inline-view state.
    if (block.show === 'simpler' && block.simpler) return block.simpler;
    if (block.show === 'example' && block.example) return block.example;
    return block.explanation || '';
  };

  const VariantButtons = ({ block }) => (
    <>
      <div className="explanation-actions">
        <button
          className="btn btn-secondary"
          disabled={busyLine === block.id}
          onClick={() => handleLineRequest(block.id, 'simpler')}
        >
          {busyLine === block.id && expandedInline[block.id] === 'simpler' ? '…' : 'Explain simpler'}
        </button>
        <button
          className="btn btn-secondary"
          disabled={busyLine === block.id}
          onClick={() => handleLineRequest(block.id, 'example')}
        >
          {busyLine === block.id && expandedInline[block.id] === 'example' ? '…' : 'Give example'}
        </button>
      </div>
      {block.show && block.show !== 'main' && (
        <button
          className="btn btn-ghost"
          style={{ width: '100%', padding: '6px 0', fontSize: 13 }}
          onClick={() => handleShowOriginal(block.id)}
        >
          Show original explanation
        </button>
      )}
    </>
  );

  /** Mistake reason + Accept fix / Ignore buttons (shared across views). */
  const MistakeBox = ({ mistake, block }) => (
    <div className="inline-mistake">
      ⚠ {mistake.reason} <em>Suggestion: {mistake.correction}</em>
      <div className="mistake-actions">
        <button onClick={() => applyCorrection(block, mistake)}>Accept fix</button>
        <button onClick={() => dismissMistake(block.id)}>Ignore</button>
      </div>
    </div>
  );

  /** Tick/untick a checklist line ("- [ ] item" → "- [x] item"). */
  const toggleChecklist = useCallback(async lineIdx => {
    const ls = body.split('\n');
    const m = CHECK_RE.exec(ls[lineIdx]);
    if (!m) return;
    ls[lineIdx] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`;
    const newBody = ls.join('\n');
    setBody(newBody);
    // Checklist ticks shouldn't trigger an AI re-scan on next Save
    savedRef.current = { ...savedRef.current, body: newBody };
    await updateNote(note.id, { body: newBody });
  }, [body, note]);

  /** One rendered note line (used in all three views). */
  const NoteLine = ({ i }) => {
    const b = blockByLine[i];
    const mistake = lineMistake(i);
    const hasExpl = lineHasExpl(i);
    const open = b ? expandedInline[b.id] : null;
    const checkMatch = CHECK_RE.exec(lines[i] || '');
    const checked = checkMatch && checkMatch[2] !== ' ';
    return (
      <div className="note-line-wrap">
        {checkMatch ? (
          <div
            className="note-line check"
            onClick={() => toggleChecklist(i)}
            style={{ cursor: 'pointer', position: 'relative' }}
          >
            <span className={`check-box${checked ? ' checked' : ''}`} aria-hidden="true">✓</span>
            <span style={checked ? { textDecoration: 'line-through', opacity: 0.5 } : null}>
              {checkMatch[4] || '\u00A0'}
            </span>
          </div>
        ) : (
          <div
            className={`note-line${mistake ? ' has-mistake' : ''}`}
            onClick={() => {
              if (!b) return;
              if (view === 'panel') {
                setSelectedLineId(b.id);
                setPanelOpen(true);
              } else {
                setExpandedInline(prev => ({ ...prev, [b.id]: prev[b.id] ? null : 'main' }));
              }
            }}
            style={{ cursor: b ? 'pointer' : 'default', position: 'relative' }}
          >
            {hasExpl && <span className="line-dot" aria-hidden="true" />}
            {renderLineText(lines[i])}
          </div>
        )}

        {/* Inline view: collapsed explanation under the line */}
        {view === 'inline' && b && (b.explanation || b.simpler || b.example) && (
          <div className="inline-explanation" onClick={e => e.stopPropagation()}>
            <div
              className="inline-collapsed"
              onClick={() => setExpandedInline(prev => ({ ...prev, [b.id]: prev[b.id] ? null : 'main' }))}
            >
              {b.show && b.show !== 'main' ? `(${b.show}) ` : ''}{activeVariant(b).slice(0, 90)}{activeVariant(b).length > 90 ? '…' : ''}
            </div>
            {open && (
              <div className="inline-expanded">
                <div className="explanation-text">{activeVariant(b)}</div>
                {busyLine === b.id && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Thinking…</div>}
                <VariantButtons block={b} />
                {mistake && !dismissed[b.id] && <MistakeBox mistake={mistake} block={b} />}
              </div>
            )}
          </div>
        )}

        {mistake && !dismissed[b.id] && view !== 'inline' && (
          <MistakeBox mistake={mistake} block={b} />
        )}
      </div>
    );
  };

  const notePage = (
    <div className="editor safe-bottom">
      <div className="read-title">{title || 'New Note'}</div>
      <button className="folder-chip" onClick={() => setMoveOpen(true)} aria-label="Move to folder">
        📁 {folderLabel || 'Folder'} <span className="folder-chip-chevron">›</span>
      </button>
      <div className="note-lines">
        {lines.map((_, i) => <NoteLine key={i} i={i} />)}
      </div>
    </div>
  );

  /** Swipe view: horizontal snap between note page and explanations page. */
  const swipeContainer = (
    <div className="swipe-container">
      <div className="swipe-page">{notePage}</div>
      <div className="swipe-page">
        <div className="editor safe-bottom">
          <div className="read-title" style={{ fontSize: 22 }}>Explanations</div>
          {blocks.filter(b => b.explanation || b.simpler || b.example).map(b => (
            <div key={b.id} className="explanation-card">
              <div className="explanation-line">{b.text}</div>
              <div className="explanation-text">
                {busyLine === b.id ? 'Thinking…' : activeVariant(b) || 'No explanation yet.'}
              </div>
              <VariantButtons block={b} />
              {b.mistake && !dismissed[b.id] && <MistakeBox mistake={b.mistake} block={b} />}
            </div>
          ))}
          {blocks.length === 0 && (
            <div className="empty-state"><div className="empty-icon">💡</div><div className="empty-title">No explanations yet</div><div className="empty-text">Tap Edit, write, then Save.</div></div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBackToList} aria-label="Back to notes list">
          ‹ Notes
        </button>
        <span className="navbar-title" style={{ fontSize: 15, opacity: 0 }}>{'\u00A0'}</span>
        <div className="flex items-center gap-8">
          <button className="navbar-btn" onClick={() => setExportOpen(true)} aria-label="Share or export">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m8 7 4-4 4 4" />
              <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
            </svg>
          </button>
          <button className="navbar-btn" onClick={() => setMode('edit')} aria-label="Edit note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          {hasStudy && (
            <button className="navbar-btn" onClick={onOpenStudy} aria-label="Study">
              📚
            </button>
          )}
        </div>
      </header>

      {/* View switcher — segmented control */}
      <div className="view-switcher">
        {[['panel', 'Panel'], ['inline', 'Inline'], ['swipe', 'Swipe']].map(([v, label]) => (
          <button
            key={v}
            className={`view-switch-btn${view === v ? ' active' : ''}`}
            onClick={() => persistView(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {scanError && (
        <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{scanError}</div>
      )}

      {view === 'swipe' ? swipeContainer : notePage}

      <SlideUpPanel
        open={panelOpen && view === 'panel'}
        onClose={() => setPanelOpen(false)}
        blocks={blocks}
        selectedLineId={selectedLineId}
        onSelectLine={setSelectedLineId}
        onExplainSimpler={id => handleLineRequest(id, 'simpler')}
        onGiveExample={id => handleLineRequest(id, 'example')}
        onShowOriginal={handleShowOriginal}
        busyLineId={busyLine}
      />

      {exportOpen && (
        <div className="export-overlay" onClick={() => setExportOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Share &amp; Export</div>
            <button className="export-btn" onClick={handleShareText}>📤 Share note as text</button>
            <button className="export-btn" onClick={handleCopyText}>📋 Copy note text</button>
            <button className="export-btn" onClick={() => handlePrintPdf(false)}>📄 Save as PDF</button>
            {explBlocks.length > 0 && (
              <button className="export-btn" onClick={() => handlePrintPdf(true)}>📄 PDF with explanations</button>
            )}
            <button className="export-btn cancel" onClick={() => setExportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {moveOpen && (
        <FolderPickerSheet
          currentId={note.folderId}
          onPick={handleMove}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {printPortal}
    </div>
  );
}