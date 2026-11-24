import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  detectDocKind,
  formatFileSize,
  extractPptxSlidesRich,
  extractDocxRich,
  searchDocMatches,
} from '../src/lib/docViewerParser';
import {
  extractLegacyPptSlidesRich,
  extractLegacyPptText,
} from '../src/lib/legacyPptParser';
import { extractDocument } from '../src/lib/docImporter';
import {
  db,
  ensureSeeded,
  createFolder,
  createNote,
  updateNote,
  saveFileAttachment,
  resolveFileBlob,
  deleteFileAttachment,
  saveCourseMaterialWithChunks,
  deleteCourseMaterial,
  noteHasContent,
} from '../src/store/db';

describe('v2.0.7 Document Viewer Parser & Binary Attachments', () => {
  it('detects document kinds from filename/mime and formats file sizes', () => {
    expect(detectDocKind('Lecture 3.PDF')).toBe('pdf');
    expect(detectDocKind('Week4_Slides.pptx')).toBe('pptx');
    expect(detectDocKind('Syllabus.docx')).toBe('docx');
    expect(detectDocKind('README.md')).toBe('md');
    expect(detectDocKind('notes.txt')).toBe('txt');
    expect(detectDocKind('unnamed', 'application/pdf')).toBe('pdf');
    expect(formatFileSize(1536000)).toBe('1.5 MB');
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('parses rich PPTX slides with titles, bullets, speaker notes, and embedded images', async () => {
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const slideXml = `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Binary Trees</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:txBody><a:p><a:r><a:t>Every node has at most two children</a:t></a:r></a:p><a:p><a:r><a:t>O(log n) balanced lookup</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`;
    const slideRels = `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/diagram.png"/>
      </Relationships>`;
    const notesXml = `<?xml version="1.0"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Explain height vs depth cleanly.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;

    const zipped = zipSync({
      'ppt/slides/slide1.xml': strToU8(slideXml),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(slideRels),
      'ppt/notesSlides/notesSlide1.xml': strToU8(notesXml),
      'ppt/media/diagram.png': fakePng,
    });

    const parsed = await extractPptxSlidesRich(zipped);
    expect(parsed.totalSlides).toBe(1);
    expect(parsed.slides[0].title).toBe('Binary Trees');
    expect(parsed.slides[0].bullets).toEqual([
      'Every node has at most two children',
      'O(log n) balanced lookup',
    ]);
    expect(parsed.slides[0].notes).toEqual(['Explain height vs depth cleanly.']);
    expect(parsed.slides[0].images.length).toBe(1);
    expect(parsed.slides[0].images[0].mime).toBe('image/png');
    expect(parsed.slides[0].images[0].bytes.length).toBe(fakePng.length);
  });

  it('parses rich DOCX headings, formatted runs, lists, tables, and embedded images', async () => {
    const fakeImg = new Uint8Array([137, 80, 78, 71, 4, 5, 6]);
    const docXml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Operating Systems</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Kernel</w:t></w:r><w:r><w:t> manages hardware.</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Scheduling</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Memory</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Algo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Speed</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>FIFO</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>O(1)</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:r><a:blip r:embed="rImg1"/></w:r></w:p>
        </w:body>
      </w:document>`;;
    const docRels = `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/>
      </Relationships>`;

    const zipped = zipSync({
      'word/document.xml': strToU8(docXml),
      'word/_rels/document.xml.rels': strToU8(docRels),
      'word/media/chart.png': fakeImg,
    });

    const parsed = await extractDocxRich(zipped);
    expect(parsed.blocks.some(b => b.type === 'heading' && b.level === 1)).toBe(true);
    const para = parsed.blocks.find(b => b.type === 'paragraph');
    expect(para.runs[0]).toMatchObject({ text: 'Kernel', bold: true });
    const list = parsed.blocks.find(b => b.type === 'list');
    expect(list.items.length).toBe(2);
    const tbl = parsed.blocks.find(b => b.type === 'table');
    expect(tbl.rows).toEqual([
      ['Algo', 'Speed'],
      ['FIFO', 'O(1)'],
    ]);
    const img = parsed.blocks.find(b => b.type === 'image');
    expect(img).toBeDefined();
    expect(img.bytes.length).toBe(fakeImg.length);
  });

  it('searches document sections case-insensitively', () => {
    const hits = searchDocMatches(
      [
        { index: 0, label: 'Page 1', text: 'Introduction to Networks' },
        { index: 1, label: 'Page 2', text: 'TCP Congestion Control and Subnetting' },
      ],
      'subnetting'
    );
    expect(hits.length).toBe(1);
    expect(hits[0].index).toBe(1);
    expect(hits[0].label).toBe('Page 2');
  });

  it('stores, resolves, and cleans up Blob attachments for Notes and Course Materials', async () => {
    await ensureSeeded();
    const fid = await createFolder('CS Viewer Test');
    const note = await createNote(fid, '', '', 'CS Viewer Test');
    expect(noteHasContent(note)).toBe(false);

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' });
    const meta = await saveFileAttachment(note.id, blob, {
      kind: 'pdf',
      name: 'Week1.pdf',
      pageCount: 5,
    });
    await updateNote(note.id, { files: [meta] });
    const updated = await db.notes.get(note.id);
    expect(noteHasContent(updated)).toBe(true);

    const resolved = await resolveFileBlob(meta);
    expect(resolved).not.toBeNull();
    expect(resolved.size).toBe(4);

    await deleteFileAttachment(meta.id);
    expect(await resolveFileBlob(meta)).toBeNull();

    const mat = await saveCourseMaterialWithChunks({
      courseId: 99,
      moduleName: 'Week 1',
      title: 'Slides 1',
      kind: 'pptx',
      fileName: 'slides1.pptx',
      extractedText: 'Slide 1 text',
      pageCount: 1,
      fileBlob: blob,
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    expect(mat.attachmentId).toBe(`mat-${mat.id}`);
    expect(await resolveFileBlob(mat)).not.toBeNull();

    await deleteCourseMaterial(mat.id);
    expect(await resolveFileBlob(mat)).toBeNull();
  });

  it('prevents premature cleanup on parent re-renders and defaults dark themes to night mode', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const modalSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/components/DocumentViewerModal.jsx'),
      'utf8'
    );
    expect(modalSrc).toContain('detectDefaultReaderTheme');
    expect(modalSrc).toContain('onCloseRef');
    expect(modalSrc).not.toMatch(/cleanupDocResources\(\);\s*\};\s*\},\s*\[\s*onClose/);
    expect(modalSrc).toContain('[cleanupDocResources]');
  });
});

function writeU16(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}

function writeU32(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
  buf[off + 2] = (v >> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

function writeDirEntry(buf, off, name, objType, startSect, streamSize) {
  for (let i = 0; i < name.length; i++) {
    writeU16(buf, off + i * 2, name.charCodeAt(i));
  }
  writeU16(buf, off + 0x40, (name.length + 1) * 2);
  buf[off + 0x42] = objType;
  writeU32(buf, off + 0x74, startSect);
  writeU32(buf, off + 0x78, streamSize);
}

function pptRec(verInst, recType, payload) {
  const out = new Uint8Array(8 + payload.length);
  writeU16(out, 0, verInst);
  writeU16(out, 2, recType);
  writeU32(out, 4, payload.length);
  out.set(payload, 8);
  return out;
}

function utf16LeBytes(str) {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) writeU16(out, i * 2, str.charCodeAt(i));
  return out;
}

function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function buildSyntheticOle2Ppt() {
  const hdrTitle = new Uint8Array(4);
  writeU32(hdrTitle, 0, 0); // Title
  const hdrBody = new Uint8Array(4);
  writeU32(hdrBody, 0, 1); // Body
  const hdrNotes = new Uint8Array(4);
  writeU32(hdrNotes, 0, 2); // Notes
  const persistPayload = new Uint8Array(20);

  const slwtSlides = pptRec(
    0x000f,
    0x0ff0,
    concatBytes([
      pptRec(0x0000, 0x03f3, persistPayload),
      pptRec(0x0000, 0x0f9f, hdrTitle),
      pptRec(0x0000, 0x0fa0, utf16LeBytes('Legacy Binary Heaps')),
      pptRec(0x0000, 0x0f9f, hdrBody),
      pptRec(0x0000, 0x0fa8, asciiBytes('Push runs in O(log n)\rClick to add text')),
      pptRec(0x0000, 0x03f3, persistPayload),
      pptRec(0x0000, 0x0f9f, hdrTitle),
      pptRec(0x0000, 0x0fa8, asciiBytes('Classic PPT Notes')),
      pptRec(0x0000, 0x0f9f, hdrBody),
      pptRec(0x0000, 0x0fa0, utf16LeBytes('Parsed offline without cloud tools')),
    ])
  );

  const slwtNotes = pptRec(
    0x002f,
    0x0ff0,
    concatBytes([
      pptRec(0x0000, 0x03f3, persistPayload),
      pptRec(0x0000, 0x0f9f, hdrNotes),
      pptRec(0x0000, 0x0fa8, asciiBytes('Explain heap property on whiteboard.')),
    ])
  );

  const pptPayload = concatBytes([slwtSlides, slwtNotes]);
  const pptStream = new Uint8Array(4096); // >= 4096 uses regular FAT
  pptStream.set(pptPayload, 0);

  // Tiny valid-signature PNG (< 4096 uses Mini-FAT)
  const fakePng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const picStream = new Uint8Array(96);
  picStream.set(fakePng, 0);

  // Sectors: 0=FAT, 1=Dir, 2=MiniFAT, 3=MiniStream(Root), 4..11=PowerPoint Document (8 sectors)
  const totalSectors = 12;
  const buf = new Uint8Array((1 + totalSectors) * 512);
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  writeU16(buf, 0x18, 0x003e);
  writeU16(buf, 0x1a, 0x0003);
  writeU16(buf, 0x1c, 0xfffe);
  writeU16(buf, 0x1e, 9); // 512B
  writeU16(buf, 0x20, 6); // 64B mini
  writeU32(buf, 0x2c, 1); // numFatSectors
  writeU32(buf, 0x30, 1); // firstDirSector
  writeU32(buf, 0x38, 4096); // miniStreamCutoff
  writeU32(buf, 0x3c, 2); // firstMiniFatSector
  writeU32(buf, 0x40, 1); // numMiniFatSectors
  writeU32(buf, 0x44, 0xfffffffe); // firstDifatSector
  writeU32(buf, 0x4c, 0); // DIFAT[0] = 0
  for (let i = 1; i < 109; i++) writeU32(buf, 0x4c + i * 4, 0xffffffff);

  // Sector 0: FAT
  const fatOff = 512;
  writeU32(buf, fatOff + 0 * 4, 0xfffffffd);
  writeU32(buf, fatOff + 1 * 4, 0xfffffffe);
  writeU32(buf, fatOff + 2 * 4, 0xfffffffe);
  writeU32(buf, fatOff + 3 * 4, 0xfffffffe);
  for (let s = 4; s < 11; s++) writeU32(buf, fatOff + s * 4, s + 1);
  writeU32(buf, fatOff + 11 * 4, 0xfffffffe);

  // Sector 1: Directory
  const dirOff = 512 * 2;
  writeDirEntry(buf, dirOff + 0 * 128, 'Root Entry', 5, 3, 128);
  writeDirEntry(buf, dirOff + 128, 'PowerPoint Document', 2, 4, 4096);
  writeDirEntry(buf, dirOff + 256, 'Pictures', 2, 0, fakePng.length);

  // Sector 2: Mini-FAT (2 * 64B mini-sectors: 0 -> 1 -> ENDOFCHAIN)
  const mfatOff = 512 * 3;
  writeU32(buf, mfatOff + 0, 1);
  writeU32(buf, mfatOff + 4, 0xfffffffe);

  // Sector 3: Root Mini-Stream
  buf.set(picStream, 512 * 4);

  // Sectors 4..11: PowerPoint Document
  buf.set(pptStream, 512 * 5);

  return buf;
}

describe('v2.0.9 Legacy .ppt Offline Parser & Rich PPTX Fidelity', () => {
  it('parses binary OLE2 .ppt slides, speaker notes, and Mini-FAT embedded pictures offline', async () => {
    const pptBytes = buildSyntheticOle2Ppt();
    const res = extractLegacyPptSlidesRich(pptBytes);

    expect(res.totalSlides).toBe(2);
    expect(res.slides[0].title).toBe('Legacy Binary Heaps');
    expect(res.slides[0].bullets).toEqual(['Push runs in O(log n)']); // filters boilerplate "Click to add text"
    expect(res.slides[0].notes).toEqual(['Explain heap property on whiteboard.']);
    expect(res.slides[0].images.length).toBe(1);
    expect(res.slides[0].images[0].mime).toBe('image/png');

    expect(res.slides[1].title).toBe('Classic PPT Notes');
    expect(res.slides[1].bullets).toEqual(['Parsed offline without cloud tools']);

    const viaViewerParser = await extractPptxSlidesRich(pptBytes);
    expect(viaViewerParser.totalSlides).toBe(2);
    expect(viaViewerParser.slides[0].title).toBe('Legacy Binary Heaps');

    const md = await extractLegacyPptText(pptBytes);
    expect(md.pageCount).toBe(2);
    expect(md.markdown).toContain('## Slide 1: Legacy Binary Heaps');
    expect(md.markdown).toContain('Speaker Notes:');

    const fakeFile = {
      name: 'Lecture_01.ppt',
      arrayBuffer: async () => pptBytes.buffer,
    };
    const imported = await extractDocument(fakeFile);
    expect(imported.kind).toBe('pptx');
    expect(imported.pageCount).toBe(2);
    expect(imported.rawMarkdown).toContain('Legacy Binary Heaps');
  });

  it('extracts .pptx tables (without duplicate bullets), rich formatted sub-bullets, bgColor, and SmartArt labels', async () => {
    const slideXml = `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:bg><p:bgPr><a:solidFill><a:srgbClr val="1e293b"/></a:solidFill></p:bgPr></p:bg>
          <p:spTree>
            <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Algorithm Tiers</a:t></a:r></a:p></p:txBody></p:sp>
            <p:sp><p:txBody>
              <a:p><a:r><a:rPr b="1"/><a:t>Fast</a:t></a:r><a:r><a:t> paths</a:t></a:r></a:p>
              <a:p><a:pPr lvl="1"/><a:r><a:rPr i="1"/><a:t>Sub-bullet O(n)</a:t></a:r></a:p>
            </p:txBody></p:sp>
            <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
              <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Algo</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Time</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
              <a:tr><a:tc><a:txBody><a:p><a:r><a:t>BFS</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>O(V+E)</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
            </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
          </p:spTree>
        </p:cSld>
      </p:sld>`;
    const relsXml = `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rDiag" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
      </Relationships>`;
    const diagXml = `<dgm:dataModel xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:pt><dgm:t><a:p><a:r><a:t>Queue Node</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:dataModel>`;

    const zipped = zipSync({
      'ppt/slides/slide1.xml': strToU8(slideXml),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(relsXml),
      'ppt/diagrams/data1.xml': strToU8(diagXml),
    });

    const parsed = await extractPptxSlidesRich(zipped);
    const s = parsed.slides[0];
    expect(s.bgColor).toBe('#1E293B');
    expect(s.bullets).toEqual(['Fast paths', 'Sub-bullet O(n)']);
    expect(s.richBullets[0].runs[0]).toMatchObject({ text: 'Fast', bold: true });
    expect(s.richBullets[1].level).toBe(1);
    expect(s.richBullets[1].runs[0]).toMatchObject({ text: 'Sub-bullet O(n)', italic: true });
    expect(s.tables).toEqual([
      [
        ['Algo', 'Time'],
        ['BFS', 'O(V+E)'],
      ],
    ]);
    expect(s.diagramTexts).toContain('Queue Node');
  });
});
