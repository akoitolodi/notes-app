import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  extractPptxText,
  extractDocument,
  titleFromFilename,
} from '../src/lib/docImporter.js';
import { NOTE_TEMPLATES, instantiateTemplate } from '../src/lib/templates.js';

function buildSamplePptx() {
  const slide1Xml = `<?xml version="1.0" encoding="UTF-8"?>
  <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <p:cSld><p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Thermodynamics &amp; Entropy</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>First Law: Energy is conserved</a:t></a:r></a:p>
          <a:p><a:r><a:t>Second Law: </a:t></a:r><a:r><a:t>Entropy never decreases (&Delta;S &gt;= 0)</a:t></a:r></a:p>
          <a:p><a:r><a:t>1</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree></p:cSld>
  </p:sld>`;

  const slide1Rels = `<?xml version="1.0" encoding="UTF-8"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  </Relationships>`;

  const notes1Xml = `<?xml version="1.0" encoding="UTF-8"?>
  <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <p:cSld><p:spTree><p:sp><p:txBody>
      <a:p><a:r><a:t>Professor emphasized this will be on the midterm.</a:t></a:r></a:p>
      <a:p><a:r><a:t>1</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld>
  </p:notes>`;

  const slide2Xml = `<?xml version="1.0" encoding="UTF-8"?>
  <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <p:cSld><p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Carnot Efficiency</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Maximum theoretical efficiency depends only on reservoir temperatures.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree></p:cSld>
  </p:sld>`;

  return zipSync({
    'ppt/slides/slide1.xml': strToU8(slide1Xml),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(slide1Rels),
    'ppt/notesSlides/notesSlide1.xml': strToU8(notes1Xml),
    'ppt/slides/slide2.xml': strToU8(slide2Xml),
  });
}

describe('Document Importer (.pptx, .md, .txt)', () => {
  it('cleans filenames into readable titles', () => {
    expect(titleFromFilename('Week_04-Cell_Biology.pptx')).toBe('Week 04 Cell Biology');
    expect(titleFromFilename('C:\\docs\\Lecture 12.pdf')).toBe('Lecture 12');
  });

  it('extracts PPTX slide headings, bullets, decoded entities, and speaker notes in numeric order', async () => {
    const pptxBytes = buildSamplePptx();
    const res = await extractPptxText(pptxBytes);

    expect(res.pageCount).toBe(2);
    expect(res.markdown).toContain('## Slide 1: Thermodynamics & Entropy');
    expect(res.markdown).toContain('- First Law: Energy is conserved');
    expect(res.markdown).toContain('>= 0');
    expect(res.markdown).toContain('> **Speaker Notes:** Professor emphasized this will be on the midterm.');
    expect(res.markdown).toContain('## Slide 2: Carnot Efficiency');
    // Bare slide number footers should be stripped
    expect(res.markdown).not.toContain('\n- 1\n');
  });

  it('imports .md files and rejects legacy .ppt cleanly', async () => {
    const mdFile = {
      name: 'Lecture_Notes.md',
      text: async () => '# Intro\r\n- Point A\r\n- Point B',
    };
    const res = await extractDocument(mdFile);
    expect(res.title).toBe('Lecture Notes');
    expect(res.kind).toBe('md');
    expect(res.rawMarkdown).toBe('# Intro\n- Point A\n- Point B');

    await expect(
      extractDocument({ name: 'old_deck.ppt', arrayBuffer: async () => new ArrayBuffer(0) })
    ).rejects.toThrow(/Legacy \.ppt/i);
  });
});

describe('Note Templates', () => {
  it('exposes categorized general (8) and optional tech (4) templates including Cornell & Formula Sheet', () => {
    expect(NOTE_TEMPLATES.length).toBe(12);
    expect(NOTE_TEMPLATES.filter(t => t.category !== 'tech').length).toBe(8);
    expect(NOTE_TEMPLATES.filter(t => t.category === 'tech').length).toBe(4);
    const cornell = instantiateTemplate('cornell');
    expect(cornell.title).toContain('Cornell');
    expect(cornell.body).toContain('## Key Cues & Questions');

    const formula = instantiateTemplate('formula', { tagPrefix: '#physics' });
    expect(formula.body).toContain('$y = mx + b$');
    expect(formula.body).toContain('#physics');
  });
});
