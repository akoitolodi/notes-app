/**
 * PDF export — generates clean A4 PDFs in-app for notes & exam summaries.
 *
 * Fixes over v1.2:
 * - Resolves Dexie v4 Blob attachments cleanly via resolveImageDataUrl().
 * - Auto-detects image format (PNG vs JPEG vs WEBP) instead of hardcoding 'JPEG'.
 * - Preserves exact aspect ratio when clamping tall portrait photos.
 * - Slices tall drawings cleanly across A4 pages instead of clipping off the bottom.
 * - Unicode / math fallback: lines with characters outside Latin-1 (e.g. α, π, ∑,
 *   ≤, →, CJK, emojis) render via crisp high-DPI canvas image so they NEVER turn
 *   into garbled Helvetica mojibake!
 */
import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { renderStrokesToCanvas } from '../components/StrokeLayer';
import { resolveImageDataUrl } from '../store/db';

const W = 595.28;
const H = 841.89;
const M = 44;
const CONTENT_W = W - M * 2;
const MAX_CONTENT_H = H - M * 2;

const NON_LATIN1_RE = /[^\u0020-\u007E\u00A0-\u00FF]/;

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

/**
 * Render a Unicode text block onto a 2x offscreen canvas so math symbols, Greek,
 * CJK, or emojis export cleanly without embedding multi-MB TTF font files.
 */
