/**
 * PDF export (v2.6.0) — 5 Genuinely Distinct Markdown-Free A4 PDF Designs.
 *
 * Themes:
 * 1. Academic    — Institutional handout (navy header rule, course pill, left-accent headings, shaded callouts)
 * 2. Cheat Sheet — True 2-column condensed study grid with compact margins & boxed section pills
 * 3. Code & Tech — Dark slate header banner, monospace `//` headings & dark #111827 code blocks
 * 4. Editorial   — Warm ivory paper (#FCFBF7) on every page, locked Times serif & classic pull-quotes
 * 5. Minimal     — Pure B&W Swiss ink-saver (zero background fills, crisp hairline rules)
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
    id: 'academic',
    name: 'Academic',
    primary: [30, 58, 138], // Institutional Navy
    tint: [239, 246, 255],
    text: [20, 21, 26],
    muted: [92, 98, 112],
    font: 'helvetica',
    topStripe: true,
    bodySize: 11,
    lineFactor: 1.42,
    margin: 44,
    codeBg: [244, 246, 250],
    codeBorder: [218, 224, 234],
    codeText: [30, 41, 59],
  },
  cheatsheet: {
    id: 'cheatsheet',
    name: 'Cheat Sheet',
    primary: [15, 118, 110], // Deep Teal + Indigo accent
    accentAlt: [79, 70, 229],
    tint: [236, 253, 245],
    text: [17, 24, 39],
    muted: [75, 85, 99],
    font: 'helvetica',
    banner: true,
    twoColumn: true,
    bodySize: 8.5,
    lineFactor: 1.32,
    margin: 24,
    codeBg: [238, 242, 255],
    codeBorder: [199, 210, 254],
    codeText: [30, 41, 59],
  },
  technical: {
    id: 'technical',
    name: 'Code & Tech',
    primary: [15, 23, 42], // Slate 900
    accentLine: [6, 182, 212], // Cyan 500
    tint: [241, 245, 249],
    text: [15, 23, 42],
    muted: [71, 85, 105],
    font: 'helvetica',
    headingFont: 'courier',
    darkHeader: true,
    darkCode: true,
    bodySize: 10.5,
    lineFactor: 1.38,
    margin: 42,
    codeBg: [17, 24, 39],
    codeBorder: [6, 182, 212],
    codeText: [226, 232, 240],
  },
  editorial: {
    id: 'editorial',
    name: 'Editorial',
    primary: [136, 19, 55], // Burgundy Rose
    tint: [245, 239, 230], // Soft parchment highlight
    paperBg: [252, 251, 247], // Warm Ivory Cream page canvas
    text: [32, 28, 24],
    muted: [110, 100, 92],
    font: 'times',
    lockFont: true,
    serifRule: true,
    bodySize: 12,
    lineFactor: 1.54,
    margin: 54,
    codeBg: [245, 239, 230],
    codeBorder: [224, 214, 198],
    codeText: [45, 38, 32],
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    primary: [17, 17, 17],
    tint: [255, 255, 255],
    text: [17, 17, 17],
    muted: [95, 95, 95],
    font: 'helvetica',
    minimal: true,
    bodySize: 11,
    lineFactor: 1.4,
    margin: 46,
    codeBg: [255, 255, 255],
    codeBorder: [170, 170, 170],
    codeText: [25, 25, 25],
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

export function stripMarkdownToCleanText(raw) {
  let s = String(raw || '').replace(/\r/g, '');
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => latexToUnicode(expr));
  s = s.replace(/\$([^$\n]+)\$/g, (_, expr) => latexToUnicode(expr));
  s = s.replace(/\[\[([^[\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[^)]+)\)/g, '$1');
  s = s.replace(/^\s*#{1,6}\s+/gm, '');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<![\w\d])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w\d])/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/\*{2,}/g, '');
  return s;
}

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

    const fenceOpen = /^```([a-zA-Z0-9+#_-]*)\s*$/.exec(trimmed);
    if (fenceOpen) {
      const lang = fenceOpen[1] || 'code';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    if (/^([-*_]){3,}\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (/^\|.+\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1].trim())) {
      const splitRow = r =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(c => stripMarkdownToCleanText(c).trim());
      const headers = splitRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

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

function paintPageBackdrop(doc, theme) {
  if (Array.isArray(theme?.paperBg)) {
    doc.setFillColor(theme.paperBg[0], theme.paperBg[1], theme.paperBg[2]);
    doc.rect(0, 0, W, H, 'F');
  }
  if (theme?.topStripe) {
    doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.rect(0, 0, W, 5, 'F');
  }
}

function startNewPage(doc, yRef, theme) {
  doc.addPage();
  paintPageBackdrop(doc, theme);
  yRef.y = theme?.margin || M;
}

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

function addTextBlock(
  doc,
  text,
  yRef,
  {
    fontSize = 11.5,
    bold = false,
    italic = false,
    font = 'helvetica',
    color = [20, 21, 26],
    indent = 0,
    lineFactor = 1.4,
    margin = M,
    colX = null,
    colW = null,
    theme = null,
  } = {}
) {
  const xOrigin = colX !== null ? colX : margin;
  const areaW = colW !== null ? colW : W - margin * 2;
  const maxW = areaW - indent;
  const str = String(text || '');
  if (!str.trim()) {
    yRef.y += fontSize * 0.6;
    return;
  }

  if (NON_LATIN1_RE.test(str)) {
    const img = renderUnicodeParagraphToImage(str, { fontSize, bold, color, maxWidth: maxW });
    if (img) {
      if (yRef.y + img.height > H - margin - 18) {
        if (typeof yRef.advanceCol === 'function') yRef.advanceCol();
        else startNewPage(doc, yRef, theme);
      }
      doc.addImage(img.dataUrl, 'PNG', xOrigin + indent, yRef.y, img.width, img.height);
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
    if (yRef.y + lh > H - margin - 18) {
      if (typeof yRef.advanceCol === 'function') yRef.advanceCol();
      else startNewPage(doc, yRef, theme);
    }
    doc.text(line, xOrigin + indent, yRef.y + fontSize * 0.85);
    yRef.y += lh;
  }
  doc.setTextColor(15);
}

function addRichRunsBlock(
  doc,
  rawText,
  yRef,
  {
    fontSize = 11.5,
    font = 'helvetica',
    color = [20, 21, 26],
    indent = 0,
    lineFactor = 1.4,
    margin = M,
    colX = null,
    colW = null,
    theme = null,
  } = {}
) {
  const plain = stripMarkdownToCleanText(rawText);
  const runs = tokenizeInlineRuns(rawText);
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
      margin,
      colX,
      colW,
      theme,
    });
    return;
  }

  const xOrigin = colX !== null ? colX : margin;
  const areaW = colW !== null ? colW : W - margin * 2;
  const startX = xOrigin + indent;
  const maxX = xOrigin + areaW;
  const lh = fontSize * lineFactor;
  let curX = startX;

  const ensureLineSpace = () => {
    if (yRef.y + lh > H - margin - 18) {
      if (typeof yRef.advanceCol === 'function') yRef.advanceCol();
      else startNewPage(doc, yRef, theme);
    }
  };

  ensureLineSpace();
  for (const run of runs) {
    const runFont = run.code ? 'courier' : font;
    const style = run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
    doc.setFont(runFont, style);
    doc.setFontSize(run.code ? Math.max(8, fontSize - 0.8) : fontSize);
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

function addPagedCanvas(doc, sourceCanvas, widthPt, heightPt, yRef, theme) {
  const margin = theme?.margin || M;
  const pxPerPt = sourceCanvas.height / heightPt;
  let remainingPt = heightPt;
  let srcY = 0;

  while (remainingPt > 1) {
    const availPt = H - margin - 18 - yRef.y;
    if (availPt < 60) {
      startNewPage(doc, yRef, theme);
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

    doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, yRef.y, widthPt, slicePt);
    yRef.y += slicePt + 8;
    srcY += slicePx;
    remainingPt -= slicePt;
    if (remainingPt > 1) {
      startNewPage(doc, yRef, theme);
    }
  }
}

function addPageFooters(doc, { label = 'Notes by Bai', muted = [120, 120, 120], font = 'helvetica', theme = null } = {}) {
  const pageCount = doc.internal.getNumberOfPages();
  const safeLabel = stripMarkdownToCleanText(label).slice(0, 64);
  const margin = theme?.margin || M;

  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    if (theme?.id === 'editorial') {
      doc.setFont('times', 'italic');
      doc.setFontSize(9.5);
      setDocTextColor(doc, muted);
      doc.text(`— ${p} of ${pageCount} —`, W / 2, H - 24, { align: 'center' });
      continue;
    }
    if (theme?.id === 'technical') {
      doc.setDrawColor(6, 182, 212);
      doc.setLineWidth(0.5);
      doc.line(margin, H - 30, W - margin, H - 30);
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      setDocTextColor(doc, muted);
      doc.text(`SPEC // ${safeLabel.toUpperCase()}`, margin, H - 18);
      doc.text(`PAGE ${String(p).padStart(2, '0')} / ${String(pageCount).padStart(2, '0')}`, W - margin, H - 18, { align: 'right' });
      continue;
    }
    doc.setDrawColor(theme?.minimal ? 200 : 222, theme?.minimal ? 200 : 225, theme?.minimal ? 200 : 232);
    doc.setLineWidth(theme?.minimal ? 0.5 : 0.4);
    doc.line(margin, H - 28, W - margin, H - 28);
    doc.setFont(font, 'normal');
    doc.setFontSize(8);
    setDocTextColor(doc, muted);
    doc.text(safeLabel, margin, H - 17);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 17, { align: 'right' });
  }
}

function drawPdfHeader(doc, yRef, { title, subject, dateStr, theme }) {
  const cleanTitle = stripMarkdownToCleanText(title || 'Untitled Note').trim() || 'Untitled Note';
  const cleanSubj = stripMarkdownToCleanText(subject || '').trim();
  const margin = theme.margin || M;
  const areaW = W - margin * 2;

  paintPageBackdrop(doc, theme);

  if (theme.banner) {
    // Cheat Sheet Compact Dual-Tone Top Header
    doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.roundedRect(margin, yRef.y, areaW, 40, 5, 5, 'F');
    doc.setFillColor(79, 70, 229);
    doc.roundedRect(W - margin - 88, yRef.y + 8, 78, 22, 4, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('CHEAT SHEET', W - margin - 49, yRef.y + 21, { align: 'center' });

    doc.setFontSize(14);
    doc.text(cleanTitle.slice(0, 52), margin + 12, yRef.y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(220, 252, 244);
    doc.text(`${cleanSubj ? `${cleanSubj} · ` : ''}${dateStr}`, margin + 12, yRef.y + 32);
    yRef.y += 50;
    return;
  }

  if (theme.darkHeader) {
    // Code & Tech Full-Slate Technical Banner
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(margin, yRef.y, areaW, 58, 5, 5, 'F');
    doc.setFillColor(6, 182, 212);
    doc.rect(margin, yRef.y, 5, 58, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(34, 211, 238);
    doc.text(`${cleanSubj ? `${cleanSubj.toUpperCase()}  //  ` : ''}TECH SPEC`, margin + 14, yRef.y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(248, 250, 252);
    doc.text(cleanTitle.slice(0, 55), margin + 14, yRef.y + 35);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(dateStr, margin + 14, yRef.y + 49);
    yRef.y += 72;
    return;
  }

  if (theme.id === 'editorial') {
    // Editorial Book Title Block on Warm Cream Paper
    if (cleanSubj) {
      doc.setFont('times', 'italic');
      doc.setFontSize(10.5);
      setDocTextColor(doc, theme.primary);
      doc.text(cleanSubj, W / 2, yRef.y + 8, { align: 'center' });
      yRef.y += 18;
    }
    doc.setFont('times', 'bold');
    doc.setFontSize(22);
    setDocTextColor(doc, theme.text);
    const titleLines = doc.splitTextToSize(cleanTitle, areaW - 20);
    titleLines.forEach(tl => {
      doc.text(tl, W / 2, yRef.y + 14, { align: 'center' });
      yRef.y += 26;
    });
    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    setDocTextColor(doc, theme.muted);
    doc.text(dateStr, W / 2, yRef.y + 4, { align: 'center' });
    yRef.y += 14;
    doc.setDrawColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.setLineWidth(1.0);
    doc.line(W / 2 - 48, yRef.y, W / 2 + 48, yRef.y);
    yRef.y += 20;
    return;
  }

  if (theme.minimal) {
    // Pure B&W Swiss Header
    doc.setFont(theme.font, 'bold');
    doc.setFontSize(20);
    setDocTextColor(doc, theme.text);
    const wrapped = doc.splitTextToSize(cleanTitle, areaW);
    wrapped.forEach(l => {
      doc.text(l, margin, yRef.y + 14);
      yRef.y += 24;
    });
    doc.setFont(theme.font, 'normal');
    doc.setFontSize(9);
    setDocTextColor(doc, theme.muted);
    doc.text(`${cleanSubj ? `${cleanSubj}  ·  ` : ''}${dateStr}`, margin, yRef.y + 2);
    yRef.y += 10;
    doc.setDrawColor(17, 17, 17);
    doc.setLineWidth(0.6);
    doc.line(margin, yRef.y, W - margin, yRef.y);
    yRef.y += 16;
    return;
  }

  // Academic Institutional Handout Header
  if (cleanSubj) {
    doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
    const pillW = Math.min(areaW, doc.getTextWidth(cleanSubj.toUpperCase()) + 22);
    doc.roundedRect(margin, yRef.y, Math.max(60, pillW), 16, 3, 3, 'F');
    doc.setFont(theme.font, 'bold');
    doc.setFontSize(8);
    setDocTextColor(doc, theme.primary);
    doc.text(cleanSubj.toUpperCase(), margin + 8, yRef.y + 11);
    yRef.y += 22;
  }

  addTextBlock(doc, cleanTitle, yRef, {
    fontSize: 20,
    bold: true,
    font: theme.font,
    color: theme.text,
    margin,
    theme,
  });
  yRef.y += 2;
  addTextBlock(doc, `Lecture Handout  ·  ${dateStr}`, yRef, {
    fontSize: 9.5,
    font: theme.font,
    color: theme.muted,
    margin,
    theme,
  });
  yRef.y += 6;
  doc.setDrawColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.setLineWidth(1.4);
  doc.line(margin, yRef.y, W - margin, yRef.y);
  yRef.y += 14;
}

/** True 2-column flowing renderer for the Cheat Sheet theme. */
function renderTwoColumnBlocks(doc, parsedBlocks, { startY, theme }) {
  const margin = theme.margin; // 24
  const gap = 14;
  const colW = (W - margin * 2 - gap) / 2;
  const colXs = [margin, margin + colW + gap];
  let colIdx = 0;

  const yRef = {
    y: startY,
    colStartY: startY,
    advanceCol: () => {
      if (colIdx === 0) {
        colIdx = 1;
        yRef.y = yRef.colStartY;
      } else {
        doc.addPage();
        colIdx = 0;
        yRef.colStartY = margin;
        yRef.y = margin;
      }
    },
  };

  const curColX = () => colXs[colIdx];

  for (const blk of parsedBlocks) {
    if (blk.type === 'spacer') {
      yRef.y += 4;
      continue;
    }

    if (blk.type === 'hr') {
      if (yRef.y + 10 > H - margin - 18) yRef.advanceCol();
      doc.setDrawColor(200, 210, 215);
      doc.setLineWidth(0.5);
      doc.line(curColX(), yRef.y + 3, curColX() + colW, yRef.y + 3);
      yRef.y += 8;
      continue;
    }

    if (blk.type === 'heading') {
      if (yRef.y + 24 > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      const pillRgb = blk.level === 1 ? theme.primary : theme.accentAlt;
      doc.setFillColor(pillRgb[0], pillRgb[1], pillRgb[2]);
      doc.roundedRect(x, yRef.y, colW, 15, 3, 3, 'F');
      doc.setFont(theme.font, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(stripMarkdownToCleanText(blk.text).slice(0, 42).toUpperCase(), x + 6, yRef.y + 10.5);
      yRef.y += 19;
      continue;
    }

    if (blk.type === 'code') {
      const codeLines = blk.lines.length ? blk.lines : [''];
      const lineH = 9.5;
      const boxH = 12 + codeLines.length * lineH + 4;
      if (yRef.y + Math.min(boxH, 120) > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      doc.setFillColor(theme.codeBg[0], theme.codeBg[1], theme.codeBg[2]);
      doc.setDrawColor(theme.codeBorder[0], theme.codeBorder[1], theme.codeBorder[2]);
      doc.roundedRect(x, yRef.y, colW, Math.min(H - margin - yRef.y - 18, boxH), 3, 3, 'FD');
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      setDocTextColor(doc, theme.codeText);
      let cy = yRef.y + 10;
      for (const cl of codeLines) {
        if (cy + lineH > H - margin - 18) {
          yRef.advanceCol();
          cy = yRef.y + 10;
        }
        const wrapped = doc.splitTextToSize(String(cl || ' '), colW - 10);
        for (const wl of wrapped) {
          doc.text(wl, curColX() + 5, cy);
          cy += lineH;
        }
      }
      yRef.y = cy + 4;
      continue;
    }

    if (blk.type === 'table') {
      const cols = Math.max(1, blk.headers.length);
      const cellW = colW / cols;
      const rowH = 15;
      if (yRef.y + rowH * 2 > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
      doc.setDrawColor(190, 210, 205);
      doc.rect(x, yRef.y, colW, rowH, 'FD');
      doc.setFont(theme.font, 'bold');
      doc.setFontSize(7.5);
      setDocTextColor(doc, theme.primary);
      blk.headers.forEach((h, i) => doc.text(String(h || '').slice(0, 14), x + i * cellW + 3, yRef.y + 10));
      yRef.y += rowH;
      doc.setFont(theme.font, 'normal');
      for (const row of blk.rows) {
        if (yRef.y + rowH > H - margin - 18) yRef.advanceCol();
        const rx = curColX();
        doc.setDrawColor(210, 220, 220);
        doc.rect(rx, yRef.y, colW, rowH, 'D');
        setDocTextColor(doc, theme.text);
        for (let i = 0; i < cols; i++) doc.text(String(row[i] || '').slice(0, 14), rx + i * cellW + 3, yRef.y + 10);
        yRef.y += rowH;
      }
      yRef.y += 5;
      continue;
    }

    if (blk.type === 'quote') {
      const wrapped = doc.splitTextToSize(blk.text, colW - 12);
      const h = wrapped.length * 10.5 + 8;
      if (yRef.y + h > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
      doc.rect(x, yRef.y, colW, h, 'F');
      doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      doc.rect(x, yRef.y, 2.5, h, 'F');
      yRef.y += 4;
      addTextBlock(doc, blk.text, yRef, {
        fontSize: 8,
        italic: true,
        font: theme.font,
        color: theme.text,
        indent: 6,
        lineFactor: 1.28,
        margin,
        colX: x,
        colW,
      });
      yRef.y += 4;
      continue;
    }

    if (blk.type === 'bullet' || blk.type === 'checkbox') {
      if (yRef.y + 12 > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      doc.circle(x + 3, yRef.y + 5, 1.5, 'F');
      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: theme.text,
        indent: 9,
        lineFactor: theme.lineFactor,
        margin,
        colX: x,
        colW,
      });
      continue;
    }

    if (blk.type === 'ordered') {
      if (yRef.y + 12 > H - margin - 18) yRef.advanceCol();
      const x = curColX();
      doc.setFont(theme.font, 'bold');
      doc.setFontSize(theme.bodySize);
      setDocTextColor(doc, theme.primary);
      doc.text(`${blk.num}.`, x, yRef.y + theme.bodySize * 0.85);
      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: theme.text,
        indent: 12,
        lineFactor: theme.lineFactor,
        margin,
        colX: x,
        colW,
      });
      continue;
    }

    addRichRunsBlock(doc, blk.text, yRef, {
      fontSize: theme.bodySize,
      font: theme.font,
      color: theme.text,
      lineFactor: theme.lineFactor,
      margin,
      colX: curColX(),
      colW,
    });
  }

  return yRef;
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
  // Respect user's chosen app font for Auto / Academic / Minimal, NEVER overwrite Editorial serif or Technical mono
  const theme =
    userFont.id !== 'system' && !baseTheme.lockFont && (!pdfStyle || pdfStyle === 'auto' || resolvedStyleId === 'academic')
      ? { ...baseTheme, font: userFont.pdfFont }
      : baseTheme;

  const margin = theme.margin || M;
  const areaW = W - margin * 2;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const yRef = { y: margin };
  const dateStr = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  drawPdfHeader(doc, yRef, { title, subject, dateStr, theme });

  // Images
  for (const img of images) {
    const dataUrl = await resolveImageDataUrl(img);
    if (!dataUrl) continue;
    const dim = await imageDims(dataUrl);
    if (!dim || !dim.w || !dim.h) continue;

    const scale = Math.min(areaW / dim.w, (H - margin * 2 - 32) / dim.h, 1.5);
    const w = dim.w * scale;
    const h = dim.h * scale;
    const x = margin + (areaW - w) / 2;

    if (yRef.y + h > H - margin - 18) startNewPage(doc, yRef, theme);
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

  const parsedBlocks = parseMarkdownBlocksForPdf(body);

  if (theme.twoColumn) {
    renderTwoColumnBlocks(doc, parsedBlocks, { startY: yRef.y, theme });
    yRef.y = H - margin - 24;
  } else {
    for (const blk of parsedBlocks) {
      if (blk.type === 'spacer') {
        yRef.y += blk.height;
        continue;
      }

      if (blk.type === 'hr') {
        if (yRef.y + 12 > H - margin - 18) startNewPage(doc, yRef, theme);
        doc.setDrawColor(theme.minimal ? 160 : 210, theme.minimal ? 160 : 215, theme.minimal ? 160 : 222);
        doc.setLineWidth(theme.minimal ? 0.5 : 0.7);
        doc.line(margin, yRef.y + 4, W - margin, yRef.y + 4);
        yRef.y += 12;
        continue;
      }

      if (blk.type === 'heading') {
        yRef.y += 6;
        const sz = blk.level === 1 ? 15 : blk.level === 2 ? 13 : 11.5;
        if (theme.id === 'technical') {
          addTextBlock(doc, `// ${blk.text}`, yRef, {
            fontSize: sz,
            bold: true,
            font: 'courier',
            color: [15, 23, 42],
            lineFactor: theme.lineFactor,
            margin,
            theme,
          });
          doc.setDrawColor(6, 182, 212);
          doc.setLineWidth(1.0);
          doc.line(margin, yRef.y, W - margin, yRef.y);
          yRef.y += 5;
        } else if (theme.id === 'academic') {
          if (yRef.y + 22 > H - margin - 18) startNewPage(doc, yRef, theme);
          doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
          doc.rect(margin, yRef.y - 2, areaW, 20, 'F');
          doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
          doc.rect(margin, yRef.y - 2, 3, 20, 'F');
          addTextBlock(doc, blk.text, yRef, {
            fontSize: sz - 0.5,
            bold: true,
            font: theme.font,
            color: theme.primary,
            indent: 8,
            lineFactor: theme.lineFactor,
            margin,
            theme,
          });
          yRef.y += 4;
        } else if (theme.minimal) {
          addTextBlock(doc, blk.text, yRef, {
            fontSize: sz,
            bold: true,
            font: theme.font,
            color: theme.text,
            lineFactor: theme.lineFactor,
            margin,
            theme,
          });
          doc.setDrawColor(190, 190, 190);
          doc.setLineWidth(0.5);
          doc.line(margin, yRef.y, W - margin, yRef.y);
          yRef.y += 4;
        } else {
          // Editorial serif heading
          addTextBlock(doc, blk.text, yRef, {
            fontSize: sz + 0.5,
            bold: true,
            font: 'times',
            color: blk.level === 1 ? theme.primary : theme.text,
            lineFactor: theme.lineFactor,
            margin,
            theme,
          });
          yRef.y += 3;
        }
        continue;
      }

      if (blk.type === 'code') {
        const codeLines = blk.lines.length ? blk.lines : [''];
        const lineH = 13;
        const padY = 10;
        const headerH = 15;
        const boxH = Math.min(H - margin * 2 - 20, headerH + padY + codeLines.length * lineH);
        if (yRef.y + boxH > H - margin - 18) startNewPage(doc, yRef, theme);

        const totalBoxH = headerH + padY + codeLines.length * lineH;
        if (theme.minimal) {
          doc.setDrawColor(theme.codeBorder[0], theme.codeBorder[1], theme.codeBorder[2]);
          doc.setLineWidth(0.6);
          doc.rect(margin, yRef.y, areaW, totalBoxH, 'D');
        } else {
          doc.setFillColor(theme.codeBg[0], theme.codeBg[1], theme.codeBg[2]);
          doc.setDrawColor(theme.codeBorder[0], theme.codeBorder[1], theme.codeBorder[2]);
          doc.roundedRect(margin, yRef.y, areaW, totalBoxH, 5, 5, 'FD');
          if (theme.darkCode) {
            doc.setFillColor(6, 182, 212);
            doc.rect(margin, yRef.y, 4, totalBoxH, 'F');
          }
        }
        doc.setFont(theme.darkCode ? 'courier' : 'helvetica', 'bold');
        doc.setFontSize(8);
        setDocTextColor(doc, theme.darkCode ? [34, 211, 238] : theme.primary);
        doc.text(String(blk.lang || 'CODE').toUpperCase(), margin + 10, yRef.y + 11);

        let cy = yRef.y + headerH + 8;
        doc.setFont('courier', 'normal');
        doc.setFontSize(9.5);
        setDocTextColor(doc, theme.codeText);
        for (const cl of codeLines) {
          if (cy + lineH > H - margin - 18) {
            startNewPage(doc, yRef, theme);
            cy = yRef.y + 8;
            setDocTextColor(doc, theme.darkCode ? [30, 41, 59] : theme.codeText);
          }
          const safeLine = doc.splitTextToSize(String(cl || ' '), areaW - 20);
          for (const sl of safeLine) {
            doc.text(sl, margin + 10, cy);
            cy += lineH;
          }
        }
        yRef.y = cy + 6;
        continue;
      }

      if (blk.type === 'table') {
        const cols = Math.max(1, blk.headers.length);
        const colW = areaW / cols;
        const rowH = 22;

        if (yRef.y + rowH * 2 > H - margin - 18) startNewPage(doc, yRef, theme);

        if (theme.minimal) {
          doc.setDrawColor(40, 40, 40);
          doc.rect(margin, yRef.y, areaW, rowH, 'D');
        } else {
          doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
          doc.setDrawColor(210, 214, 222);
          doc.rect(margin, yRef.y, areaW, rowH, 'FD');
        }
        doc.setFont(theme.font, 'bold');
        doc.setFontSize(9.5);
        setDocTextColor(doc, theme.primary);
        blk.headers.forEach((h, cIdx) => {
          doc.text(String(h || '').slice(0, 26), margin + cIdx * colW + 6, yRef.y + 14);
        });
        yRef.y += rowH;

        doc.setFont(theme.font, 'normal');
        doc.setFontSize(9.5);
        for (const row of blk.rows) {
          if (yRef.y + rowH > H - margin - 18) startNewPage(doc, yRef, theme);
          doc.setDrawColor(220, 224, 230);
          doc.rect(margin, yRef.y, areaW, rowH, 'D');
          setDocTextColor(doc, theme.text);
          for (let cIdx = 0; cIdx < cols; cIdx++) {
            doc.text(String(row[cIdx] || '').slice(0, 28), margin + cIdx * colW + 6, yRef.y + 14);
          }
          yRef.y += rowH;
        }
        yRef.y += 8;
        continue;
      }

      if (blk.type === 'quote') {
        const cleanQ = blk.text;
        const wrapped = doc.splitTextToSize(cleanQ, areaW - 22);
        const h = wrapped.length * (theme.bodySize * 1.4) + 12;
        if (yRef.y + h > H - margin - 18) startNewPage(doc, yRef, theme);
        if (!theme.minimal) {
          doc.setFillColor(theme.tint[0], theme.tint[1], theme.tint[2]);
          doc.rect(margin, yRef.y, areaW, h, 'F');
        }
        doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
        doc.rect(margin, yRef.y, theme.minimal ? 1.5 : 3.5, h, 'F');
        yRef.y += 6;
        addTextBlock(doc, cleanQ, yRef, {
          fontSize: theme.bodySize - 0.5,
          italic: true,
          font: theme.font,
          color: theme.text,
          indent: 12,
          lineFactor: 1.4,
          margin,
          theme,
        });
        yRef.y += 8;
        continue;
      }

      if (blk.type === 'checkbox') {
        if (yRef.y + 18 > H - margin - 18) startNewPage(doc, yRef, theme);
        const bx = margin + blk.indent;
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
          margin,
          theme,
        });
        continue;
      }

      if (blk.type === 'bullet') {
        if (yRef.y + 16 > H - margin - 18) startNewPage(doc, yRef, theme);
        doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
        doc.circle(margin + blk.indent + 4, yRef.y + 6.5, 2, 'F');
        addRichRunsBlock(doc, blk.text, yRef, {
          fontSize: theme.bodySize,
          font: theme.font,
          color: theme.text,
          indent: blk.indent + 13,
          lineFactor: theme.lineFactor,
          margin,
          theme,
        });
        continue;
      }

      if (blk.type === 'ordered') {
        if (yRef.y + 16 > H - margin - 18) startNewPage(doc, yRef, theme);
        doc.setFont(theme.font, 'bold');
        doc.setFontSize(theme.bodySize);
        setDocTextColor(doc, theme.primary);
        doc.text(`${blk.num}.`, margin + blk.indent, yRef.y + theme.bodySize * 0.85);
        addRichRunsBlock(doc, blk.text, yRef, {
          fontSize: theme.bodySize,
          font: theme.font,
          color: theme.text,
          indent: blk.indent + 18,
          lineFactor: theme.lineFactor,
          margin,
          theme,
        });
        continue;
      }

      addRichRunsBlock(doc, blk.text, yRef, {
        fontSize: theme.bodySize,
        font: theme.font,
        color: theme.text,
        lineFactor: theme.lineFactor,
        margin,
        theme,
      });
    }
  }

  // Drawings
  const rendered = renderStrokesToCanvas(drawings, areaW, { dark: false });
  if (rendered?.canvas) {
    if (theme.twoColumn) startNewPage(doc, yRef, theme);
    else yRef.y += 12;
    addTextBlock(doc, 'Handwritten Annotations', yRef, {
      fontSize: 13,
      bold: true,
      font: theme.font,
      color: theme.primary,
      margin,
      theme,
    });
    yRef.y += 4;
    addPagedCanvas(doc, rendered.canvas, rendered.width, rendered.height, yRef, theme);
  }

  // Explanations section (optional)
  const expl = blocks.filter(b => b.explanation || b.simpler || b.example);
  if (withExplanations && expl.length) {
    startNewPage(doc, yRef, theme);
    addTextBlock(doc, 'AI Explanations', yRef, {
      fontSize: 16,
      bold: true,
      font: theme.font,
      color: theme.primary,
      margin,
      theme,
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
        margin,
        theme,
      });
      addTextBlock(doc, stripMarkdownToCleanText(text), yRef, {
        fontSize: 10.5,
        font: theme.font,
        color: theme.muted,
        indent: 8,
        margin,
        theme,
      });
      yRef.y += 8;
    }
  }

  addPageFooters(doc, {
    label: `Notes by Bai${subject ? ` · ${subject}` : ''} · ${theme.name}`,
    muted: theme.muted,
    font: theme.font,
    theme,
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
    addTextBlock(doc, 'Summary', yRef, { fontSize: 15, bold: true, color: theme.primary, theme });
    yRef.y += 4;
    for (const blk of parseMarkdownBlocksForPdf(summary)) {
      if (blk.type === 'heading') {
        addTextBlock(doc, blk.text, yRef, { fontSize: 12.5, bold: true, color: theme.text, theme });
      } else if (blk.type === 'bullet' || blk.type === 'ordered') {
        addTextBlock(doc, `• ${stripMarkdownToCleanText(blk.text)}`, yRef, { fontSize: 11, indent: 8, theme });
      } else if (blk.text) {
        addTextBlock(doc, stripMarkdownToCleanText(blk.text), yRef, { fontSize: 11, theme });
      }
    }
    yRef.y += 12;
  }

  if (flashcards.length) {
    addTextBlock(doc, `Flashcards (${flashcards.length})`, yRef, { fontSize: 15, bold: true, color: theme.primary, theme });
    yRef.y += 4;
    flashcards.forEach((c, i) => {
      addTextBlock(doc, `${i + 1}. Q: ${stripMarkdownToCleanText(c.q)}`, yRef, { fontSize: 11, bold: true, theme });
      addTextBlock(doc, `A: ${stripMarkdownToCleanText(c.a)}`, yRef, { fontSize: 11, color: theme.muted, indent: 10, theme });
      yRef.y += 6;
    });
    yRef.y += 10;
  }

  if (quiz.length) {
    addTextBlock(doc, `Practice Quiz (${quiz.length})`, yRef, { fontSize: 15, bold: true, color: theme.primary, theme });
    yRef.y += 4;
    quiz.forEach((q, i) => {
      addTextBlock(doc, `${i + 1}. ${stripMarkdownToCleanText(q.question)}`, yRef, { fontSize: 11, bold: true, theme });
      (q.choices || []).forEach((ch, j) => {
        const mark = j === q.answer ? ' [Answer]' : '';
        addTextBlock(doc, `${String.fromCharCode(65 + j)}. ${stripMarkdownToCleanText(ch)}${mark}`, yRef, {
          fontSize: 10.5,
          bold: j === q.answer,
          color: j === q.answer ? theme.primary : theme.muted,
          indent: 12,
          theme,
        });
      });
      yRef.y += 6;
    });
  }

  if (predicted.length) {
    addTextBlock(doc, `Predicted Exam Questions (${predicted.length})`, yRef, { fontSize: 15, bold: true, color: theme.primary, theme });
    yRef.y += 4;
    predicted.forEach((p, i) => {
      addTextBlock(doc, `${i + 1}. ${stripMarkdownToCleanText(p.question)}`, yRef, { fontSize: 11, bold: true, theme });
      addTextBlock(doc, stripMarkdownToCleanText(p.answer), yRef, { fontSize: 11, color: theme.muted, indent: 10, theme });
      yRef.y += 6;
    });
  }

  addPageFooters(doc, {
    label: `Notes by Bai · ${folderName || 'Exam Pack'}`,
    muted: theme.muted,
    theme,
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
