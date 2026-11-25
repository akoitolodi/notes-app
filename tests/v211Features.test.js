import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, ensureSeeded } from '../src/store/db';
import {
  parseSchedulePdfItems,
  parseScheduleLines,
  commitImportedSchedule,
} from '../src/lib/schedulePdfParser';
import {
  resolveScheduleEntries,
  detectScheduleConflicts,
  cleanupOrphanScheduleRows,
  meetingsToScheduleRows,
} from '../src/lib/scheduleView';
import {
  matchAnnouncementToCourse,
  assignAnnouncementsToCourses,
} from '../src/lib/announcementSchedule';
import { buildClassReminderSchedules } from '../src/lib/notifications';
import {
  computeMinPassingScore,
  evaluateQuizScore,
  summarizeQuizHistory,
} from '../src/lib/gradeCalc';
import { shouldAutoShowOnboarding } from '../src/lib/onboarding';

// Exact PDF item coordinates extracted from real HNU Class Schedule (`academics.pdf`)
const HNU_ACADEMICS_PDF_ITEMS = [
  { x: 73.7, y: 385.2, width: 190, str: 'Holy Name University' },
  { x: 478.3, y: 352.8, width: 100, str: '2nd Semester 2026-2027' },
  { x: 59.8, y: 327.2, width: 50.6, str: 'Catalog No.' },
  { x: 133.3, y: 327.2, width: 31.1, str: 'Section' },
  { x: 180, y: 327.2, width: 22.8, str: 'Units' },
  { x: 286.5, y: 327.2, width: 22.2, str: 'Time' },
  { x: 398.3, y: 327.2, width: 25.5, str: 'Room' },
  { x: 453.2, y: 327.2, width: 85.8, str: "Teacher's Signature" },
  { x: 45.4, y: 308.8, width: 51.1, str: 'PATH FIT 4' },
  { x: 145.2, y: 308.8, width: 7.2, str: 'Y' },
  { x: 182.6, y: 308.8, width: 17.5, str: '2.00' },
  { x: 215.4, y: 308.8, width: 98.6, str: '04:30PM-05:30PM MW' },
  { x: 404.9, y: 308.8, width: 12.2, str: 'G3' },
  { x: 45.4, y: 291.8, width: 43.6, str: 'ICM 101A' },
  { x: 145.2, y: 291.8, width: 7.2, str: 'A' },
  { x: 182.6, y: 291.8, width: 17.5, str: '3.00' },
  { x: 215.4, y: 291.8, width: 105.8, str: '11:30AM-12:30PM MWF' },
  { x: 398.5, y: 291.8, width: 25, str: '207-B' },
  { x: 45.4, y: 274.8, width: 35.3, str: 'IPM 101' },
  { x: 145.5, y: 274.8, width: 6.7, str: 'C' },
  { x: 182.6, y: 274.8, width: 17.5, str: '3.00' },
  { x: 215.4, y: 274.8, width: 104.2, str: '01:30PM-02:30PM MWF' },
  { x: 398.5, y: 274.8, width: 25, str: '207-B' },
  { x: 45.4, y: 257.8, width: 32, str: 'MS 102' },
  { x: 145.5, y: 257.8, width: 6.7, str: 'B' },
  { x: 182.6, y: 257.8, width: 17.5, str: '3.00' },
  { x: 215.4, y: 257.8, width: 104.2, str: '03:30PM-04:30PM MWF' },
  { x: 398.5, y: 257.8, width: 25, str: '210-B' },
  // Vertically centered multi-slot subjects: anchor Y sits BETWEEN the two time rows!
  { x: 45.4, y: 237.9, width: 44.2, str: 'NET 101A' },
  { x: 145.5, y: 237.9, width: 6.7, str: 'C' },
  { x: 182.6, y: 237.9, width: 17.5, str: '3.00' },
  { x: 215.4, y: 243.6, width: 100.8, str: '09:00AM-10:30AM TTh' },
  { x: 385.5, y: 243.6, width: 93.9, str: '007-1B (Computer Lab' },
  { x: 215.4, y: 232.3, width: 97.5, str: '01:30PM-02:30PM TTh' },
  { x: 385.5, y: 232.3, width: 16.9, str: 'IT 3' },
  { x: 45.4, y: 215.3, width: 36.4, str: 'CCS 105' },
  { x: 145.5, y: 215.3, width: 6.7, str: 'C' },
  { x: 182.6, y: 215.3, width: 17.5, str: '3.00' },
  { x: 215.4, y: 220.9, width: 99.2, str: '11:30AM-01:00PM TTh' },
  { x: 385.5, y: 220.9, width: 88.9, str: '503C (Computer Lab)' },
  { x: 215.4, y: 209.6, width: 97.5, str: '07:00PM-08:00PM TTh' },
  { x: 385.5, y: 209.6, width: 16.9, str: 'IT 3' },
  { x: 45.4, y: 195.4, width: 42.5, str: 'GEC ART' },
  { x: 147.2, y: 195.4, width: 3.3, str: 'I' },
  { x: 182.6, y: 195.4, width: 17.5, str: '3.00' },
  { x: 215.4, y: 195.4, width: 97.5, str: '03:00PM-04:30PM TTh' },
  { x: 400.2, y: 195.4, width: 21.7, str: '101C' },
  { x: 45.4, y: 175.6, width: 39.7, str: 'IPT 101A' },
  { x: 145.5, y: 175.6, width: 6.7, str: 'C' },
  { x: 182.6, y: 175.6, width: 17.5, str: '3.00' },
  { x: 215.4, y: 181.3, width: 97.5, str: '04:30PM-05:30PM TTh' },
  { x: 385.5, y: 181.3, width: 16.9, str: 'IT 3' },
  { x: 215.4, y: 169.9, width: 97.5, str: '05:30PM-07:00PM TTh' },
  { x: 385.5, y: 169.9, width: 88.9, str: '503C (Computer Lab)' },
  { x: 121.9, y: 155.7, width: 48.1, str: 'Total Units:' },
  { x: 184.3, y: 155.7, width: 17.5, str: '23.0' },
];

