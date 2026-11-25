/**
 * schedulePdfParser — 100% offline coordinate-aware PDF & text class schedule parser
 * plus smart-merge Course + Timetable + Folder committer.
 *
 * Designed around real university registrar / Student Study Load tables (e.g. HNU COR):
 *   Catalog No. | Section | Units | Time | Room
 * Supporting multi-row split schedules (LEC + LAB on consecutive lines), truncated room labels,
 * 12h/24h times, and optional AI fallback for scanned schedules.
 */
import { db, createFolder, COURSE_PALETTE } from '../store/db';
import { meetingsToScheduleRows } from './scheduleView';
import { syncDeadlineNotifications } from './notifications';
import { aiText } from './aiCore';

const DAY_TOKENS = [
  ['thurs', 4],
  ['thur', 4],
  ['thu', 4],
  ['tues', 2],
  ['tue', 2],
  ['wed', 3],
  ['mon', 1],
  ['fri', 5],
  ['sat', 6],
  ['sun', 0],
  ['th', 4],
  ['su', 0],
  ['m', 1],
  ['t', 2],
  ['w', 3],
  ['r', 4],
  ['f', 5],
  ['s', 6],
  ['u', 0],
];

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Parse compact day strings ("MWF", "TTh", "MW", "M/W/F", "Sat") into unique weekday indices. */
export function parseDayTokens(raw) {
  let s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!s) return [];

  const found = new Set();
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [tok, dayIdx] of DAY_TOKENS) {
      if (s.startsWith(tok, i)) {
        found.add(dayIdx);
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }

  return [...found].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function to24h(hourStr, minStr, ampmRaw, fallbackAmPm = '') {
  let h = Number(hourStr);
  const m = Number(minStr);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59 || h < 0 || h > 23) {
    return null;
  }
  const ap = (ampmRaw || fallbackAmPm || '').toLowerCase();
  if (ap === 'am' || ap === 'pm') {
    if (h < 1 || h > 12) return null;
    if (ap === 'am' && h === 12) h = 0;
    else if (ap === 'pm' && h !== 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse time ranges like "04:30PM-05:30PM", "11:30AM-01:00PM", "9:00-10:30 AM", "13:30-15:00". */
export function parseTimeRangeTo24h(raw) {
  const m =
    /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-–—to]+\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(
      String(raw || '')
    );
  if (!m) return null;
  const [, sh, sm, sap, eh, em, eap] = m;

  let startAp = sap || '';
  if (!startAp && eap) {
    const sNum = Number(sh);
    const eNum = Number(eh);
    if (eap.toUpperCase() === 'PM' && sNum > eNum && sNum < 12) {
      startAp = 'AM';
    } else {
      startAp = eap;
    }
  }

  const startTime = to24h(sh, sm, startAp);
  const endTime = to24h(eh, em, eap || startAp);
  if (!startTime || !endTime) return null;
  return { startTime, endTime };
}

/** Normalize room text (closes truncated parens like "007-1B (Computer Lab") and classifies LEC/LAB. */
export function cleanRoomLabel(raw) {
  let room = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^[|\-–:]+|[|\-]+$/g, '')
    .trim();
  const opens = (room.match(/\(/g) || []).length;
  const closes = (room.match(/\)/g) || []).length;
  if (opens > closes) {
    room += ')'.repeat(opens - closes);
  }
  const kind = /\b(lab|laboratory|comp\s*lab|computer\s*lab)\b/i.test(room) ? 'LAB' : 'LEC';
  return { room, kind };
}

function parsePrefixCourseMeta(prefix) {
  const tokens = String(prefix || '')
    .replace(/\|/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let units = 3;
  const last = tokens[tokens.length - 1];
  if (/^\d+(?:\.\d+)?$/.test(last)) {
    const num = Number(last);
    if (num >= 0.5 && num <= 12) {
      units = Math.round(num * 100) / 100;
      tokens.pop();
    }
  }

  let section = '';
  if (tokens.length >= 2) {
    const cand = tokens[tokens.length - 1];
    const hasEarlierNumber = tokens.slice(0, -1).some(t => /\d/.test(t));
    const isLikelySection =
      /^[A-Z](?:[A-Z0-9]{0,2})?$/i.test(cand) &&
      !/^(I|II|III|IV|V|VI)$/i.test(cand) || (cand.length === 1 && tokens.length >= 3);
    // Avoid mistaking trailing catalog numbers (e.g. "CS 101" or "PATH FIT 4") for a section
    const isCatalogDigits = /^\d{1,4}[A-Z]?$/i.test(cand) && !hasEarlierNumber;
    if (!isCatalogDigits && isLikelySection && (tokens.length >= 3 || hasEarlierNumber)) {
      section = cand.toUpperCase();
      tokens.pop();
    }
  }

  const code = tokens.join(' ').trim();
  if (!code || !/[A-Z]/i.test(code)) return null;
  if (/^(catalog|section|units|total|note|run date|page)/i.test(code)) return null;
  return { code, section, units };
}

const TIME_DAYS_LINE_RE =
  /(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+([A-Za-z/]+)\b(.*)$/i;
const DAYS_TIME_LINE_RE =
  /\b([MTWRFSU]{1,7}|(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:[/,\s]+(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun))*)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)(.*)$/i;

/**
 * Parse lines of extracted schedule text (HNU Student Class Schedule or standard tables)
 * into structured courses & grouped meetings.
 */
export function parseScheduleLines(lines = []) {
  const courses = [];
  let semester = '';
  let declaredTotalUnits = null;
  let lastCourse = null;

  for (const rawLine of lines) {
    const line = String(rawLine || '').replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (!semester) {
      const semMatch = /\b((?:1st|2nd|Summer|Midyear|First|Second)\s+(?:Semester|Term)\s*(?:\d{4}\s*[-–]\s*\d{4})?)/i.exec(
        line
      );
      if (semMatch) semester = semMatch[1].trim();
    }

    const totMatch = /\btotal\s+units\s*:?\s*(\d+(?:\.\d+)?)/i.exec(line);
    if (totMatch) {
      declaredTotalUnits = Number(totMatch[1]);
      continue;
    }

    // Ignore page header/footer noise that doesn't define a time range
    if (/^(note:|official copy|run date:|catalog no\.)/i.test(line)) continue;

    let prefix = '';
    let timeStr = '';
    let daysStr = '';
    let suffix = '';

    const tdMatch = TIME_DAYS_LINE_RE.exec(line);
    if (tdMatch) {
      prefix = line.slice(0, tdMatch.index).trim();
      timeStr = tdMatch[1];
      daysStr = tdMatch[2];
      suffix = tdMatch[3] || '';
    } else {
      const dtMatch = DAYS_TIME_LINE_RE.exec(line);
      if (dtMatch) {
        prefix = line.slice(0, dtMatch.index).trim();
        daysStr = dtMatch[1];
        timeStr = dtMatch[2];
        suffix = dtMatch[3] || '';
      }
    }

    if (!timeStr) continue;

    const range = parseTimeRangeTo24h(timeStr);
    const days = parseDayTokens(daysStr);
    if (!range || days.length === 0) continue;

    const { room, kind } = cleanRoomLabel(suffix);
    const meeting = {
      days,
      startTime: range.startTime,
      endTime: range.endTime,
      room,
      kind,
    };

    if (prefix) {
      const meta = parsePrefixCourseMeta(prefix);
      if (meta) {
        // Merge duplicate rows of exact same course code & section if split in table
        const existing = courses.find(
          c =>
            c.code.toLowerCase() === meta.code.toLowerCase() &&
            (c.section || '') === (meta.section || '')
        );
        if (existing) {
          existing.meetings.push(meeting);
          lastCourse = existing;
        } else {
          const courseObj = {
            code: meta.code,
            name: meta.code,
            section: meta.section,
            units: meta.units,
            instructor: '',
            meetings: [meeting],
          };
          courses.push(courseObj);
          lastCourse = courseObj;
        }
        continue;
      }
    }

    // No prefix (continuation meeting on next row of the same subject, e.g. Lab slot)
    if (!prefix && lastCourse) {
      lastCourse.meetings.push(meeting);
    }
  }

  const totalUnits =
    Math.round(courses.reduce((sum, c) => sum + (Number(c.units) || 0), 0) * 100) / 100;

  return {
    courses,
    totalUnits,
    declaredTotalUnits,
    semester,
  };
}

export function looksLikeClassScheduleText(text) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  const parsed = parseScheduleLines(clean.split(/\r?\n/));
  return parsed.courses.length >= 2;
}

/**
 * Reconstruct table rows by grouping PDF text items by Y baseline (tolerance 4pt)
 * and sorting left-to-right by X so multi-column PDFs stay row-aligned.
 */
function pdfItemsToTableLines(items = []) {
  const rows = [];
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str.trim()) continue;
    const x = Array.isArray(item.transform) ? Number(item.transform[4]) || 0 : 0;
    const y = Array.isArray(item.transform) ? Number(item.transform[5]) || 0 : 0;

    let row = rows.find(r => Math.abs(r.y - y) <= 4.2);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, str });
  }

  // Sort top-to-bottom (higher PDF Y first), then left-to-right within each row
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.cells.sort((a, b) => a.x - b.x);
    return r.cells.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
  });
}

