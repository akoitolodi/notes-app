/**
 * Legacy PowerPoint (.ppt, OLE2/CFBF + [MS-PPT]) Pure-JS Offline Parser
 * -----------------------------------------------------------------------
 * Extracts slides, titles, body bullets, speaker notes, and embedded PNG/JPEG
 * pictures 100% offline with zero native dependencies.
 * Lazy-loaded only when the user imports or opens a .ppt binary file.
 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const MAX_PICTURES = 16;

const BOILERPLATE_LINES = new Set([
  'click to add title',
  'click to add subtitle',
  'click to add text',
  'click to edit master title style',
  'click to edit master text styles',
]);

export function isZipMagic(bytes) {
  return Boolean(
    bytes &&
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05) &&
      (bytes[3] === 0x04 || bytes[3] === 0x06)
  );
}

export function isOle2Magic(bytes) {
  return Boolean(
    bytes &&
      bytes.length >= 8 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0 &&
      bytes[4] === 0xa1 &&
      bytes[5] === 0xb1 &&
      bytes[6] === 0x1a &&
      bytes[7] === 0xe1
  );
}

function readU16(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8);
}

function readU32(bytes, off) {
  return (
    (bytes[off] |
      (bytes[off + 1] << 8) |
      (bytes[off + 2] << 16) |
      (bytes[off + 3] << 24)) >>>
    0
  );
}

function decodeUtf16Le(bytes, start, end) {
  let out = '';
  for (let i = start; i + 1 < end; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

const WIN1252_EXTRA = {
  0x80: '\u20ac',
  0x82: '\u201a',
  0x83: '\u0192',
  0x84: '\u201e',
  0x85: '\u2026',
  0x86: '\u2020',
  0x87: '\u2021',
  0x88: '\u02c6',
  0x89: '\u2030',
  0x8a: '\u0160',
  0x8b: '\u2039',
  0x8c: '\u0152',
  0x8e: '\u017d',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
  0x98: '\u02dc',
  0x99: '\u2122',
  0x9a: '\u0161',
  0x9b: '\u203a',
  0x9c: '\u0153',
  0x9e: '\u017e',
  0x9f: '\u0178',
};

function decodeLatin1Win1252(bytes, start, end) {
  let out = '';
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    if (b === 0) continue;
    out += b >= 0x80 && b <= 0x9f ? WIN1252_EXTRA[b] || '' : String.fromCharCode(b);
  }
  return out;
}

function cleanTextLines(rawText) {
  const normalized = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\x0b/g, '\n');
  const lines = [];
  for (const part of normalized.split('\n')) {
    const line = part.replace(/[\x00-\x08\x0c\x0e-\x1f]/g, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (BOILERPLATE_LINES.has(line.toLowerCase())) continue;
    lines.push(line);
  }
  return lines;
}

/**
 * Parse an OLE2/CFBF binary buffer into named streams.
 */
