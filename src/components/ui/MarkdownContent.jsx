/**
 * Safe Markdown + KaTeX math renderer.
 * Supports:
 * - Display math ($$...$$) and inline math ($...$) via KaTeX
 * - Headings, blockquotes, unordered/ordered lists, fenced code blocks, horizontal rules
 * - Inline **bold**, *italic*, ~~strike~~, `code`, [links](https://...), #hashtags, [1] citations
 * - Zero raw user HTML injection
 */
import { memo } from 'react';
import 'katex/dist/katex.min.css';
import { renderKatexCached } from '../../lib/katexRender';
import { tokenizeCode, isTableDividerRow, splitTableRow } from '../../lib/codeHighlight';

function renderKatex(expr, displayMode = false) {
  return renderKatexCached(expr, displayMode);
}

function isSafeUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

/**
 * Render inline markdown + inline math ($...$) + hashtags + citations into React nodes.
 */
export function renderInlineRich(
  text,
  keyBase = 'r',
  { sources = null, allowHashtags = false, onTagTap = null, onWikiLinkTap = null } = {}
) {
  const str = String(text || '');
  if (!str) return ['\u00A0'];

  const tokenRe =
    /(\$\$[^$]+\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\s][^*]*\*|\[\[[^[\]]+\]\]|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[\d+\]|#[A-Za-z0-9_-]+)/g;

  const parts = str.split(tokenRe);
  if (parts.length === 1) return [str];

  return parts.map((part, idx) => {
    const key = `${keyBase}-${idx}`;
    if (!part) return null;

    // Display math inline fallback
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      const html = renderKatex(part.slice(2, -2), true);
      if (html) {
        return <span key={key} className="math-block-inline" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      return part;
    }

    // Inline math $...$
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const inner = part.slice(1, -1);
      // Avoid turning prices like "$5 and $10" into math if it's purely digits/space
      if (!/^\d+(\.\d+)?$/.test(inner.trim())) {
        const html = renderKatex(inner, false);
        if (html) {
          return <span key={key} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
        }
      }
      return part;
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key} className="md-code">{part.slice(1, -1)}</code>;
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return <del key={key}>{part.slice(2, -2)}</del>;
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }

    // [[Wiki-Link]] or [[Wiki-Link|Alias]]
    if (part.startsWith('[[') && part.endsWith(']]') && part.length > 4) {
      const inner = part.slice(2, -2);
      const [rawTarget, rawAlias] = inner.split('|');
      const target = (rawTarget || '').trim();
      const label = (rawAlias || rawTarget || '').trim();
      if (target) {
        return (
          <button
            key={key}
            type="button"
            className="wiki-link-pill"
            onClick={e => {
              e.stopPropagation();
              onWikiLinkTap?.(target);
            }}
          >
            {label}
          </button>
        );
      }
    }

    // Safe markdown links [label](https://...)
    const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (linkMatch && isSafeUrl(linkMatch[2])) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
          onClick={e => e.stopPropagation()}
        >
          {linkMatch[1]}
        </a>
      );
    }

    // Clickable web citation [1]
    const citeMatch = /^\[(\d+)\]$/.exec(part);
    if (citeMatch && Array.isArray(sources) && sources.length > 0) {
      const n = parseInt(citeMatch[1], 10);
      const src = sources.find(s => s.index === n) || sources[n - 1];
      if (src && isSafeUrl(src.url)) {
        return (
          <a
            key={key}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="cite-badge"
            title={src.title}
            onClick={e => e.stopPropagation()}
          >
            {n}
          </a>
        );
      }
    }

    // #hashtag pills (in note lines)
    if (allowHashtags && /^#[A-Za-z0-9_-]+$/.test(part)) {
      return (
        <span
          key={key}
          className="hashtag"
          onClick={
            onTagTap
              ? e => {
                  e.stopPropagation();
                  onTagTap(part.slice(1));
                }
              : undefined
          }
        >
          {part}
        </span>
      );
    }

    return part;
  });
}

/**
 * Single-line rich note renderer (used in NoteEditor Read Mode so each line
 * stays individually tappable for AI explanations while rendering markdown & math).
 */
