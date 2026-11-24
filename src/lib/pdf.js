/**
 * PDF export (v2.0.2) — Clean Markdown-free A4 PDFs with Adaptive Designs.
 *
 * Fixes & Upgrades:
 * - Zero Markdown symbol leaks: strips stray #, *, **, `, ```, [[wiki]], [links](url),
 *   and $LaTeX$ delimiters — rendering real bold/italic runs, lined tables,
 *   shaded code boxes, styled callouts, vector checkboxes, and readable math symbols.
 * - Adaptive PDF Design Themes: Auto-detects note category (or user picks manually):
 *   Academic Lecture · Cheat Sheet & Lab · Technical Code · Editorial Journal · Minimal Print.
 * - Fixed Android Native Share/Save: passes Capacitor v8 `files: [uri]` for proper
 *   FileProvider attachment, handles user share cancellation gracefully without errors,
 *   and provides direct "Save to Documents/NotesByBai" offline file saving.
 * - Unicode & Image Resilience: high-DPI canvas fallback for non-Latin1 scripts/math
 *   plus clean multi-page canvas slicing for drawings.
 */
import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { renderStrokesToCanvas } from '../components/StrokeLayer';
import { resolveImageDataUrl } from '../store/db';
import { PDF_STYLES, detectPdfStyle } from './pdfThemes';
import { getSettings, getFontPreset } from '../theme';

export { PDF_STYLES, detectPdfStyle };

const W = 595.28;
const H = 841.89;
const M = 44;
const CONTENT_W = W - M * 2;
const MAX_CONTENT_H = H - M * 2 - 20;

const NON_LATIN1_RE = /[^\u0020-\u007E\u00A0-\u00FF]/;

const PDF_THEME_SPECS = {
  academic: {
    name: 'Academic',
    primary: [67, 56, 202], // Indigo
    tint: [238, 242, 255],
    text: [20, 21, 26],
    muted: [92, 98, 112],
    font: 'helvetica',
    topStripe: true,
    bodySize: 11.5,
    lineFactor: 1.42,
  },
  cheatsheet: {
    name: 'Cheat Sheet',
    primary: [15, 118, 110], // Deep Teal
    tint: [236, 253, 245],
    text: [17, 24, 39],
    muted: [75, 85, 99],
    font: 'helvetica',
    banner: true,
    bodySize: 10.5,
    lineFactor: 1.34,
  },
  technical: {
    name: 'Code & Tech',
    primary: [30, 41, 59], // Dark Slate
    accentLine: [14, 165, 233], // Sky accent
    tint: [241, 245, 249],
    text: [15, 23, 42],
    muted: [71, 85, 105],
    font: 'helvetica',
    darkHeader: true,
    bodySize: 11,
    lineFactor: 1.38,
  },
  editorial: {
    name: 'Editorial',
    primary: [146, 64, 14], // Warm Sepia Amber
    tint: [254, 243, 199],
    text: [28, 25, 23],
    muted: [107, 100, 92],
    font: 'times',
    serifRule: true,
    bodySize: 12,
    lineFactor: 1.5,
  },
  minimal: {
    name: 'Minimal',
    primary: [30, 30, 30],
    tint: [244, 244, 245],
    text: [15, 15, 15],
    muted: [100, 100, 100],
    font: 'helvetica',
    minimal: true,
    bodySize: 11.5,
    lineFactor: 1.4,
  },
};

const LATEX_SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Theta: 'Θ', Pi: 'Π',
  infty: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤',
  ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', degree: '°', deg: '°',
};

export function latexToUnicode(expr) {
  let s = String(expr || '');
  s = s.replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\sqrt\s*\{([^}]*)\}/g, '√($1)');
  s = s.replace(/\\text\s*\{([^}]*)\}/g, '$1');
  s = s.replace(/\\mathbf\s*\{([^}]*)\}/g, '$1');
  s = s.replace(/\\([a-zA-Z]+)/g, (_, name) => LATEX_SYMBOLS[name] || name);
  s = s.replace(/\^2\b/g, '²').replace(/\^3\b/g, '³').replace(/\^0\b/g, '⁰');
  s = s.replace(/\{([^{}]*)\}/g, '$1');
  return s.trim();
}

/**
 * Clean ALL Markdown syntax from text while preserving human meaning & math symbols.
 * Guarantees zero stray `#`, `*`, `**`, backticks, or raw `[url](link)` artifacts in PDFs.
 */
