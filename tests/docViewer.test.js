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
