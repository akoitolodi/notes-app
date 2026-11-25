import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, ensureSeeded } from '../src/store/db';
import {
  parseDayTokens,
  parseTimeRangeTo24h,
  cleanRoomLabel,
  parseScheduleLines,
  looksLikeClassScheduleText,
  commitImportedSchedule,
} from '../src/lib/schedulePdfParser';
import {
  matchAnnouncementToCourse,
  extractQuickLinks,
  parseCanvasDiscussionUrl,
  getNextUpcomingClassAcrossWeek,
} from '../src/lib/announcementSchedule';
import { resolveScheduleEntries } from '../src/lib/scheduleView';
import { buildClassReminderSchedules } from '../src/lib/notifications';

const HNU_SAMPLE_LINES = [
  'Holy Name University',
  'STUDENT’S CLASS SCHEDULE',
  '2nd Semester 2026-2027',
  'Catalog No. Section Units Time Room Teacher’s Signature',
  'PATH FIT 4 Y 2.00 04:30PM-05:30PM MW G3',
  'ICM 101A A 3.00 11:30AM-12:30PM MWF 207-B',
  'IPM 101 C 3.00 01:30PM-02:30PM MWF 207-B',
  'MS 102 B 3.00 03:30PM-04:30PM MWF 210-B',
  'NET 101A C 3.00 09:00AM-10:30AM TTh 007-1B (Computer Lab',
  '01:30PM-02:30PM TTh IT 3',
  'CCS 105 C 3.00 11:30AM-01:00PM TTh 503C (Computer Lab)',
  '07:00PM-08:00PM TTh IT 3',
  'GEC ART I 3.00 03:00PM-04:30PM TTh 101C',
  'IPT 101A C 3.00 04:30PM-05:30PM TTh IT 3',
  '05:30PM-07:00PM TTh 503C (Computer Lab)',
  'Total Units: 23.0',
  'Run Date:Wed. Nov. 25, 2026 11:36AM Page: 1/1 *729378*',
];

