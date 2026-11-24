/**
 * Rich Offline Document Viewer Parser — pure JS parsing for PPTX slides,
 * DOCX structured documents, file type detection, and in-doc search.
 * Lazy-loaded strictly when the user opens a document inside DocumentViewerModal.
 */

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

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

function inferMimeFromPath(filePath) {
  const ext = String(filePath || '').split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXT[ext] || 'image/png';
}

export function detectDocKind(name = '', mime = '') {
  const cleanName = String(name || '').trim().toLowerCase();
  const ext = cleanName.includes('.') ? cleanName.split('.').pop() : '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'csv' || ext === 'json') return 'txt';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';

  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('presentation') || m.includes('powerpoint')) return 'pptx';
  if (m.includes('wordprocessingml') || m.includes('msword')) return 'docx';
  if (m.includes('markdown')) return 'md';
  if (m.startsWith('text/')) return 'txt';
  if (m.startsWith('image/')) return 'image';
  return 'unknown';
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extractPptxParagraphs(xml) {
  if (!xml) return [];
  const paragraphs = [];
  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pm;
  while ((pm = pRe.exec(xml)) !== null) {
    const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let tm;
    const runs = [];
    while ((tm = tRe.exec(pm[1])) !== null) {
      runs.push(decodeXmlEntities(tm[1]));
    }
    const line = runs.join('').replace(/\s+/g, ' ').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

function extractSlideTitle(xml) {
  const spRe = /<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g;
  let m;
  while ((m = spRe.exec(xml)) !== null) {
    if (/<p:ph\b[^>]*type="(?:title|ctrTitle)"/i.test(m[1])) {
      const paras = extractPptxParagraphs(m[1]);
      if (paras.length > 0) return paras.join(' ').trim();
    }
  }
  return '';
}

function parseRelsMap(relsXml, baseDir = 'ppt/slides') {
  const notesTargets = [];
  const imageTargets = [];
  const byId = {};
  if (!relsXml) return { notesTargets, imageTargets, byId };

  const relRe = /<Relationship\b[^>]*>/g;
  let m;
  while ((m = relRe.exec(relsXml)) !== null) {
    const tag = m[0];
    const idMatch = /\bId="([^"]+)"/i.exec(tag);
    const typeMatch = /\bType="([^"]+)"/i.exec(tag);
    const targetMatch = /\bTarget="([^"]+)"/i.exec(tag);
    if (!targetMatch) continue;

    const rawTarget = targetMatch[1];
    let resolved = rawTarget.replace(/^\/+/, '');
    if (resolved.startsWith('../')) {
      const prefix = baseDir.startsWith('word') ? 'word/' : 'ppt/';
      resolved = prefix + resolved.replace(/^(\.\.\/)+/, '');
    } else if (!resolved.startsWith('ppt/') && !resolved.startsWith('word/')) {
      resolved = `${baseDir}/${resolved}`;
    }

    if (idMatch) byId[idMatch[1]] = resolved;
    const relType = typeMatch ? typeMatch[1] : '';
    if (/notesSlide/i.test(relType) || /notesSlide/i.test(resolved)) {
      notesTargets.push(resolved);
    } else if (/\/image$/i.test(relType) || /\.(png|jpe?g|gif|webp|svg)$/i.test(resolved)) {
      imageTargets.push(resolved);
    }
  }
  return { notesTargets, imageTargets, byId };
}

/**
 * Parse a .pptx buffer into structured slides with title, bullets, speaker notes, and embedded images.
 */
export async function extractPptxSlidesRich(input) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Could not open this PowerPoint (.pptx) file.');
  }

  const slideFiles = Object.keys(entries)
    .map(name => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name);
      return m ? { name, num: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  if (slideFiles.length === 0) {
    throw new Error('No slides found inside this PowerPoint presentation.');
  }

  const slides = slideFiles.map(({ name, num }) => {
    const slideXml = strFromU8(entries[name]);
    const explicitTitle = extractSlideTitle(slideXml);
    const allParas = extractPptxParagraphs(slideXml);

    let title = explicitTitle;
    let bullets = allParas;
    if (title) {
      let removed = false;
      bullets = allParas.filter(p => {
        if (!removed && p === title) {
          removed = true;
          return false;
        }
        return true;
      });
    } else if (allParas.length > 0 && allParas[0].length <= 120) {
      title = allParas[0];
      bullets = allParas.slice(1);
    }
    bullets = bullets.filter(p => p !== String(num));

    const relsPath = `ppt/slides/_rels/slide${num}.xml.rels`;
    const relsXml = entries[relsPath] ? strFromU8(entries[relsPath]) : '';
    const rels = parseRelsMap(relsXml, 'ppt/slides');

    const notesPath = rels.notesTargets[0] || `ppt/notesSlides/notesSlide${num}.xml`;
    const notes = entries[notesPath]
      ? extractPptxParagraphs(strFromU8(entries[notesPath])).filter(p => p !== String(num))
      : [];

    const images = [];
    const seenPaths = new Set();
    for (const imgPath of rels.imageTargets) {
      if (seenPaths.has(imgPath) || !entries[imgPath]) continue;
      seenPaths.add(imgPath);
      images.push({
        name: imgPath.split('/').pop() || `slide-${num}-img`,
        mime: inferMimeFromPath(imgPath),
        bytes: new Uint8Array(entries[imgPath]),
      });
    }

    return {
      num,
      title: title || `Slide ${num}`,
      bullets,
      notes,
      images,
    };
  });

  return { slides, totalSlides: slides.length };
}

