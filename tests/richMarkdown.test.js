import { describe, it, expect } from 'vitest';
import { tokenizeCode, groupNoteLines } from '../src/lib/codeHighlight.js';
import { extractWikiLinks, findBacklinks, resolveLinkedNotes } from '../src/lib/wikiLinks.js';
import { applyGrammarFix } from '../src/lib/grammarCheck.js';

describe('Rich Markdown, Code Highlighting, Wiki-Links & Grammar Fix', () => {
  it('tokenizes Python and SQL code cleanly without emitting HTML', () => {
    const py = tokenizeCode('def add(a, b):\n  return a + 1 # sum', 'python');
    expect(py.some(t => t.type === 'kw' && t.text === 'def')).toBe(true);
    expect(py.some(t => t.type === 'fn' && t.text === 'add')).toBe(true);
    expect(py.some(t => t.type === 'cmt' && t.text.includes('# sum'))).toBe(true);

    const sql = tokenizeCode("SELECT name FROM users WHERE id = 5;", 'sql');
    expect(sql.some(t => t.type === 'kw' && t.text === 'SELECT')).toBe(true);
    expect(sql.some(t => t.type === 'num' && t.text === '5')).toBe(true);
  });

  it('groups fenced code blocks and GFM tables while keeping exact line indices for normal lines', () => {
    const lines = [
      '# Intro',
      '```js',
      'const x = 1;',
      '```',
      'Regular line',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      'Footer',
    ];
    const segs = groupNoteLines(lines);
    expect(segs.map(s => s.type)).toEqual(['line', 'code', 'line', 'table', 'line']);
    expect(segs[0].index).toBe(0);
    expect(segs[1].lang).toBe('js');
    expect(segs[1].code).toBe('const x = 1;');
    expect(segs[2].index).toBe(4);
    expect(segs[3].headers).toEqual(['A', 'B']);
    expect(segs[3].rows).toEqual([['1', '2']]);
    expect(segs[4].index).toBe(8);
  });

  it('extracts [[Wiki-Links]], computes backlinks, and respects hidden locked folders', () => {
    expect(extractWikiLinks('See [[Dopamine]] and [[Habit Loop|habits]]')).toEqual([
      'Dopamine',
      'Habit Loop',
    ]);

    const notes = [
      { id: 1, folderId: 10, title: 'Dopamine', body: 'Reward prediction error' },
      { id: 2, folderId: 11, title: 'Study Habits', body: 'Connected to [[Dopamine]] loops' },
      { id: 3, folderId: 99, title: 'Locked Diary', body: 'Secret mention of [[Dopamine]]' },
    ];
    const hidden = new Set([99]);

    const backlinks = findBacklinks(notes[0], notes, hidden);
    expect(backlinks.map(b => b.id)).toEqual([2]);

    const resolved = resolveLinkedNotes(notes[1], notes, hidden);
    expect(resolved.map(n => n.id)).toEqual([1]);
  });

  it('applies grammar fixes accurately even after earlier offset shifts', () => {
    const fixed = applyGrammarFix(
      'This are a test.',
      { offset: 5, length: 3, badText: 'are' },
      'is'
    );
    expect(fixed).toBe('This is a test.');

    const shifted = applyGrammarFix(
      'Prefix! This are a test.',
      { offset: 5, length: 3, badText: 'are' },
      'is'
    );
    expect(shifted).toBe('Prefix! This is a test.');
  });
});
