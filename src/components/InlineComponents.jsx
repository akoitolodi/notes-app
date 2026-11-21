/**
 * Inline components for NoteEditor — extracted to avoid React minified
 * "hooks in wrong place" errors (#310) when the inline arrow-function
 * components confuse the production optimizer.
 */
import { useCallback } from 'react';

/** Show hashtag pills inline. */
export function renderLineText(text) {
  if (!text) return ['\u00A0'];
  const parts = text.split(/(#[A-Za-z0-9_-]+)/);
  if (parts.length === 1) return [text];
  return parts.map((p, i) =>
    p.length > 1 && p[0] === '#'
      ? <span key={i} className="hashtag">{p}</span>
      : p
  );
}

/** "Explain simpler" / "Give example" / "Show original" buttons for a block. */
export function VariantButtons({ block, busyLine, expandedInline, onExplainSimpler, onGiveExample, onShowOriginal }) {
  return (
    <>
      <div className="explanation-actions">
        <button
          className="btn btn-secondary"
          disabled={busyLine === block.id}
          onClick={() => onExplainSimpler?.(block.id)}
        >
          {busyLine === block.id && expandedInline[block.id] === 'simpler' ? '…' : 'Explain simpler'}
        </button>
        <button
          className="btn btn-secondary"
          disabled={busyLine === block.id}
          onClick={() => onGiveExample?.(block.id)}
        >
          {busyLine === block.id && expandedInline[block.id] === 'example' ? '…' : 'Give example'}
        </button>
      </div>
      {block.show && block.show !== 'main' && (
        <button
          className="btn btn-ghost"
          style={{ width: '100%', padding: '6px 0', fontSize: 13 }}
          onClick={() => onShowOriginal?.(block.id)}
        >
          Show original explanation
        </button>
      )}
    </>
  );
}

/** Mistake reason + Accept fix / Ignore buttons. */
export function MistakeBox({ mistake, block, onApplyCorrection, onDismissMistake }) {
  return (
    <div className="inline-mistake">
      ⚠ {mistake.reason} <em>Suggestion: {mistake.correction}</em>
      <div className="mistake-actions">
        <button onClick={() => onApplyCorrection?.(block, mistake)}>Accept fix</button>
        <button onClick={() => onDismissMistake?.(block.id)}>Ignore</button>
      </div>
    </div>
  );
}

/** One rendered note line (used in all three views). */
export function NoteLine({
  i,
  lines,
  blockByLine,
  lineHasExpl,
  lineMistake,
  expandedInline,
  view,
  onOpenPanel,
  onExpandInline,
  onToggleChecklist,
  onLineRequest,
  showOriginal,
  applyCorrection,
  dismissMistake,
  busyLine,
  dismissed,
}) {
  const b = blockByLine[i];
  const mistake = lineMistake(i);
  const hasExpl = lineHasExpl(i);
  const open = b ? expandedInline[b.id] : null;
  const checkMatch = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/.exec(lines[i] || '');
  const checked = checkMatch && checkMatch[2] !== ' ';

  if (checkMatch) {
    return (
      <div className="note-line-wrap">
        <div
          className="note-line check"
          onClick={() => onToggleChecklist?.(i)}
          style={{ cursor: 'pointer', position: 'relative' }}
        >
          <span className={`check-box${checked ? ' checked' : ''}`} aria-hidden="true">✓</span>
          <span style={checked ? { textDecoration: 'line-through', opacity: 0.5 } : null}>
            {checkMatch[4] || '\u00A0'}
          </span>
        </div>
        {mistake && !dismissed[b?.id] && view !== 'inline' && (
          <MistakeBox
            mistake={mistake}
            block={b}
            onApplyCorrection={applyCorrection}
            onDismissMistake={dismissMistake}
          />
        )}
      </div>
    );
  }

  return (
    <div className="note-line-wrap">
      <div
        className={`note-line${mistake ? ' has-mistake' : ''}`}
        onClick={() => {
          if (!b) return;
          if (view === 'panel') onOpenPanel?.(b.id);
          else onExpandInline?.(b.id);
        }}
        style={{ cursor: b ? 'pointer' : 'default', position: 'relative' }}
      >
        {hasExpl && <span className="line-dot" aria-hidden="true" />}
        {renderLineText(lines[i])}
      </div>

      {view === 'inline' && b && (b.explanation || b.simpler || b.example) && (
        <div className="inline-explanation" onClick={e => e.stopPropagation()}>
          <div
            className="inline-collapsed"
            onClick={() => onExpandInline(b.id)}
          >
            {b.show && b.show !== 'main' ? `(${b.show}) ` : ''}
            {(b.show === 'simpler' && b.simpler)
              ? b.simpler
              : (b.show === 'example' && b.example)
                ? b.example
                : b.explanation || ''}
              .slice(0, 90){(b.show === 'simpler' && b.simpler ? b.simpler.length : b.show === 'example' && b.example ? b.example.length : b.explanation?.length || 0) > 90 ? '…' : ''}
          </div>
          {open && (
            <div className="inline-expanded">
              <div className="explanation-text">
                {(b.show === 'simpler' && b.simpler)
                  ? b.simpler
                  : (b.show === 'example' && b.example)
                    ? b.example
                    : b.explanation || ''}
              </div>
              {busyLine === b.id && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Thinking…</div>}
              <VariantButtons
                block={b}
                busyLine={busyLine}
                expandedInline={expandedInline}
                onExplainSimpler={id => onLineRequest?.(id, 'simpler')}
                onGiveExample={id => onLineRequest?.(id, 'example')}
                onShowOriginal={id => showOriginal?.(id)}
              />
              {mistake && !dismissed[b.id] && (
                <MistakeBox
                  mistake={mistake}
                  block={b}
                  onApplyCorrection={applyCorrection}
                  onDismissMistake={dismissMistake}
                />
              )}
            </div>
          )}
        </div>
      )}

      {mistake && !dismissed[b?.id] && view !== 'inline' && (
        <MistakeBox
          mistake={mistake}
          block={b}
          onApplyCorrection={applyCorrection}
          onDismissMistake={dismissMistake}
        />
      )}
    </div>
  );
}