describe('v2.1.1 2D Schedule PDF Parser, Teachers & Overlap Elimination', () => {
  beforeEach(async () => {
    await db.courses.clear();
    await db.classSchedule.clear();
    await db.folders.clear();
    await ensureSeeded();
  });

  it('extracts ALL 8 HNU courses, all 11 vertically-centered meetings, 23.0 units, and 0 overlaps from exact PDF coordinates', async () => {
    const parsed = parseSchedulePdfItems(HNU_ACADEMICS_PDF_ITEMS);
    expect(parsed.semester).toBe('2nd Semester 2026-2027');
    expect(parsed.declaredTotalUnits).toBe(23.0);
    expect(parsed.totalUnits).toBe(23);
    expect(parsed.courses.length).toBe(8);

    const totalMeetings = parsed.courses.reduce((n, c) => n + c.meetings.length, 0);
    expect(totalMeetings).toBe(11);

    const net = parsed.courses.find(c => c.code === 'NET 101A');
    expect(net.meetings).toEqual([
      { days: [2, 4], startTime: '09:00', endTime: '10:30', room: '007-1B (Computer Lab)', kind: 'LAB' },
      { days: [2, 4], startTime: '13:30', endTime: '14:30', room: 'IT 3', kind: 'LEC' },
    ]);

    const ccs = parsed.courses.find(c => c.code === 'CCS 105');
    expect(ccs.meetings).toHaveLength(2);
    expect(ccs.meetings[0]).toMatchObject({ startTime: '11:30', endTime: '13:00', kind: 'LAB' });
    expect(ccs.meetings[1]).toMatchObject({ startTime: '19:00', endTime: '20:00', kind: 'LEC' });

    const ipt = parsed.courses.find(c => c.code === 'IPT 101A');
    expect(ipt.meetings).toHaveLength(2);
    expect(ipt.meetings[0]).toMatchObject({ startTime: '16:30', endTime: '17:30', room: 'IT 3', kind: 'LEC' });
    expect(ipt.meetings[1]).toMatchObject({
      startTime: '17:30',
      endTime: '19:00',
      room: '503C (Computer Lab)',
      kind: 'LAB',
    });

    await commitImportedSchedule({ courses: parsed.courses, createFolders: false, replaceExisting: true });
    const courses = await db.courses.toArray();
    const rows = await db.classSchedule.toArray();
    const entries = resolveScheduleEntries(courses, rows);
    const { conflicts } = detectScheduleConflicts(entries);
    expect(entries.length).toBe(25);
    expect(conflicts).toEqual([]);
  });

  it('extracts Teacher column cleanly without Room overflow bleed and preserves TBA subjects', () => {
    const items = [
      { x: 40, y: 400, width: 60, str: 'Course Code' },
      { x: 130, y: 400, width: 40, str: 'Section' },
      { x: 185, y: 400, width: 30, str: 'Units' },
      { x: 240, y: 400, width: 80, str: 'Time' },
      { x: 370, y: 400, width: 40, str: 'Room' },
      { x: 460, y: 400, width: 60, str: 'Instructor' },
      { x: 40, y: 370, width: 50, str: 'IPT 101A' },
      { x: 135, y: 370, width: 10, str: 'C' },
      { x: 188, y: 370, width: 20, str: '3.0' },
      { x: 240, y: 370, width: 100, str: '04:30PM-05:30PM TTh' },
      { x: 370, y: 370, width: 95, str: '503C (Computer Lab)' },
      { x: 460, y: 370, width: 80, str: 'Harvey Sean Ocmen' },
      { x: 40, y: 340, width: 50, str: 'CAP 201' },
      { x: 135, y: 340, width: 10, str: 'A' },
      { x: 188, y: 340, width: 20, str: '3.0' },
      { x: 240, y: 340, width: 25, str: 'TBA' },
      { x: 460, y: 340, width: 70, str: 'Prof. Elena Cruz' },
    ];
    const parsed = parseSchedulePdfItems(items);
    expect(parsed.courses).toHaveLength(2);
    expect(parsed.courses[0]).toMatchObject({
      code: 'IPT 101A',
      instructor: 'Harvey Sean Ocmen',
    });
    expect(parsed.courses[0].meetings[0].room).toBe('503C (Computer Lab)');
    expect(parsed.courses[1]).toMatchObject({
      code: 'CAP 201',
      instructor: 'Prof. Elena Cruz',
      meetings: [],
    });

    const pasted = parseScheduleLines([
      'IPT 101A C 3.00 04:30PM-05:30PM TTh IT 3 | Harvey Sean Ocmen',
    ]);
    expect(pasted.courses[0].instructor).toBe('Harvey Sean Ocmen');
    expect(pasted.courses[0].meetings[0].room).toBe('IT 3');
  });

  it('strips archived, orphan, and duplicate DB schedule rows and replaces "<CODE> lab" cleanly', async () => {
    const active = { id: 1, code: 'IPT 101A', name: 'IPT 101A', archived: false };
    const archived = { id: 2, code: 'OLD 101', name: 'OLD 101', archived: true };
    const rows = [
      ...meetingsToScheduleRows(active, [{ days: [2, 4], startTime: '16:30', endTime: '17:30', room: 'IT 3', kind: 'LEC' }]),
      // Exact duplicate DB row that previously caused self-overlap!
      { id: 99, courseId: 1, subject: 'IPT 101A', kind: 'LEC', dayOfWeek: 2, startTime: '16:30', endTime: '17:30', room: 'IT 3' },
      // Archived course row colliding at same time
      { id: 100, courseId: 2, subject: 'OLD 101', kind: 'LEC', dayOfWeek: 2, startTime: '16:30', endTime: '17:30', room: '201' },
      // Deleted-course orphan row colliding at same time
      { id: 101, courseId: 999, subject: 'DELETED 99', kind: 'LEC', dayOfWeek: 2, startTime: '16:30', endTime: '17:30', room: '202' },
    ].map((r, idx) => ({ id: r.id || idx + 1, ...r }));

    const entries = resolveScheduleEntries([active, archived], rows);
    expect(entries).toHaveLength(2); // Only active Tue & Thu slots
    expect(detectScheduleConflicts(entries).conflicts).toEqual([]);

    const deletedIds = [];
    const removedCount = await cleanupOrphanScheduleRows({
      courses: [active, archived],
      scheduleRows: rows,
      deleteRow: id => {
        deletedIds.push(id);
        return Promise.resolve();
      },
    });
    expect(removedCount).toBe(3);
    expect(deletedIds).toEqual(expect.arrayContaining([99, 100, 101]));
  });
});