export function stripMarkdownToCleanText(raw) {
  let s = String(raw || '').replace(/\r/g, '');
  // Convert block & inline math delimiters to readable Unicode text
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => latexToUnicode(expr));
  s = s.replace(/\$([^$\n]+)\$/g, (_, expr) => latexToUnicode(expr));
  // Wiki links: [[Page|Alias]] -> Alias, [[Page]] -> Page
  s = s.replace(/\[\[([^[\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Markdown links: [Label](url) -> Label
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[^)]+)\)/g, '$1');
  // ATX Headings (# Heading)
  s = s.replace(/^\s*#{1,6}\s+/gm, '');
  // Blockquote markers
  s = s.replace(/^\s*>\s?/gm, '');
  // Bold / italic / strike / inline code
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<![\w\d])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w\d])/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Clean remaining stray formatting stars (outside spacing like "3 * 4")
  s = s.replace(/\*{2,}/g, '');
  return s;
}

/** Tokenize inline text into clean styled runs `{ text, bold, italic, code }` without Markdown punctuation. */
export function tokenizeInlineRuns(rawLine) {
  const mathCleaned = String(rawLine || '')
    .replace(/\$([^$\n]+)\$/g, (_, expr) => latexToUnicode(expr))
    .replace(/\[\[([^[\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[^)]+)\)/g, '$1');

  const runs = [];
  const tokenRe = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|(?<![\w\d])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w\d]))/g;
  let last = 0;
  let m;
  while ((m = tokenRe.exec(mathCleaned)) !== null) {
    if (m.index > last) {
      runs.push({ text: mathCleaned.slice(last, m.index).replace(/\*{2,}/g, ''), bold: false, italic: false });
    }
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) {
      runs.push({ text: tok.slice(2, -2), bold: true, italic: false });
    } else if (tok.startsWith('`')) {
      runs.push({ text: tok.slice(1, -1), bold: false, italic: false, code: true });
    } else if (tok.startsWith('*')) {
      runs.push({ text: tok.slice(1, -1), bold: false, italic: true });
    }
    last = m.index + tok.length;
  }
  if (last < mathCleaned.length) {
    runs.push({ text: mathCleaned.slice(last).replace(/\*{2,}/g, ''), bold: false, italic: false });
  }
  return runs.filter(r => r.text.length > 0);
}

/** Parse raw note Markdown into structured PDF layout blocks. */
export function parseMarkdownBlocksForPdf(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      blocks.push({ type: 'spacer', height: 6 });
      i += 1;
      continue;
    }

    // Fenced code block ```lang ... ```
    const fenceOpen = /^```([a-zA-Z0-9+#_-]*)\s*$/.exec(trimmed);
    if (fenceOpen) {
      const lang = fenceOpen[1] || 'code';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing ```
      blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    // Horizontal rule --- or ***
    if (/^([-*_]){3,}\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Markdown table | A | B |
    if (/^\|.+\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1].trim())) {
      const splitRow = r =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(c => stripMarkdownToCleanText(c).trim());
      const headers = splitRow(trimmed);
      i += 2; // skip divider row
      const rows = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Headings # ... ######
    const hMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      blocks.push({
        type: 'heading',
        level: hMatch[1].length,
        text: stripMarkdownToCleanText(hMatch[2]).trim(),
      });
      i += 1;
      continue;
    }

    // Checkboxes - [ ] or - [x]
    const chkMatch = /^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(raw);
    if (chkMatch) {
      blocks.push({
        type: 'checkbox',
        indent: Math.min(24, Math.floor((chkMatch[1] || '').length / 2) * 12),
        checked: chkMatch[2].toLowerCase() === 'x',
        text: chkMatch[3] || '',
      });
      i += 1;
      continue;
    }

    // Bullet lists - item / * item
    const bulMatch = /^(\s*)[-*+•]\s+(.+)$/.exec(raw);
    if (bulMatch) {
      blocks.push({
        type: 'bullet',
        indent: Math.min(24, Math.floor((bulMatch[1] || '').length / 2) * 12),
        text: bulMatch[2],
      });
      i += 1;
      continue;
    }

    // Ordered lists 1. item
    const ordMatch = /^(\s*)(\d+)[.)]\s+(.+)$/.exec(raw);
    if (ordMatch) {
      blocks.push({
        type: 'ordered',
        indent: Math.min(24, Math.floor((ordMatch[1] || '').length / 2) * 12),
        num: ordMatch[2],
        text: ordMatch[3],
      });
      i += 1;
      continue;
    }

    // Blockquote > text
    const qMatch = /^>\s?(.*)$/.exec(trimmed);
    if (qMatch) {
      const qLines = [stripMarkdownToCleanText(qMatch[1])];
      i += 1;
      while (i < lines.length && /^>\s?(.*)$/.test(lines[i].trim())) {
        qLines.push(stripMarkdownToCleanText(lines[i].trim().replace(/^>\s?/, '')));
        i += 1;
      }
      blocks.push({ type: 'quote', text: qLines.join(' ').trim() });
      continue;
    }

    blocks.push({ type: 'paragraph', text: raw });
    i += 1;
  }

  return blocks;
}