describe('v2.1.0 PDF Schedule Importer, Announcement Matching & Class Reminders', () => {
  beforeEach(async () => {
    await db.courses.clear();
    await db.classSchedule.clear();
    await db.folders.clear();
    await db.plannerItems.clear();
    await ensureSeeded();
  });

  it('parses day tokens, 12h/24h time ranges, and room labels with balanced parens & LAB/LEC detection', () => {
    expect(parseDayTokens('MWF')).toEqual([1, 3, 5]);
    expect(parseDayTokens('TTh')).toEqual([2, 4]);
    expect(parseDayTokens('MW')).toEqual([1, 3]);
    expect(parseTimeRangeTo24h('04:30PM-05:30PM')).toEqual({ startTime: '16:30', endTime: '17:30' });
    expect(parseTimeRangeTo24h('11:30AM-01:00PM')).toEqual({ startTime: '11:30', endTime: '13:00' });
    expect(cleanRoomLabel('007-1B (Computer Lab')).toEqual({
      room: '007-1B (Computer Lab)',
      kind: 'LAB',
    });
    expect(cleanRoomLabel('IT 3')).toEqual({ room: 'IT 3', kind: 'LEC' });
  });

  it('parses all 8 HNU courses, multi-row Lab+Lec splits, sections, and 23.0 units cleanly', () => {
    const res = parseScheduleLines(HNU_SAMPLE_LINES);
    expect(res.semester).toBe('2nd Semester 2026-2027');
    expect(res.declaredTotalUnits).toBe(23.0);
    expect(res.totalUnits).toBe(23);
    expect(res.courses.length).toBe(8);
    expect(looksLikeClassScheduleText(HNU_SAMPLE_LINES.join('\n'))).toBe(true);

    const pathFit = res.courses.find(c => c.code === 'PATH FIT 4');
    expect(pathFit).toMatchObject({ section: 'Y', units: 2 });

    const net = res.courses.find(c => c.code === 'NET 101A');
    expect(net.section).toBe('C');
    expect(net.meetings).toEqual([
      { days: [2, 4], startTime: '09:00', endTime: '10:30', room: '007-1B (Computer Lab)', kind: 'LAB' },
      { days: [2, 4], startTime: '13:30', endTime: '14:30', room: 'IT 3', kind: 'LEC' },
    ]);

    const ipt = res.courses.find(c => c.code === 'IPT 101A');
    expect(ipt.section).toBe('C');
    expect(ipt.meetings.length).toBe(2);
    expect(ipt.meetings[0]).toMatchObject({ startTime: '16:30', endTime: '17:30', room: 'IT 3', kind: 'LEC' });
    expect(ipt.meetings[1]).toMatchObject({
      startTime: '17:30',
      endTime: '19:00',
      room: '503C (Computer Lab)',
      kind: 'LAB',
    });
  });

  it('commits imported courses, timetable rows, and matching Note folders with smart-merge idempotence', async () => {
    const parsed = parseScheduleLines(HNU_SAMPLE_LINES);
    const first = await commitImportedSchedule({ courses: parsed.courses, createFolders: true });
    expect(first.created).toBe(8);
    expect(first.updated).toBe(0);
    expect(first.foldersCreated).toBe(8);
    expect(first.slots).toBe(25); // 1x2 (MW) + 3x3 (MWF) + 7x2 (TTh) = 25 weekly rows

    const folders = await db.folders.toArray();
    expect(folders.some(f => f.name === 'IPT 101A')).toBe(true);

    // Second import updates cleanly without duplicating courses or folders
    const second = await commitImportedSchedule({ courses: parsed.courses, createFolders: true });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(8);
    expect(second.foldersCreated).toBe(0);
    expect((await db.courses.toArray()).length).toBe(8);
  });

  it('silently matches Canvas announcement titles (Acronym + Section) to scheduled times & saves teacher hint', async () => {
    const parsed = parseScheduleLines(HNU_SAMPLE_LINES);
    await commitImportedSchedule({ courses: parsed.courses, createFolders: false });
    const courses = await db.courses.toArray();
    const sched = await db.classSchedule.toArray();

    // Wed Nov 25 2026 11:45 AM
    const nowWed = new Date(2026, 10, 25, 11, 45, 0);

    const iptAnn = {
      course: 'C - Integrative Programming and Technologies',
      author: 'Harvey Sean Ocmen',
      title: 'Welcome to 2nd Semester',
      description: 'Join GC https://chat.google.com/room/AAAA123 or Meet https://meet.google.com/abc-defg-hij',
    };
    const mIpt = matchAnnouncementToCourse(iptAnn, courses, sched, nowWed);
    expect(mIpt).not.toBeNull();
    expect(mIpt.course.code).toBe('IPT 101A');
    expect(mIpt.summaryText).toContain('IPT 101A');
    expect(mIpt.summaryText).toContain('4:30');
    expect(mIpt.summaryText).toContain('IT 3');
    expect(mIpt.summaryText).toContain('503C (Computer Lab)');
    expect(mIpt.nextMeetingLabel).toContain('Tomorrow 4:30 PM');
    expect(mIpt.canSaveTeacher).toBe(true);

    const mArt = matchAnnouncementToCourse(
      { course: 'I - Art Appreciation', title: 'Syllabus' },
      courses,
      sched,
      nowWed
    );
    expect(mArt?.course.code).toBe('GEC ART');

    const mNet = matchAnnouncementToCourse(
      { course: 'C - Networking 1', title: 'Lab Guidelines' },
      courses,
      sched,
      nowWed
    );
    expect(mNet?.course.code).toBe('NET 101A');

    const links = extractQuickLinks(iptAnn.description);
    expect(links.map(l => l.label)).toEqual(['Google Chat', 'Google Meet']);

    expect(
      parseCanvasDiscussionUrl('https://hnu.instructure.com/courses/14209/discussion_topics/987654')
    ).toEqual({
      host: 'hnu.instructure.com',
      courseId: '14209',
      topicId: '987654',
    });

    const entries = resolveScheduleEntries(courses, sched);
    const upNext = getNextUpcomingClassAcrossWeek(entries, nowWed);
    expect(upNext?.status).toBe('now'); // ICM 101A runs MWF 11:30 AM - 12:30 PM on Wed 11:45 AM!
    expect(upNext?.entry.baseCode).toBe('ICM 101A');

    const reminders = buildClassReminderSchedules(courses, sched, [iptAnn], nowWed.getTime(), {
      leadMinutes: 15,
    });
    expect(reminders.length).toBeGreaterThan(5);
    const iptRem = reminders.find(r => r.title.includes('IPT 101A'));
    expect(iptRem?.title).toContain('Class in 15m');
    expect(iptRem?.body).toContain('1 unread post');
  });
});
