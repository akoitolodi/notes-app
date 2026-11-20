/**
 * Slide-up panel (iOS bottom sheet) — shows AI explanations for a tapped line.
 * Three snap heights: peek (25%), half (60%), full (95%). Drag up/down between
 * them; drag down past peek to close.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const SNAP_POINTS = [0.25, 0.6, 0.95]; // fractions of viewport height
const CLOSE_THRESHOLD = 0.15; // fraction of vh dragged down that closes the panel

export default function SlideUpPanel({
  open,
  onClose,
  blocks = [],
  selectedLineId,
  onSelectLine,
  onExplainSimpler,
  onGiveExample,
}) {
  const [snap, setSnap] = useState(SNAP_POINTS[0]); // current height fraction
  const panelRef = useRef(null);
  const drag = useRef(null); // { startY, startSnap }

  // Reset to peek height whenever the panel opens
  useEffect(() => {
    if (open) setSnap(SNAP_POINTS[0]);
  }, [open]);

  const handleTouchStart = useCallback(e => {
    const t = e.touches[0];
    drag.current = { startY: t.clientY, startSnap: snap, moved: false };
    if (panelRef.current) panelRef.current.style.transition = 'none';
  }, [snap]);

  const handleTouchMove = useCallback(e => {
    if (!drag.current) return;
    const t = e.touches[0];
    const deltaUp = drag.current.startY - t.clientY; // + when dragging up
    drag.current.moved = true;
    const vh = window.innerHeight;
    const next = Math.max(
      SNAP_POINTS[0] - 0.1, // allow slight overshoot down (visual rubber band)
      Math.min(SNAP_POINTS[2], drag.current.startSnap + deltaUp / vh)
    );
    setSnap(next);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!drag.current) return;
    const { startSnap } = drag.current;
    drag.current = null;
    if (panelRef.current) {
      panelRef.current.style.transition = 'height 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    }
    // Dragged down past threshold → close
    if (snap < startSnap - CLOSE_THRESHOLD && snap <= SNAP_POINTS[0]) {
      onClose?.();
      return;
    }
    // Snap to nearest point
    const nearest = SNAP_POINTS.reduce((best, p) =>
      Math.abs(p - snap) < Math.abs(best - snap) ? p : best
    , SNAP_POINTS[0]);
    setSnap(nearest);
  }, [snap, onClose]);

  // Find block for selected line (or first with content)
  const selectedBlock = blocks.find(b => b.id === selectedLineId);
  const displayBlock = selectedBlock || blocks.find(b => b.explanation) || blocks[0];

  if (!open) return null;

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  return (
    <>
      <div className="panel-overlay visible" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="panel open"
        style={{ height: `${Math.max(snap, 0.05) * vh}px` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label="Explanations"
      >
        <div className="panel-handle" aria-hidden="true" />
        <div className="panel-header">
          <h2 className="panel-title">Explanations</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="panel-content">
          {displayBlock ? (
            <div className="explanation-card">
              <div className="explanation-line">{displayBlock.text}</div>
              <div className="explanation-text">{displayBlock.explanation || 'No explanation yet.'}</div>

              {displayBlock.terms && displayBlock.terms.length > 0 && (
                <div className="explanation-terms">
                  {displayBlock.terms.map((t, i) => (
                    <span key={i} className="term-pill">
                      <strong>{t.term}</strong>: {t.definition}
                    </span>
                  ))}
                </div>
              )}

              {displayBlock.mistake && (
                <div className="explanation-mistake">
                  <svg className="mistake-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div>
                    <div className="mistake-reason">{displayBlock.mistake.reason}</div>
                    <div className="mistake-correction">Suggestion: {displayBlock.mistake.correction}</div>
                  </div>
                </div>
              )}

              <div className="explanation-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => onExplainSimpler?.(displayBlock.id)}
                  disabled={!displayBlock.id}
                >
                  Explain simpler
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => onGiveExample?.(displayBlock.id)}
                  disabled={!displayBlock.id}
                >
                  Give example
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <div className="empty-title">No explanation yet</div>
              <div className="empty-text">Type your note, then tap Save to get explanations.</div>
            </div>
          )}

          {/* All blocks in this note */}
          {blocks.length > 1 && (
            <div className="mt-16">
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                All lines in this note
              </h3>
              {blocks.map(block => (
                <button
                  key={block.id}
                  onClick={() => onSelectLine?.(block.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: 12,
                    borderRadius: 10,
                    marginBottom: 8,
                    border: '1px solid ' + (block.id === selectedLineId ? 'var(--accent)' : 'var(--divider)'),
                    background: block.id === selectedLineId ? 'var(--bg-elevated)' : 'var(--bg)',
                    color: 'var(--text)',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 14, marginBottom: 4 }}>
                    {block.text.slice(0, 80)}{block.text.length > 80 ? '…' : ''}
                  </div>
                  {block.explanation && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {block.explanation.slice(0, 100)}{block.explanation.length > 100 ? '…' : ''}
                    </div>
                  )}
                  {block.mistake && (
                    <span style={{ fontSize: 11, color: 'var(--mistake)', fontWeight: 500 }}>
                      ⚠ Possible mistake
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}