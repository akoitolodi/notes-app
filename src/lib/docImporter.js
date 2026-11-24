/**
 * Document Importer — 100% offline client-side extraction for:
 * - PowerPoint (.pptx) via fflate unzip + pure-JS DrawingML XML parser
 * - PDF (.pdf) via lazy-loaded pdfjs-dist with local bundled worker
 * - Markdown (.md) & Plain Text (.txt)
 *
 * Plus an opt-in `structureImportedTextWithAI` pass for users who want
 * messy lecture decks / handouts turned into structured Markdown study notes.
 */
import { aiText } from './aiCore';
import { stripThinking } from '../../shared/aiParsers.js';

const MAX_DEFAULT_PDF_PAGES = 60;

/** Clean a filename into a readable note title. */
export function titleFromFilename(filename) {
  const base = String(filename || 'Imported Note')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'Imported Note';
}

/** Decode standard XML character entities without relying on DOMParser. */
function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * Extract readable text paragraphs from DrawingML XML (<a:p> ... <a:t>...</a:t> ... </a:p>).
 * Works identically in browsers, Android WebViews, and Node/Vitest.
 */
export function extractPptxXmlParagraphs(xml) {
  if (!xml) return [];
  const paragraphs = [];
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pInner = pMatch[1];
    const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let tMatch;
    const runs = [];
    while ((tMatch = tRegex.exec(pInner)) !== null) {
      runs.push(decodeXmlEntities(tMatch[1]));
    }
    const line = runs.join('').replace(/\s+/g, ' ').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

/** Try to extract explicit title placeholder text from a slide XML (<p:ph type="title|ctrTitle">). */
function extractSlideTitle(xml) {
  const spRegex = /<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g;
  let match;
  while ((match = spRegex.exec(xml)) !== null) {
    const block = match[1];
    if (/<p:ph\b[^>]*type="(?:title|ctrTitle)"/i.test(block)) {
      const paras = extractPptxXmlParagraphs(block);
      if (paras.length > 0) return paras.join(' ').trim();
    }
  }
  return '';
}

/** Parse slide relationship XML to find linked notesSlide path (e.g. ../notesSlides/notesSlide1.xml). */
function resolveNotesTarget(relsXml) {
  if (!relsXml) return null;
  const relRegex = /<Relationship\b[^>]*>/g;
  let match;
  while ((match = relRegex.exec(relsXml)) !== null) {
    const tag = match[0];
    if (/notesSlide/i.test(tag)) {
      const targetMatch = /Target="([^"]+)"/i.exec(tag);
      if (targetMatch) {
        const cleaned = targetMatch[1].replace(/^\.\.\//, 'ppt/').replace(/^\/+/, '');
        return cleaned.startsWith('ppt/') ? cleaned : `ppt/notesSlides/${cleaned}`;
      }
    }
  }
  return null;
}

/**
 * Extract slides & speaker notes from a .pptx ArrayBuffer or Uint8Array.
 * Returns { markdown, pageCount }.
 */
export async function extractPptxText(input, { onProgress = null } = {}) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Could not open this .pptx file. Make sure it is a valid PowerPoint presentation.');
  }

  const slideFiles = Object.keys(entries)
    .map(name => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name);
      return m ? { name, num: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  if (slideFiles.length === 0) {
    throw new Error('No slides found inside this PowerPoint file.');
  }

  const sections = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const { name, num } = slideFiles[i];
    onProgress?.({ current: i + 1, total: slideFiles.length, phase: 'slides' });

    const slideXml = strFromU8(entries[name]);
    const explicitTitle = extractSlideTitle(slideXml);
    const allParas = extractPptxXmlParagraphs(slideXml);

    let heading = explicitTitle;
    let bodyParas = allParas;
    if (heading) {
      // Remove duplicate title line(s) from bullet list
      let removed = false;
      bodyParas = allParas.filter(p => {
        if (!removed && p === heading) {
          removed = true;
          return false;
        }
        return true;
      });
    } else if (allParas.length > 0 && allParas[0].length <= 120) {
      heading = allParas[0];
      bodyParas = allParas.slice(1);
    }

    // Filter out bare slide-number footers
    bodyParas = bodyParas.filter(p => p !== String(num));

    // Resolve speaker notes via _rels or matching numeric index
    const relsPath = `ppt/slides/_rels/slide${num}.xml.rels`;
    const relsXml = entries[relsPath] ? strFromU8(entries[relsPath]) : '';
    const linkedNotesPath = resolveNotesTarget(relsXml) || `ppt/notesSlides/notesSlide${num}.xml`;

    let speakerNotes = [];
    if (entries[linkedNotesPath]) {
      const notesXml = strFromU8(entries[linkedNotesPath]);
      speakerNotes = extractPptxXmlParagraphs(notesXml).filter(p => p !== String(num));
    }

    const lines = [];
    lines.push(heading ? `## Slide ${num}: ${heading}` : `## Slide ${num}`);
    for (const p of bodyParas) {
      lines.push(`- ${p}`);
    }
    if (speakerNotes.length > 0) {
      lines.push(`> **Speaker Notes:** ${speakerNotes.join(' ')}`);
    }
    if (bodyParas.length > 0 || heading || speakerNotes.length > 0) {
      sections.push(lines.join('\n'));
    }
  }

  if (sections.length === 0) {
    throw new Error('This PowerPoint contains no extractable text (slides may be images only).');
  }

  return {
    markdown: sections.join('\n\n'),
    pageCount: slideFiles.length,
    truncatedPages: 0,
  };
}

