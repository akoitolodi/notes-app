/**
 * Slide-up panel (iOS bottom sheet) — shows AI explanations for a tapped line.
 * Draggable: collapsed → expanded → full screen. Swipe down to close.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export default function SlideUpPanel({
  open,
  onClose,
  blocks = [],
  selectedLineId,
  onSelectLine,
  onExplainSimpler,
  onGiveExample,
}) {
  // Snap points as fraction of viewport height
  const SNAP_POINTS = [0.25, 0.6, 0.95]; // collapsed, half, full
  const [snapIndex, setSnapIndex] = useState(0); // 0 = collapsed
  const panelRef = useRef(null);
  const startY = useRef(0);
  const startSnap = useRef(0);
  const isDragging = useRef(false);

  // When open prop changes, reset to collapsed
  useEffect(() => {
    if (open) setSnapIndex(0);
  }, [open]);

  const handleTouchStart = useCallback(e => {
    if (!panelRef.current) return;
    const touch = e.touches[0];
    startY.current = touch.clientY;
    startSnap.current = snapIndex;
    isDragging.current = true;
    panelRef.current.style.transition = 'none';
  }, [snapIndex]);

  const handleTouchMove = useCallback(e => {
    if (!isDragging.current || !panelRef.current) return;
    const touch = e.touches[0];
    const deltaY = startY.current - touch.clientY; // negative = drag up
    const vh = window.innerHeight;
    // Each snap point is a fraction of vh
    const deltaSnaps = deltaY / (vh * 0.35); // roughly 35% per snap
    const target = Math.max(0, Math.min(2, startSnap.current - deltaSnaps));
    setSnapIndex(target);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    panelRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    // Snap to nearest point
    const nearest = Math.round(snapIndex);
    setSnapIndex(Math.max(0, Math.min(2, nearest)));
    // If dragged down past collapsed, close
    if (snapIndex < 0.3) onClose?.();
  }, [snapIndex, onClose]);

  // Compute transform
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const heights = SNAP_POINTS.map(p => p * vh);
  const currentHeight = heights[Math.round(snapIndex)] || heights[0];
  const translateY = vh - currentHeight;

  // Find block for selected line
  const selectedBlock = blocks.find(b => b.id === selectedLineId);
  // If no specific line selected, show first block with content
  const displayBlock = selectedBlock || blocks.find(b => b.explanation) || blocks[0];

  if (!open) return null;

  return (
    <>
      <div
        className="panel-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`panel ${snapIndex >= 2 ? 'full' : ''} ${snapIndex > 0 ? 'open' : ''}`}
        style={{ transform: `translateY(${translateY}px)`, height: `${currentHeight}px` }}
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
              <div className="empty-text">Tap a line in your note, then tap Save to get an explanation.</div>
            </div>
          )}

          {/* List all blocks for this note */}
          {blocks.length > 1 && (
            <div className="mt-16">
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                All lines in this note
              </h3>
              {blocks.map((block, i) => (
                <button
                  key={block.id}
                  className={`list-item ${block.id === selectedLineId ? 'bg-elevated' : ''}`}
                  onClick={() => onSelectLine?.(block.id)}
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    marginBottom: 8,
                    border: '1px solid var(--divider)',
                    background: block.id === selectedLineId ? 'var(--bg-elevated)' : 'var(--bg)',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
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