/** Extract structured courses & timetable offline from a Class Schedule PDF buffer. */
export async function extractScheduleFromPdfBuffer(arrayBuffer) {
  const pdfjsLib = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const workerMod = await import('pdfjs-dist/build/pdf.worker.min.js?url');
      if (workerMod?.default) pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
    } catch {
      // workerless fallback
    }
  }

  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const doc = await pdfjsLib.getDocument({
    data,
    disableWorker: typeof window === 'undefined' || !pdfjsLib.GlobalWorkerOptions?.workerSrc,
    useSystemFonts: true,
  }).promise;

  const allLines = [];
  try {
    const cap = Math.min(doc.numPages || 1, 8);
    for (let p = 1; p <= cap; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      allLines.push(...pdfItemsToTableLines(tc.items || []));
      page.cleanup?.();
    }
  } finally {
    doc.destroy?.();
  }

  const parsed = parseScheduleLines(allLines);
  return {
    ...parsed,
    rawText: allLines.join('\n'),
  };
}

/** Optional AI fallback for scanned / unusual schedule layouts. */
export async function parseScheduleWithAI(rawText) {
  const clean = String(rawText || '').trim().slice(0, 7000);
  if (!clean) throw new Error('No schedule text available to parse.');

  const prompt = [
    'Extract all college classes and meeting times from this student class schedule into strict JSON only (no markdown fences).',
    'Format: {"semester":"string","courses":[{"code":"IPT 101A","name":"IPT 101A","section":"C","units":3,"meetings":[{"days":[2,4],"startTime":"16:30","endTime":"17:30","room":"IT 3","kind":"LEC"}]}]}',
    'Weekday index map: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun. Keep 24-hour HH:MM strings.',
    '',
    clean,
  ].join('\n');

  const rawReply = await aiText(prompt, { maxTokens: 1600, temperature: 0.1 });
  const jsonMatch = /\{[\s\S]*\}/.exec(String(rawReply || ''));
  if (!jsonMatch) throw new Error('AI could not extract structured schedule JSON.');

  const data = JSON.parse(jsonMatch[0]);
  const list = Array.isArray(data?.courses) ? data.courses : [];
  const normalized = list
    .map(c => ({
      code: String(c?.code || c?.name || '').trim(),
      name: String(c?.name || c?.code || '').trim(),
      section: String(c?.section || '').trim(),
      units: Math.max(0.5, Math.min(12, Number(c?.units) || 3)),
      instructor: String(c?.instructor || '').trim(),
      meetings: (Array.isArray(c?.meetings) ? c.meetings : [])
        .map(m => ({
          days: Array.isArray(m?.days)
            ? m.days.map(Number).filter(d => d >= 0 && d <= 6)
            : parseDayTokens(m?.days || ''),
          startTime: String(m?.startTime || '').trim(),
          endTime: String(m?.endTime || '').trim(),
          room: String(m?.room || '').trim(),
          kind: m?.kind === 'LAB' || /\blab\b/i.test(String(m?.room || '')) ? 'LAB' : 'LEC',
        }))
        .filter(m => m.days.length > 0 && /^\d{2}:\d{2}$/.test(m.startTime) && /^\d{2}:\d{2}$/.test(m.endTime)),
    }))
    .filter(c => c.code);

  const totalUnits =
    Math.round(normalized.reduce((sum, c) => sum + (Number(c.units) || 0), 0) * 100) / 100;

  return {
    courses: normalized,
    totalUnits,
    declaredTotalUnits: null,
    semester: String(data?.semester || '').trim(),
  };
}

