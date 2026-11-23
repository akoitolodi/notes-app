import { describe, it, expect } from 'vitest';
import {
  extractRelevantLines,
  retrieveCrossNoteContext,
  buildFallbackSearchQuery,
} from '../src/lib/localRag.js';
import { reconstructAbstract } from '../src/lib/research.js';

describe('localRag & research utilities', () => {
  it('extracts relevant lines with immediate neighbors for long notes', () => {
    const lines = [
      'Lecture 1: Introduction to thermodynamics.',
      'Temperature measures average kinetic energy.',
      'Unrelated remark about lab safety goggles.',
      'Unrelated remark about attendance sheets.',
      'Unrelated remark about textbook chapters.',
      'Unrelated remark about office hours.',
      'Unrelated remark about syllabus grading.',
      'Unrelated remark about homework submission.',
      'Unrelated remark about exam dates.',
      'Unrelated remark about lab partners.',
      'Unrelated remark about seating chart.',
      'Unrelated remark about calculator rules.',
      'Unrelated remark about extra credit.',
      'Second Law of Thermodynamics:',
      'Entropy of an isolated system never decreases over time.',
      'Spontaneous processes move toward higher disorder.',
    ];
    const body = lines.join('\n');
    const picked = extractRelevantLines(body, 'Why does entropy increase in an isolated system?', {
      maxLines: 6,
    });
    expect(picked.some(l => l.includes('Entropy of an isolated system'))).toBe(true);
    expect(picked.some(l => l.includes('Second Law'))).toBe(true);
  });

  it('retrieves relevant excerpts from sibling folder notes via BM25', () => {
    const current = { id: 3, title: 'Enzyme Kinetics', body: 'Michaelis-Menten equation' };
    const siblings = [
      {
        id: 1,
        title: 'Protein Structure',
        body: 'Tertiary structure depends on hydrogen bonds and hydrophobic interactions.\n\nHigh temperature disrupts hydrogen bonds causing protein denaturation and loss of active site shape.',
      },
      {
        id: 2,
        title: 'World History',
        body: 'The Treaty of Westphalia ended the Thirty Years War in 1648.',
      },
    ];

    const hits = retrieveCrossNoteContext(
      current,
      siblings,
      'Why does high temperature cause denaturation of enzymes?'
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toBe('Protein Structure');
    expect(hits[0].excerpt).toContain('denaturation');
  });

  it('builds concrete fallback search queries from title and question', () => {
    const q = buildFallbackSearchQuery('why does this happen at high temp?', 'Enzyme Denaturation', 'Biology');
    expect(q).toContain('enzyme');
    expect(q).toContain('denaturation');
    expect(q).toContain('high');
  });

  it('reconstructs OpenAlex inverted-index abstracts accurately', () => {
    const inverted = {
      Enzymes: [0],
      accelerate: [1],
      reactions: [2, 6],
      by: [3],
      lowering: [4],
      activation: [5],
    };
    expect(reconstructAbstract(inverted)).toBe('Enzymes accelerate reactions by lowering activation reactions');
  });
});