function renderUnicodeParagraphToImage(text, { fontSize = 12, bold = false, color = '#111111', maxWidth = CONTENT_W } = {}) {
  if (typeof document === 'undefined') return null;
  const dpr = 2;
  const lineH = fontSize * 1.42;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  const font = `${bold ? '700' : '400'} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  mctx.font = font;

  // Word-wrap respecting long tokens
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
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  wrapped.forEach((ln, idx) => ctx.fillText(ln, 0, idx * lineH + 2));

  return { dataUrl: canvas.toDataURL('image/png'), width: maxWidth, height: totalH };
}

/** Add a text paragraph safely (per-line pagination + Unicode canvas fallback). */
function addTextBlock(doc, text, yRef, { fontSize = 12, bold = false, color = 0, indent = 0 } = {}) {
  const maxW = CONTENT_W - indent;
  const str = String(text || '');
  if (!str.trim()) {
    yRef.y += fontSize * 0.7;
    return;
  }

  if (NON_LATIN1_RE.test(str)) {
    const hex = color === 0 ? '#111111' : color === 60 ? '#444444' : '#666666';
    const img = renderUnicodeParagraphToImage(str, { fontSize, bold, color: hex, maxWidth: maxW });
    if (img) {
      if (yRef.y + img.height > H - M) {
        doc.addPage();
        yRef.y = M;
      }
      doc.addImage(img.dataUrl, 'PNG', M + indent, yRef.y, img.width, img.height);
      yRef.y += img.height + 2;
      return;
    }
  }

  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(color);
  const lh = fontSize * 1.38;
  const wrapped = doc.splitTextToSize(str, maxW);
  for (const line of wrapped) {
    if (yRef.y + lh > H - M) {
      doc.addPage();
      yRef.y = M;
    }
    doc.text(line, M + indent, yRef.y + fontSize * 0.85);
    yRef.y += lh;
  }
  doc.setTextColor(0);
}

/** Slice a tall canvas vertically across pages so annotations never clip. */
function addPagedCanvas(doc, sourceCanvas, widthPt, heightPt, yRef) {
  const pxPerPt = sourceCanvas.height / heightPt;
  let remainingPt = heightPt;
  let srcY = 0;

  while (remainingPt > 1) {
    const availPt = H - M - yRef.y;
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

export async function buildNotePDF({
  title,
  body,
  blocks = [],
  images = [],
  drawings = null,
  withExplanations = false,
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const yRef = { y: M };

  // Title & date
  addTextBlock(doc, title || 'New Note', yRef, { fontSize: 20, bold: true });
  yRef.y += 4;
  addTextBlock(
    doc,
    new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }),
    yRef,
    { fontSize: 10, color: 110 }
  );
  yRef.y += 14;

  // Images (resolved from Dexie v4 Blob attachments or legacy dataUrls)
  for (const img of images) {
    const dataUrl = await resolveImageDataUrl(img);
    if (!dataUrl) continue;
    const dim = await imageDims(dataUrl);
    if (!dim || !dim.w || !dim.h) continue;

    // Fit proportionally within CONTENT_W x MAX_CONTENT_H (never stretch!)
    const scale = Math.min(CONTENT_W / dim.w, (MAX_CONTENT_H - 16) / dim.h, 1.5);
    const w = dim.w * scale;
    const h = dim.h * scale;
    const x = M + (CONTENT_W - w) / 2;

    if (yRef.y + h > H - M) {
      doc.addPage();
      yRef.y = M;
    }
    try {
      doc.addImage(dataUrl, detectImageFormat(dataUrl), x, yRef.y, w, h);
      yRef.y += h + 14;
    } catch {
      // Fallback: re-encode via canvas to JPEG if format wasn't directly supported (e.g. WEBP)
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

  // Body lines
  const bodyLines = String(body || '').split('\n');
  for (const rawLine of bodyLines) {
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(rawLine);
    if (hMatch) {
      yRef.y += 4;
      const sz = hMatch[1].length === 1 ? 16 : hMatch[1].length === 2 ? 14 : 13;
      addTextBlock(doc, hMatch[2], yRef, { fontSize: sz, bold: true });
      yRef.y += 2;
      continue;
    }
    const clean = rawLine.replace(/^(\s*)-\s\[x\]\s*/i, '$1[✓] ').replace(/^(\s*)-\s\[ \]\s*/, '$1[ ] ');
    addTextBlock(doc, clean, yRef, { fontSize: 12 });
  }

  // Drawings (multi-page sliced cleanly)
  const rendered = renderStrokesToCanvas(drawings, CONTENT_W, { dark: false });
  if (rendered?.canvas) {
    yRef.y += 12;
    addTextBlock(doc, 'Annotations', yRef, { fontSize: 13, bold: true, color: 60 });
    yRef.y += 4;
    addPagedCanvas(doc, rendered.canvas, rendered.width, rendered.height, yRef);
  }

  // Explanations section (optional)
  const expl = blocks.filter(b => b.explanation || b.simpler || b.example);
  if (withExplanations && expl.length) {
    doc.addPage();
    yRef.y = M;
    addTextBlock(doc, 'AI Explanations', yRef, { fontSize: 16, bold: true });
    yRef.y += 10;

    for (const b of expl) {
      const text =
        b.show === 'simpler' && b.simpler
          ? b.simpler
          : b.show === 'example' && b.example
            ? b.example
            : b.explanation;
      if (!text) continue;
      addTextBlock(doc, b.text || '', yRef, { fontSize: 11, bold: true });
      addTextBlock(doc, text, yRef, { fontSize: 11, color: 60, indent: 8 });
      yRef.y += 8;
    }
  }

  return doc;
}

/** Build a clean PDF for an entire Exam Study Pack. */
export async function buildExamSummaryPDF({ folderName, summary, flashcards = [], quiz = [], predicted = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const yRef = { y: M };

  addTextBlock(doc, `${folderName || 'Subject'} — Exam Study Pack`, yRef, { fontSize: 20, bold: true });
  yRef.y += 4;
  addTextBlock(
    doc,
    new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }),
    yRef,
    { fontSize: 10, color: 110 }
  );
  yRef.y += 14;

  if (summary) {
    addTextBlock(doc, 'Summary', yRef, { fontSize: 15, bold: true });
    yRef.y += 4;
    for (const line of String(summary).split('\n')) {
      addTextBlock(doc, line.replace(/^#{1,4}\s+/, ''), yRef, {
        fontSize: /^#{1,4}\s+/.test(line) ? 13 : 11,
        bold: /^#{1,4}\s+/.test(line),
      });
    }
    yRef.y += 12;
  }

  if (flashcards.length) {
    addTextBlock(doc, `Flashcards (${flashcards.length})`, yRef, { fontSize: 15, bold: true });
    yRef.y += 4;
    flashcards.forEach((c, i) => {
      addTextBlock(doc, `${i + 1}. Q: ${c.q}`, yRef, { fontSize: 11, bold: true });
      addTextBlock(doc, `A: ${c.a}`, yRef, { fontSize: 11, color: 60, indent: 10 });
      yRef.y += 6;
    });
    yRef.y += 10;
  }

  if (quiz.length) {
    addTextBlock(doc, `Practice Quiz (${quiz.length})`, yRef, { fontSize: 15, bold: true });
    yRef.y += 4;
    quiz.forEach((q, i) => {
      addTextBlock(doc, `${i + 1}. ${q.question}`, yRef, { fontSize: 11, bold: true });
      (q.choices || []).forEach((ch, j) => {
        const mark = j === q.answer ? ' ✓' : '';
        addTextBlock(doc, `${String.fromCharCode(65 + j)}. ${ch}${mark}`, yRef, {
          fontSize: 10.5,
          color: j === q.answer ? 0 : 60,
          indent: 12,
        });
      });
      yRef.y += 6;
    });
  }

  if (predicted.length) {
    addTextBlock(doc, `Predicted Exam Questions (${predicted.length})`, yRef, { fontSize: 15, bold: true });
    yRef.y += 4;
    predicted.forEach((p, i) => {
      addTextBlock(doc, `${i + 1}. ${p.question}`, yRef, { fontSize: 11, bold: true });
      addTextBlock(doc, p.answer, yRef, { fontSize: 11, color: 60, indent: 10 });
      yRef.y += 6;
    });
  }

  return doc;
}

/** Save the PDF: native → Android share sheet; web → browser download. */
export async function saveNotePDF(doc, title) {
  const safe = (title || 'note').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'note';
  const filename = `${safe}.pdf`;

  if (Capacitor.isNativePlatform?.()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const file = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: file.uri,
      dialogTitle: 'Save or share PDF',
    });
    return 'shared';
  }

  doc.save(filename);
  return 'downloaded';
}