function normCode(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Smart-merge imported schedule courses into Dexie (`courses`, `classSchedule`, and optional `folders`).
 * Updates matching existing courses without erasing user notes, modules, or grade entries.
 */
export async function commitImportedSchedule({ courses = [], createFolders = true } = {}) {
  const [existingCourses, existingSchedule, existingFolders] = await Promise.all([
    db.courses.toArray().catch(() => []),
    db.classSchedule.toArray().catch(() => []),
    db.folders.toArray().catch(() => []),
  ]);

  let created = 0;
  let updated = 0;
  let slots = 0;
  let foldersCreated = 0;
  const savedCourses = [];

  for (let i = 0; i < courses.length; i++) {
    const item = courses[i];
    const code = String(item?.code || item?.name || '').trim();
    if (!code) continue;

    const name = String(item?.name || code).trim();
    const section = String(item?.section || '').trim();
    const units = Math.max(0.5, Math.min(12, Number(item?.units) || 3));
    const instructor = String(item?.instructor || '').trim();
    const meetings = Array.isArray(item?.meetings) ? item.meetings : [];

    const key = normCode(code);
    const match = existingCourses.find(
      c => normCode(c.code) === key || normCode(c.name) === key || normCode(c.icsCourseTag) === key
    );

    let folderId = match?.folderId || null;
    if (createFolders && !folderId) {
      const fMatch = existingFolders.find(
        f => !f.locked && !f.isSystemVault && normCode(f.name) === key
      );
      if (fMatch) {
        folderId = fMatch.id;
      } else {
        folderId = await createFolder(code.slice(0, 32), { mode: 'study', locked: false });
        existingFolders.push({ id: folderId, name: code.slice(0, 32), locked: false });
        foldersCreated += 1;
      }
    }

    let savedCourse;
    if (match) {
      const patch = {
        code,
        section,
        units,
        archived: false,
        ...(folderId && !match.folderId ? { folderId } : {}),
        ...(instructor && !match.instructor ? { instructor } : {}),
      };
      await db.courses.update(match.id, patch);
      savedCourse = { ...match, ...patch };
      updated += 1;
    } else {
      const color = COURSE_PALETTE[(existingCourses.length + created) % COURSE_PALETTE.length];
      const newCourse = {
        code,
        name,
        nickname: '',
        section,
        icsCourseTag: code,
        instructor,
        color,
        folderId,
        rssUrl: '',
        units,
        archived: false,
        createdAt: Date.now(),
      };
      const id = await db.courses.add(newCourse);
      savedCourse = { id, ...newCourse };
      existingCourses.push(savedCourse);
      created += 1;
    }

    savedCourses.push(savedCourse);

    // Replace existing schedule rows belonging to this course cleanly
    const oldIds = existingSchedule
      .filter(r => r.courseId === savedCourse.id || normCode(r.subject) === key)
      .map(r => r.id)
      .filter(Boolean);
    if (oldIds.length > 0) {
      await Promise.all(oldIds.map(id => db.classSchedule.delete(id).catch(() => {})));
    }

    const newRows = meetingsToScheduleRows(savedCourse, meetings);
    if (newRows.length > 0) {
      await Promise.all(newRows.map(r => db.classSchedule.add(r)));
      slots += newRows.length;
    }
  }

  syncDeadlineNotifications().catch(() => {});
  return { created, updated, slots, foldersCreated, courses: savedCourses };
}