export function parseOle2Streams(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isOle2Magic(bytes) || bytes.length < 512) {
    throw new Error('Not a valid OLE2 PowerPoint (.ppt) container.');
  }

  const sectorShift = readU16(bytes, 0x1e);
  const miniSectorShift = readU16(bytes, 0x20);
  if (sectorShift !== 9 && sectorShift !== 12) {
    throw new Error('Unsupported CFBF sector size in .ppt file.');
  }
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = miniSectorShift === 6 ? 64 : 1 << miniSectorShift;

  const firstDirSector = readU32(bytes, 0x30);
  const miniStreamCutoff = readU32(bytes, 0x38) || 4096;
  const firstMiniFatSector = readU32(bytes, 0x3c);
  const numMiniFatSectors = readU32(bytes, 0x40);
  const firstDifatSector = readU32(bytes, 0x44);
  const numDifatSectors = readU32(bytes, 0x48);

  const maxSectors = Math.max(1, Math.floor((bytes.length - 512) / sectorSize) + 2);
  const sectorOffset = sid => 512 + sid * sectorSize;

  // 1. Collect FAT sector IDs from header DIFAT (109 slots) + extra DIFAT chain
  const fatSectorIds = [];
  for (let i = 0; i < 109; i++) {
    const sid = readU32(bytes, 0x4c + i * 4);
    if (sid !== FREESECT && sid !== ENDOFCHAIN && sid < 0xfffffffa) {
      fatSectorIds.push(sid);
    }
  }
  let difatCur = firstDifatSector;
  let difatSteps = 0;
  const difatPerSector = Math.floor(sectorSize / 4) - 1;
  while (
    numDifatSectors > 0 &&
    difatCur < 0xfffffffa &&
    difatSteps < numDifatSectors &&
    difatSteps < maxSectors
  ) {
    const off = sectorOffset(difatCur);
    if (off + sectorSize > bytes.length) break;
    for (let i = 0; i < difatPerSector; i++) {
      const sid = readU32(bytes, off + i * 4);
      if (sid !== FREESECT && sid !== ENDOFCHAIN && sid < 0xfffffffa) {
        fatSectorIds.push(sid);
      }
    }
    difatCur = readU32(bytes, off + difatPerSector * 4);
    difatSteps++;
  }

  // 2. Build FAT array
  const entriesPerSector = sectorSize >> 2;
  const fat = new Uint32Array(fatSectorIds.length * entriesPerSector);
  for (let s = 0; s < fatSectorIds.length; s++) {
    const off = sectorOffset(fatSectorIds[s]);
    if (off + sectorSize > bytes.length) continue;
    const base = s * entriesPerSector;
    for (let i = 0; i < entriesPerSector; i++) {
      fat[base + i] = readU32(bytes, off + i * 4);
    }
  }

  const readFatChain = (startSect, limitBytes = Infinity) => {
    if (startSect >= 0xfffffffa || startSect >= fat.length) return new Uint8Array(0);
    const chunks = [];
    let total = 0;
    let cur = startSect;
    let steps = 0;
    const visited = new Set();
    while (cur < 0xfffffffa && cur < fat.length && steps <= maxSectors && !visited.has(cur)) {
      visited.add(cur);
      const off = sectorOffset(cur);
      if (off < 0 || off + sectorSize > bytes.length) break;
      const take = Math.min(sectorSize, limitBytes - total);
      if (take <= 0) break;
      chunks.push(bytes.subarray(off, off + take));
      total += take;
      if (total >= limitBytes) break;
      cur = fat[cur];
      steps++;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  };

  // 3. Read Directory Entries
  const dirBytes = readFatChain(firstDirSector);
  const dirEntries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const objType = dirBytes[off + 0x42];
    if (objType === 0) continue;
    const nameByteLen = Math.min(64, readU16(dirBytes, off + 0x40));
    const name = decodeUtf16Le(dirBytes, off, off + Math.max(0, nameByteLen - 2)).trim();
    const startSect = readU32(dirBytes, off + 0x74);
    const streamSize = readU32(dirBytes, off + 0x78);
    if (name) {
      dirEntries.push({ name, objType, startSect, streamSize });
    }
  }

  // 4. Mini-FAT & Root Mini-Stream
  const rootEntry = dirEntries.find(e => e.objType === 5);
  const miniContainer =
    rootEntry && rootEntry.streamSize > 0
      ? readFatChain(rootEntry.startSect, rootEntry.streamSize)
      : new Uint8Array(0);

  let miniFat = new Uint32Array(0);
  if (numMiniFatSectors > 0 && firstMiniFatSector < 0xfffffffa) {
    const mfBytes = readFatChain(firstMiniFatSector);
    miniFat = new Uint32Array(Math.floor(mfBytes.length / 4));
    for (let i = 0; i < miniFat.length; i++) {
      miniFat[i] = readU32(mfBytes, i * 4);
    }
  }

  const readMiniChain = (startSect, size) => {
    if (!size || startSect >= 0xfffffffa || miniFat.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(size);
    let pos = 0;
    let cur = startSect;
    let steps = 0;
    const maxMini = Math.ceil(miniContainer.length / miniSectorSize) + 4;
    const visited = new Set();
    while (cur < 0xfffffffa && cur < miniFat.length && pos < size && steps <= maxMini && !visited.has(cur)) {
      visited.add(cur);
      const mOff = cur * miniSectorSize;
      if (mOff + miniSectorSize > miniContainer.length) break;
      const take = Math.min(miniSectorSize, size - pos);
      out.set(miniContainer.subarray(mOff, mOff + take), pos);
      pos += take;
      cur = miniFat[cur];
      steps++;
    }
    return pos === size ? out : out.subarray(0, pos);
  };

  const streams = Object.create(null);
  for (const ent of dirEntries) {
    if (ent.objType !== 2 || ent.streamSize === 0) continue;
    if (ent.streamSize < miniStreamCutoff && miniContainer.length > 0 && miniFat.length > 0) {
      streams[ent.name] = readMiniChain(ent.startSect, ent.streamSize);
    } else {
      streams[ent.name] = readFatChain(ent.startSect, ent.streamSize);
    }
  }

  return streams;
}

