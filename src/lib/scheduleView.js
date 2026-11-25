/**
 * scheduleView.js — Pure helpers for the 30-minute visual Timetable Grid,
 * Study Load summary (Code · Days · Time · Room · Teacher · Units),
 * overlap/conflict detection, Now / Up Next card, and Course <-> classSchedule sync.
 */

export const SCHEDULE_DAYS = [
  { idx: 1, short: 'Mon', code: 'M' },
  { idx: 2, short: 'Tue', code: 'T' },
  { idx: 3, short: 'Wed', code: 'W' },
  { idx: 4, short: 'Thu', code: 'Th' },
  { idx: 5, short: 'Fri', code: 'F' },
  { idx: 6, short: 'Sat', code: 'S' },
  { idx: 0, short: 'Sun', code: 'Su' },
];

const DAY_ORDER_INDEX = new Map(SCHEDULE_DAYS.map((d, i) => [d.idx, i]));

export function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

export function formatTime12h(hhmmOrMins, { compact = false } = {}) {
  const totalMins =
    typeof hhmmOrMins === 'number' ? hhmmOrMins : timeToMinutes(hhmmOrMins);
  if (totalMins === null || !Number.isFinite(totalMins)) return String(hhmmOrMins || '');
  const h24 = Math.floor(totalMins / 60) % 24;
  const mins = totalMins % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (compact && mins === 0) return `${h12} ${period}`;
  return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
}

export function formatTimeRange12h(startTime, endTime) {
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  if (sMin === null || eMin === null) {
    return [startTime, endTime].filter(Boolean).join('–');
  }
  const sPeriod = Math.floor(sMin / 60) >= 12 ? 'PM' : 'AM';
  const ePeriod = Math.floor(eMin / 60) >= 12 ? 'PM' : 'AM';
  const sH12 = Math.floor(sMin / 60) % 12 === 0 ? 12 : Math.floor(sMin / 60) % 12;
  const eH12 = Math.floor(eMin / 60) % 12 === 0 ? 12 : Math.floor(eMin / 60) % 12;
  const sStr = `${sH12}:${String(sMin % 60).padStart(2, '0')}`;
  const eStr = `${eH12}:${String(eMin % 60).padStart(2, '0')} ${ePeriod}`;
  return sPeriod === ePeriod ? `${sStr}–${eStr}` : `${sStr} ${sPeriod}–${eStr}`;
}

export function groupDaysLabel(dayNums = []) {
  const unique = [...new Set(dayNums.map(Number).filter(n => DAY_ORDER_INDEX.has(n)))].sort(
    (a, b) => DAY_ORDER_INDEX.get(a) - DAY_ORDER_INDEX.get(b)
  );
  if (unique.length === 0) return '';
  if (unique.length === 5 && unique.join(',') === '1,2,3,4,5') return 'Mon–Fri';
  return unique
    .map(idx => SCHEDULE_DAYS.find(d => d.idx === idx)?.code || '')
    .filter(Boolean)
    .join('');
}

/** Normalize Course Dashboard meeting groups -> flat `classSchedule` DB rows. */
export function meetingsToScheduleRows(course, meetings = []) {
  const rows = [];
  const createdAt = Date.now();
  const labelCode = String(course?.code || course?.nickname || course?.name || 'Course').trim();
  const baseInstructor = String(course?.instructor || '').trim();
  const color = course?.color || '#0a84ff';

  for (const m of meetings) {
    if (!m) continue;
    const days = [...new Set((m.days || []).map(Number).filter(d => DAY_ORDER_INDEX.has(d)))];
    const startTime = String(m.startTime || '09:00').trim();
    const endTime = String(m.endTime || '10:30').trim();
    const sMin = timeToMinutes(startTime);
    const eMin = timeToMinutes(endTime);
    if (days.length === 0 || sMin === null || eMin === null || eMin <= sMin) continue;

    const kind = m.kind === 'LAB' ? 'LAB' : 'LEC';
    const room = String(m.room || '').trim();
    const rowInstructor = String(m.instructor || baseInstructor).trim();
    const rowSubject =
      kind === 'LAB' && !/\blab\b/i.test(labelCode) ? `${labelCode} lab` : labelCode;

    for (const dayOfWeek of days) {
      rows.push({
        courseId: course?.id ?? null,
        subject: rowSubject,
        courseName: course?.name || labelCode,
        kind,
        dayOfWeek,
        startTime,
        endTime,
        room,
        instructor: rowInstructor,
        color,
        createdAt,
      });
    }
  }
  return rows;
}

