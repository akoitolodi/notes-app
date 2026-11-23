import { describe, it, expect } from 'vitest';
import { markdownToCleanHtml } from '../src/lib/richEditorCodec.js';
import { NOTE_TEMPLATES } from '../src/lib/templates.js';

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Clean Visual Editor Codec (Zero Raw Markdown Symbols)', () => {
  it('converts headings, bold, checklists, bullets, math, tables & wiki-links into clean semantic HTML', () => {
    const md = [
      '## Key Cues',
      '- **Core Idea:** Energy is conserved',
      '- [ ] Review flashcards',
      '- [x] Completed lab',
      'Formula: $E = mc^2$',
      'See [[Dopamine]]',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');

    const html = markdownToCleanHtml(md);
    expect(html).toContain('<h2 class="ce-h ce-h2">Key Cues</h2>');
    expect(html).toContain('<strong>Core Idea:</strong>');
    expect(html).toContain('data-checked="0"');
    expect(html).toContain('data-checked="1"');
    expect(html).toContain('data-tex="E = mc^2"');
    expect(html).toContain('data-wiki="Dopamine"');
    expect(html).toContain('<table class="ce-table">');

    const visibleText = stripTags(html);
    expect(visibleText).not.toContain('##');
    expect(visibleText).not.toContain('**');
    expect(visibleText).not.toContain('- [ ]');
    expect(visibleText).not.toContain('[[');
  });

  it('renders every built-in template without visible ##, **, or - [ ] clutter', () => {
    for (const tpl of NOTE_TEMPLATES) {
      if (!tpl.body) continue;
      const html = markdownToCleanHtml(tpl.body);
      const visible = stripTags(html);
      expect(visible).not.toContain('##');
      expect(visible).not.toContain('**');
      expect(visible).not.toContain('- [ ]');
      expect(visible).not.toContain('| --- |');
    }
  });
});
