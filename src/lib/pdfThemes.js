/**
 * pdfThemes — Lightweight metadata, visual preview descriptors & clean print block parser
 * for adaptive PDF & Print layouts.
 * Kept 100% separate from jsPDF so PDF generation remains strictly lazy-loaded.
 */

export const PDF_STYLES = [
  {
    id: 'auto',
    label: 'Auto',
    tagline: 'Smart match',
    preview: { paper: '#ffffff', header: '#4f46e5', accent: '#6366f1', cols: 1, font: 'sans', darkCode: false, auto: true },
  },
  {
    id: 'academic',
    label: 'Academic',
    tagline: 'Handout',
    preview: { paper: '#ffffff', header: '#1e3a8a', accent: '#1e3a8a', cols: 1, font: 'sans', darkCode: false },
  },
  {
    id: 'cheatsheet',
    label: 'Cheat Sheet',
    tagline: '2-Col Grid',
    preview: { paper: '#ffffff', header: '#0f766e', accent: '#0f766e', cols: 2, font: 'sans', darkCode: false },
  },
  {
    id: 'technical',
    label: 'Code & Tech',
    tagline: 'Dark Code',
    preview: { paper: '#ffffff', header: '#0f172a', accent: '#06b6d4', cols: 1, font: 'mono', darkCode: true },
  },
  {
    id: 'editorial',
    label: 'Editorial',
    tagline: 'Cream Serif',
    preview: { paper: '#fcfbf7', header: '#881337', accent: '#881337', cols: 1, font: 'serif', darkCode: false },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    tagline: 'B&W Print',
    preview: { paper: '#ffffff', header: '#111111', accent: '#111111', cols: 1, font: 'sans', darkCode: false, minimal: true },
  },
];

/** Automatically choose the best PDF layout from the note's content, subject & mode. */
export function detectPdfStyle({ title = '', body = '', noteMode = 'study' } = {}) {
  const t = String(title || '').toLowerCase();
  const b = String(body || '');
  const m = String(noteMode || 'study').toLowerCase();

  if (
    m === 'code' ||
    /```[\s\S]+?```/.test(b) ||
    /\b(?:console\.log|function\s+\w+|#include\s*<|public\s+class\s+|SELECT\s+.+\s+FROM)\b/.test(b)
  ) {
    return 'technical';
  }
  if (
    m === 'journal' ||
    /\b(?:journal|reflection|diary|thoughts|on my mind|highlight)\b/i.test(t)
  ) {
    return 'editorial';
  }
  if (
    /\b(?:cheat\s*sheet|formula|lab|exam|review|study\s*guide|quiz)\b/i.test(t) ||
    /\$[^$\n]+\$/.test(b) ||
    /^\|.+\|\s*$/m.test(b)
  ) {
    return 'cheatsheet';
  }
  return 'academic';
}

/** Lightweight structured Markdown block parser for `Print / system PDF` parity (zero dependencies). */
export function parseNoteBlocksForPrint(body = '') {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const cleanInline = s =>
    String(s || '')
      .replace(/\[\[([^[\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[^)]+)\)/g, '$1');

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const fence = /^```([a-zA-Z0-9+#_-]*)\s*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1] || 'code';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }
    if (/^([-*_]){3,}\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    const hm = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1].length, text: cleanInline(hm[2]) });
      i += 1;
      continue;
    }
    const chkm = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(trimmed);
    if (chkm) {
      blocks.push({ type: 'checkbox', checked: chkm[1].toLowerCase() === 'x', text: cleanInline(chkm[2]) });
      i += 1;
      continue;
    }
    const bm = /^[-*+•]\s+(.+)$/.exec(trimmed);
    if (bm) {
      blocks.push({ type: 'bullet', text: cleanInline(bm[1]) });
      i += 1;
      continue;
    }
    const om = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (om) {
      blocks.push({ type: 'ordered', num: om[1], text: cleanInline(om[2]) });
      i += 1;
      continue;
    }
    const qm = /^>\s?(.*)$/.exec(trimmed);
    if (qm) {
      blocks.push({ type: 'quote', text: cleanInline(qm[1]) });
      i += 1;
      continue;
    }
    blocks.push({ type: 'paragraph', text: cleanInline(raw) });
    i += 1;
  }
  return blocks;
}
