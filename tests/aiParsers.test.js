import { describe, it, expect } from 'vitest';
import {
  stripThinking,
  extractFirstJsonObject,
  parseScanResult,
  parseLineResult,
  parseExamResult,
} from '../shared/aiParsers.js';

describe('shared/aiParsers', () => {
  it('strips complete <think>...</think> reasoning blocks completely', () => {
    const raw = '<think>Step 1: analyze carefully.\nStep 2: conclude.</think>\nFinal answer: ATP powers the cell.';
    expect(stripThinking(raw)).toBe('Final answer: ATP powers the cell.');
  });

  it('handles stray orphan think tags', () => {
    expect(stripThinking('Hello </think> world')).toBe('Hello  world');
  });

  it('extracts first balanced JSON object from fenced or noisy output', () => {
    const raw = 'Sure! Here is your JSON:\n```json\n{"explanation": "Simple {braces} inside string"}\n```\n{"extra": true}';
    expect(JSON.parse(extractFirstJsonObject(raw))).toEqual({
      explanation: 'Simple {braces} inside string',
    });
  });

  it('normalizes scan results and clamps out-of-bounds quiz answer indices', () => {
    const raw = JSON.stringify({
      blocks: [
        {
          id: 'line-2',
          text: 'F = ma',
          explanation: 'Newton second law',
          terms: [{ term: 'Force', definition: 'Push or pull' }, { bad: true }],
          mistake: null,
        },
      ],
      flashcards: [{ q: 'What is F?', a: 'Mass times acceleration' }],
      quiz: [
        { question: 'Units of force?', choices: ['Newton', 'Joule'], answer: 99 },
        { question: 'Negative index?', choices: ['A', 'B', 'C'], answer: -3 },
        { question: 'Invalid single choice', choices: ['Only one'], answer: 0 },
      ],
    });

    const parsed = parseScanResult(raw);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].terms).toEqual([{ term: 'Force', definition: 'Push or pull' }]);
    expect(parsed.quiz).toHaveLength(2);
    expect(parsed.quiz[0].answer).toBe(0);
    expect(parsed.quiz[1].answer).toBe(0);
  });

  it('parses line and exam results safely even wrapped in thinking tags', () => {
    expect(parseLineResult('<think>hmm</think>{"explanation":"Water boils at 100C"}')).toEqual({
      explanation: 'Water boils at 100C',
    });

    const exam = parseExamResult(
      '{"summary":"Key points","flashcards":[{"q":"Q1","a":"A1"}],"quiz":[{"question":"Test?","choices":["X","Y"],"answer":1}]}'
    );
    expect(exam.summary).toBe('Key points');
    expect(exam.quiz[0].answer).toBe(1);
  });
});