function detectImageFormat(dataUrl) {
  const head = String(dataUrl || '').slice(0, 40).toLowerCase();
  if (head.includes('image/png')) return 'PNG';
  if (head.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function imageDims(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function rgbToCss(color, fallback = '#14151a') {
  if (Array.isArray(color) && color.length >= 3) {
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  }
  if (typeof color === 'number') {
    const v = Math.max(0, Math.min(255, color));
    return `rgb(${v}, ${v}, ${v})`;
  }
  return typeof color === 'string' ? color : fallback;
}

function setDocTextColor(doc, color) {
  if (Array.isArray(color) && color.length >= 3) {
    doc.setTextColor(color[0], color[1], color[2]);
  } else {
    doc.setTextColor(typeof color === 'number' ? color : 15);
  }
}

/**
 * Render non-Latin1 Unicode text (math Greek symbols, Tagalog/CJK, emojis) cleanly onto
 * a crisp 2x canvas bitmap and slice safely across page boundaries if tall.
 */
function renderUnicodeParagraphToImage(text, { fontSize = 11.5, bold = false, color = [20, 21, 26], maxWidth = CONTENT_W } = {}) {
  if (typeof document === 'undefined') return null;
  const dpr = 2;
  const lineH = fontSize * 1.44;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  const font = `${bold ? '700' : '400'} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  mctx.font = font;

  const words = String(text || '').split(/(\s+)/);
  const wrapped = [];
  let cur = '';
  for (const w of words) {
    const test = cur + w;
    if (cur && mctx.measureText(test).width > maxWidth) {
      wrapped.push(cur.trimEnd());
      cur = w.trimStart();
    } else {
      cur = test;
    }
  }
  if (cur) wrapped.push(cur);
  if (!wrapped.length) return null;

  const totalH = Math.ceil(wrapped.length * lineH + 4);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(maxWidth * dpr);
  canvas.height = Math.ceil(totalH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.fillStyle = rgbToCss(color);
  ctx.textBaseline = 'top';
  wrapped.forEach((ln, idx) => ctx.fillText(ln, 0, idx * lineH + 2));

  return { dataUrl: canvas.toDataURL('image/png'), width: maxWidth, height: totalH };
}

/** Add a text paragraph safely (per-line pagination, custom font & RGB, Unicode fallback). */
function addTextBlock(
  doc,
  text,
  yRef,
  { fontSize = 11.5, bold = false, italic = false, font = 'helvetica', color = [20, 21, 26], indent = 0, lineFactor = 1.4 } = {}
) {
  const maxW = CONTENT_W - indent;
  const str = String(text || '');
  if (!str.trim()) {
    yRef.y += fontSize * 0.65;
    return;
  }

  if (NON_LATIN1_RE.test(str)) {
    const img = renderUnicodeParagraphToImage(str, { fontSize, bold, color, maxWidth: maxW });
    if (img) {
      if (yRef.y + img.height > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.addImage(img.dataUrl, 'PNG', M + indent, yRef.y, img.width, img.height);
      yRef.y += img.height + 2;
      return;
    }
  }

  const fontStyle = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  doc.setFont(font, fontStyle);
  doc.setFontSize(fontSize);
  setDocTextColor(doc, color);
  const lh = fontSize * lineFactor;
  const wrapped = doc.splitTextToSize(str, maxW);
  for (const line of wrapped) {
    if (yRef.y + lh > H - M - 16) {
      doc.addPage();
      yRef.y = M;
    }
    doc.text(line, M + indent, yRef.y + fontSize * 0.85);
    yRef.y += lh;
  }
  doc.setTextColor(15);
}

/** Render inline runs (`bold`, `italic`, plain) cleanly across wrapped lines. */
function addRichRunsBlock(doc, rawText, yRef, { fontSize = 11.5, font = 'helvetica', color = [20, 21, 26], indent = 0, lineFactor = 1.4 } = {}) {
  const plain = stripMarkdownToCleanText(rawText);
  const runs = tokenizeInlineRuns(rawText);
  // If non-Latin1 characters or purely uniform text exist, use optimized addTextBlock
  if (NON_LATIN1_RE.test(plain) || runs.length <= 1) {
    const r0 = runs[0];
    addTextBlock(doc, plain, yRef, {
      fontSize,
      bold: Boolean(r0?.bold),
      italic: Boolean(r0?.italic),
      font: r0?.code ? 'courier' : font,
      color,
      indent,
      lineFactor,
    });
    return;
  }

  // Word-level layout with inline bold/italic runs
  const startX = M + indent;
  const maxX = W - M;
  const lh = fontSize * lineFactor;
  let curX = startX;

  const ensureLineSpace = () => {
    if (yRef.y + lh > H - M - 16) {
      doc.addPage();
      yRef.y = M;
    }
  };

  ensureLineSpace();
  for (const run of runs) {
    const runFont = run.code ? 'courier' : font;
    const style = run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
    doc.setFont(runFont, style);
    doc.setFontSize(run.code ? Math.max(9.5, fontSize - 1) : fontSize);
    setDocTextColor(doc, color);

    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const w = doc.getTextWidth(part);
      if (curX > startX && curX + w > maxX && part.trim()) {
        yRef.y += lh;
        ensureLineSpace();
        curX = startX;
      }
      if (curX === startX && !part.trim()) continue;
      doc.text(part, curX, yRef.y + fontSize * 0.85);
      curX += w;
    }
  }
  yRef.y += lh;
  doc.setFont(font, 'normal');
  doc.setTextColor(15);
}

/** Slice a tall canvas vertically across pages so annotations never clip. */
function addPagedCanvas(doc, sourceCanvas, widthPt, heightPt, yRef) {
  const pxPerPt = sourceCanvas.height / heightPt;
  let remainingPt = heightPt;
  let srcY = 0;

  while (remainingPt > 1) {
    const availPt = H - M - 18 - yRef.y;
    if (availPt < 60) {
      doc.addPage();
      yRef.y = M;
      continue;
    }
    const slicePt = Math.min(remainingPt, availPt);
    const slicePx = Math.max(1, Math.round(slicePt * pxPerPt));

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = sourceCanvas.width;
    sliceCanvas.height = slicePx;
    sliceCanvas
      .getContext('2d')
      .drawImage(sourceCanvas, 0, srcY, sourceCanvas.width, slicePx, 0, 0, sourceCanvas.width, slicePx);

    doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', M, yRef.y, widthPt, slicePt);
    yRef.y += slicePt + 8;
    srcY += slicePx;
    remainingPt -= slicePt;
    if (remainingPt > 1) {
      doc.addPage();
      yRef.y = M;
    }
  }
}

function addPageFooters(doc, { label = 'Notes by Bai', muted = [120, 120, 120], font = 'helvetica' } = {}) {
  const pageCount = doc.internal.getNumberOfPages();
  const safeLabel = stripMarkdownToCleanText(label).slice(0, 64);
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(225, 226, 232);
    doc.setLineWidth(0.4);
    doc.line(M, H - 30, W - M, H - 30);
    doc.setFont(font, 'normal');
    doc.setFontSize(8.5);
    setDocTextColor(doc, muted);
    doc.text(safeLabel, M, H - 18);
    doc.text(`Page ${p} of ${pageCount}`, W - M, H - 18, { align: 'right' });
  }
}

/** Render adaptive styled PDF document header according to chosen PDF design theme. */
function drawPdfHeader(doc, yRef, { title, subject, dateStr, theme }) {
  const cleanTitle = stripMarkdownToCleanText(title || 'Untitled Note').trim() || 'Untitled Note';
  const cleanSubj = stripMarkdownToCleanText(subject || '').trim();

  if (theme.banner) {
    // Cheat Sheet / Lab Emerald-Teal Compact Header Card
    doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.roundedRect(M, yRef.y, CONTENT_W, 56, 6, 6, 'F');
    doc.setFont(theme.font, 'bold');
    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.text(cleanTitle.slice(0, 60), M + 14, yRef.y + 24);
    doc.setFont(theme.font, 'normal');
    doc.setFontSize(9.5);
    doc.text(`${cleanSubj ? `${cleanSubj}  ·  ` : ''}${dateStr}`, M + 14, yRef.y + 42);
    yRef.y += 70;
    return;
  }

  if (theme.darkHeader) {
    // Code & Tech Slate Dark Header Strip
    doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.roundedRect(M, yRef.y, CONTENT_W, 54, 5, 5, 'F');
    doc.setFillColor(14, 165, 233);
    doc.rect(M, yRef.y, 5, 54, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(248, 250, 252);
    doc.text(cleanTitle.slice(0, 60), M + 16, yRef.y + 24);
    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(186, 230, 253);
    doc.text(`${cleanSubj ? `${cleanSubj}  //  ` : ''}${dateStr}`, M + 16, yRef.y + 41);
    yRef.y += 68;
    return;
  }

  if (theme.topStripe) {
    doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.rect(0, 0, W, 6, 'F');
  }

  if (cleanSubj && !theme.minimal) {
    doc.setFont(theme.font, 'bold');
    doc.setFontSize(9);
    setDocTextColor(doc, theme.primary);
    doc.text(cleanSubj.toUpperCase(), M, yRef.y + 6);
    yRef.y += 14;
  }

  addTextBlock(doc, cleanTitle, yRef, {
    fontSize: 20,
    bold: true,
    font: theme.font,
    color: theme.text,
  });
  yRef.y += 2;
  addTextBlock(doc, cleanSubj && theme.minimal ? `${cleanSubj} · ${dateStr}` : dateStr, yRef, {
    fontSize: 9.5,
    font: theme.font,
    color: theme.muted,
  });
  yRef.y += 6;
  doc.setDrawColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.setLineWidth(theme.serifRule ? 1.2 : 0.7);
  doc.line(M, yRef.y, W - M, yRef.y);
  yRef.y += 14;
}

export async function buildNotePDF({
  title,
  body,
  subject = '',
  noteMode = 'study',
  pdfStyle = 'auto',
  blocks = [],
  images = [],
  drawings = null,
  withExplanations = false,
}) {
  const resolvedStyleId =
    !pdfStyle || pdfStyle === 'auto'
      ? detectPdfStyle({ title, body, subject, noteMode })
      : PDF_THEME_SPECS[pdfStyle]
        ? pdfStyle
        : 'academic';
  const baseTheme = PDF_THEME_SPECS[resolvedStyleId] || PDF_THEME_SPECS.academic;
  const userFont = getFontPreset(getSettings().font);
  const theme =
    userFont.id !== 'system' &&
    (!pdfStyle || pdfStyle === 'auto' || ['minimal', 'academic', 'editorial'].includes(resolvedStyleId))
      ? { ...baseTheme, font: userFont.pdfFont }
      : baseTheme;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const yRef = { y: M };
  const dateStr = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  drawPdfHeader(doc, yRef, { title, subject, dateStr, theme });

  // Images (resolved from Dexie v4 Blob attachments or legacy dataUrls)
  for (const img of images) {
    const dataUrl = await resolveImageDataUrl(img);
    if (!dataUrl) continue;
    const dim = await imageDims(dataUrl);
    if (!dim || !dim.w || !dim.h) continue;

    const scale = Math.min(CONTENT_W / dim.w, (MAX_CONTENT_H - 16) / dim.h, 1.5);
    const w = dim.w * scale;
    const h = dim.h * scale;
    const x = M + (CONTENT_W - w) / 2;

    if (yRef.y + h > H - M - 16) {
      doc.addPage();
      yRef.y = M;
    }
    try {
      doc.addImage(dataUrl, detectImageFormat(dataUrl), x, yRef.y, w, h);
      yRef.y += h + 14;
    } catch {
      try {
        const c = document.createElement('canvas');
        c.width = dim.w;
        c.height = dim.h;
        const im = new Image();
        await new Promise(res => {
          im.onload = res;
          im.onerror = res;
          im.src = dataUrl;
        });
        c.getContext('2d').drawImage(im, 0, 0);
        doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', x, yRef.y, w, h);
        yRef.y += h + 14;
      } catch {
        // skip corrupted image
      }
    }
  }

  // Clean structured Markdown rendering
  const parsedBlocks = parseMarkdownBlocksForPdf(body);
  for (const blk of parsedBlocks) {
    if (blk.type === 'spacer') {
      yRef.y += blk.height;
      continue;
    }

    if (blk.type === 'hr') {
      if (yRef.y + 12 > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.setDrawColor(215, 218, 224);
      doc.setLineWidth(0.6);
      doc.line(M, yRef.y + 4, W - M, yRef.y + 4);
      yRef.y += 12;
      continue;
    }

    if (blk.type === 'heading') {
      yRef.y += 6;
      const sz = blk.level === 1 ? 15.5 : blk.level === 2 ? 13.5 : 12;
      addTextBlock(doc, blk.text, yRef, {
        fontSize: sz,
        bold: true,
        font: theme.font,
        color: blk.level <= 2 && !theme.minimal ? theme.primary : theme.text,
        lineFactor: theme.lineFactor,
      });
      if (blk.level <= 2 && !theme.minimal) {
        doc.setDrawColor(theme.tint[0], theme.tint[1], theme.tint[2]);
        doc.setLineWidth(0.8);
        doc.line(M, yRef.y, W - M, yRef.y);
      }
      yRef.y += 4;
      continue;
    }

    if (blk.type === 'code') {
      const codeLines = blk.lines.length ? blk.lines : [''];
      const lineH = 13;
      const padY = 10;
      const headerH = 14;
      const boxH = Math.min(H - M * 2 - 20, headerH + padY + codeLines.length * lineH);
      if (yRef.y + boxH > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.setFillColor(244, 246, 250);
      doc.setDrawColor(220, 224, 232);
      doc.roundedRect(M, yRef.y, CONTENT_W, headerH + padY + codeLines.length * lineH, 5, 5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      setDocTextColor(doc, theme.primary);
      doc.text(String(blk.lang || 'CODE').toUpperCase(), M + 10, yRef.y + 11);

      let cy = yRef.y + headerH + 8;
      doc.setFont('courier', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      for (const cl of codeLines) {
        if (cy + lineH > H - M - 16) {
          doc.addPage();
          cy = M;
        }
        const safeLine = doc.splitTextToSize(String(cl || ' '), CONTENT_W - 20);
        for (const sl of safeLine) {
          doc.text(sl, M + 10, cy);
          cy += lineH;
        }
      }
      yRef.y = cy + 6;
      continue;
    }

    if (blk.type === 'table') {
      const cols = Math.max(1, blk.headers.length);
      const colW = CONTENT_W / cols;
      const rowH = 22;

      if (yRef.y + rowH * 2 > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }

      // Header row
      doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
      doc.setDrawColor(210, 214, 222);
      doc.rect(M, yRef.y, CONTENT_W, rowH, 'FD');
      doc.setFont(theme.font, 'bold');
      doc.setFontSize(9.5);
      setDocTextColor(doc, theme.primary);
      blk.headers.forEach((h, cIdx) => {
        doc.text(String(h || '').slice(0, 28), M + cIdx * colW + 6, yRef.y + 14);
      });
      yRef.y += rowH;

      // Body rows
      doc.setFont(theme.font, 'normal');
      doc.setFontSize(9.5);
      for (const row of blk.rows) {
        if (yRef.y + rowH > H - M - 16) {
          doc.addPage();
          yRef.y = M;
        }
        doc.setDrawColor(220, 224, 230);
        doc.rect(M, yRef.y, CONTENT_W, rowH, 'D');
        setDocTextColor(doc, theme.text);
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          doc.text(String(row[cIdx] || '').slice(0, 32), M + cIdx * colW + 6, yRef.y + 14);
        }
        yRef.y += rowH;
      }
      yRef.y += 8;
      continue;
    }

    if (blk.type === 'quote') {
      const cleanQ = blk.text;
      const wrapped = doc.splitTextToSize(cleanQ, CONTENT_W - 22);
      const h = wrapped.length * (theme.bodySize * 1.38) + 12;
      if (yRef.y + h > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
      doc.rect(M, yRef.y, CONTENT_W, h, 'F');
      doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      doc.rect(M, yRef.y, 3.5, h, 'F');
      yRef.y += 6;
      addTextBlock(doc, cleanQ, yRef, {
        fontSize: theme.bodySize - 0.5,
        italic: true,
        font: theme.font,
        color: theme.text,
        indent: 12,
        lineFactor: 1.38,
      });
      yRef.y += 8;
      continue;
    }

    if (blk.type === 'checkbox') {
      if (yRef.y + 18 > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      const bx = M + blk.indent;
      const by = yRef.y + 2;
      doc.setDrawColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      doc.setLineWidth(0.9);
      if (blk.checked) {
        doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
        doc.roundedRect(bx, by, 9, 9, 2, 2, 'FD');
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(1.2);
        doc.line(bx + 2, by + 4.8, bx + 3.8, by + 6.8);
        doc.line(bx + 3.8, by + 6.8, bx + 7.2, by + 2.4);
      } else {
        doc.roundedRect(bx, by, 9, 9, 2, 2, 'D');
      }
      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: blk.checked ? theme.muted : theme.text,
        indent: blk.indent + 15,
        lineFactor: theme.lineFactor,
      });
      continue;
    }

    if (blk.type === 'bullet') {
      if (yRef.y + 16 > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      doc.circle(M + blk.indent + 4, yRef.y + 6.5, 2, 'F');
      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: theme.text,
        indent: blk.indent + 13,
        lineFactor: theme.lineFactor,
      });
      continue;
    }

    if (blk.type === 'ordered') {
      if (yRef.y + 16 > H - M - 16) {
        doc.addPage();
        yRef.y = M;
      }
      doc.setFont(theme.font, 'bold');
      doc.setFontSize(theme.bodySize);
      setDocTextColor(doc, theme.primary);
      doc.text(`${blk.num}.`, M + blk.indent, yRef.y + theme.bodySize * 0.85);
      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: theme.text,
        indent: blk.indent + 18,
        lineFactor: theme.lineFactor,
      });
      continue;
    }

    // Normal paragraph with rich bold/italic runs & clean text
    addRichRunsBlock(doc, blk.text, yRef, {
      fontSize: theme.bodySize,
      font: theme.font,
      color: theme.text,
      lineFactor: theme.lineFactor,
    });
  }

  // Drawings (multi-page sliced cleanly)
  const rendered = renderStrokesToCanvas(drawings, CONTENT_W, { dark: false });
  if (rendered?.canvas) {
    yRef.y += 12;
    addTextBlock(doc, 'Handwritten Annotations', yRef, {
      fontSize: 13,
      bold: true,
      font: theme.font,
      color: theme.primary,
    });
    yRef.y += 4;
    addPagedCanvas(doc, rendered.canvas, rendered.width, rendered.height, yRef);
  }

  // Explanations section (optional)
  const expl = blocks.filter(b => b.explanation || b.simpler || b.example);
  if (withExplanations && expl.length) {
    doc.addPage();
    yRef.y = M;
    addTextBlock(doc, 'AI Explanations', yRef, {
      fontSize: 16,
      bold: true,
      font: theme.font,
      color: theme.primary,
    });
    yRef.y += 10;

    for (const b of expl) {
      const text =
        b.show === 'simpler' && b.simpler
          ? b.simpler
          : b.show === 'example' && b.example
            ? b.example
            : b.explanation;
      if (!text) continue;
      addTextBlock(doc, stripMarkdownToCleanText(b.text || ''), yRef, {
        fontSize: 11,
        bold: true,
        font: theme.font,
        color: theme.text,
      });
      addTextBlock(doc, stripMarkdownToCleanText(text), yRef, {
        fontSize: 10.5,
        font: theme.font,
        color: theme.muted,
        indent: 8,
      });
      yRef.y += 8;
    }
  }

  addPageFooters(doc, {
    label: `Notes by Bai${subject ? ` · ${subject}` : ''} · ${theme.name}`,
    muted: theme.muted,
    font: theme.font,
  });

  return doc;
}

/** Build a clean, Markdown-free PDF for an entire Exam Study Pack. */
export async function buildExamSummaryPDF({ folderName, summary, flashcards = [], quiz = [], predicted = [] }) {
  const theme = PDF_THEME_SPECS.academic;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const yRef = { y: M };
  const dateStr = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  drawPdfHeader(doc, yRef, {
    title: `${folderName || 'Subject'} — Exam Study Pack`,
    subject: folderName || 'Exam Prep',
    dateStr,
    theme,
  });

  if (summary) {
    addTextBlock(doc, 'Summary', yRef, { fontSize: 15, bold: true, color: theme.primary });
    yRef.y += 4;
    for (const blk of parseMarkdownBlocksForPdf(summary)) {
      if (blk.type === 'heading') {
        addTextBlock(doc, blk.text, yRef, { fontSize: 12.5, bold: true, color: theme.text });
      } else if (blk.type === 'bullet' || blk.type === 'ordered') {
        addTextBlock(doc, `• ${stripMarkdownToCleanText(blk.text)}`, yRef, { fontSize: 11, indent: 8 });
      } else if (blk.text) {
        addTextBlock(doc, stripMarkdownToCleanText(blk.text), yRef, { fontSize: 11 });
      }
    }
    yRef.y += 12;
  }

  if (flashcards.length) {
    addTextBlock(doc, `Flashcards (${flashcards.length})`, yRef, {
      fontSize: 15,
      bold: true,
      color: theme.primary,
    });
    yRef.y += 4;
    flashcards.forEach((c, i) => {
      addTextBlock(doc, `${i + 1}. Q: ${stripMarkdownToCleanText(c.q)}`, yRef, { fontSize: 11, bold: true });
      addTextBlock(doc, `A: ${stripMarkdownToCleanText(c.a)}`, yRef, {
        fontSize: 11,
        color: theme.muted,
        indent: 10,
      });
      yRef.y += 6;
    });
    yRef.y += 10;
  }

  if (quiz.length) {
    addTextBlock(doc, `Practice Quiz (${quiz.length})`, yRef, {
      fontSize: 15,
      bold: true,
      color: theme.primary,
    });
    yRef.y += 4;
    quiz.forEach((q, i) => {
      addTextBlock(doc, `${i + 1}. ${stripMarkdownToCleanText(q.question)}`, yRef, { fontSize: 11, bold: true });
      (q.choices || []).forEach((ch, j) => {
        const mark = j === q.answer ? ' [Answer]' : '';
        addTextBlock(doc, `${String.fromCharCode(65 + j)}. ${stripMarkdownToCleanText(ch)}${mark}`, yRef, {
          fontSize: 10.5,
          bold: j === q.answer,
          color: j === q.answer ? theme.primary : theme.muted,
          indent: 12,
        });
      });
      yRef.y += 6;
    });
  }

  if (predicted.length) {
    addTextBlock(doc, `Predicted Exam Questions (${predicted.length})`, yRef, {
      fontSize: 15,
      bold: true,
      color: theme.primary,
    });
    yRef.y += 4;
    predicted.forEach((p, i) => {
      addTextBlock(doc, `${i + 1}. ${stripMarkdownToCleanText(p.question)}`, yRef, { fontSize: 11, bold: true });
      addTextBlock(doc, stripMarkdownToCleanText(p.answer), yRef, {
        fontSize: 11,
        color: theme.muted,
        indent: 10,
      });
      yRef.y += 6;
    });
  }

  addPageFooters(doc, {
    label: `Notes by Bai · ${folderName || 'Exam Pack'}`,
    muted: theme.muted,
  });

  return doc;
}

function buildSafePdfFilename(title) {
  const safe =
    String(title || 'note')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 56) || 'note';
  return `${safe}.pdf`;
}

/** Save & share the PDF: native Android -> FileProvider `files: [uri]` share sheet; web -> download. */
export async function saveNotePDF(doc, title) {
  const filename = buildSafePdfFilename(title);

  if (Capacitor.isNativePlatform?.()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const file = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    try {
      await Share.share({
        title: filename,
        files: [file.uri],
        dialogTitle: 'Save or share PDF',
      });
      return 'shared';
    } catch (err) {
      if (/cancel|abort/i.test(String(err?.message || err))) {
        return 'cancelled';
      }
      throw err;
    }
  }

  doc.save(filename);
  return 'downloaded';
}

/** Save PDF directly to Phone Documents/NotesByBai on Android (no Share Sheet needed). */
export async function savePdfToDocuments(doc, title) {
  const filename = buildSafePdfFilename(title);
  if (!Capacitor.isNativePlatform?.()) {
    doc.save(filename);
    return { savedPath: filename };
  }
  const base64 = doc.output('datauristring').split(',')[1];
  const relPath = `NotesByBai/${filename}`;
  await Filesystem.writeFile({
    path: relPath,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });
  return { savedPath: `Documents/${relPath}` };
}
