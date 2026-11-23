/**
 * Read-mode note line components — rich Markdown + KaTeX rendering per line,
 * interactive checklists, mistake boxes, and tap-to-explain margin indicators.
 */
import { useState } from 'react';
import { Check, AlertTriangle, Copy, Bug, ChevronUp } from 'lucide-react';
import MarkdownContent, { renderRichNoteLine, renderInlineRich } from './ui/MarkdownContent';
import { tokenizeCode } from '../lib/codeHighlight';
import { debugCodeWithAI } from '../lib/aiFeatures';

/** Interactive syntax-highlighted fenced code card for Read Mode (Copy + 1-tap Debug/Trace). */
export function CodeBlockCard({ lang = '', code = '', noteContext = '', zeroAi = false }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [err, setErr] = useState('');
  const tokens = tokenizeCode(code, lang);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const handleDebug = async () => {
    if (busy || zeroAi) return;
    if (analysis) {
      setAnalysis('');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await debugCodeWithAI({
        code,
        lang,
        noteContext,
        onToken: partial => setAnalysis(partial),
      });
      setAnalysis(res);
    } catch (e) {
      setErr(e?.message || 'Code analysis failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="code-card">
      <div className="code-card-head">
        <span className="code-card-lang">{lang || 'code'}</span>
        <div className="flex items-center gap-6">
          {!zeroAi && (
            <button
              type="button"
              className="code-card-btn"
              onClick={handleDebug}
              disabled={busy}
              title="Trace execution, spot bugs & Big-O"
            >
              {busy ? (
                <span className="spinner" style={{ width: 12, height: 12 }} />
              ) : analysis ? (
                <ChevronUp size={13} />
              ) : (
                <Bug size={13} />
              )}
              <span>{busy ? 'Tracing…' : analysis ? 'Hide trace' : 'Trace / Debug'}</span>
            </button>
          )}
          <button type="button" className="code-card-btn" onClick={handleCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className="code-card-pre">
        <code>
          {tokens.map((tk, idx) =>
            tk.type === 'plain' ? (
              tk.text
            ) : (
              <span key={idx} className={`tok-${tk.type}`}>
                {tk.text}
              </span>
            )
          )}
        </code>
      </pre>
      {err && <div className="inline-mistake" style={{ margin: '8px 10px' }}>{err}</div>}
      {analysis && (
        <div className="code-card-analysis">
          <MarkdownContent text={analysis} />
        </div>
      )}
    </div>
  );
}

/** Clean responsive GFM table card for Read Mode. */
export function MarkdownTableBlock({ headers = [], rows = [], onWikiLinkTap = null }) {
  return (
    <div className="md-table-wrap" style={{ margin: '10px 0' }}>
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((h, hi) => (
              <th key={hi}>{renderInlineRich(h, `rth-${hi}`, { allowHashtags: true, onWikiLinkTap })}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci}>
                  {renderInlineRich(r[ci] || '', `rtd-${ri}-${ci}`, { allowHashtags: true, onWikiLinkTap })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  onWikiLinkTap = null,
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
            {renderInlineRich(checkMatch[4] || '\u00A0', `chk-${i}`, { allowHashtags: true, onWikiLinkTap })}
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

  const parsed = renderRichNoteLine(raw, `ln-${i}`, { onWikiLinkTap });
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