/** Consolidate flat `classSchedule` rows back into grouped meeting slots for editing/Study Load. */
export function scheduleRowsToMeetings(rows = []) {
  const byKey = new Map();
  for (const r of rows) {
    const startTime = String(r.startTime || '09:00').trim();
    const endTime = String(r.endTime || '10:30').trim();
    const room = String(r.room || '').trim();
    const kind = r.kind === 'LAB' || /\blab\b/i.test(String(r.subject || '')) ? 'LAB' : 'LEC';
    const instructor = String(r.instructor || '').trim();
    const key = `${kind}|${startTime}|${endTime}|${room}|${instructor}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        days: [],
        startTime,
        endTime,
        room,
        kind,
        instructor,
      });
    }
    const g = byKey.get(key);
    const d = Number(r.dayOfWeek);
    if (DAY_ORDER_INDEX.has(d) && !g.days.includes(d)) {
      g.days.push(d);
    }
  }
  return [...byKey.values()].map(g => ({
    ...g,
    days: g.days.sort((a, b) => DAY_ORDER_INDEX.get(a) - DAY_ORDER_INDEX.get(b)),
  }));
}

function matchCourseForScheduleRow(row, courses = []) {
  if (row?.courseId) {
    const exact = courses.find(c => c.id === row.courseId);
    if (exact) return exact;
  }
  const subj = String(row?.subject || '')
    .replace(/\s+lab$/i, '')
    .trim()
    .toLowerCase();
  if (!subj) return null;
  return (
    courses.find(c => {
      const code = String(c.code || '').trim().toLowerCase();
      const nick = String(c.nickname || '').trim().toLowerCase();
      const name = String(c.name || '').trim().toLowerCase();
      const ics = String(c.icsCourseTag || '').trim().toLowerCase();
      return (
        (code && (code === subj || subj.includes(code) || code.includes(subj))) ||
        (nick && (nick === subj || subj.includes(nick))) ||
        (name && (name === subj || name.includes(subj))) ||
        (ics && (ics === subj || ics.includes(subj)))
      );
    }) || null
  );
}

/**
 * Join `classSchedule` rows with `courses` so Timetable & Study Load show rich metadata,
 * while strictly stripping archived-course rows, deleted-course orphans, and exact duplicates.
 */
export function resolveScheduleEntries(courses = [], scheduleRows = []) {
  const coursesById = new Map();
  for (const c of courses) {
    if (c && c.id != null) coursesById.set(c.id, c);
  }
  const activeCourses = courses.filter(c => !c?.archived);
  const archivedNormKeys = new Set(
    courses
      .filter(c => c?.archived)
      .flatMap(c => [c.code, c.name, c.nickname, c.icsCourseTag])
      .map(s => String(s || '').replace(/\s+lab$/i, '').trim().toLowerCase())
      .filter(Boolean)
  );

  const deduped = new Map();
  for (const r of scheduleRows) {
    if (!r) continue;
    const startMin = timeToMinutes(r.startTime);
    const endMin = timeToMinutes(r.endTime);
    if (startMin === null || endMin === null || endMin <= startMin) continue;

    if (r.courseId != null && courses.length > 0) {
      const linked = coursesById.get(r.courseId);
      if (!linked || linked.archived) continue; // deleted-course orphan or archived course
    }

    const course = matchCourseForScheduleRow(r, activeCourses);
    if (!course && archivedNormKeys.size > 0) {
      const subjNorm = String(r.subject || '').replace(/\s+lab$/i, '').trim().toLowerCase();
      if (subjNorm && archivedNormKeys.has(subjNorm)) continue;
    }

    const kind =
      r.kind === 'LAB' || /\blab\b/i.test(String(r.subject || '')) ? 'LAB' : 'LEC';
    const baseCode = course?.code || course?.nickname || String(r.subject || 'Course').trim();
    const displayCode =
      r.subject && String(r.subject).trim()
        ? String(r.subject).trim()
        : kind === 'LAB' && !/\blab\b/i.test(baseCode)
          ? `${baseCode} lab`
          : baseCode;

    const entry = {
      id: r.id,
      courseId: course?.id ?? r.courseId ?? null,
      course,
      code: displayCode,
      baseCode,
      title: course?.name || r.courseName || displayCode,
      kind,
      dayOfWeek: Number(r.dayOfWeek),
      startTime: r.startTime,
      endTime: r.endTime,
      startMin,
      endMin,
      durationMin: endMin - startMin,
      room: String(r.room || '').trim(),
      instructor: String(r.instructor || course?.instructor || '').trim(),
      units: Number(course?.units) || 3,
      color: r.color || course?.color || '#f59e0b',
    };

    const identity = entry.courseId ? `c:${entry.courseId}` : `s:${entry.baseCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const slotKey = `${identity}|${entry.dayOfWeek}|${entry.startMin}|${entry.endMin}|${entry.kind}`;
    const prev = deduped.get(slotKey);
    if (!prev) {
      deduped.set(slotKey, entry);
    } else {
      const prevScore = (prev.room ? 2 : 0) + (prev.instructor ? 1 : 0) + (prev.courseId ? 1 : 0);
      const nextScore = (entry.room ? 2 : 0) + (entry.instructor ? 1 : 0) + (entry.courseId ? 1 : 0);
      if (nextScore > prevScore) deduped.set(slotKey, entry);
    }
  }

  const out = [...deduped.values()];
  out.sort((a, b) => {
    const dDiff = (DAY_ORDER_INDEX.get(a.dayOfWeek) ?? 9) - (DAY_ORDER_INDEX.get(b.dayOfWeek) ?? 9);
    if (dDiff !== 0) return dDiff;
    return a.startMin - b.startMin;
  });
  return out;
}

/**
 * Remove orphan rows (pointing to deleted/archived courses) and exact duplicate rows
 * from `db.classSchedule`. Works with a Dexie `db` instance or custom `{ courses, scheduleRows, deleteRow }`.
 */
export async function cleanupOrphanScheduleRows(target) {
  if (!target) return 0;
  let courses = [];
  let scheduleRows = [];
  let deleteRow;

  if (target.classSchedule && target.courses) {
    [courses, scheduleRows] = await Promise.all([
      target.courses.toArray().catch(() => []),
      target.classSchedule.toArray().catch(() => []),
    ]);
    deleteRow = id => target.classSchedule.delete(id).catch(() => {});
  } else {
    courses = Array.isArray(target.courses) ? target.courses : [];
    scheduleRows = Array.isArray(target.scheduleRows) ? target.scheduleRows : [];
    deleteRow = target.deleteRow || (() => Promise.resolve());
  }

  const coursesById = new Map(courses.filter(c => c?.id != null).map(c => [c.id, c]));
  const keptBySlot = new Map();
  const toDelete = [];

  for (const r of scheduleRows) {
    if (!r?.id) continue;
    const startMin = timeToMinutes(r.startTime);
    const endMin = timeToMinutes(r.endTime);
    if (startMin === null || endMin === null || endMin <= startMin) {
      toDelete.push(r.id);
      continue;
    }
    if (r.courseId != null && courses.length > 0) {
      const c = coursesById.get(r.courseId);
      if (!c || c.archived) {
        toDelete.push(r.id);
        continue;
      }
    }
    const kind = r.kind === 'LAB' || /\blab\b/i.test(String(r.subject || '')) ? 'LAB' : 'LEC';
    const subjKey = String(r.subject || '').replace(/\s+lab$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const idKey = r.courseId ? `c:${r.courseId}` : `s:${subjKey}`;
    const slotKey = `${idKey}|${Number(r.dayOfWeek)}|${startMin}|${endMin}|${kind}`;
    if (keptBySlot.has(slotKey)) {
      toDelete.push(r.id);
    } else {
      keptBySlot.set(slotKey, r.id);
    }
  }

  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(id => deleteRow(id)));
  }
  return toDelete.length;
}

