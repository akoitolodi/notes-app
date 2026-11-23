/**
 * Bidirectional Markdown <-> Clean Visual HTML codec for Notes by Bai's Clean Edit Mode.
 *
 * Lets users edit templates and formatted notes cleanly (no raw ##, **, - [ ], ```,
 * or |---| symbols cluttering the screen) while preserving 100% canonical Markdown
 * underneath for Read Mode, AI line explanations, Wiki-Links, Checklists, Tables,
 * Code Cards, Exam Paper Builder, and PDF export.
 */
import katex from 'katex';
import { isTableDividerRow, splitTableRow } from './codeHighlight.js';

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMathHtml(tex, displayMode = false) {
  try {
    return katex.renderToString(String(tex || '').trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return escapeHtml(tex);
  }
}

/** Convert inline Markdown (**bold**, *italic*, ~~strike~~, `code`, $math$, [[wiki]]) to clean HTML. */
export function inlineMarkdownToHtml(text) {
  const str = String(text || '');
  if (!str) return '';

  const tokenRe =
    /(\$\$[^$]+\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\s][^*]*\*|\[\[[^[\]]+\]\])/g;

  const parts = str.split(tokenRe);
  return parts
    .map(part => {
      if (!part) return '';
      if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
        const tex = part.slice(2, -2).trim();
        return `<span class="ce-math ce-math-display" contenteditable="false" data-tex="${escapeHtml(tex)}" data-display="1" title="Tap to edit equation">${renderMathHtml(tex, true)}</span>`;
      }
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
        const tex = part.slice(1, -1).trim();
        if (!/^\d+(\.\d+)?$/.test(tex)) {
          return `<span class="ce-math" contenteditable="false" data-tex="${escapeHtml(tex)}" data-display="0" title="Tap to edit equation">${renderMathHtml(tex, false)}</span>`;
        }
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return `<code class="ce-code">${escapeHtml(part.slice(1, -1))}</code>`;
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      }
      if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
        return `<del>${escapeHtml(part.slice(2, -2))}</del>`;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return `<em>${escapeHtml(part.slice(1, -1))}</em>`;
      }
      if (part.startsWith('[[') && part.endsWith(']]') && part.length > 4) {
        const inner = part.slice(2, -2);
        return `<span class="ce-wikilink" data-wiki="${escapeHtml(inner)}">${escapeHtml(inner.split('|').pop().trim())}</span>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

/** Convert canonical Markdown note body into clean visual HTML (zero visible ## or ** syntax). */
export function markdownToCleanHtml(markdown) {
  const raw = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return '';

  const lines = raw.split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html.push(
        `<pre class="ce-pre" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
      );
      continue;
    }

    // 2. Display math block (single-line $$...$$ or multi-line $$)
    const singleDisplay = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (singleDisplay) {
      const tex = singleDisplay[1].trim();
      html.push(
        `<div class="ce-math-block" contenteditable="false" data-tex="${escapeHtml(tex)}" data-display="1" title="Tap to edit equation">${renderMathHtml(tex, true)}</div>`
      );
      i += 1;
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      const mLines = [];
      i += 1;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) {
        mLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const tex = mLines.join('\n').trim();
      html.push(
        `<div class="ce-math-block" contenteditable="false" data-tex="${escapeHtml(tex)}" data-display="1" title="Tap to edit equation">${renderMathHtml(tex, true)}</div>`
      );
      continue;
    }

    // 3. GFM Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableDividerRow(lines[i + 1])) {
      const headers = splitTableRow(line);
      if (headers.length >= 2) {
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        const thead = `<thead><tr>${headers.map(h => `<th>${inlineMarkdownToHtml(h)}</th>`).join('')}</tr></thead>`;
        const tbody = `<tbody>${rows
          .map(
            r =>
              `<tr>${headers
                .map((_, ci) => `<td>${inlineMarkdownToHtml(r[ci] || '')}</td>`)
                .join('')}</tr>`
          )
          .join('')}</tbody>`;
        html.push(`<table class="ce-table">${thead}${tbody}</table>`);
        continue;
      }
    }

    // 4. Blank line
    if (!trimmed) {
      html.push('<p class="ce-p"><br></p>');
      i += 1;
      continue;
    }

    // 5. Headings (# .. ###)
    const hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hMatch) {
      const lvl = hMatch[1].length;
      html.push(`<h${lvl} class="ce-h ce-h${lvl}">${inlineMarkdownToHtml(hMatch[2]) || '<br>'}</h${lvl}>`);
      i += 1;
      continue;
    }

    // 6. Checklist item (- [ ] or - [x])
    const chkMatch = /^\s*-\s+\[( |x|X)\]\s*(.*)$/.exec(line);
    if (chkMatch) {
      const isChecked = chkMatch[1].toLowerCase() === 'x';
      html.push(
        `<div class="ce-check" data-checked="${isChecked ? '1' : '0'}"><span class="ce-check-box" contenteditable="false">${isChecked ? '✓' : ''}</span><span class="ce-check-text">${inlineMarkdownToHtml(chkMatch[2]) || '<br>'}</span></div>`
      );
      i += 1;
      continue;
    }

    // 7. Blockquote
    if (/^>\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote class="ce-quote">${qLines.map(inlineMarkdownToHtml).join('<br>')}</blockquote>`);
      continue;
    }

    // 8. Unordered bullet list (- or *)
    if (/^\s*[-*•]\s+(?!\[[ xX]\])/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+(?!\[[ xX]\])/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*•]\s+/, '');
        items.push(`<li>${inlineMarkdownToHtml(content) || '<br>'}</li>`);
        i += 1;
      }
      html.push(`<ul class="ce-ul">${items.join('')}</ul>`);
      continue;
    }

    // 9. Ordered list (1. )
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        items.push(`<li>${inlineMarkdownToHtml(content) || '<br>'}</li>`);
        i += 1;
      }
      html.push(`<ol class="ce-ol">${items.join('')}</ol>`);
      continue;
    }

    // 10. Horizontal rule
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      html.push('<hr class="ce-hr">');
      i += 1;
      continue;
    }

    // 11. Normal paragraph line
    html.push(`<p class="ce-p">${inlineMarkdownToHtml(line)}</p>`);
    i += 1;
  }

  return html.join('');
}

/** Serialize inline DOM nodes back to canonical Markdown. */
function serializeInlineNodes(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    return (node.nodeValue || '').replace(/\u00A0/g, ' ');
  }
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '';

  if (node.dataset?.tex !== undefined) {
    const tex = node.dataset.tex || '';
    return node.dataset.display === '1' ? `$$${tex}$$` : `$${tex}$`;
  }
  if (node.dataset?.wiki !== undefined) {
    return `[[${node.dataset.wiki}]]`;
  }

  const inner = Array.from(node.childNodes).map(serializeInlineNodes).join('');

  if (tag === 'strong' || tag === 'b') {
    const t = inner.trim();
    return t ? `**${t}**${inner.endsWith(' ') ? ' ' : ''}` : inner;
  }
  if (tag === 'em' || tag === 'i') {
    const t = inner.trim();
    return t ? `*${t}*${inner.endsWith(' ') ? ' ' : ''}` : inner;
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    const t = inner.trim();
    return t ? `~~${t}~~` : inner;
  }
  if (tag === 'code') {
    const t = inner.replace(/`/g, '');
    return t ? `\`${t}\`` : '';
  }
  return inner;
}

