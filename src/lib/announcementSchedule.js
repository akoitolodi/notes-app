/**
 * announcementSchedule — Zero-dep helper joining Canvas Announcements with Course
 * Timetable schedules, silent Acronym + Section matching, Quick Link extraction,
 * Home "Up Next Class" across-week resolver, and Reply status tracking.
 */
import {
  SCHEDULE_DAYS,
  formatTimeRange12h,
  groupDaysLabel,
  resolveScheduleEntries,
  scheduleRowsToMeetings,
} from './scheduleView';

const REPLIED_ANNS_KEY = 'aicn:annReplies:v1';

const STOP_WORDS = new Set([
  'and',
  'of',
  'to',
  'the',
  'in',
  'for',
  'on',
  'with',
  'a',
  'an',
  'toward',
  'towards',
  'from',
  'by',
  'at',
]);

function normAlnum(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Extract { section, title } from Canvas course labels like "C - Integrative Programming and Technologies". */
export function parseCanvasCourseLabel(rawLabel) {
  const clean = String(rawLabel || '').trim();
  const m = /^([A-Z0-9]{1,3})\s*[-–:]\s+(.+)$/i.exec(clean);
  if (m) {
    return { section: m[1].toUpperCase(), title: m[2].trim(), raw: clean };
  }
  return { section: '', title: clean, raw: clean };
}

function significantWords(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(w => w && !STOP_WORDS.has(w));
}

function courseTokens(course) {
  const code = String(course?.code || '').trim();
  const words = code
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const alphaJoined = words.filter(w => /^[a-z]+$/.test(w)).join('');
  const firstAlpha = words.find(w => /^[a-z]+$/.test(w)) || '';
  const digits = (code.match(/\d+/g) || []);
  return { words, alphaJoined, firstAlpha, digits };
}

/** Score how strongly an announcement belongs to a Course record. */
function scoreCourseMatch(announcement, course) {
  const annCourseRaw = String(announcement?.course || '').trim();
  if (!annCourseRaw && !announcement?.author) return 0;

  const annLower = annCourseRaw.toLowerCase();
  const annNorm = normAlnum(annCourseRaw);
  const parsed = parseCanvasCourseLabel(annCourseRaw);
  const titleNorm = normAlnum(parsed.title);

  // Tier 1: Explicit saved aliases / exact code / name / ICS tag
  const aliases = Array.isArray(course?.canvasAliases) ? course.canvasAliases : [];
  for (const al of aliases) {
    if (normAlnum(al) && (normAlnum(al) === annNorm || normAlnum(al) === titleNorm)) {
      return 120;
    }
  }

  const directFields = [course?.icsCourseTag, course?.code, course?.nickname, course?.name]
    .map(s => String(s || '').trim())
    .filter(Boolean);
  for (const df of directFields) {
    const dfLower = df.toLowerCase();
    const dfNorm = normAlnum(df);
    if (!dfNorm) continue;
    if (dfLower === annLower || dfNorm === annNorm || dfNorm === titleNorm) {
      return 100;
    }
    if (dfNorm.length >= 4 && (annNorm.includes(dfNorm) || dfNorm.includes(titleNorm))) {
      return 80;
    }
  }

  // Tier 2: Acronym + Word-Prefix + Section + Course Number inference
  const { words: cWords, alphaJoined, firstAlpha, digits: cDigits } = courseTokens(course);
  const titleWords = significantWords(parsed.title);
  const titleInitials = titleWords.filter(w => /^[a-z]/.test(w)).map(w => w[0]).join('');
  const titleInitialsNoTrailingNum = titleWords
    .filter(w => !/^\d+$/.test(w))
    .map(w => w[0])
    .join('');

  let score = 0;
  if (
    alphaJoined.length >= 2 &&
    (titleInitials === alphaJoined ||
      titleInitialsNoTrailingNum === alphaJoined ||
      (firstAlpha.length >= 2 && titleInitialsNoTrailingNum === firstAlpha))
  ) {
    score += 50;
  } else if (cWords.length >= 2) {
    // e.g. "PATH FIT 4" matching "Physical Activities Toward Health and Fitness 4" (fit/health) or "GEC ART" matching "Art Appreciation"
    let tokenHits = 0;
    for (const cw of cWords) {
      if (/^\d+$/.test(cw)) continue;
      if (titleWords.some(tw => tw === cw || (cw.length >= 3 && tw.startsWith(cw)))) {
        tokenHits += 1;
      } else if (cw.length >= 4 && titleWords.some(tw => tw.startsWith(cw.slice(0, 4)))) {
        tokenHits += 0.6;
      }
    }
    if (tokenHits >= 1) {
      score += 36 * tokenHits;
    } else if (
      firstAlpha.length >= 3 &&
      titleWords.some(tw => tw.startsWith(firstAlpha))
    ) {
      score += 38;
    }
  } else if (firstAlpha.length >= 3 && titleWords.some(tw => tw.startsWith(firstAlpha))) {
    score += 38;
  }

  if (score > 0) {
    const titleDigits = parsed.title.match(/\d+/g) || [];
    if (cDigits.length > 0 && titleDigits.some(d => cDigits.includes(d))) {
      score += 14;
    }
    if (parsed.section && course?.section) {
      if (parsed.section.toUpperCase() === String(course.section).trim().toUpperCase()) {
        score += 20;
      } else {
        score -= 10;
      }
    }
  }

  // Tier 3: Instructor match
  const authorLower = String(announcement?.author || '').trim().toLowerCase();
  const instLower = String(course?.instructor || '').trim().toLowerCase();
  if (authorLower && instLower && authorLower !== 'pasted note') {
    if (authorLower === instLower || authorLower.includes(instLower) || instLower.includes(authorLower)) {
      score += 45;
    }
  }

  return score;
}

const DAY_INDEX_SEQ = [0, 1, 2, 3, 4, 5, 6];

/**
 * Secretly match an announcement to its scheduled Course + Timetable slots.
 */
export function matchAnnouncementToCourse(
  announcement,
  courses = [],
  scheduleRows = [],
  nowDate = new Date()
) {
  if (!announcement || !Array.isArray(courses) || courses.length === 0) return null;

  let bestCourse = null;
  let bestScore = 0;
  for (const c of courses) {
    if (c?.archived) continue;
    const sc = scoreCourseMatch(announcement, c);
    if (sc > bestScore) {
      bestScore = sc;
      bestCourse = c;
    }
  }

  if (!bestCourse || bestScore < 35) return null;

  const entries = resolveScheduleEntries([bestCourse], scheduleRows).filter(
    e => e.courseId === bestCourse.id || normAlnum(e.baseCode) === normAlnum(bestCourse.code)
  );
  const meetings = scheduleRowsToMeetings(entries);

  const slotStrings = meetings.map(m => {
    const days = groupDaysLabel(m.days);
    const time = formatTimeRange12h(m.startTime, m.endTime);
    return m.room ? `${days} ${time} (${m.room})` : `${days} ${time}`;
  });

  const codeLabel = bestCourse.code || bestCourse.nickname || bestCourse.name || '';
  const summaryText =
    slotStrings.length > 0 ? `${codeLabel} · ${slotStrings.join(' · ')}` : codeLabel;

  let compactText = codeLabel;
  if (meetings.length > 0) {
    const first = meetings[0];
    const base = `${groupDaysLabel(first.days)} ${formatTimeRange12h(first.startTime, first.endTime)}${
      first.room ? ` · ${first.room}` : ''
    }`;
    compactText = meetings.length > 1 ? `${base} +${meetings.length - 1}` : base;
  }

  // Compute nearest next class session label (e.g. "Today 4:30 PM" or "Thu 4:30 PM")
  let nextMeetingLabel = '';
  if (entries.length > 0) {
    const nowDow = nowDate.getDay();
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    let bestDeltaMin = Infinity;
    let bestEntry = null;
    let bestOffsetDays = 0;

    for (const e of entries) {
      for (const offset of DAY_INDEX_SEQ) {
        const targetDow = (nowDow + offset) % 7;
        if (e.dayOfWeek !== targetDow) continue;
        if (offset === 0 && e.endMin <= nowMin) continue;
        const delta = offset * 1440 + e.startMin - nowMin;
        if (delta < bestDeltaMin) {
          bestDeltaMin = delta;
          bestEntry = e;
          bestOffsetDays = offset;
        }
      }
    }

    if (bestEntry) {
      const h24 = Math.floor(bestEntry.startMin / 60);
      const mins = bestEntry.startMin % 60;
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      const ap = h24 >= 12 ? 'PM' : 'AM';
      const tStr = `${h12}:${String(mins).padStart(2, '0')} ${ap}`;
      const dayWord =
        bestOffsetDays === 0
          ? bestEntry.startMin <= nowMin
            ? 'Now'
            : 'Today'
          : bestOffsetDays === 1
            ? 'Tomorrow'
            : SCHEDULE_DAYS.find(d => d.idx === bestEntry.dayOfWeek)?.short || '';
      nextMeetingLabel = bestEntry.startMin <= nowMin && bestOffsetDays === 0
        ? `Now until ${formatTimeRange12h(bestEntry.startTime, bestEntry.endTime).split('–')[1]}`
        : `${dayWord} ${tStr}`;
    }
  }

  const author = String(announcement?.author || '').trim();
  const canSaveTeacher = Boolean(
    author &&
      author !== 'Pasted Note' &&
      !String(bestCourse.instructor || '').trim()
  );

  return {
    course: bestCourse,
    meetings,
    summaryText,
    compactText,
    nextMeetingLabel,
    canSaveTeacher,
    score: bestScore,
  };
}

/** Extract courseId & topicId from Canvas announcement/discussion URLs. */
export function parseCanvasDiscussionUrl(url) {
  const m =
    /^https:\/\/([^/]+)\/courses\/(\d+)\/(?:discussion_topics|announcements)\/(\d+)/i.exec(
      String(url || '').trim()
    );
  if (!m) return null;
  return {
    host: m[1],
    courseId: m[2],
    topicId: m[3],
  };
}

const QUICK_LINK_RULES = [
  { re: /^https?:\/\/meet\.google\.com\//i, kind: 'meet', label: 'Google Meet' },
  { re: /^https?:\/\/(?:chat\.google\.com|mail\.google\.com\/chat)/i, kind: 'chat', label: 'Google Chat' },
  { re: /^https?:\/\/(?:[a-z0-9-]+\.)?zoom\.us\//i, kind: 'zoom', label: 'Zoom' },
  { re: /^https?:\/\/(?:drive|docs)\.google\.com\//i, kind: 'drive', label: 'Google Drive' },
  { re: /^https?:\/\/forms\.gle\//i, kind: 'drive', label: 'Google Form' },
  { re: /^https?:\/\/teams\.microsoft\.com\//i, kind: 'meet', label: 'MS Teams' },
];

/** Extract high-utility meeting/chat/drive URLs from announcement Markdown or plain text. */
export function extractQuickLinks(text) {
  const raw = String(text || '');
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  const seen = new Set();
  const out = [];

  for (const m of matches) {
    const url = m.replace(/[.,;!?]+$/, '');
    if (seen.has(url)) continue;
    const rule = QUICK_LINK_RULES.find(r => r.re.test(url));
    if (!rule) continue;
    seen.add(url);
    out.push({ kind: rule.kind, label: rule.label, url });
    if (out.length >= 3) break;
  }
  return out;
}

/** Find current class, today's next class, or the nearest upcoming class across the week. */
export function getNextUpcomingClassAcrossWeek(entries = [], nowDate = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const nowDow = nowDate.getDay();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  const today = entries
    .filter(e => e.dayOfWeek === nowDow)
    .sort((a, b) => a.startMin - b.startMin);

  const running = today.find(e => nowMin >= e.startMin && nowMin < e.endMin);
  if (running) {
    return {
      status: 'now',
      entry: running,
      minutesLeft: running.endMin - nowMin,
      minutesUntil: 0,
      dayLabel: 'Now',
    };
  }

  const laterToday = today.find(e => e.startMin > nowMin);
  if (laterToday) {
    return {
      status: 'today',
      entry: laterToday,
      minutesLeft: 0,
      minutesUntil: laterToday.startMin - nowMin,
      dayLabel: 'Today',
    };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const dow = (nowDow + offset) % 7;
    const dayClasses = entries
      .filter(e => e.dayOfWeek === dow)
      .sort((a, b) => a.startMin - b.startMin);
    if (dayClasses.length > 0) {
      const next = dayClasses[0];
      const dayLabel =
        offset === 1
          ? 'Tomorrow'
          : SCHEDULE_DAYS.find(d => d.idx === dow)?.short || '';
      return {
        status: 'upcoming',
        entry: next,
        minutesLeft: 0,
        minutesUntil: offset * 1440 + next.startMin - nowMin,
        dayLabel,
      };
    }
  }
  return null;
}

function readReplyMap() {
  try {
    const obj = JSON.parse(localStorage.getItem(REPLIED_ANNS_KEY) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function itemReplyKey(item) {
  return item?.externalUid || (item?.id ? `id:${item.id}` : '');
}

export function getAnnouncementReplyMeta(item) {
  const k = itemReplyKey(item);
  if (!k) return null;
  const map = readReplyMap();
  return map[k] || null;
}

export function isAnnouncementReplied(item) {
  return Boolean(getAnnouncementReplyMeta(item));
}

export function markAnnouncementReplied(item, snippet = '') {
  const k = itemReplyKey(item);
  if (!k) return;
  try {
    const map = readReplyMap();
    map[k] = {
      at: Date.now(),
      snippet: String(snippet || '').trim().slice(0, 140),
    };
    const keys = Object.keys(map);
    if (keys.length > 200) {
      keys.sort((a, b) => (map[a]?.at || 0) - (map[b]?.at || 0));
      for (const oldKey of keys.slice(0, keys.length - 200)) delete map[oldKey];
    }
    localStorage.setItem(REPLIED_ANNS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage limits
  }
}