/**
 * Scan the optional OLE2 "Pictures" stream for embedded PNG and JPEG images.
 */
function extractLegacyPictures(picBytes) {
  if (!picBytes || picBytes.length < 16) return [];
  const images = [];
  let totalBytes = 0;
  let i = 0;

  while (i < picBytes.length - 12 && images.length < MAX_PICTURES && totalBytes < MAX_PICTURE_BYTES) {
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    if (
      picBytes[i] === 0x89 &&
      picBytes[i + 1] === 0x50 &&
      picBytes[i + 2] === 0x4e &&
      picBytes[i + 3] === 0x47 &&
      picBytes[i + 4] === 0x0d &&
      picBytes[i + 5] === 0x0a &&
      picBytes[i + 6] === 0x1a &&
      picBytes[i + 7] === 0x0a
    ) {
      let end = -1;
      for (let j = i + 8; j <= picBytes.length - 8; j++) {
        if (
          picBytes[j] === 0x49 &&
          picBytes[j + 1] === 0x45 &&
          picBytes[j + 2] === 0x4e &&
          picBytes[j + 3] === 0x44 &&
          picBytes[j + 4] === 0xae &&
          picBytes[j + 5] === 0x42 &&
          picBytes[j + 6] === 0x60 &&
          picBytes[j + 7] === 0x82
        ) {
          end = j + 8;
          break;
        }
      }
      if (end > i + 16 && totalBytes + (end - i) <= MAX_PICTURE_BYTES) {
        const slice = picBytes.slice(i, end);
        images.push({
          name: `picture-${images.length + 1}.png`,
          mime: 'image/png',
          bytes: slice,
        });
        totalBytes += slice.length;
        i = end;
        continue;
      }
    }

    // JPEG magic: FF D8 FF ... FF D9
    if (picBytes[i] === 0xff && picBytes[i + 1] === 0xd8 && picBytes[i + 2] === 0xff) {
      let end = -1;
      for (let j = i + 4; j < picBytes.length - 1; j++) {
        if (picBytes[j] === 0xff && picBytes[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end > i + 64 && totalBytes + (end - i) <= MAX_PICTURE_BYTES) {
        const slice = picBytes.slice(i, end);
        images.push({
          name: `picture-${images.length + 1}.jpg`,
          mime: 'image/jpeg',
          bytes: slice,
        });
        totalBytes += slice.length;
        i = end;
        continue;
      }
    }
    i++;
  }

  return images;
}

const RT_DOCUMENT = 0x03e8;
const RT_SLIDE = 0x03ee;
const RT_NOTES = 0x03f0;
const RT_SLIDE_PERSIST_ATOM = 0x03f3;
const RT_MAIN_MASTER = 0x03f8;
const RT_TEXT_HEADER_ATOM = 0x0f9f;
const RT_TEXT_CHARS_ATOM = 0x0fa0;
const RT_TEXT_BYTES_ATOM = 0x0fa8;
const RT_SLIDE_LIST_WITH_TEXT = 0x0ff0;

/**
 * Parse a binary .ppt (OLE2) ArrayBuffer/Uint8Array into structured slides compatible with DocumentViewerModal.
 */
export function extractLegacyPptSlidesRich(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isZipMagic(bytes)) {
    return { isZip: true, slides: [], totalSlides: 0 };
  }

  const streams = parseOle2Streams(bytes);
  const pptKey = Object.keys(streams).find(k => k.toLowerCase() === 'powerpoint document');
  const pptStream = pptKey ? streams[pptKey] : null;
  if (!pptStream || pptStream.length < 16) {
    throw new Error('Could not find PowerPoint slide records inside this .ppt file.');
  }

  const picKey = Object.keys(streams).find(k => k.toLowerCase() === 'pictures');
  const extractedImages = picKey ? extractLegacyPictures(streams[picKey]) : [];

  const slwtSlides = [];
  const slwtNotes = [];
  const containerSlides = [];
  const containerNotes = [];
  const fallbackLines = [];

  const createBucket = () => ({ title: '', bullets: [], notes: [] });

  const addTextToBucket = (bucket, headerType, rawLines) => {
    for (const line of rawLines) {
      if ((headerType === 0 || headerType === 6) && !bucket.title) {
        bucket.title = line;
      } else if (headerType === 2) {
        bucket.notes.push(line);
      } else {
        bucket.bullets.push(line);
      }
    }
  };

  let curSlwtList = null;
  let curSlwtBucket = null;
  let curContainerBucket = null;
  let curContainerKind = null; // 'slide' | 'notes'
  let lastHeaderType = 1;
  let inMaster = false;

  const walk = (start, end) => {
    let pos = start;
    while (pos + 8 <= end) {
      const verInst = readU16(pptStream, pos);
      const isContainer = (verInst & 0x0f) === 0x0f;
      const instance = verInst >> 4;
      const recType = readU16(pptStream, pos + 2);
      const recLen = readU32(pptStream, pos + 4);
      const payloadStart = pos + 8;
      const payloadEnd = Math.min(end, payloadStart + recLen);

      if (recType === RT_MAIN_MASTER) {
        const prev = inMaster;
        inMaster = true;
        if (isContainer) walk(payloadStart, payloadEnd);
        inMaster = prev;
        pos = payloadEnd;
        continue;
      }

      if (recType === RT_SLIDE_LIST_WITH_TEXT && isContainer) {
        const prevList = curSlwtList;
        const prevBucket = curSlwtBucket;
        if (instance === 0) curSlwtList = slwtSlides;
        else if (instance === 2) curSlwtList = slwtNotes;
        else curSlwtList = null;
        curSlwtBucket = null;
        walk(payloadStart, payloadEnd);
        curSlwtList = prevList;
        curSlwtBucket = prevBucket;
        pos = payloadEnd;
        continue;
      }

      if (recType === RT_SLIDE_PERSIST_ATOM && curSlwtList) {
        const bucket = createBucket();
        curSlwtList.push(bucket);
        curSlwtBucket = bucket;
        lastHeaderType = curSlwtList === slwtNotes ? 2 : 1;
        pos = payloadEnd;
        continue;
      }

      if (recType === RT_SLIDE && isContainer) {
        const bucket = createBucket();
        containerSlides.push(bucket);
        const prevBucket = curContainerBucket;
        const prevKind = curContainerKind;
        curContainerBucket = bucket;
        curContainerKind = 'slide';
        lastHeaderType = 1;
        walk(payloadStart, payloadEnd);
        curContainerBucket = prevBucket;
        curContainerKind = prevKind;
        pos = payloadEnd;
        continue;
      }

      if (recType === RT_NOTES && isContainer) {
        const bucket = createBucket();
        containerNotes.push(bucket);
        const prevBucket = curContainerBucket;
        const prevKind = curContainerKind;
        curContainerBucket = bucket;
        curContainerKind = 'notes';
        lastHeaderType = 2;
        walk(payloadStart, payloadEnd);
        curContainerBucket = prevBucket;
        curContainerKind = prevKind;
        pos = payloadEnd;
        continue;
      }

      if (recType === RT_TEXT_HEADER_ATOM && payloadEnd >= payloadStart + 4) {
        lastHeaderType = readU32(pptStream, payloadStart);
        pos = payloadEnd;
        continue;
      }

      if ((recType === RT_TEXT_CHARS_ATOM || recType === RT_TEXT_BYTES_ATOM) && !inMaster) {
        const decoded =
          recType === RT_TEXT_CHARS_ATOM
            ? decodeUtf16Le(pptStream, payloadStart, payloadEnd)
            : decodeLatin1Win1252(pptStream, payloadStart, payloadEnd);
        const lines = cleanTextLines(decoded);
        if (lines.length > 0) {
          if (curSlwtBucket) {
            addTextToBucket(
              curSlwtBucket,
              curSlwtList === slwtNotes ? 2 : lastHeaderType,
              lines
            );
          } else if (curContainerBucket) {
            addTextToBucket(
              curContainerBucket,
              curContainerKind === 'notes' ? 2 : lastHeaderType,
              lines
            );
          } else {
            fallbackLines.push(...lines);
          }
        }
        pos = payloadEnd;
        continue;
      }

      if (isContainer) {
        walk(payloadStart, payloadEnd);
      }

      if (payloadEnd <= pos) break;
      pos = payloadEnd;
    }
  };

  walk(0, pptStream.length);

  // Merge SlideListWithText & container records cleanly without duplicate lines
  const slwtHasContent = slwtSlides.some(s => s.title || s.bullets.length > 0);
  const chosenSlides = slwtHasContent ? slwtSlides : containerSlides;

  // Pair notes when counts align or merge non-empty notes sequentially
  const noteBuckets = slwtNotes.some(n => n.notes.length > 0)
    ? slwtNotes
    : containerNotes;

  const normalized = [];
  for (let idx = 0; idx < chosenSlides.length; idx++) {
    const raw = chosenSlides[idx];
    const num = idx + 1;
    let title = raw.title || '';
    let bullets = [...raw.bullets];

    // Add any extra container bullets if SlideListWithText missed autoshape text on same slide
    if (slwtHasContent && containerSlides[idx]) {
      const seen = new Set([title, ...bullets]);
      for (const extra of [containerSlides[idx].title, ...containerSlides[idx].bullets]) {
        if (extra && !seen.has(extra)) {
          seen.add(extra);
          bullets.push(extra);
        }
      }
    }

    if (!title && bullets.length > 0 && bullets[0].length <= 120) {
      title = bullets[0];
      bullets = bullets.slice(1);
    }

    bullets = bullets.filter(b => b && b !== String(num));

    const notes = [
      ...raw.notes,
      ...(noteBuckets[idx]?.notes || []),
    ].filter(n => n && n !== String(num));

    if (!title && bullets.length === 0 && notes.length === 0 && idx > 0 && extractedImages.length === 0) {
      continue;
    }

    const slideNum = normalized.length + 1;
    normalized.push({
      num: slideNum,
      title: title || `Slide ${slideNum}`,
      bullets,
      richBullets: bullets.map(b => ({ level: 0, runs: [{ text: b }] })),
      tables: [],
      diagramTexts: [],
      notes,
      images: slideNum === 1 ? extractedImages : [],
      bgColor: null,
    });
  }

  if (normalized.length === 0 && (fallbackLines.length > 0 || extractedImages.length > 0)) {
    const chunkSize = 8;
    const totalChunks = Math.max(1, Math.ceil(fallbackLines.length / chunkSize));
    for (let i = 0; i < totalChunks; i++) {
      const chunk = fallbackLines.slice(i * chunkSize, (i + 1) * chunkSize);
      const slideNum = i + 1;
      normalized.push({
        num: slideNum,
        title: chunk[0] || `Slide ${slideNum}`,
        bullets: chunk.slice(1),
        richBullets: chunk.slice(1).map(b => ({ level: 0, runs: [{ text: b }] })),
        tables: [],
        diagramTexts: [],
        notes: [],
        images: slideNum === 1 ? extractedImages : [],
        bgColor: null,
      });
    }
  }

  if (normalized.length === 0) {
    throw new Error(
      'No readable slides or text records found in this .ppt file (it may be encrypted or password-protected).'
    );
  }

  return { slides: normalized, totalSlides: normalized.length };
}

/**
 * Extract Markdown text + slide count from a binary .ppt buffer for Note/Course importing.
 */
export async function extractLegacyPptText(input, { onProgress = null } = {}) {
  const { slides } = extractLegacyPptSlidesRich(input);
  const sections = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    onProgress?.({ current: i + 1, total: slides.length, phase: 'slides' });
    const lines = [];
    lines.push(s.title ? `## Slide ${s.num}: ${s.title}` : `## Slide ${s.num}`);
    for (const b of s.bullets) {
      lines.push(`- ${b}`);
    }
    if (s.notes.length > 0) {
      lines.push(`> **Speaker Notes:** ${s.notes.join(' ')}`);
    }
    if (s.bullets.length > 0 || s.title || s.notes.length > 0) {
      sections.push(lines.join('\n'));
    }
  }

  if (sections.length === 0) {
    throw new Error('This PowerPoint contains no extractable text (slides may be images only).');
  }

  return {
    markdown: sections.join('\n\n'),
    pageCount: slides.length,
    truncatedPages: 0,
  };
}
