/**
 * pdfThemes — Lightweight metadata & auto-detection for adaptive PDF layouts.
 * Kept separate from jsPDF so PDF generation stays 100% lazy-loaded.
 */

export const PDF_STYLES = [
  { id: 'auto', label: 'Auto' },
  { id: 'academic', label: 'Academic' },
  { id: 'cheatsheet', label: 'Cheat Sheet' },
  { id: 'technical', label: 'Code & Tech' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'minimal', label: 'Minimal' },
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