export const SCHEDULE_FILTER_KEY = 'aicn:scheduleFilterMode'; // 'no-paired-lec' (default) | 'all'

export function getScheduleFilterMode() {
  try {
    return localStorage.getItem(SCHEDULE_FILTER_KEY) === 'all' ? 'all' : 'no-paired-lec';
  } catch {
    return 'no-paired-lec';
  }
}

export function setScheduleFilterMode(mode) {
  const next = mode === 'all' ? 'all' : 'no-paired-lec';
  try {
    localStorage.setItem(SCHEDULE_FILTER_KEY, next);
  } catch {
    // ignore storage quota errors
  }
  return next;
}

function entryCourseIdentity(entry) {
  if (entry?.courseId != null) return `c:${entry.courseId}`;
  return `s:${String(entry?.baseCode || entry?.code || '').replace(/\s+lab$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Filter resolved schedule entries by mode:
 * - 'no-paired-lec' (default): for subjects that have BOTH LAB and LEC slots, hide the LEC slots and keep LAB;
 *   subjects with only LEC stay 100% visible!
 * - 'all': keep every slot.
 */
export function filterScheduleEntries(entries = [], mode = 'no-paired-lec') {
  if (!Array.isArray(entries) || entries.length === 0 || mode === 'all') {
    return entries;
  }
  const hasLabByCourse = new Map();
  for (const e of entries) {
    if (e?.kind === 'LAB') {
      hasLabByCourse.set(entryCourseIdentity(e), true);
    }
  }
  return entries.filter(e => !(e?.kind === 'LEC' && hasLabByCourse.has(entryCourseIdentity(e))));
}

/** Count how many paired LEC slots are hidden by 'no-paired-lec' mode. */
export function countHiddenPairedLecs(entries = []) {
  return Math.max(0, entries.length - filterScheduleEntries(entries, 'no-paired-lec').length);
}

/** Compute 30-min grid bounds (earliest/latest hours) and visible weekday columns. */
export function computeTimetableGrid(entries = [], { minHour = 9, maxHour = 19 } = {}) {
  let earliestMin = entries.length > 0 ? Math.min(...entries.map(e => e.startMin)) : minHour * 60;
  let latestMin = entries.length > 0 ? Math.max(...entries.map(e => e.endMin)) : maxHour * 60;

  earliestMin = Math.min(earliestMin, minHour * 60);
  latestMin = Math.max(latestMin, Math.min(maxHour * 60, earliestMin + 300));

  const startHour = Math.max(0, Math.floor(earliestMin / 60));
  const endHour = Math.min(24, Math.ceil(latestMin / 60));
  const gridStartMin = startHour * 60;
  const gridEndMin = Math.max(gridStartMin + 60, endHour * 60);

  const slots = [];
  for (let m = gridStartMin; m < gridEndMin; m += 30) {
    const isFullHour = m % 60 === 0;
    const h24 = Math.floor(m / 60);
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const period = h24 >= 12 ? 'PM' : 'AM';
    slots.push({
      minutes: m,
      isFullHour,
      label: isFullHour ? `${h12} ${period}` : `${h12}:30`,
      shortLabel: isFullHour ? `${h12}${h24 >= 12 ? 'p' : 'a'}` : ':30',
    });
  }

  const hasSat = entries.some(e => e.dayOfWeek === 6);
  const hasSun = entries.some(e => e.dayOfWeek === 0);
  const visibleDays = SCHEDULE_DAYS.filter(d => {
    if (d.idx >= 1 && d.idx <= 5) return true;
    if (d.idx === 6) return hasSat;
    if (d.idx === 0) return hasSun;
    return false;
  });

  return {
    startHour,
    endHour,
    gridStartMin,
    gridEndMin,
    slots,
    visibleDays,
  };
}

/** Detect same-day overlapping classes and compute side-by-side layout lanes per entry. */
export function detectScheduleConflicts(entries = []) {
  const conflicts = [];
  const layoutByKey = new Map();
  const byDay = new Map();

  for (const e of entries) {
    if (!byDay.has(e.dayOfWeek)) byDay.set(e.dayOfWeek, []);
    byDay.get(e.dayOfWeek).push(e);
  }

  for (const [dayIdx, list] of byDay.entries()) {
    list.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          conflicts.push({
            dayOfWeek: dayIdx,
            dayLabel: SCHEDULE_DAYS.find(d => d.idx === dayIdx)?.short || '',
            first: a,
            second: b,
          });
          if (!layoutByKey.has(a)) layoutByKey.set(a, { col: 0, cols: 2 });
          if (!layoutByKey.has(b)) layoutByKey.set(b, { col: 1, cols: 2 });
        }
      }
    }
  }

  return { conflicts, layoutByKey };
}

/** Build consolidated Study Load rows grouped by Course (with total units & weekly hours). */
export function buildStudyLoadSummary(courses = [], entries = []) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.courseId ? `course:${e.courseId}` : `subj:${e.baseCode.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        courseId: e.courseId,
        course: e.course,
        code: e.baseCode,
        title: e.title,
        instructor: e.instructor,
        units: e.units,
        color: e.color,
        rows: [],
        weeklyMinutes: 0,
      });
    }
    const g = groups.get(key);
    g.rows.push(e);
    g.weeklyMinutes += e.durationMin;
    if (!g.instructor && e.instructor) g.instructor = e.instructor;
  }

  // Also include active courses that don't have schedules yet so user sees what's missing
  for (const c of courses) {
    if (c.archived) continue;
    const key = `course:${c.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        courseId: c.id,
        course: c,
        code: c.code || c.nickname || c.name,
        title: c.name || c.code,
        instructor: c.instructor || '',
        units: Number(c.units) || 3,
        color: c.color || '#0a84ff',
        rows: [],
        weeklyMinutes: 0,
      });
    }
  }

  const items = [...groups.values()].map(g => ({
    ...g,
    meetings: scheduleRowsToMeetings(g.rows),
    rooms: [...new Set(g.rows.map(r => r.room).filter(Boolean))],
  }));

  const totalUnits = items.reduce((acc, it) => acc + (Number(it.units) || 0), 0);
  const totalWeeklyHours = Math.round(
    (items.reduce((acc, it) => acc + it.weeklyMinutes, 0) / 60) * 10
  ) / 10;

  return { items, totalUnits, totalWeeklyHours };
}

/** Determine currently running class & upcoming next class for a given clock Date. */
export function getNowAndNextClass(entries = [], nowDate = new Date()) {
  const dow = nowDate.getDay();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  const todayClasses = entries
    .filter(e => e.dayOfWeek === dow)
    .sort((a, b) => a.startMin - b.startMin);

  const currentClass =
    todayClasses.find(c => nowMin >= c.startMin && nowMin < c.endMin) || null;
  const nextClass = todayClasses.find(c => c.startMin > nowMin) || null;

  return {
    todayDow: dow,
    nowMinutes: nowMin,
    todayClasses,
    currentClass,
    minutesRemainingCurrent: currentClass ? currentClass.endMin - nowMin : 0,
    nextClass,
    minutesUntilNext: nextClass ? nextClass.startMin - nowMin : null,
  };
}
