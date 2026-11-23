import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseIcsEvents,
  parseRssAnnouncements,
  parsePastedAnnouncement,
  buildCanvasNoteContent,
} from '../src/lib/canvasSync.js';
import { percentToPhGwa, percentToUsGpa, computeTargetFinal } from '../src/lib/gradeCalc.js';
import { stripForSpeech, buildOfflineNarrationSegments } from '../src/lib/audioStudy.js';
import {
  generateSortSteps,
  generateBinarySearchSteps,
  generateGridPathSteps,
  generateRecursionSteps,
} from '../src/lib/algoSteps.js';
import {
  evaluateExpression,
  numericalDerivative,
  findApproxRoots,
  compileMathExpression,
} from '../src/lib/mathGrapher.js';
import { parseErrorTrace, saveBugLog, getBugLogs, deleteBugLog } from '../src/lib/bugDebugger.js';
import {
  buildNoteBaiBundle,
  encodeBaiShareCode,
  decodeBaiBundle,
  importNoteBaiBundle,
  filterSafeSyncPayload,
} from '../src/lib/baiDrop.js';
import { db, logStudyActivity, getActivityHeatmap } from '../src/store/db.js';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('Canvas LMS Integration (.ics, RSS, Quick-Paste & Note Builder)', () => {
  it('parses folded RFC-5545 Canvas .ics events, extracts course codes & classifies exams', () => {
    const sampleIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:event-assignment-101',
      'DTSTART:20261128T155900Z',
      'SUMMARY:Problem Set 4: Kinematics [PHYS 101]',
      'DESCRIPTION:Solve chapters 3\\, 4\\nShow all steps',
      ' and include free-body diagrams.',
      'URL:https://school.instructure.com/courses/10/assignments/101',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:event-exam-202',
      'DTSTART;VALUE=DATE:20261205',
      'SUMMARY:Midterm Exam [CS 201]',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcsEvents(sampleIcs);
    expect(events.length).toBe(2);
    expect(events[0].title).toBe('Problem Set 4: Kinematics');
    expect(events[0].course).toBe('PHYS 101');
    expect(events[0].type).toBe('assignment');
    expect(events[0].description).toContain('free-body diagrams');
    expect(events[1].type).toBe('exam');
    expect(events[1].course).toBe('CS 201');
    expect(events[1].dateKey).toBe('2026-12-05');

    const noteMd = buildCanvasNoteContent(events[0]);
    expect(noteMd).toContain('PHYS 101');
    expect(noteMd).toContain('Action Checklist');
    expect(noteMd).toContain('Open in Canvas');
  });

  it('parses RSS/Atom announcements and auto-detects due dates from pasted Canvas announcements', () => {
    const rss = `<rss><channel><title>CS 201 Announcements</title><item><title>Lab 5 Deadline Extended</title><description><![CDATA[<p>Submit by Friday</p>]]></description><link>https://canvas.example/a/1</link><guid>ann-1</guid><pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
    const anns = parseRssAnnouncements(rss);
    expect(anns.length).toBe(1);
    expect(anns[0].course).toBe('CS 201 Announcements');
    expect(anns[0].title).toBe('Lab 5 Deadline Extended');
    expect(anns[0].description).toBe('Submit by Friday');

    const pasted = parsePastedAnnouncement(
      'Final Project Demo Schedule\nPlease submit your slide deck by December 4, 2026 at 5pm.',
      'IT 301'
    );
    expect(pasted.title).toBe('Final Project Demo Schedule');
    expect(pasted.course).toBe('IT 301');
    expect(pasted.detectedDateKey).toBe('2026-12-04');
  });
});

describe('Grade Calculator (PH GWA, US GPA & Target Final)', () => {
  it('converts percentages accurately and computes required final exam score', () => {
    expect(percentToPhGwa(97)).toBe(1.0);
    expect(percentToPhGwa(91)).toBe(1.5);
    expect(percentToPhGwa(65)).toBe(5.0);
    expect(percentToUsGpa(95)).toBe(4.0);
    expect(percentToUsGpa(85)).toBe(3.0);

    const res = computeTargetFinal({
      components: [
        { name: 'Quizzes', weight: 30, score: 85 },
        { name: 'Midterm', weight: 30, score: 90 },
      ],
      targetPercent: 90,
    });
    expect(res.completedWeight).toBe(60);
    expect(res.remainingWeight).toBe(40);
    expect(res.currentStanding).toBe(87.5);
    // Needed: (90 - (25.5 + 27)) / 40 * 100 = 37.5 / 40 * 100 = 93.75 -> 93.8
    expect(res.requiredOnRemaining).toBe(93.8);
  });
});

describe('Study Commute Audio Engine', () => {
  it('strips Markdown & converts LaTeX formulas into smooth spoken text', () => {
    const spoken = stripForSpeech('## Energy\n**Formula:** $E = mc^2$ and $\\frac{a}{b}$ with $\\sqrt{x}$');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('#');
    expect(spoken).toContain('squared');
    expect(spoken).toContain('a over b');
    expect(spoken).toContain('square root of x');

    const segs = buildOfflineNarrationSegments({ title: 'Physics 1', body: 'First paragraph.\n\nSecond paragraph.' });
    expect(segs.length).toBe(3);
    expect(segs[0].text).toBe('Physics 1');
  });
});

describe('Offline Algorithm & Data Structure Visualizer Generators', () => {
  it('sorts arrays accurately across Bubble, Insertion, Merge & QuickSort', () => {
    const input = [42, 7, 19, 3, 28, 15];
    const expected = [3, 7, 15, 19, 28, 42];
    for (const algo of ['bubble', 'insertion', 'merge', 'quick']) {
      const steps = generateSortSteps(algo, input);
      expect(steps.length).toBeGreaterThan(2);
      expect(steps[steps.length - 1].array).toEqual(expected);
    }
  });

  it('traces Binary Search hit/miss, BFS/Dijkstra shortest path, and Recursion Call Stack', () => {
    const hit = generateBinarySearchSteps([2, 5, 10, 20, 40], 20);
    expect(hit[hit.length - 1].foundIndex).toBe(3);

    const miss = generateBinarySearchSteps([2, 5, 10, 20, 40], 99);
    expect(miss[miss.length - 1].foundIndex).toBe(-1);

    const bfs = generateGridPathSteps({
      rows: 5,
      cols: 5,
      start: [0, 0],
      end: [0, 4],
      walls: new Set(['0,2', '1,2']),
      algo: 'bfs',
    });
    const lastBfs = bfs[bfs.length - 1];
    expect(lastBfs.found).toBe(true);
    expect(lastBfs.path[0]).toBe('0,0');
    expect(lastBfs.path[lastBfs.path.length - 1]).toBe('0,4');
    expect(lastBfs.path).not.toContain('0,2');

    const factSteps = generateRecursionSteps('factorial', 4);
    expect(factSteps[factSteps.length - 1].result).toBe(24);
    const fibSteps = generateRecursionSteps('fibonacci', 4);
    expect(fibSteps[fibSteps.length - 1].result).toBe(3);
  });
});

describe('Offline 2D Math Function Grapher (Zero-Eval Parser)', () => {
  it('evaluates polynomials, trig, implicit multiplication, derivatives & roots safely', () => {
    expect(evaluateExpression('2x + 3', 5)).toBe(13);
    expect(evaluateExpression('x^2 - 4', 3)).toBe(5);
    expect(evaluateExpression('3sin(pi / 2)', 0)).toBeCloseTo(3, 5);
    expect(evaluateExpression('ln(e^2)', 0)).toBeCloseTo(2, 5);
    expect(numericalDerivative('x^2', 3)).toBeCloseTo(6, 3);

    const roots = findApproxRoots('x^2 - 4', -5, 5);
    expect(roots.length).toBe(2);
    expect(roots[0]).toBeCloseTo(-2, 2);
    expect(roots[1]).toBeCloseTo(2, 2);

    // Rejects arbitrary JS injection safely
    expect(() => compileMathExpression('process.exit(1)')).toThrow();
  });
});

describe('Bugs I Solved — Offline Stack-Trace Parser & Archive', () => {
  beforeEach(async () => {
    await db.bugLogs.clear();
  });

  it('parses Python, JS & C++ errors and persists bug logs in Dexie v6', async () => {
    const py = parseErrorTrace('Traceback (most recent call last):\n  File "app.py", line 12\nZeroDivisionError: division by zero');
    expect(py.language).toBe('Python');
    expect(py.errorType).toBe('ZeroDivisionError');
    expect(py.file).toBe('app.py');
    expect(py.line).toBe(12);

    const js = parseErrorTrace("TypeError: Cannot read properties of undefined (reading 'id')\n    at main.jsx:42:9");
    expect(js.language).toBe('JavaScript');
    expect(js.errorType).toBe('TypeError');
    expect(js.line).toBe(42);

    const cpp = parseErrorTrace('lab2.cpp:18:5: error: expected \';\' before \'return\'');
    expect(cpp.language).toBe('C/C++');
    expect(cpp.file).toBe('lab2.cpp');
    expect(cpp.line).toBe(18);

    const id = await saveBugLog({ ...py, rawTrace: 'ZeroDivisionError', fixSummary: 'Check len(scores) > 0' });
    const rows = await getBugLogs('ZeroDivision');
    expect(rows.length).toBe(1);
    expect(rows[0].fixSummary).toContain('len(scores)');
    await deleteBugLog(id);
    expect((await getBugLogs()).length).toBe(0);
  });
});

describe('BaiDrop Offline Share, Zero-AI Vault Exclusion & Study Heatmap', () => {
  beforeEach(async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.activityLog.clear();
  });

  it('round-trips a note via BAIDROP1 share code and strictly strips Vault/locked items from LAN sync', async () => {
    const bundle = buildNoteBaiBundle(
      {
        title: 'Sorting Complexity',
        subject: 'CS 201',
        body: 'Merge sort is $O(n \\log n)$.',
        flashcards: [{ q: 'Merge sort worst case?', a: 'O(n log n)' }],
        quiz: [],
      },
      'CS 201'
    );
    const code = encodeBaiShareCode(bundle);
    expect(code.startsWith('BAIDROP1:')).toBe(true);
    const decoded = decodeBaiBundle(code);
    expect(decoded.note.title).toBe('Sorting Complexity');
    expect(decoded.note.flashcards.length).toBe(1);

    const imported = await importNoteBaiBundle(code);
    expect(imported.note.title).toBe('Sorting Complexity');
    expect(imported.note.flashcards[0].a).toBe('O(n log n)');

    // Strict Zero-AI & Hidden Vault exclusion check
    const filtered = filterSafeSyncPayload({
      folders: [
        { id: 1, name: 'General', locked: false, mode: 'study' },
        { id: 2, name: 'Passwords & Keys', locked: true, isSystemVault: true, mode: 'vault' },
        { id: 3, name: 'Private Diary', locked: true, mode: 'journal' },
      ],
      notes: [
        { id: 10, folderId: 1, title: 'Class Note', body: 'ok' },
        { id: 11, folderId: 2, title: 'Bank PIN', body: 'secret', mode: 'vault' },
        { id: 12, folderId: 3, title: 'Hidden Entry', body: 'private' },
      ],
    });
    expect(filtered.folders.map(f => f.name)).toEqual(['General']);
    expect(filtered.notes.map(n => n.title)).toEqual(['Class Note']);
  });

  it('logs daily study actions and builds a 112-day study heatmap', async () => {
    await logStudyActivity('notes', 2);
    await logStudyActivity('coding', 1);
    const cells = await getActivityHeatmap(112);
    expect(cells.length).toBe(112);
    const todayCell = cells[cells.length - 1];
    expect(todayCell.count).toBe(3);
    expect(todayCell.notes).toBe(2);
    expect(todayCell.coding).toBe(1);
  });
});
