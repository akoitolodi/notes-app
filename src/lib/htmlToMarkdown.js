/**
 * htmlToMarkdown — Pure-JS offline converter for pasting Canvas Module Pages,
 * Google Docs excerpts, or web handouts into clean study Markdown.
 *
 * Preserves headings, bold/italic, code blocks, bullet/numbered lists,
 * HTML tables, and clickable links — zero external dependencies & works in Node/Vitest too.
 */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) && c > 0 ? String.fromCharCode(c) : '';
    })
    .replace(/&amp;/gi, '&');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function convertTableToMarkdown(tableHtml) {
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(cm[1]).replace(/\|/g, '\\|'));
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map(r => r.length));
  const pad = r => Array.from({ length: colCount }, (_, i) => r[i] || '');
  const head = pad(rows[0]);
  const sep = Array.from({ length: colCount }, () => '---');
  const body = rows.slice(1).map(pad);
  return [
    `| ${head.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map(r => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/**
 * Convert raw HTML (e.g. from Canvas Module Page clipboard `text/html`) into crisp Markdown.
 * If the input has no HTML tags, normalizes & returns plain text cleanly.
 */
export function htmlToCleanMarkdown(rawHtml = '', plainFallback = '') {
  const src = String(rawHtml || '').trim();
  if (!src || !/<[a-z][\s\S]*>/i.test(src)) {
    return String(plainFallback || src || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  let md = src
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Preformatted code blocks
  md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });

  // HTML Tables
  md = md.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const tbl = convertTableToMarkdown(inner);
    return tbl ? `\n\n${tbl}\n\n` : '';
  });

  // Headings
  md = md.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
    const hashes = '#'.repeat(Math.min(4, Math.max(1, Number(lvl))));
    const txt = stripTags(inner);
    return txt ? `\n\n${hashes} ${txt}\n\n` : '';
  });

  // Clickable http(s) links
  md = md.replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const label = stripTags(inner);
    return label ? `[${label}](${href.trim()})` : href.trim();
  });

  // Inline code, bold, italic
  md = md
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${stripTags(inner)}\``)
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, inner) => {
      const t = stripTags(inner);
      return t ? `**${t}**` : '';
    })
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, inner) => {
      const t = stripTags(inner);
      return t ? `*${t}*` : '';
    });

  // Blockquotes & lists
  md = md
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
      const t = stripTags(inner);
      return t ? `\n> ${t}\n` : '';
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
      const t = decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
      return t ? `\n- ${t}` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|ul|ol|header|footer)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(md)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
