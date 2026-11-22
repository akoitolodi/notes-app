/**
 * Inline components for NoteEditor — extracted to avoid React minified
 * "hooks in wrong place" errors (#310) when the inline arrow-function
 * components confuse the production optimizer.
 *
 * NoteLine is panel-only (v1.2.0): tapping a line with an explanation opens
 * the slide-up panel. An optional one-line "hint" can be shown under lines
 * (Settings → Reading).
 */

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

/** Which explanation variant text to show for a block. */
export function activeVariant(block) {
  if (block.show === 'simpler' && block.simpler) return block.simpler;
  if (block.show === 'example' && block.example) return block.example;
  return block.explanation || '';
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

/** One rendered note line (used in read mode). */
export function NoteLine({
  i,
  lines,
  blockByLine,
  lineHasExpl,
  lineMistake,
  onLineTap,
  onToggleChecklist,
  applyCorrection,
  dismissMistake,
  dismissed,
  showHint = false,
}) {
  const b = blockByLine[i];
  const mistake = lineMistake(i);
  const hasExpl = lineHasExpl(i);
  const checkMatch = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/.exec(lines[i] || '');
  const checked = checkMatch && checkMatch[2] !== ' ';

  const hint = showHint && b && hasExpl ? activeVariant(b) : null;

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
        {hint && <div className="line-hint">{hint.slice(0, 90)}{hint.length > 90 ? '…' : ''}</div>}
        {mistake && !dismissed[b?.id] && (
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
        onClick={() => onLineTap?.(b, i)}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        {hasExpl && <span className="line-dot" aria-hidden="true" />}
        {renderLineText(lines[i])}
      </div>

      {hint && <div className="line-hint">{hint.slice(0, 90)}{hint.length > 90 ? '…' : ''}</div>}

      {mistake && !dismissed[b?.id] && (
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