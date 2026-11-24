import { describe, it, expect, afterEach } from 'vitest';
import {
  FEYNMAN_PERSONAS,
  getFeynmanPersona,
  getSavedFeynmanPrefs,
  saveFeynmanPrefs,
  buildFeynmanOpeningMessage,
  buildFeynmanSystemPrompt,
  buildFeynmanGradingPrompt,
  parseFeynmanGradeJson,
} from '../src/lib/feynmanPersonas';
import {
  timeToMinutes,
  formatTime12h,
  formatTimeRange12h,
  groupDaysLabel,
  meetingsToScheduleRows,
  scheduleRowsToMeetings,
  resolveScheduleEntries,
  computeTimetableGrid,
  detectScheduleConflicts,
  buildStudyLoadSummary,
  getNowAndNextClass,
} from '../src/lib/scheduleView';
import { REDUCE_MOTION_KEY, getSettings, applySettings } from '../src/theme';

const originalStorage = globalThis.localStorage;
const originalDoc = globalThis.document;
const originalWin = globalThis.window;

afterEach(() => {
  globalThis.localStorage = originalStorage;
  globalThis.document = originalDoc;
  globalThis.window = originalWin;
});

function createMockStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

describe('v2.0.3 Human-Like Reverse Feynman Personas & English/Taglish Toggle', () => {
  it('defines 6 relatable student/teacher personas without parent/interviewer personas', () => {
    expect(FEYNMAN_PERSONAS.length).toBe(6);
    const ids = FEYNMAN_PERSONAS.map(p => p.id);
    expect(ids).toEqual([
      'close-friend',
      'classmate',
      'junior',
      'kid',
      'teacher',
      'panic-groupmate',
    ]);
    const labels = FEYNMAN_PERSONAS.map(p => p.label.toLowerCase()).join(' ');
    expect(labels).not.toContain('lola');
    expect(labels).not.toContain('parent');
    expect(labels).not.toContain('interviewer');
    expect(getFeynmanPersona('unknown-id').id).toBe('close-friend');
  });

  it('defaults to English language and persists Taglish toggle + persona selection', () => {
    globalThis.localStorage = createMockStorage();
    expect(getSavedFeynmanPrefs()).toEqual({ personaId: 'close-friend', lang: 'en' });

    saveFeynmanPrefs({ personaId: 'kid', lang: 'taglish' });
    expect(getSavedFeynmanPrefs()).toEqual({ personaId: 'kid', lang: 'taglish' });

    const enOpen = buildFeynmanOpeningMessage({
      personaId: 'close-friend',
      lang: 'en',
      topicTitle: 'Binary Search',
    });
    const tlOpen = buildFeynmanOpeningMessage({
      personaId: 'close-friend',
      lang: 'taglish',
      topicTitle: 'Binary Search',
    });
    expect(enOpen).toContain('Binary Search');
    expect(tlOpen).toContain('Binary Search');
    expect(enOpen).not.toBe(tlOpen);
  });

  it('builds natural human prompts banning Markdown lists and robotic AI phrases', () => {
    const sysEn = buildFeynmanSystemPrompt({
      personaId: 'kid',
      lang: 'en',
      topicTitle: 'Recursion',
      subject: 'CS 102',
      noteContext: 'A function calling itself with a base case.',
    });
    expect(sysEn).toContain('9-year-old');
    expect(sysEn).toContain('STRICTLY NO Markdown formatting');
    expect(sysEn).toContain('Great question!');
    expect(sysEn).toContain('Ask ONLY ONE focused question');

    const sysTl = buildFeynmanSystemPrompt({
      personaId: 'panic-groupmate',
      lang: 'taglish',
      topicTitle: 'Ohm Law',
    });
    expect(sysTl).toContain('Taglish');
    expect(sysTl).toContain('Gio');
  });

  it('grades Clarity, Accuracy, and Audience Fit within 0-10 bounds', () => {
    const prompt = buildFeynmanGradingPrompt({ personaId: 'teacher', lang: 'en' });
    expect(prompt).toContain('audienceFit');
    expect(prompt).toContain('Prof. Reyes');

    const parsed = parseFeynmanGradeJson(
      '{"clarity": 12, "accuracy": -2, "audienceFit": 9, "summary": "Sharp explanation!", "missingGaps": ["Base case", "Space complexity"]}'
    );
    expect(parsed).toEqual({
      clarity: 10,
      accuracy: 0,
      audienceFit: 9,
      summary: 'Sharp explanation!',
      missingGaps: ['Base case', 'Space complexity'],
    });

    const fallbackFit = parseFeynmanGradeJson('{"clarity": 8, "accuracy": 6, "summary": "Ok"}');
    expect(fallbackFit.audienceFit).toBe(7);
  });
});

