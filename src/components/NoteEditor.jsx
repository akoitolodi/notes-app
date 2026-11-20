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
  const [mode, setMode] = useState('read'); // read | edit
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [blocks, setBlocks] = useState(note?.blocks || []);
  const [flashcards, setFlashcards] = useState(note?.flashcards || []);
  const [quiz, setQuiz] = useState(note?.quiz || []);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'panel');
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [expandedInline, setExpandedInline] = useState({}); // lineId -> variant shown
  const [busyLine, setBusyLine] = useState(null); // lineId while re-scanning
  const [dismissed, setDismissed] = useState({}); // lineId -> mistake dismissed

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

  const handleSave = useCallback(async () => {
    await updateNote(note.id, { title, body });
    const changedLines = [];
    const oldLines = savedRef.current.body.split('\n');
    const newLines = body.split('\n');
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) changedLines.push(i + 1);
    }

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanNote(body, note.subject || 'General', changedLines);
      savedRef.current = { title, body };
      const newBlocks = result.blocks || [];
      setBlocks(newBlocks);
      setFlashcards(result.flashcards || []);
      setQuiz(result.quiz || []);
      await updateNote(note.id, {
        blocks: newBlocks,
        flashcards: result.flashcards || [],
        quiz: result.quiz || [],
      });
      setMode('read');
    } catch (err) {
      setScanError(err.message);
    } finally {
      setIsScanning(false);
    }
  }, [title, body, note]);

  /** Re-scan one line: request = 'simpler' | 'example' */
  const handleLineRequest = useCallback(async (lineId, request) => {
    const block = blocks.find(b => b.id === lineId);
    if (!block || busyLine) return;
    setBusyLine(lineId);
    try {
      const { explanation } = await scanLine(body, block.text, request);
      const updated = blocks.map(b =>
        b.id === lineId
          ? { ...b, [request === 'simpler' ? 'simpler' : 'example']: explanation }
          : b
      );
      setBlocks(updated);
      await updateNote(note.id, { blocks: updated });
    } catch (err) {
      setScanError(err.message);
    } finally {
      setBusyLine(null);
    }
  }, [blocks, body, note, busyLine]);

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
          <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBackToList} aria-label="Back to notes list">
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
  const blockByLine = {}; // line index (0-based) -> block
  blocks.forEach(b => {
    const m = /^line-(\d+)$/.exec(b.id);
    if (m) blockByLine[parseInt(m[1], 10) - 1] = b;
  });
  const hasStudy = flashcards.length + quiz.length > 0;

  const lineHasExpl = i => {
    const b = blockByLine[i];
    return b && (b.explanation || b.simpler || b.example);
  };
  const lineMistake = i => blockByLine[i]?.mistake || null;

  const activeVariant = block => {
    // Which explanation text to show for a block right now
    const ex = expandedInline[block.id];
    if (ex === 'simpler' && block.simpler) return block.simpler;
    if (ex === 'example' && block.example) return block.example;
    return block.explanation || '';
  };

  const VariantButtons = ({ block }) => (
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
              {activeVariant(b).slice(0, 90)}{activeVariant(b).length > 90 ? '…' : ''}
            </div>
            {open && (
              <div className="inline-expanded">
                <div className="explanation-text">{activeVariant(b)}</div>
                {busyLine === b.id && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Thinking…</div>}
                <VariantButtons block={b} />
              </div>
            )}
          </div>
        )}

        {mistake && !dismissed[b.id] && view !== 'inline' && (
          <div className="inline-mistake">
            ⚠ {mistake.reason} <em>Suggestion: {mistake.correction}</em>
            <div className="mistake-actions">
              <button onClick={() => applyCorrection(b, mistake)}>Accept fix</button>
              <button onClick={() => setDismissed(prev => ({ ...prev, [b.id]: true }))}>Ignore</button>
            </div>
          </div>
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
      />
    </div>
  );
}