describe('v2.1.1 Zero Announcement Bleeding (Strict 1-to-1 Course Ownership)', () => {
  const courses = [
    { id: 1, code: 'IPT 101A', name: 'IPT 101A', section: 'C', instructor: 'Harvey Sean Ocmen' },
    { id: 2, code: 'CCS 105', name: 'CCS 105', section: 'C', instructor: 'Harvey Sean Ocmen' },
    { id: 3, code: 'NET 101A', name: 'NET 101A', section: 'A', instructor: 'Prof. Dela Cruz' },
    { id: 4, code: 'GEC ART', name: 'GEC ART', section: 'I', instructor: 'Prof. Luna' },
  ];

  it('never leaks announcements across courses taught by the same teacher or mismatched sections', () => {
    // Section C announcement with shared teacher: must ONLY match IPT 101A, NOT CCS 105!
    const iptAnn = {
      id: 10,
      course: 'C - Integrative Programming and Technologies',
      author: 'Harvey Sean Ocmen',
      title: 'Welcome',
    };
    const m1 = matchAnnouncementToCourse(iptAnn, courses, []);
    expect(m1?.course?.code).toBe('IPT 101A');

    // Different teacher/different section: Section C Networking post must NOT bleed into Section A Networking course!
    const wrongSecAnn = {
      id: 11,
      course: 'C - Networking 1',
      author: 'Prof. Dela Cruz',
      title: 'Lab update',
    };
    expect(matchAnnouncementToCourse(wrongSecAnn, courses, [])).toBeNull();

    // Unrelated subject sharing ONLY the teacher name must NOT falsely match either course
    const otherSubjectSameTeacher = {
      id: 12,
      course: 'D - Data Warehousing Elective',
      author: 'Harvey Sean Ocmen',
      title: 'Project',
    };
    expect(matchAnnouncementToCourse(otherSubjectSameTeacher, courses, [])).toBeNull();

    const grouped = assignAnnouncementsToCourses([iptAnn, wrongSecAnn, otherSubjectSameTeacher], courses);
    expect(grouped.get(1)).toHaveLength(1);
    expect(grouped.get(2)).toHaveLength(0);
    expect(grouped.get(3)).toHaveLength(0);
  });
});

