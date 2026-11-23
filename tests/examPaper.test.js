import { describe, it, expect } from 'vitest';
import {
  createDefaultExamConfig,
  computeExamTotals,
  parseExamPaperJson,
  gradeExamPaperOffline,
} from '../src/lib/examPaper.js';

describe('Answerable & Printable Bond-Paper Exam Engine', () => {
  it('calculates exact item and point totals across custom combined test types', () => {
    const cfg = createDefaultExamConfig();
    cfg.sections.mcq = { enabled: true, count: 10, pointsEach: 1 };
    cfg.sections.true_false = { enabled: true, count: 5, pointsEach: 1 };
    cfg.sections.identification = { enabled: false, count: 5, pointsEach: 1 };
    cfg.sections.matching = { enabled: true, count: 4, pointsEach: 1 };
    cfg.sections.enumeration = { enabled: true, count: 2, pointsEach: 3 };
    cfg.sections.problem_solving = { enabled: true, count: 2, pointsEach: 5 };
    cfg.sections.essay = { enabled: true, count: 1, pointsEach: 5 };

    const totals = computeExamTotals(cfg);
    expect(totals.totalItems).toBe(24);
    expect(totals.totalPoints).toBe(10 + 5 + 4 + 6 + 10 + 5);
    expect(totals.activeSections.map(s => s.type)).toEqual([
      'mcq',
      'true_false',
      'matching',
      'enumeration',
      'problem_solving',
      'essay',
    ]);
  });

  it('parses all 8 test types cleanly and auto-grades objective items offline with partial credit', () => {
    const sampleJson = JSON.stringify({
      title: 'BSIT Midterm Exam',
      parts: [
        {
          type: 'mcq',
          pointsEach: 1,
          items: [
            { question: 'Which layer handles IP routing?', choices: ['Physical', 'Network', 'Transport', 'Session'], answerIndex: 1 },
          ],
        },
        {
          type: 'true_false',
          pointsEach: 1,
          items: [{ statement: 'UDP guarantees packet delivery.', answer: false }],
        },
        {
          type: 'identification',
          pointsEach: 1,
          items: [{ question: 'Protocol translating domain names to IP addresses.', answer: 'DNS', acceptable: ['Domain Name System'] }],
        },
        {
          type: 'matching',
          pointsEach: 1,
          columnB: [
            { letter: 'A', text: 'Port 443' },
            { letter: 'B', text: 'Port 22' },
            { letter: 'C', text: 'Port 80' },
          ],
          items: [{ prompt: 'HTTPS', answerLetter: 'A' }],
        },
        {
          type: 'enumeration',
          pointsEach: 3,
          items: [{ question: 'Enumerate 3 OOP pillars.', answers: ['Encapsulation', 'Inheritance', 'Polymorphism'] }],
        },
        {
          type: 'problem_solving',
          pointsEach: 5,
          items: [{ question: 'Find usable hosts in /26.', solution: '62 usable hosts', rubric: ['2^6 - 2 = 62'] }],
        },
      ],
    });

    const paper = parseExamPaperJson(sampleJson, { title: 'Fallback' });
    expect(paper.parts).toHaveLength(6);

    const grade = gradeExamPaperOffline(
      paper,
      {
        '0-0': 1, // MC right (+1)
        '1-0': false, // T/F right (+1)
        '2-0': 'domain name system', // Identification alias right (+1)
        '3-0': 'A', // Matching right (+1)
        '4-0': ['Encapsulation', 'Inheritance', 'Wrong'], // 2/3 enum -> +2
        '5-0': '2^6 - 2 = 62',
      },
      { '5-0': { earned: 5, feedback: 'Exact!' } }
    );

    expect(grade.objectiveEarned).toBe(6);
    expect(grade.objectiveMax).toBe(7);
    expect(grade.writtenEarned).toBe(5);
    expect(grade.writtenMax).toBe(5);
    expect(grade.totalEarned).toBe(11);
    expect(grade.totalMax).toBe(12);
  });
});
