/**
 * Read-mode note line components — rich Markdown + KaTeX rendering per line,
 * interactive checklists, mistake boxes, and tap-to-explain margin indicators.
 */
import { Check, AlertTriangle } from 'lucide-react';
import { renderRichNoteLine, renderInlineRich } from './ui/MarkdownContent';

/** Which explanation variant text to show for a block. */
export function activeVariant(block) {
  if (!block) return '';
  if (block.show === 'simpler' && block.simpler) return block.simpler;
  if (block.show === 'example' && block.example) return block.example;
  return block.explanation || '';
}

/** Mistake reason + Accept fix / Ignore buttons. */
export function MistakeBox({ mistake, block, onApplyCorrection, onDismissMistake }) {
  return (
    <div className="inline-mistake">
      <div className="flex items-center gap-6" style={{ fontWeight: 600 }}>
        <AlertTriangle size={14} /> Possible mistake
      </div>
      <div style={{ marginTop: 3 }}>{mistake.reason}</div>
      {mistake.correction && (
        <div className="inline-mistake-fix">Suggestion: {mistake.correction}</div>
      )}
      <div className="mistake-actions">
        {mistake.correction && (
          <button
            type="button"
            className="mistake-accept"
            onClick={() => onApplyCorrection?.(block, mistake)}
          >
            Accept fix
          </button>
        )}
        <button
          type="button"
          className="mistake-ignore"
          onClick={() => onDismissMistake?.(block.id)}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

const CHECK_RE = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/;

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
  const raw = lines[i] || '';
  const b = blockByLine[i];
  const mistake = lineMistake(i);
  const hasExpl = lineHasExpl(i);
  const checkMatch = CHECK_RE.exec(raw);
  const checked = Boolean(checkMatch && checkMatch[2] !== ' ');
  const hint = showHint && b && hasExpl ? activeVariant(b) : null;
  const showMistake = Boolean(mistake && !dismissed[b?.id] && !b?.mistakeIgnored);

  if (checkMatch) {
    return (
      <div className="note-line-wrap">
        <div
          className="note-line check"
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onClick={() => onToggleChecklist?.(i)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleChecklist?.(i);
            }
          }}
        >
          <span className={`check-box${checked ? ' checked' : ''}`} aria-hidden="true">
            {checked && <Check size={12} strokeWidth={3} />}
          </span>
          <span
            style={checked ? { textDecoration: 'line-through', opacity: 0.55 } : null}
          >
            {renderInlineRich(checkMatch[4] || '\u00A0', `chk-${i}`, { allowHashtags: true })}
          </span>
        </div>
        {hint && (
          <div className="line-hint">
            {hint.slice(0, 100)}
            {hint.length > 100 ? '…' : ''}
          </div>
        )}
        {showMistake && (
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

  const parsed = renderRichNoteLine(raw, `ln-${i}`);
  const indentStyle = parsed.indent ? { paddingLeft: 6 + parsed.indent * 16 } : undefined;

  return (
    <div className="note-line-wrap">
      <div
        className={`note-line variant-${parsed.variant}${showMistake ? ' has-mistake' : ''}`}
        style={indentStyle}
        onClick={() => onLineTap?.(b, i)}
      >
        {hasExpl && <span className="line-dot" aria-hidden="true" />}
        {parsed.variant === 'bullet' && <span className="line-marker">•</span>}
        {parsed.variant === 'ordered' && <span className="line-marker">{parsed.marker}</span>}
        <span className="flex-1" style={{ minWidth: 0 }}>{parsed.content}</span>
      </div>

      {hint && (
        <div className="line-hint">
          {hint.slice(0, 100)}
          {hint.length > 100 ? '…' : ''}
        </div>
      )}

      {showMistake && (
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