describe('v2.0.3 Visual 30-Minute Schedule Grid, Study Load & Live Now/Next Engine', () => {
  it('parses times and formats compact hours and AM/PM time ranges accurately', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('13:30')).toBe(810);
    expect(timeToMinutes('bad')).toBeNull();

    expect(formatTime12h('09:00', { compact: true })).toBe('9 AM');
    expect(formatTime12h('13:30')).toBe('1:30 PM');
    expect(formatTimeRange12h('09:00', '10:30')).toBe('9:00–10:30 AM');
    expect(formatTimeRange12h('11:30', '13:00')).toBe('11:30 AM–1:00 PM');
  });

  it('groups days cleanly (MWF, TTh, Mon–Fri) and round-trips meetings <-> DB rows', () => {
    expect(groupDaysLabel([1, 3, 5])).toBe('MWF');
    expect(groupDaysLabel([4, 2])).toBe('TTh');
    expect(groupDaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');

    const course = {
      id: 7,
      code: 'IPT 101',
      name: 'Integrative Programming',
      instructor: 'Prof. Dela Cruz',
      color: '#0a84ff',
      units: 3,
    };
    const meetings = [
      { days: [1, 3, 5], startTime: '11:30', endTime: '12:30', room: '207-B', kind: 'LEC' },
      { days: [2, 4], startTime: '17:30', endTime: '19:00', room: '503C', kind: 'LAB' },
    ];
    const rows = meetingsToScheduleRows(course, meetings);
    expect(rows.length).toBe(5);
    expect(rows.filter(r => r.kind === 'LAB').every(r => r.subject === 'IPT 101 lab')).toBe(true);

    const regrouped = scheduleRowsToMeetings(rows);
    expect(regrouped.length).toBe(2);
    expect(regrouped[0]).toMatchObject({ days: [1, 3, 5], room: '207-B', kind: 'LEC' });
    expect(regrouped[1]).toMatchObject({ days: [2, 4], room: '503C', kind: 'LAB' });
  });

  it('builds 30-min grid slots, detects conflicts, summarizes study load & tracks Now/Up Next', () => {
    const courses = [
      { id: 1, code: 'ICM 101A', name: 'Intro Computing', instructor: 'Prof. Reyes', units: 3, color: '#0a84ff' },
      { id: 2, code: 'CCS 102', name: 'Data Structs', instructor: 'Prof. Santos', units: 3, color: '#28b44c' },
    ];
    const rows = [
      ...meetingsToScheduleRows(courses[0], [
        { days: [1, 3, 5], startTime: '11:30', endTime: '12:30', room: '207-B', kind: 'LEC' },
      ]),
      ...meetingsToScheduleRows(courses[1], [
        { days: [1], startTime: '12:00', endTime: '13:30', room: '503C', kind: 'LAB' },
        { days: [6], startTime: '09:00', endTime: '12:00', room: '007-1B', kind: 'LAB' },
      ]),
    ];

    const entries = resolveScheduleEntries(courses, rows);
    expect(entries.length).toBe(5);

    const grid = computeTimetableGrid(entries);
    expect(grid.visibleDays.map(d => d.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(grid.slots[0]).toMatchObject({ label: '9 AM', isFullHour: true });
    expect(grid.slots[1]).toMatchObject({ label: '9:30', isFullHour: false });

    const { conflicts, layoutByKey } = detectScheduleConflicts(entries);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].dayLabel).toBe('Mon');
    expect(layoutByKey.size).toBe(2);

    const load = buildStudyLoadSummary(courses, entries);
    expect(load.totalUnits).toBe(6);
    expect(load.totalWeeklyHours).toBe(7.5);

    // Fixed clock: Monday 12:15 PM (inside both ICM 101A 11:30-12:30 and CCS 102 lab 12:00-13:30)
    const monNoon = new Date(2026, 10, 23, 12, 15, 0); // 2026-11-23 is Monday
    const status = getNowAndNextClass(entries, monNoon);
    expect(status.currentClass.baseCode).toBe('ICM 101A');
    expect(status.minutesRemainingCurrent).toBe(15);

    // Fixed clock: Monday 10:45 AM (45 min before ICM 101A)
    const monMorning = new Date(2026, 10, 23, 10, 45, 0);
    const morningStatus = getNowAndNextClass(entries, monMorning);
    expect(morningStatus.currentClass).toBeNull();
    expect(morningStatus.nextClass.baseCode).toBe('ICM 101A');
    expect(morningStatus.minutesUntilNext).toBe(45);
  });
});

describe('v2.0.3 Reduce Motion Setting Synchronization', () => {
  it('syncs data-reduce-motion attribute safely from theme settings', () => {
    globalThis.localStorage = createMockStorage();
    const attrs = new Map();
    const dataset = {};
    const styleProps = new Map();
    const rootEl = {
      dataset,
      style: { setProperty: (k, v) => styleProps.set(k, v), backgroundColor: '' },
      classList: { remove: () => {}, add: () => {} },
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: k => attrs.delete(k),
    };
    globalThis.document = {
      documentElement: rootEl,
      querySelector: () => null,
    };
    globalThis.window = {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    };

    localStorage.setItem(REDUCE_MOTION_KEY, 'true');
    expect(getSettings().reduceMotion).toBe(true);
    applySettings();
    expect(rootEl.dataset.reduceMotion).toBe('true');

    localStorage.setItem(REDUCE_MOTION_KEY, 'false');
    applySettings();
    expect(rootEl.dataset.reduceMotion).toBeUndefined();
  });
});
