/**
 * PDF export — generates a real PDF file in-app (no print dialog needed).
 *
 * Native (APK): writes to app cache, then opens the Android share sheet —
 *   from there you can save to Downloads/Files, send via WhatsApp/email, etc.
 * Web: triggers a browser download.
 */
import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { drawStroke } from '../components/StrokeLayer';

const W = 595.28, H = 841.89, M = 44; // A4 in pt, margins
const CONTENT_W = W - M * 2;

/** Load a dataURL image and return {w, h} in px (or null). */
function imageDims(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Render strokes onto an offscreen canvas (content space, scaled to width). */
function strokesToCanvas(drawings, contentWidth) {
  const strokes = drawings?.strokes || [];
  if (!strokes.length) return null;
  const scale = contentWidth / (drawings.refWidth || contentWidth);
  let maxY = 0;
  strokes.forEach(s => (s.points || []).forEach(p => {
    const y = p.y * scale;
    if (y > maxY) maxY = y;
  }));
  const h = Math.min(Math.max(Math.ceil(maxY + 40), 120), 2400);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(contentWidth);
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  strokes.forEach(s => {
    ctx.save();
    ctx.scale(scale, scale);
    drawStroke(ctx, s);
    ctx.restore();
  });
  return { dataUrl: canvas.toDataURL('image/png'), h };
}

export async function buildNotePDF({ title, body, blocks = [], images = [], drawings = null, withExplanations = false }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = M;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  const titleLines = doc.splitTextToSize(title || 'New Note', CONTENT_W);
  doc.text(titleLines, M, y + 16);
  y += titleLines.length * 24 + 6;

  // Date
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }),
    M, y + 10
  );
  y += 28;
  doc.setTextColor(0);

  const newPageIfNeeded = needed => {
    if (y + needed > H - M) { doc.addPage(); y = M; return true; }
    return false;
  };

  // Images
  for (const img of images) {
    const dim = await imageDims(img.dataUrl);
    if (!dim) continue;
    const w = CONTENT_W;
    const h = Math.min(w * dim.h / dim.w, H - M * 2);
    newPageIfNeeded(h + 12);
    try { doc.addImage(img.dataUrl, 'JPEG', M, y, w, h); } catch { /* skip broken image */ }
    y += h + 14;
  }

  // Body
  doc.setFontSize(12);
  const bodyLines = (body || '').split('\n');
  for (const line of bodyLines) {
    if (!line.trim()) { y += 9; continue; }
    const wrapped = doc.splitTextToSize(line, CONTENT_W);
    const lh = 16;
    newPageIfNeeded(wrapped.length * lh);
    doc.text(wrapped, M, y + 4);
    y += wrapped.length * lh;
  }

  // Drawings (annotations)
  const rendered = strokesToCanvas(drawings, CONTENT_W);
  if (rendered) {
    newPageIfNeeded(rendered.h + 16);
    try { doc.addImage(rendered.dataUrl, 'PNG', M, y, CONTENT_W, rendered.h); } catch { /* skip */ }
    y += rendered.h + 20;
  }

  // Explanations (optional)
  const expl = blocks.filter(b => b.explanation || b.simpler || b.example);
  if (withExplanations && expl.length) {
    doc.addPage();
    y = M;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Explanations', M, y + 12);
    y += 34;
    doc.setFont('helvetica', 'normal');
    for (const b of expl) {
      const text = b.show === 'simpler' && b.simpler ? b.simpler
        : b.show === 'example' && b.example ? b.example
        : b.explanation;
      if (!text) continue;
      const lineText = doc.splitTextToSize(b.text || '', CONTENT_W - 10);
      const explText = doc.splitTextToSize(text, CONTENT_W - 10);
      newPageIfNeeded((lineText.length + explText.length) * 15 + 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(lineText, M, y + 8);
      y += lineText.length * 14 + 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(explText, M, y + 10);
      y += explText.length * 14 + 12;
      doc.setTextColor(0);
    }
  }

  return doc;
}

/** Save the PDF: native → share sheet; web → browser download. */
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