/**
 * Convert the contentEditable DOM tree cleanly back into canonical Markdown.
 * Preserves headings, bold, italic, checklists, bullets, numbered lists,
 * fenced code blocks, GFM tables, [[Wiki-Links]], and $LaTeX$ equations.
 */
export function cleanHtmlToMarkdown(rootEl) {
  if (!rootEl) return '';
  const blocks = [];

  const pushNode = node => {
    if (!node) return;
    if (node.nodeType === 3) {
      const txt = (node.nodeValue || '').replace(/\u00A0/g, ' ');
      if (txt.trim()) blocks.push(txt.trimEnd());
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName.toLowerCase();

    // Display math block
    if (node.classList?.contains('ce-math-block') || (tag === 'div' && node.dataset?.tex !== undefined)) {
      blocks.push(`$$${node.dataset.tex || ''}$$`);
      return;
    }

    // Checklist item
    if (node.classList?.contains('ce-check')) {
      const isChecked = node.dataset.checked === '1';
      const textEl = node.querySelector?.('.ce-check-text') || node;
      const content = Array.from(textEl.childNodes)
        .filter(ch => !(ch.nodeType === 1 && ch.classList?.contains('ce-check-box')))
        .map(serializeInlineNodes)
        .join('')
        .replace(/\n+/g, ' ')
        .trim();
      blocks.push(`- [${isChecked ? 'x' : ' '}] ${content}`);
      return;
    }

    // Headings
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const hashes = '#'.repeat(Number(tag[1]));
      const text = Array.from(node.childNodes).map(serializeInlineNodes).join('').trim();
      if (text) blocks.push(`${hashes} ${text}`);
      else blocks.push('');
      return;
    }

    // Fenced code block
    if (tag === 'pre') {
      const lang = node.dataset?.lang || '';
      const rawCode = (node.textContent || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
      blocks.push(`\`\`\`${lang}\n${rawCode}\n\`\`\``);
      return;
    }

    // Table -> GFM Markdown table
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
        Array.from(tr.children).map(cell =>
          Array.from(cell.childNodes)
            .map(serializeInlineNodes)
            .join('')
            .replace(/\|/g, '\\|')
            .replace(/\n+/g, ' ')
            .trim()
        )
      );
      if (rows.length > 0) {
        const cols = Math.max(...rows.map(r => r.length), 1);
        const padRow = r => Array.from({ length: cols }, (_, ci) => r[ci] || '');
        const head = padRow(rows[0]);
        const div = Array.from({ length: cols }, () => '---');
        const bodyRows = rows.slice(1).map(padRow);
        const lines = [
          `| ${head.join(' | ')} |`,
          `| ${div.join(' | ')} |`,
          ...bodyRows.map(r => `| ${r.join(' | ')} |`),
        ];
        blocks.push(lines.join('\n'));
      }
      return;
    }

    // Unordered list
    if (tag === 'ul') {
      const items = Array.from(node.children)
        .filter(el => el.tagName?.toLowerCase() === 'li')
        .map(li => {
          const text = Array.from(li.childNodes).map(serializeInlineNodes).join('').trim();
          return `- ${text}`;
        });
      if (items.length > 0) blocks.push(items.join('\n'));
      return;
    }

    // Ordered list
    if (tag === 'ol') {
      const items = Array.from(node.children)
        .filter(el => el.tagName?.toLowerCase() === 'li')
        .map((li, idx) => {
          const text = Array.from(li.childNodes).map(serializeInlineNodes).join('').trim();
          return `${idx + 1}. ${text}`;
        });
      if (items.length > 0) blocks.push(items.join('\n'));
      return;
    }

    // Blockquote
    if (tag === 'blockquote') {
      const text = Array.from(node.childNodes)
        .map(ch => (ch.nodeType === 1 && ch.tagName.toLowerCase() === 'br' ? '\n' : serializeInlineNodes(ch)))
        .join('')
        .trim();
      blocks.push(
        text
          .split('\n')
          .map(l => `> ${l}`)
          .join('\n')
      );
      return;
    }

    if (tag === 'hr') {
      blocks.push('---');
      return;
    }

    // Paragraph / generic div
    if (tag === 'p' || tag === 'div') {
      // Check if browser nested block elements inside a div
      const hasBlockChild = Array.from(node.children || []).some(ch =>
        ['p', 'div', 'h1', 'h2', 'h3', 'ul', 'ol', 'pre', 'table', 'blockquote'].includes(
          ch.tagName.toLowerCase()
        )
      );
      if (hasBlockChild) {
        Array.from(node.childNodes).forEach(pushNode);
        return;
      }
      const text = Array.from(node.childNodes).map(serializeInlineNodes).join('').replace(/\n+/g, ' ');
      blocks.push(text.trimEnd());
      return;
    }

    // Fallback inline tag directly under root
    blocks.push(serializeInlineNodes(node).trimEnd());
  };

  Array.from(rootEl.childNodes).forEach(pushNode);

  // Trim trailing empty blank lines created solely by a trailing <br>
  while (blocks.length > 1 && blocks[blocks.length - 1] === '' && blocks[blocks.length - 2] === '') {
    blocks.pop();
  }
  const joined = blocks.join('\n');
  return joined === '\n' ? '' : joined;
}
