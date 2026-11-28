import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/store/db';
import {
  parseSchoolCalendarText,
  parsePartialRevisionMemoOffline,
  diffSchoolCalendarEvents,
  applyCalendarDiffSelection,
  saveAndSyncSchoolCalendar,
  detectActiveTermForDate,
  filterCalendarEventsForDisplay,
} from '../src/lib/schoolCalendar';
import {
  parseGecMatrixText,
  matchGecToEnrolled,
  resolveGecModalityForDate,
  getGecPeriodSummaryForDate,
} from '../src/lib/gecSchedule';
import { buildNotePDF } from '../src/lib/pdf';
import { PDF_STYLES } from '../src/lib/pdfThemes';

const SAMPLE_HNU_CALENDAR = `
HOLY NAME UNIVERSITY
ACADEMIC CALENDAR FOR ACADEMIC YEAR 2026-2027

FIRST SEMESTER
July 8 Start of Classes for Tertiary Department
August 21 Ninoy Aquino Day
September 1-7 Midterm Examination
Oct 29-Nov 7 Final Examination
November 7 Last Day of Classes
November 14 Deadline of Final Grades

SECOND SEMESTER
November 23 Start of Classes
December 19 Last school day of 2026
January 4 Start of Class 2027
February 1-6 Midterm Examination
February 15-20 University Days
March 15-20 Final Exams - Grad Students
March 25-27 Holy Days
April 5-10 Final Exams - Non-Grad Stud
April 10 Last Day of Classes

SUMMER
April 26 Start of Classes
May 14 Midterm Examination
June 4 Final Examination
`;

const SAMPLE_GEC_MATRIX = `
General Education
Face-to-Face and Virtual Schedule
2nd Sem AY 2026-2027
Set A: Art | Math | Rizal | World
Set B: STS | Self | Com | Hist | Ethics
November 23 - 28, 2026 | Adjustment Period
December 1 - 2, 2026 | Face-to-Face | Virtual
December 3-4 | Virtual | Face-to-Face
December 7 - 11, 2026 | Face-to-Face | Virtual
February 1 - 6, 2027 | Midterm Exam
February 15 - 20, 2027 | University Days
March 25 - 26, 2027 | Holy Days
April 5 - 10, 2027 | Final Exam
`;

describe('v2.6.0 Multi-Term School Calendar Maker & Mid-Sem Revision Diff', () => {
  beforeEach(async () => {
    await db.plannerItems.clear();
    await db.schoolCalendars.clear();
  });

  it('infers cross-year dates, cross-month ranges, Grad vs Non-Grad exams across all 3 terms', () => {
    const cal = parseSchoolCalendarText(SAMPLE_HNU_CALENDAR);
    expect(cal.academicYear).toBe('2026-2027');

    const firstStart = cal.events.find(e => e.term === 'first' && /start of classes/i.test(e.title));
    expect(firstStart?.startDate).toBe('2026-07-08');

    const crossMonthFinals = cal.events.find(e => e.term === 'first' && /final exam/i.test(e.title));
    expect(crossMonthFinals?.startDate).toBe('2026-10-29');
    expect(crossMonthFinals?.endDate).toBe('2026-11-07');

    const janReturn = cal.events.find(e => e.term === 'second' && /start of class 2027/i.test(e.title));
    expect(janReturn?.startDate).toBe('2027-01-04');

    const gradFinal = cal.events.find(e => /grad students/i.test(e.title));
    const nonGradFinal = cal.events.find(e => /non-grad/i.test(e.title));
    expect(gradFinal?.audience).toBe('grad');
    expect(nonGradFinal?.audience).toBe('undergrad');

    const visible = filterCalendarEventsForDisplay({ ...cal, activeTerm: 'second', includeGradExams: false });
    expect(visible.some(e => e.audience === 'grad')).toBe(false);
    expect(visible.some(e => e.audience === 'undergrad')).toBe(true);

    expect(detectActiveTermForDate(cal.events, '2026-12-05')).toBe('second');
    expect(detectActiveTermForDate(cal.events, '2027-05-10')).toBe('summer');
  });

  it('handles mid-sem revision diffs (partial memos) without wiping personal tasks', async () => {
    // Seed personal task + initial calendar
    await db.plannerItems.add({
      title: 'Buy lab notebook',
      course: 'Personal',
      type: 'todo',
      source: 'local',
      dateKey: '2027-02-02',
      done: false,
    });

    const parsed = parseSchoolCalendarText(SAMPLE_HNU_CALENDAR);
    const savedV1 = await saveAndSyncSchoolCalendar({ ...parsed, activeTerm: 'second', version: 1 });

    // Revise midterms + suspend a day via memo
    const patches = parsePartialRevisionMemoOffline(
      'Midterm Examination moved to Feb 8-13\nFeb 26 classes suspended',
      savedV1
    );
    const diff = diffSchoolCalendarEvents(savedV1.events, patches, { isPartialPatch: true });
    expect(diff.moved.length).toBe(1);
    expect(diff.moved[0].prev.startDate).toBe('2027-02-01');
    expect(diff.moved[0].next.startDate).toBe('2027-02-08');
    expect(diff.added.length).toBe(1);
    expect(diff.removed.length).toBe(0);

    const nextEvents = applyCalendarDiffSelection(savedV1.events, diff);
    await saveAndSyncSchoolCalendar({ ...savedV1, version: 2, events: nextEvents });

    const allPlanner = await db.plannerItems.toArray();
    // Personal task stays intact!
    expect(allPlanner.some(it => it.title === 'Buy lab notebook' && it.source === 'local')).toBe(true);
    // Midterms updated cleanly to Feb 8 without leaving stale Feb 1 duplicate
    const midterms = allPlanner.filter(it => it.source === 'school-calendar' && /midterm exam/i.test(it.title));
    expect(midterms.length).toBe(1);
    expect(midterms[0].dateKey).toBe('2027-02-08');
  });
});