describe('v2.1.1 Persistent Customizable Class Reminders, Quiz Pass Calc & Onboarding', () => {
  it('builds persistent class reminders with customizable lead time and immediate ongoing imminent alert', () => {
    const courses = [{ id: 1, code: 'IPT 101A', section: 'C', instructor: 'Harvey Sean Ocmen' }];
    const rows = [
      { id: 1, courseId: 1, subject: 'IPT 101A', kind: 'LEC', dayOfWeek: 3, startTime: '13:00', endTime: '14:00', room: 'IT 3' },
    ];
    // Wed Nov 25 2026 12:53 PM — 7 minutes before 1:00 PM class (within 10m lead window!)
    const wedImminent = new Date(2026, 10, 25, 12, 53, 0).getTime();
    const remPersist = buildClassReminderSchedules(courses, rows, [], wedImminent, {
      leadMinutes: 10,
      persistent: true,
    });
    expect(remPersist).toHaveLength(1);
    expect(remPersist[0].title).toContain('Class in 7m: IPT 101A');
    expect(remPersist[0].ongoing).toBe(true);
    expect(remPersist[0].autoCancel).toBe(false);
    expect(remPersist[0].channelId).toBe('class-reminders');
    expect(remPersist[0].body).toContain('Harvey Sean Ocmen');

    // Earlier in the day (10:00 AM) with custom 20-min lead time
    const wedMorning = new Date(2026, 10, 25, 10, 0, 0).getTime();
    const rem20 = buildClassReminderSchedules(courses, rows, [], wedMorning, {
      leadMinutes: 20,
      persistent: true,
    });
    expect(rem20[0].title).toContain('Class in 20m: IPT 101A');
    expect(rem20[0].ongoing).toBe(true);
  });

  it('evaluates Raw (Zero-Based), Base-50, and Base-60 quiz scores, reverse targets & history', () => {
    const rawFail = evaluateQuizScore({ score: 36, total: 50, passingPercent: 75, base: 0 });
    expect(rawFail).toMatchObject({ rawPercent: 72, transmutedPercent: 72, passed: false, minScore: 38, pointsMargin: -2 });

    // Base-50: 25 / 50 => 50 + 50*(0.5) = 75% PASSED
    const base50Pass = evaluateQuizScore({ score: 25, total: 50, passingPercent: 75, base: 50 });
    expect(base50Pass).toMatchObject({ rawPercent: 50, transmutedPercent: 75, passed: true, minScore: 25, pointsMargin: 0 });

    // Reverse mode before exam (score blank, total 60, Base-60, passing 75% => 37.5% raw => 23/60)
    const rev = computeMinPassingScore({ total: 60, passingPercent: 75, base: 60 });
    expect(rev.minScore).toBe(23);
    expect(rev.maxMistakes).toBe(37);

    const summary = summarizeQuizHistory(
      [
        { transmutedPercent: 72, passed: false },
        { transmutedPercent: 86, passed: true },
      ],
      75
    );
    expect(summary).toMatchObject({ count: 2, passedCount: 1, passRate: 50, avgPercent: 79, neededNextPercent: 67 });
  });

  it('triggers onboarding automatically ONLY on genuinely fresh installs', () => {
    expect(shouldAutoShowOnboarding({ onboardingDone: false, noteCount: 0, courseCount: 0, hasApiKey: false })).toBe(true);
    expect(shouldAutoShowOnboarding({ onboardingDone: true, noteCount: 0, courseCount: 0, hasApiKey: false })).toBe(false);
    expect(shouldAutoShowOnboarding({ onboardingDone: false, noteCount: 1, courseCount: 0, hasApiKey: false })).toBe(false);
    expect(shouldAutoShowOnboarding({ onboardingDone: false, noteCount: 0, courseCount: 2, hasApiKey: false })).toBe(false);
    expect(shouldAutoShowOnboarding({ onboardingDone: false, noteCount: 0, courseCount: 0, hasApiKey: true })).toBe(false);
  });
});