function parseDocxRuns(paragraphXml) {
  const runs = [];
  const rRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let rm;
  while ((rm = rRe.exec(paragraphXml)) !== null) {
    const rInner = rm[1];
    const rPrMatch = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(rInner);
    const rPr = rPrMatch ? rPrMatch[1] : '';

    const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")/i.test(rPr);
    const italic = /<w:i\b(?![^>]*w:val="(?:0|false)")/i.test(rPr);
    const underline = /<w:u\b(?![^>]*w:val="none")/i.test(rPr);
    const code = /(?:Consolas|Courier|Menlo|Monaco|Roboto Mono|Mono)/i.test(rPr);

    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm;
    const textParts = [];
    while ((tm = tRe.exec(rInner)) !== null) {
      textParts.push(decodeXmlEntities(tm[1]));
    }
    const text = textParts.join('');
    if (!text) continue;

    const prev = runs[runs.length - 1];
    if (
      prev &&
      prev.bold === bold &&
      prev.italic === italic &&
      prev.underline === underline &&
      prev.code === code
    ) {
      prev.text += text;
    } else {
      runs.push({ text, bold, italic, underline, code });
    }
  }
  return runs;
}

/**
 * Parse a .docx buffer into structured rich blocks (headings, formatted runs,
 * grouped lists, tables, and embedded Word media images).
 */
export async function extractDocxRich(input) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Could not open this Word (.docx) document.');
  }

  const docEntry = entries['word/document.xml'];
  if (!docEntry) {
    throw new Error('No readable content found inside this .docx file.');
  }

  const xml = strFromU8(docEntry);
  const relsXml = entries['word/_rels/document.xml.rels']
    ? strFromU8(entries['word/_rels/document.xml.rels'])
    : '';
  const rels = parseRelsMap(relsXml, 'word');

  const bodyMatch = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;

  const blocks = [];
  let charTotal = 0;
  let m;

  const flushListItem = (ordered, runs) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'list' && last.ordered === ordered) {
      last.items.push(runs);
    } else {
      blocks.push({ type: 'list', ordered, items: [runs] });
    }
  };

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
          const runs = parseDocxRuns(cm[1]);
          const cellText = runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
          cells.push(cellText);
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
        charTotal += rows.reduce((acc, r) => acc + r.join(' ').length, 0);
      }
      continue;
    }

    // Extract inline embedded images inside this paragraph if present
    const imgRefRe = /(?:r:embed|r:id)="([^"]+)"/g;
    let im;
    while ((im = imgRefRe.exec(chunk)) !== null) {
      const targetPath = rels.byId[im[1]];
      if (targetPath && entries[targetPath]) {
        blocks.push({
          type: 'image',
          name: targetPath.split('/').pop() || im[1],
          mime: inferMimeFromPath(targetPath),
          bytes: new Uint8Array(entries[targetPath]),
        });
      }
    }

    const runs = parseDocxRuns(chunk);
    const plain = runs.map(r => r.text).join('').trim();
    if (!plain) continue;
    charTotal += plain.length;

    const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(chunk);
    const styleVal = styleMatch ? styleMatch[1] : '';
    const headingMatch = /^Heading([1-4])$/i.exec(styleVal);

    if (headingMatch || /^Title$/i.test(styleVal)) {
      const level = headingMatch ? Math.min(4, Number(headingMatch[1])) : 1;
      blocks.push({ type: 'heading', level, runs });
    } else if (/<w:numPr\b/.test(chunk) || /^List/i.test(styleVal)) {
      const ordered = /Number|Decimal/i.test(styleVal);
      flushListItem(ordered, runs);
    } else {
      blocks.push({ type: 'paragraph', runs });
    }
  }

  return {
    blocks,
    approxPages: Math.max(1, Math.ceil(charTotal / 2400)),
  };
}

/** Search plain-text segments inside a loaded document and return jumpable match locations. */
export function searchDocMatches(items = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(items)) return [];
  const matches = [];
  for (const item of items) {
    const raw = String(item?.text || '');
    const lower = raw.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 24);
    const end = Math.min(raw.length, idx + q.length + 36);
    const excerpt = `${start > 0 ? '…' : ''}${raw.slice(start, end).replace(/\s+/g, ' ').trim()}${end < raw.length ? '…' : ''}`;
    matches.push({
      index: item.index,
      label: item.label || `#${item.index + 1}`,
      excerpt,
    });
    if (matches.length >= 150) break;
  }
  return matches;
}