export function renderRichNoteLine(rawLine, keyBase = 'ln', opts = {}) {
  const line = String(rawLine || '');
  if (!line.trim()) return { variant: 'empty', content: '\u00A0' };

  // Display math line $$...$$
  const mathBlock = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
  if (mathBlock) {
    const html = renderKatex(mathBlock[1], true);
    if (html) {
      return {
        variant: 'math',
        content: <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} />,
      };
    }
  }

  // Horizontal rule
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
    return { variant: 'hr', content: <hr className="md-hr" /> };
  }

  // Headings # .. ###
  const hMatch = /^(#{1,3})\s+(.+)$/.exec(line);
  if (hMatch) {
    return {
      variant: `h${hMatch[1].length}`,
      content: renderInlineRich(hMatch[2], keyBase, { allowHashtags: true, ...opts }),
    };
  }

  // Blockquote
  const bqMatch = /^>\s?(.*)$/.exec(line);
  if (bqMatch) {
    return {
      variant: 'quote',
      content: renderInlineRich(bqMatch[1], keyBase, { allowHashtags: true, ...opts }),
    };
  }

  // Bullet list item (- text or * text, excluding checklists)
  const ulMatch = /^(\s*)[-*•]\s+(?!\[[ xX]\])(.+)$/.exec(line);
  if (ulMatch) {
    const indent = Math.min(Math.floor(ulMatch[1].length / 2), 3);
    return {
      variant: 'bullet',
      indent,
      content: renderInlineRich(ulMatch[2], keyBase, { allowHashtags: true, ...opts }),
    };
  }

  // Numbered list item
  const olMatch = /^(\s*)(\d+[.)])\s+(.+)$/.exec(line);
  if (olMatch) {
    const indent = Math.min(Math.floor(olMatch[1].length / 2), 3);
    return {
      variant: 'ordered',
      marker: olMatch[2],
      indent,
      content: renderInlineRich(olMatch[3], keyBase, { allowHashtags: true, ...opts }),
    };
  }

  return {
    variant: 'text',
    content: renderInlineRich(line, keyBase, { allowHashtags: true, ...opts }),
  };
}

/**
 * Full multi-line Markdown + KaTeX component (used in Chat, Summaries, Exam Summary, Study).
 */
const MarkdownContent = memo(function MarkdownContent({ text, sources = null, className = '' }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (with lightweight syntax highlighting)
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim().split(/\s+/)[0] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      const toks = tokenizeCode(code.join('\n'), lang);
      out.push(
        <pre key={k++} className="md-pre">
          <code>
            {toks.map((tk, ti) =>
              tk.type === 'plain' ? (
                tk.text
              ) : (
                <span key={ti} className={`tok-${tk.type}`}>
                  {tk.text}
                </span>
              )
            )}
          </code>
        </pre>
      );
      continue;
    }

    // GFM Markdown Table
    if (line.includes('|') && i + 1 < lines.length && isTableDividerRow(lines[i + 1])) {
      const headers = splitTableRow(line);
      if (headers.length >= 2) {
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        out.push(
          <div key={k++} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi}>{renderInlineRich(h, `th-${k}-${hi}`, { sources })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {headers.map((_, ci) => (
                      <td key={ci}>{renderInlineRich(r[ci] || '', `td-${k}-${ri}-${ci}`, { sources })}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Multi-line display math $$ ... $$
    if (/^\s*\$\$\s*$/.test(line)) {
      const mathLines = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) mathLines.push(lines[i++]);
      i++;
      const html = renderKatex(mathLines.join('\n'), true);
      out.push(
        html ? (
          <div key={k++} className="math-display" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre key={k++} className="md-pre">{mathLines.join('\n')}</pre>
        )
      );
      continue;
    }

    // Single-line display math $$...$$
    const singleMath = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (singleMath) {
      const html = renderKatex(singleMath[1], true);
      out.push(
        html ? (
          <div key={k++} className="math-display" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p key={k++} className="md-p">{line}</p>
        )
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={k++} className="md-hr" />);
      i++;
      continue;
    }

    if (/^#{1,4}\s+/.test(line)) {
      const level = line.match(/^(#{1,4})/)[1].length;
      out.push(
        <div key={k++} className={`md-h md-h${level}`}>
          {renderInlineRich(line.replace(/^#{1,4}\s+/, ''), `h${k}`, { sources })}
        </div>
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i++].replace(/^>\s?/, ''));
      }
      out.push(
        <blockquote key={k++} className="md-quote">
          {quoteLines.map((t, j) => (
            <div key={j}>{renderInlineRich(t, `q${k}${j}`, { sources })}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      }
      out.push(
        <ul key={k++} className="md-list">
          {items.map((t, j) => (
            <li key={j}>{renderInlineRich(t, `u${k}${j}`, { sources })}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      }
      out.push(
        <ol key={k++} className="md-list">
          {items.map((t, j) => (
            <li key={j}>{renderInlineRich(t, `o${k}${j}`, { sources })}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^\s*\$\$/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={k++} className="md-p">
        {para.map((t, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {renderInlineRich(t, `p${k}${j}`, { sources })}
          </span>
        ))}
      </p>
    );
  }

  return <div className={`md-root ${className}`.trim()}>{out}</div>;
});

export default MarkdownContent;