/**
 * Reconstruct clean visual lines from pdf.js textContent items using their Y baseline.
 */
function textItemsToLines(items) {
  const lines = [];
  let currentY = null;
  let buf = [];

  for (const item of items || []) {
    const str = typeof item.str === 'string' ? item.str : '';
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : currentY;

    if (currentY !== null && y !== null && Math.abs(y - currentY) > 4) {
      const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) lines.push(joined);
      buf = [];
    }
    if (str.trim()) {
      buf.push(str.trim());
    }
    if (item.hasEOL) {
      const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) lines.push(joined);
      buf = [];
      currentY = null;
    } else if (y !== null) {
      currentY = y;
    }
  }
  const tail = buf.join(' ').replace(/\s+/g, ' ').trim();
  if (tail) lines.push(tail);
  return lines;
}

/**
 * Extract text page-by-page from a PDF ArrayBuffer / Uint8Array using lazy-loaded pdfjs-dist.
 * Uses local Vite-bundled worker so it works 100% offline inside the APK WebView.
 */
export async function extractPdfText(
  input,
  { maxPages = MAX_DEFAULT_PDF_PAGES, onProgress = null } = {}
) {
  const pdfjsLib = await import('pdfjs-dist');

  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    try {
      const workerMod = await import('pdfjs-dist/build/pdf.worker.min.js?url');
      if (workerMod?.default) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
      }
    } catch {
      // Fallback: pdfjs-dist will run with disableWorker if worker URL fails
    }
  }

  const data = input instanceof Uint8Array ? input.slice() : new Uint8Array(input.slice(0));

  let pdf;
  try {
    const task = pdfjsLib.getDocument({
      data,
      disableWorker: typeof window === 'undefined' || !pdfjsLib.GlobalWorkerOptions?.workerSrc,
      useSystemFonts: true,
    });
    pdf = await task.promise;
  } catch (err) {
    throw new Error(
      `Could not read this PDF (${err?.message || 'corrupted or password-protected file'}).`
    );
  }

  const totalPages = pdf.numPages || 0;
  const pagesToRead = Math.min(totalPages, maxPages);
  const sections = [];

  try {
    for (let p = 1; p <= pagesToRead; p++) {
      onProgress?.({ current: p, total: pagesToRead, phase: 'pages' });
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = textItemsToLines(content.items);
      if (lines.length > 0) {
        sections.push(`## Page ${p}\n${lines.join('\n')}`);
      }
      page.cleanup?.();
    }
  } finally {
    pdf.destroy?.();
  }

  if (sections.length === 0) {
    throw new Error(
      'This PDF appears to be scanned images (no selectable text). Take a screenshot or photo and use OCR Scan in Edit mode.'
    );
  }

  const truncatedPages = Math.max(0, totalPages - pagesToRead);
  let markdown = sections.join('\n\n');
  if (truncatedPages > 0) {
    markdown += `\n\n> *Note: Imported the first ${pagesToRead} of ${totalPages} pages.*`;
  }

  return {
    markdown,
    pageCount: pagesToRead,
    truncatedPages,
  };
}

/**
 * Pure-JS offline Word (.docx) XML parser (word/document.xml) preserving headings,
 * bullet/numbered lists, paragraphs, and Markdown tables.
 */
