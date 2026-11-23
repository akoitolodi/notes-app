/**
 * SlideUpPanel — iOS bottom sheet for line explanations.
 *
 * Upgrades:
 * - Pointer-event drag handling (touch + desktop mouse) using direct DOM height
 *   updates during drag (zero 60fps React re-renders).
 * - Escape key support.
 * - Respects mistakeIgnored / dismissed and provides Accept fix / Ignore actions.
 * - Highlights active variant (Original / Simpler / Example) with spinner on load.
 * - Renders explanations with Markdown + KaTeX support.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Sparkles, Lightbulb, FileText } from 'lucide-react';
import MarkdownContent from './ui/MarkdownContent';

const SNAP_POINTS = [0.46, 0.72, 0.92];
const CLOSE_THRESHOLD = 0.08;

export default function SlideUpPanel({
  open,
  onClose,
  blocks = [],
  selectedLineId,
  onSelectLine,
  onExplainSimpler,
  onGiveExample,
  onShowOriginal,
  onApplyCorrection,
  onDismissMistake,
  dismissed = {},
  busyLineId,
}) {
  const [snap, setSnap] = useState(SNAP_POINTS[0]);
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  const panelRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (open) setSnap(SNAP_POINTS[0]);
  }, [open]);

  // Escape closes panel
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handlePointerDown = useCallback(
    e => {
      if (e.button && e.button !== 0) return;
      const handle = e.target.closest?.('.panel-handle, .panel-header');
      if (!handle || e.target.closest?.('button')) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { startY: e.clientY, startSnap: snap, liveSnap: snap };
      if (panelRef.current) panelRef.current.style.transition = 'none';
    },
    [snap]
  );

  const handlePointerMove = useCallback(e => {
    const d = dragRef.current;
    if (!d) return;
    const deltaUp = d.startY - e.clientY;
    const curVh = window.innerHeight || 800;
    const next = Math.max(0.16, Math.min(SNAP_POINTS[2], d.startSnap + deltaUp / curVh));
    d.liveSnap = next;
    if (panelRef.current) {
      panelRef.current.style.height = `${next * curVh}px`;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (panelRef.current) {
      panelRef.current.style.transition = 'height 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
    }
    const endSnap = d.liveSnap;
    if (endSnap < d.startSnap - CLOSE_THRESHOLD && endSnap <= SNAP_POINTS[0]) {
      onClose?.();
      return;
    }
    const nearest = SNAP_POINTS.reduce(
      (best, p) => (Math.abs(p - endSnap) < Math.abs(best - endSnap) ? p : best),
      SNAP_POINTS[0]
    );
    setSnap(nearest);
    if (panelRef.current) {
      panelRef.current.style.height = `${nearest * (window.innerHeight || 800)}px`;
    }
  }, [onClose]);

  const selectedBlock = blocks.find(b => b.id === selectedLineId);
  const displayBlock =
    selectedBlock || blocks.find(b => b.explanation || b.simpler || b.example) || blocks[0];

  const activeVariantKey = block => {
    if (!block) return 'main';
    if (block.show === 'simpler' && block.simpler) return 'simpler';
    if (block.show === 'example' && block.example) return 'example';
    return 'main';
  };

  const activeVariantText = block => {
    const v = activeVariantKey(block);
    if (v === 'simpler') return block.simpler;
    if (v === 'example') return block.example;
    return block?.explanation || '';
  };

  if (!open) return null;

  const isBusy = displayBlock && busyLineId === displayBlock.id;
  const variant = activeVariantKey(displayBlock);
  const showMistake = Boolean(
    displayBlock?.mistake && !displayBlock.mistakeIgnored && !dismissed[displayBlock.id]
  );

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="panel"
        style={{ height: `${snap * vh}px`, transition: 'height 0.22s cubic-bezier(0.22, 1, 0.36, 1)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="dialog"
        aria-modal="true"
        aria-label="Explanations"
      >
        <div className="panel-handle" aria-hidden="true" />
        <div className="panel-header">
          <h2 className="panel-title">Explanations</h2>
          <button
            type="button"
            className="navbar-btn"
            style={{ color: 'var(--text-secondary)' }}
            onClick={onClose}
            aria-label="Close explanations"
          >
            <X size={20} />
          </button>
        </div>

        <div className="panel-content">
          {displayBlock ? (
            <div className="explanation-card">
              <div className="explanation-line">{displayBlock.text}</div>

              {(displayBlock.simpler || displayBlock.example) && (
                <div className="variant-pills">
                  <button
                    type="button"
                    className={`variant-pill${variant === 'main' ? ' active' : ''}`}
                    onClick={() => onShowOriginal?.(displayBlock.id)}
                  >
                    Original
                  </button>
                  {displayBlock.simpler && (
                    <button
                      type="button"
                      className={`variant-pill${variant === 'simpler' ? ' active' : ''}`}
                      onClick={() => onExplainSimpler?.(displayBlock.id)}
                    >
                      Simpler
                    </button>
                  )}
                  {displayBlock.example && (
                    <button
                      type="button"
                      className={`variant-pill${variant === 'example' ? ' active' : ''}`}
                      onClick={() => onGiveExample?.(displayBlock.id)}
                    >
                      Example
                    </button>
                  )}
                </div>
              )}

              <div className="explanation-text">
                {isBusy ? (
                  <div className="scan-indicator" style={{ padding: 0 }}>
                    <span className="spinner" /> Thinking…
                  </div>
                ) : activeVariantText(displayBlock) ? (
                  <MarkdownContent text={activeVariantText(displayBlock)} />
                ) : (
                  'No explanation yet.'
                )}
              </div>

              {displayBlock.terms && displayBlock.terms.length > 0 && (
                <div className="explanation-terms">
                  {displayBlock.terms.map((t, i) => (
                    <span key={i} className="term-pill">
                      <strong>{t.term}</strong>: {t.definition}
                    </span>
                  ))}
                </div>
              )}

              {showMistake && (
                <div className="explanation-mistake">
                  <AlertTriangle size={18} className="mistake-icon" />
                  <div className="flex-1">
                    <div className="mistake-reason">{displayBlock.mistake.reason}</div>
                    {displayBlock.mistake.correction && (
                      <div className="mistake-correction">
                        Suggestion: {displayBlock.mistake.correction}
                      </div>
                    )}
                    <div className="mistake-actions">
                      {displayBlock.mistake.correction && (
                        <button
                          type="button"
                          className="mistake-accept"
                          onClick={() =>
                            onApplyCorrection?.(displayBlock, displayBlock.mistake)
                          }
                        >
                          Accept fix
                        </button>
                      )}
                      <button
                        type="button"
                        className="mistake-ignore"
                        onClick={() => onDismissMistake?.(displayBlock.id)}
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="explanation-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onExplainSimpler?.(displayBlock.id)}
                  disabled={isBusy}
                >
                  <Sparkles size={15} /> Explain simpler
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onGiveExample?.(displayBlock.id)}
                  disabled={isBusy}
                >
                  <Lightbulb size={15} /> Give example
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <FileText size={26} />
              </div>
              <div className="empty-title">No explanation yet</div>
              <div className="empty-text">
                Tap Explain in the editor, or tap any line in Read mode to explain it on demand.
              </div>
            </div>
          )}

          {blocks.length > 1 && (
            <div className="mt-16">
              <div className="settings-label" style={{ marginBottom: 8 }}>
                All explained lines ({blocks.length})
              </div>
              {blocks.map(block => {
                const active = block.id === selectedLineId;
                const hasUnignoredMistake = Boolean(
                  block.mistake && !block.mistakeIgnored && !dismissed[block.id]
                );
                return (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onSelectLine?.(block.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 12,
                      borderRadius: 12,
                      marginBottom: 8,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--divider)'}`,
                      background: active ? 'var(--accent-tint)' : 'var(--panel-card)',
                      color: 'var(--text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
                      {block.text.slice(0, 85)}
                      {block.text.length > 85 ? '…' : ''}
                    </div>
                    {block.explanation && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {block.explanation.slice(0, 100)}
                        {block.explanation.length > 100 ? '…' : ''}
                      </div>
                    )}
                    {hasUnignoredMistake && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 4,
                          fontSize: 11,
                          color: 'var(--mistake-ink)',
                          fontWeight: 600,
                        }}
                      >
                        <AlertTriangle size={12} /> Possible mistake
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
