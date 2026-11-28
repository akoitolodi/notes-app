import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PROVIDERS,
  MODE_KEY,
  PROVIDER_KEY,
  BASEURL_KEY,
  MODEL_KEY,
  setKeyForProvider,
} from '../src/lib/aiConfig';
import { clearRouteTelemetry } from '../src/lib/aiRouter';
import { extractSchoolCalendarFromInput } from '../src/lib/schoolCalendar';
import { extractGecFromInput } from '../src/lib/gecSchedule';
import { formatLectureTranscriptToNotes } from '../src/lib/lectureRecorder';
import { parseScheduleWithAI } from '../src/lib/schedulePdfParser';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('AI Vision & Text Call Signature Guards (no missing content 400 errors)', () => {
  beforeEach(() => {
    memStore.clear();
    clearRouteTelemetry();
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'gemini');
    localStorage.setItem(BASEURL_KEY, PROVIDERS.gemini.baseUrl);
    localStorage.setItem(MODEL_KEY, 'gemini-2.5-flash');
    setKeyForProvider('gemini', 'AIza_test_key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetchReturningJson(jsonObj) {
    const captured = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, opts) => {
        const body = JSON.parse(opts.body);
        captured.push(body);
        for (const msg of body.messages) {
          expect(msg.role).toBeTruthy();
          expect(msg.content).toBeDefined();
          if (typeof msg.content === 'string') {
            expect(msg.content.trim().length).toBeGreaterThan(0);
          } else {
            expect(Array.isArray(msg.content)).toBe(true);
            expect(msg.content.some(p => p.type === 'text' && p.text.trim().length > 0)).toBe(true);
            expect(msg.content.some(p => p.type === 'image_url' && p.image_url?.url)).toBe(true);
          }
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(jsonObj) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return captured;
  }

  it('extractSchoolCalendarFromInput sends valid vision payload with imageDataUrl and prompt content', async () => {
    const captured = stubFetchReturningJson({
      schoolName: 'Holy Name University',
      academicYear: '2026-2027',
      startYear: 2026,
      endYear: 2027,
      events: [
        { term: 'first', title: 'Start of Classes', startDate: '2026-07-08', endDate: '2026-07-08', kind: 'milestone', audience: 'all' },
      ],
    });

    const res = await extractSchoolCalendarFromInput({
      imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    });
    expect(res.events.length).toBe(1);
    expect(captured.length).toBe(1);
    const userMsg = captured[0].messages.find(m => m.role === 'user');
    expect(Array.isArray(userMsg.content)).toBe(true);
  });

  it('extractSchoolCalendarFromInput sends valid text payload for AI revision memo fallback', async () => {
    const captured = stubFetchReturningJson({
      patches: [
        { action: 'move', targetTitle: 'Midterm Examination', term: 'second', title: 'Midterm Examination', startDate: '2027-02-08', endDate: '2027-02-13', kind: 'exam' },
      ],
    });

    const res = await extractSchoolCalendarFromInput({
      text: 'Dean announced adjustment to second term assessment window next month.',
      mode: 'revise',
      existingCalendar: {
        schoolName: 'HNU',
        academicYear: '2026-2027',
        activeTerm: 'second',
        startYear: 2026,
        endYear: 2027,
        events: [{ term: 'second', title: 'Midterm Examination', startDate: '2027-02-01', endDate: '2027-02-06', kind: 'exam' }],
      },
    });
    expect(res.isPartialPatch).toBe(true);
    expect(res.patches.length).toBe(1);
    expect(captured.length).toBe(1);
  });

  it('extractGecFromInput sends valid vision payload for matrix and master schedule images', async () => {
    const captured = stubFetchReturningJson({
      termLabel: '2nd Sem AY 2026-2027',
      sets: [{ id: 'set-a', label: 'Set A', subjects: ['Art'] }],
      periods: [{ startDate: '2026-12-01', endDate: '2026-12-02', specialLabel: '', modalities: { 'set-a': 'f2f' } }],
      classes: [{ code: 'GEC-AA', name: 'Art Appreciation', days: 'MWF', startTime: '09:00', endTime: '10:00', room: 'Rm 201' }],
    });

    const res = await extractGecFromInput({
      matrixImageDataUrl: 'data:image/jpeg;base64,/9j/matrix',
      masterImageDataUrl: 'data:image/jpeg;base64,/9j/master',
    });
    expect(res.periods.length).toBe(1);
    expect(res.masterClasses.length).toBe(1);
    expect(captured.length).toBe(2);
  });

  it('formatLectureTranscriptToNotes and parseScheduleWithAI pass { user } object cleanly', async () => {
    const captured = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, opts) => {
        const body = JSON.parse(opts.body);
        captured.push(body);
        for (const msg of body.messages) {
          expect(typeof msg.content).toBe('string');
          expect(msg.content.trim().length).toBeGreaterThan(0);
        }
        const isSched = body.messages.some(m => m.content.includes('Extract all college classes'));
        const content = isSched
          ? JSON.stringify({ semester: '2nd Sem', courses: [{ code: 'CS 102', name: 'Data Structures', units: 3, meetings: [] }] })
          : '# Lecture Summary\n\n## Key Concepts\n- AVL Balance';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );

    const lec = await formatLectureTranscriptToNotes({ transcript: 'Today we discussed AVL tree rotations.', subject: 'CS 102' });
    expect(lec.title).toBe('Lecture Summary');

    const sched = await parseScheduleWithAI('CS 102 Data Structures 3 units MWF 9:00-10:00 AM');
    expect(sched.courses[0].code).toBe('CS 102');
    expect(captured.length).toBe(2);
  });
});