export function extractDocxXmlToMarkdown(xml) {
  if (!xml) return '';
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const extractRunText = block => {
    const runs = [];
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm;
    while ((tm = tRe.exec(block)) !== null) {
      runs.push(decodeXmlEntities(tm[1]));
    }
    return runs.join('').replace(/\s+/g, ' ').trim();
  };

  // Match top-level tables and paragraphs in document order
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  const out = [];
  let m;
  while ((m = blockRe.exec(body)) !== null) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl')) {
      const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
      const rows = [];
      let rm;
      while ((rm = trRe.exec(chunk)) !== null) {
        const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        const cells = [];
        let cm;
        while ((cm = tcRe.exec(rm[1])) !== null) {
          cells.push(extractRunText(cm[1]).replace(/\|/g, '\\|'));
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) {
        const cols = Math.max(...rows.map(r => r.length));
        const pad = r => Array.from({ length: cols }, (_, i) => r[i] || '');
        out.push(
          [
            `| ${pad(rows[0]).join(' | ')} |`,
            `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
            ...rows.slice(1).map(r => `| ${pad(r).join(' | ')} |`),
          ].join('\n')
        );
      }
      continue;
    }

    const txt = extractRunText(chunk);
    if (!txt) continue;
    const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(chunk);
    const styleVal = styleMatch ? styleMatch[1] : '';
    const headingMatch = /^Heading([1-4])$/i.exec(styleVal);
    if (headingMatch || /^Title$/i.test(styleVal)) {
      const lvl = headingMatch ? Math.min(4, Number(headingMatch[1])) : 1;
      out.push(`${'#'.repeat(lvl)} ${txt}`);
    } else if (/<w:numPr\b/.test(chunk) || /^List/i.test(styleVal)) {
      out.push(`- ${txt}`);
    } else {
      out.push(txt);
    }
  }
  return out.join('\n\n').trim();
}

/** Extract Word (.docx) content 100% offline via fflate unzip + word/document.xml parser. */
export async function extractDocxText(arrayBuffer) {
  const { unzipSync, strFromU8 } = await import('fflate');
  let entries;
  try {
    entries = unzipSync(new Uint8Array(arrayBuffer));
  } catch {
    throw new Error('Could not open this .docx file. Make sure it is a valid Microsoft Word document.');
  }
  const docEntry = entries['word/document.xml'];
  if (!docEntry) {
    throw new Error('No document body found inside this .docx file.');
  }
  const xml = strFromU8(docEntry);
  const markdown = extractDocxXmlToMarkdown(xml);
  if (!markdown) {
    throw new Error('This Word document appears to be empty (or images only).');
  }
  const approxPages = Math.max(1, Math.ceil(markdown.length / 2600));
  return { markdown, pageCount: approxPages };
}

/**
 * Extract any supported local file (.pdf, .pptx, .docx, .md, .txt) offline on-device.
 */
export async function extractDocument(file, { maxPages = MAX_DEFAULT_PDF_PAGES, onProgress = null } = {}) {
  if (!file) throw new Error('No file selected.');
  const name = file.name || 'Imported Note';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const title = titleFromFilename(name);

  if (ext === 'ppt') {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const { isZipMagic, extractLegacyPptText } = await import('./legacyPptParser');
    const res = isZipMagic(bytes)
      ? await extractPptxText(buf, { onProgress })
      : await extractLegacyPptText(buf, { onProgress });
    return { title, rawMarkdown: res.markdown, pageCount: res.pageCount, truncatedPages: 0, kind: 'pptx' };
  }

  if (ext === 'doc') {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const { isZipMagic } = await import('./legacyPptParser');
    if (isZipMagic(bytes)) {
      const res = await extractDocxText(buf);
      return { title, rawMarkdown: res.markdown, pageCount: res.pageCount, truncatedPages: 0, kind: 'docx' };
    }
    throw new Error('Legacy binary .doc files cannot be parsed offline — please re-save as .docx or .pdf first.');
  }

  if (ext === 'pptx') {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const { isOle2Magic, extractLegacyPptText } = await import('./legacyPptParser');
    const res = isOle2Magic(bytes)
      ? await extractLegacyPptText(buf, { onProgress })
      : await extractPptxText(buf, { onProgress });
    return { title, rawMarkdown: res.markdown, pageCount: res.pageCount, truncatedPages: 0, kind: 'pptx' };
  }

  if (ext === 'docx') {
    onProgress?.({ current: 1, total: 1, phase: 'docx' });
    const buf = await file.arrayBuffer();
    const res = await extractDocxText(buf);
    return { title, rawMarkdown: res.markdown, pageCount: res.pageCount, truncatedPages: 0, kind: 'docx' };
  }

  if (ext === 'pdf') {
    const buf = await file.arrayBuffer();
    const res = await extractPdfText(buf, { maxPages, onProgress });
    return {
      title,
      rawMarkdown: res.markdown,
      pageCount: res.pageCount,
      truncatedPages: res.truncatedPages,
      kind: 'pdf',
    };
  }

  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    const text = (await file.text()).replace(/\r\n?/g, '\n').trim();
    if (!text) throw new Error('This file is empty.');
    return { title, rawMarkdown: text, pageCount: 1, truncatedPages: 0, kind: ext === 'txt' ? 'txt' : 'md' };
  }

  throw new Error(`Unsupported file type ".${ext}". Please choose a .pdf, .ppt, .pptx, .docx, .md, or .txt file.`);
}

/**
 * Optional AI structuring pass — turns raw slide/PDF text into crisp Markdown study notes.
 * Free-tier friendly: 1 compact call for docs <= 9,000 chars, max 2 calls for longer docs.
 */
export async function structureImportedTextWithAI({
  title,
  rawMarkdown,
  subject = 'General',
  signal = null,
  onStatus = null,
}) {
  const cleanText = String(rawMarkdown || '').trim();
  if (!cleanText) return '';

  const CHUNK_LIMIT = 9000;
  const sys = `You are an expert study-note organizer. Transform the raw lecture slides or PDF text into clean, concise, high-yield Markdown study notes.

RULES:
- Use clear ## section headings and concise bullet points (bold key terms).
- Preserve all important formulas (format equations with LaTeX $...$ or $$...$$), definitions, dates, and examples.
- Remove slide numbers, redundant headers/footers, and filler text.
- End with a short "## Key Takeaways" section (3-4 bullets) and 2-3 relevant lowercase #tags on the last line.
- Write in the same language as the source document. Output ONLY the clean Markdown note (no preamble).`;

  if (cleanText.length <= CHUNK_LIMIT) {
    onStatus?.('Structuring study notes with AI…');
    const out = await aiText({
      system: sys,
      user: `SUBJECT: ${subject}\nDOCUMENT TITLE: ${title}\n\nRAW CONTENT:\n---\n${cleanText}\n---`,
      maxTokens: 2400,
      timeoutMs: 180000,
      signal,
    });
    return stripThinking(out).trim() || cleanText;
  }

  // Cap to 2 chunks (up to 18,000 chars) to protect free-tier rate limits
  const firstSlice = cleanText.slice(0, CHUNK_LIMIT);
  const secondSlice = cleanText.slice(CHUNK_LIMIT, CHUNK_LIMIT * 2);

  onStatus?.('Structuring part 1 of 2 with AI…');
  const part1 = stripThinking(
    await aiText({
      system: sys,
      user: `SUBJECT: ${subject}\nDOCUMENT TITLE: ${title} (Part 1 of 2)\n\nRAW CONTENT:\n---\n${firstSlice}\n---`,
      maxTokens: 1800,
      timeoutMs: 180000,
      signal,
    })
  ).trim();

  onStatus?.('Structuring part 2 of 2 with AI…');
  let part2 = '';
  try {
    part2 = stripThinking(
      await aiText({
        system: sys,
        user: `SUBJECT: ${subject}\nDOCUMENT TITLE: ${title} (Part 2 of 2)\n\nRAW CONTENT:\n---\n${secondSlice}\n---`,
        maxTokens: 1800,
        timeoutMs: 180000,
        signal,
      })
    ).trim();
  } catch (err) {
    if (err?.isCancelled) throw err;
    // Graceful fallback: keep Part 1 + raw remainder if Part 2 hits free-tier 429
    part2 = `## Continued (Raw Extract)\n${secondSlice}`;
  }

  const extraNotice =
    cleanText.length > CHUNK_LIMIT * 2
      ? '\n\n> *Note: Source was very long — AI structured the first ~18,000 characters to stay within API limits.*'
      : '';

  return [part1, part2].filter(Boolean).join('\n\n') + extraNotice;
}
