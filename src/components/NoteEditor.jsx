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
import { scanNote } from '../api/scan';
import { scanLine } from '../api/scanLine';
import { updateNote } from '../store/db';
import SlideUpPanel from './SlideUpPanel';

const VIEW_KEY = 'ai-class-notes:view';

export default function NoteEditor({ note, onOpenStudy, onBackToList }) {
  const [mode, setMode] = useState(() => {
    // New (empty) notes open straight into editing, like iOS Notes.
    // Existing notes open in read mode.
    const isNew = !(note?.title || '').trim() && !(note?.body || '').trim();
    return isNew ? 'edit' : 'read';
  }); // read | edit
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
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

  const textareaRef = useRef(null);
  const savedRef = useRef({ title: note?.title || '', body: note?.body || '' });

  // Re-init when a different note is opened
  useEffect(() => {
    setTitle(note?.title || '');
    setBody(note?.body || '');
    setBlocks(note?.blocks || []);
    setFlashcards(note?.flashcards || []);
    setQuiz(note?.quiz || []);
    savedRef.current = { title: note?.title || '', body: note?.body || '' };
    setScanError(null);
    setMode('read');
  }, [note?.id]);

  const persistView = v => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const handleSave = useCallback(async ({ rescan = true } = {}) => {
    // Never scan an empty note
    const noteIsEmpty = !body.trim() && !title.trim();
    if (noteIsEmpty) {
      await updateNote(note.id, { title, body });
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
      await updateNote(note.id, { title, body });
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
      const result = await scanNote(body, note.subject || 'General', linesToScan);
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
        blocks: merged,
        flashcards: result.flashcards?.length ? result.flashcards : flashcards,
        quiz: result.quiz?.length ? result.quiz : quiz,
      });
      setMode('read');
    } catch (err) {
      // Scan failed: keep the saved text (don't lose edits) and show the error
      setScanError(err.message);
    } finally {
      setIsScanning(false);
    }
  }, [title, body, note, blocks, flashcards, quiz]);

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
                updateNote(note.id, { title, body });
                savedRef.current = { title, body };
              }
              setMode('read');
            }}
            aria-label="Back to notes list"
          >
            ‹ Notes
          </button>
          <span className="navbar-title" style={{ fontSize: 15 }}>Edit</span>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isScanning}
            style={{ padding: '6px 14px', fontSize: 15 }}
          >
            {isScanning ? (<><span className="spinner" style={{ width: 14, height: 14 }} /> Scanning…</>) : 'Save'}
          </button>
        </header>

        <div className="editor safe-bottom">
          {scanError && (
            <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{scanError}</div>
          )}
          <input
            type="text" className="editor-title" placeholder="Title"
            value={title} onChange={e => setTitle(e.target.value)} aria-label="Note title"
          />
          <textarea
            ref={textareaRef}
            className="editor-body" placeholder="Start typing your notes…"
            value={body} onChange={e => setBody(e.target.value)} aria-label="Note body"
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

  /** One rendered note line (used in all three views). */
  const NoteLine = ({ i }) => {
    const b = blockByLine[i];
    const mistake = lineMistake(i);
    const hasExpl = lineHasExpl(i);
    const open = b ? expandedInline[b.id] : null;
    return (
      <div className="note-line-wrap">
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
          {lines[i] || '\u00A0'}
        </div>

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
        <span className="navbar-title" style={{ fontSize: 15 }}>{title || 'New Note'}</span>
        <div className="flex items-center gap-8">
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
      <div className="view-switcher safe-top" style={{ paddingTop: 8 }}>
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
    </div>
  );
}