describe('v2.6.0 GEC Set A/B Auto-Matcher & Split-Week Modality Resolver', () => {
  it('parses split weeks, missing years, and special periods then matches enrolled GECs accurately', () => {
    const matrix = parseGecMatrixText(SAMPLE_GEC_MATRIX);
    expect(matrix.sets.length).toBe(2);
    expect(matrix.sets[0].subjects).toEqual(['Art', 'Math', 'Rizal', 'World']);

    // Check December 3-4 (missing year in text!) inherited 2026 & flipped Set A -> virtual, Set B -> f2f
    const dec34 = matrix.periods.find(p => p.startDate === '2026-12-03');
    expect(dec34).toBeDefined();
    expect(dec34.modalities['set-a']).toBe('virtual');
    expect(dec34.modalities['set-b']).toBe('f2f');

    const matched = matchGecToEnrolled({
      sets: matrix.sets,
      enrolledCourses: [
        { id: 1, code: 'GEC-MMW', name: 'Mathematics in the Modern World' },
        { id: 2, code: 'GEC-UTS', name: 'Understanding the Self' },
        { id: 3, code: 'CS 201', name: 'Data Structures and Algorithms' },
      ],
    });
    const mmw = matched.matchedCourses.find(c => c.code === 'GEC-MMW');
    const uts = matched.matchedCourses.find(c => c.code === 'GEC-UTS');
    const cs = matched.matchedCourses.find(c => c.code === 'CS 201');
    expect(mmw?.setId).toBe('set-a');
    expect(uts?.setId).toBe('set-b');
    expect(cs?.setId).toBeNull();

    const gecSched = {
      ...matrix,
      courseSetMap: {
        'id:1': { setId: 'set-a' },
        'id:2': { setId: 'set-b' },
      },
    };
    // Dec 1: Set A F2F, Set B Virtual
    expect(resolveGecModalityForDate({ courseId: 1, code: 'GEC-MMW' }, '2026-12-01', gecSched)?.mode).toBe('f2f');
    expect(resolveGecModalityForDate({ courseId: 2, code: 'GEC-UTS' }, '2026-12-01', gecSched)?.mode).toBe('virtual');
    // Dec 3 (mid-week flip!): Set A Virtual, Set B F2F
    expect(resolveGecModalityForDate({ courseId: 1, code: 'GEC-MMW' }, '2026-12-03', gecSched)?.mode).toBe('virtual');
    expect(resolveGecModalityForDate({ courseId: 2, code: 'GEC-UTS' }, '2026-12-03', gecSched)?.mode).toBe('f2f');
    // Non-GEC returns null
    expect(resolveGecModalityForDate({ courseId: 3, code: 'CS 201' }, '2026-12-03', gecSched)).toBeNull();
    // Merged row Feb 3 -> Midterm Exam
    expect(resolveGecModalityForDate({ courseId: 1, code: 'GEC-MMW' }, '2027-02-03', gecSched)?.label).toBe('Midterm Exam');
    expect(getGecPeriodSummaryForDate('2026-12-01', gecSched)?.text).toBe('Set A F2F · Set B Virtual');
  });
});

describe('v2.6.0 Distinct PDF Export Layouts', () => {
  it('builds valid distinct jsPDF documents across all 5 visual designs', async () => {
    expect(PDF_STYLES.length).toBe(6);
    const md = `# Overview\nKey takeaway with **bold** and \`inline()\`.\n\n- Bullet item 1\n- Bullet item 2\n\n> Important study quote.\n\n\`\`\`js\nconsole.log("hi");\n\`\`\``;
    const outputs = {};
    for (const st of ['academic', 'cheatsheet', 'technical', 'editorial', 'minimal']) {
      const doc = await buildNotePDF({
        title: 'Operating Systems Notes',
        subject: 'CS 301',
        body: md,
        pdfStyle: st,
      });
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
      outputs[st] = doc.output();
    }
    // Verify outputs actually differ structurally/visually between designs
    expect(outputs.cheatsheet).not.toBe(outputs.academic);
    expect(outputs.technical).not.toBe(outputs.academic);
    expect(outputs.editorial).not.toBe(outputs.minimal);
  });
});
