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

function isNoiseTeacherCell(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2) return true;
  if (/^(tba|tbd|n\/a|none|null|-+|–+|—+|_+|\*+)$/i.test(s)) return true;
  if (/^(teacher'?s?\s*signature|instructor'?s?\s*signature|signature|faculty)$/i.test(s)) return true;
  if (!/[a-zA-Z]{2,}/.test(s)) return true;
  return false;
}

function cleanTeacherLabel(raw) {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:teacher|instructor|faculty|prof\.?)\s*[:\-–]\s*/i, '')
    .replace(/^[|\-–:]+|[|\-]+$/g, '')
    .trim();
  return isNoiseTeacherCell(s) ? '' : s;
}

const TIME_DAYS_LINE_RE =
  /(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+([A-Za-z/]+)\b(.*)$/i;
const DAYS_TIME_LINE_RE =
  /\b([MTWRFSU]{1,7}|(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:[/,\s]+(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun))*)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)(.*)$/i;

function splitRoomAndTeacherSuffix(rawSuffix) {
  let text = String(rawSuffix || '').replace(/\s+/g, ' ').trim();
  if (!text) return { room: '', kind: 'LEC', instructor: '' };

  let instructor = '';
  // Case 1: explicit delimiter like "207-B | Prof. Santos" or "IT 3 · Sir Ocmen"
  const delimMatch = /^(.*?)\s*(?:\||·|\/\/)\s*(.+)$/.exec(text);
  if (delimMatch) {
    const candRoom = delimMatch[1].trim();
    const candInst = cleanTeacherLabel(delimMatch[2]);
    if (candInst) {
      text = candRoom;
      instructor = candInst;
    }
  }
  // Case 2: explicit label "207-B Instructor: Maria Reyes" or "IT 3 Prof. Santos"
  if (!instructor) {
    const labelMatch =
      /^(.*?)\s+\b((?:Instructor|Teacher|Prof\.?|Dr\.?|Engr\.?|Mr\.?|Ms\.?|Mrs\.?|Sir|Ma'?am)[:.\s]+[A-Za-z][A-Za-z .,'-]+)$/i.exec(
        text
      );
    if (labelMatch) {
      const candInst = cleanTeacherLabel(labelMatch[2]);
      if (candInst) {
        text = labelMatch[1].trim();
        instructor = candInst;
      }
    }
  }

  const { room, kind } = cleanRoomLabel(text);
  return { room, kind, instructor };
}

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
    const rawStr = String(rawLine || '');
    // Preserve tabs temporarily to check tab-delimited teacher cells
    const tabParts = rawStr.includes('\t')
      ? rawStr.split('\t').map(s => s.replace(/\s+/g, ' ').trim())
      : null;
    const line = rawStr.replace(/\s+/g, ' ').trim();
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
    if (/^(note:|official copy|run date:|catalog no\.|student'?s class schedule)/i.test(line)) continue;

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

    let { room, kind, instructor } = splitRoomAndTeacherSuffix(suffix);
    if (!instructor && tabParts && tabParts.length >= 5) {
      const lastCell = cleanTeacherLabel(tabParts[tabParts.length - 1]);
      if (lastCell && lastCell !== room) instructor = lastCell;
    }

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
        const existing = courses.find(
          c =>
            c.code.toLowerCase() === meta.code.toLowerCase() &&
            (c.section || '') === (meta.section || '')
        );
        if (existing) {
          existing.meetings.push(meeting);
          if (!existing.instructor && instructor) existing.instructor = instructor;
          lastCourse = existing;
        } else {
          const courseObj = {
            code: meta.code,
            name: meta.code,
            section: meta.section,
            units: meta.units,
            instructor,
            meetings: [meeting],
          };
          courses.push(courseObj);
          lastCourse = courseObj;
        }
        continue;
      }
    }

    if (!prefix && lastCourse) {
      lastCourse.meetings.push(meeting);
      if (!lastCourse.instructor && instructor) lastCourse.instructor = instructor;
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
 * Reconstruct plain text lines by Y baseline for AI fallback or header scanning.
 */
function pdfItemsToTableLines(items = []) {
  const rows = [];
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str.trim()) continue;
    const x =
      typeof item.x === 'number'
        ? item.x
        : Array.isArray(item.transform)
          ? Number(item.transform[4]) || 0
          : 0;
    const y =
      typeof item.y === 'number'
        ? item.y
        : Array.isArray(item.transform)
          ? Number(item.transform[5]) || 0
          : 0;

    let row = rows.find(r => Math.abs(r.y - y) <= 4.2);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, str });
  }

  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.cells.sort((a, b) => a.x - b.x);
    return r.cells.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
  });
}

function classifyHeaderColumn(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s) return null;
  if (/^(catalog|course\s*code|subj(?:ect)?\s*code|cat\.?\s*no|code)\b|\bcatalog\s*no/.test(s)) {
    return 'code';
  }
  if (/^(course\s*title|descriptive\s*title|description|title|subject)$/.test(s)) {
    return 'title';
  }
  if (/^sec(?:tion)?$/.test(s)) return 'section';
  if (/^(units?|cred(?:its?)?)$/.test(s)) return 'units';
  if (/^(days?)$/.test(s)) return 'day';
  if (/^(time|schedule|sched)$/.test(s)) return 'time';
  if (/^(room|bldg|building|venue)/.test(s)) return 'room';
  if (/^(teacher|instructor|faculty|prof)/.test(s)) return 'teacher';
  return null;
}

function normalizePdfItem(it) {
  const str = typeof it?.str === 'string' ? it.str.replace(/\s+/g, ' ').trim() : '';
  if (!str) return null;
  const x =
    typeof it.x === 'number'
      ? it.x
      : Array.isArray(it.transform)
        ? Number(it.transform[4]) || 0
        : 0;
  const y =
    typeof it.y === 'number'
      ? it.y
      : Array.isArray(it.transform)
        ? Number(it.transform[5]) || 0
        : 0;
  const width =
    typeof it.width === 'number' ? it.width : Math.max(0, Number(it.w) || 0);
  return { str, x, y, width };
}

function groupItemsByY(list, tolerance = 4.2) {
  const rows = [];
  const sorted = [...list].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    let row = rows.find(r => Math.abs(r.y - item.y) <= tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.y = row.items.reduce((s, it) => s + it.y, 0) / row.items.length;
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

function buildColumnIntervals(headerRow, bodyItemsForBounds = []) {
  const cols = [];
  for (const it of headerRow.items) {
    const kind = classifyHeaderColumn(it.str);
    if (!kind) continue;
    const center = it.x + (it.width > 0 ? it.width * 0.5 : 18);
    cols.push({ kind, headerX: it.x, center });
  }
  if (cols.length < 3) return null;
  cols.sort((a, b) => a.headerX - b.headerX);

  const hasLeftAnchor = cols.some(c => c.kind === 'code' || c.kind === 'title');
  const hasScheduleCol = cols.some(c => c.kind === 'time' || c.kind === 'room' || c.kind === 'day');
  if (!hasLeftAnchor || !hasScheduleCol) return null;

  // Define X boundaries using midpoint between header start/center positions, biased cleanly
  // so overflowing room strings like "503C (Computer Lab)" starting in Room stay in Room!
  const ranges = cols.map((col, idx) => {
    const prev = cols[idx - 1];
    const next = cols[idx + 1];
    const minX =
      idx === 0
        ? -Infinity
        : col.kind === 'teacher'
          ? Math.min(col.headerX - 10, (prev.center + col.headerX) / 2 + 12)
          : Math.min(col.headerX - 18, (prev.headerX + col.headerX) / 2);
    const maxX =
      idx === cols.length - 1
        ? Infinity
        : next.kind === 'teacher'
          ? Math.min(next.headerX - 10, (col.center + next.headerX) / 2 + 12)
          : Math.min(next.headerX - 18, (col.headerX + next.headerX) / 2);
    return { kind: col.kind, headerX: col.headerX, minX, maxX };
  });

  // Normalize contiguous non-overlapping intervals
  for (let i = 0; i < ranges.length - 1; i++) {
    ranges[i].maxX = Math.min(ranges[i].maxX, ranges[i + 1].minX);
    ranges[i + 1].minX = ranges[i].maxX;
  }

  // Refine column boundaries using real data coordinates below header:
  // If time items start further left than a centered "Time" header (e.g. HNU COR: header 286.5 vs data 215.4),
  // pull the `time` boundary left to cover the actual time column while staying clear of Units!
  const unitsCol = ranges.find(r => r.kind === 'units');
  const timeCol = ranges.find(r => r.kind === 'time');
  const prevToTime = timeCol ? ranges[ranges.indexOf(timeCol) - 1] : null;
  if (timeCol && prevToTime) {
    const timeLikeItems = bodyItemsForBounds.filter(
      it => /\d{1,2}:\d{2}/.test(it.str) && it.x > (unitsCol ? unitsCol.headerX + 12 : prevToTime.headerX + 12)
    );
    if (timeLikeItems.length > 0) {
      const minTimeX = Math.min(...timeLikeItems.map(it => it.x));
      if (minTimeX < timeCol.minX) {
        const refinedSplit = Math.max(prevToTime.headerX + 20, minTimeX - 6);
        prevToTime.maxX = refinedSplit;
        timeCol.minX = refinedSplit;
      }
    }
  }

  return ranges;
}

function parseScheduleCellsFromRowText(line) {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const matches = [];
  const timeGlobal =
    /(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*([A-Za-z/]+)?/gi;
  let m;
  while ((m = timeGlobal.exec(clean)) !== null) {
    const range = parseTimeRangeTo24h(m[1]);
    if (!range) continue;
    const days = m[2] ? parseDayTokens(m[2]) : [];
    matches.push({ startTime: range.startTime, endTime: range.endTime, days, endIdx: m.index + m[0].length });
  }
  return matches;
}

/**
 * 2D Coordinate-Aware Class Schedule PDF Parser.
 * Accurately handles vertically-centered merged table cells (e.g. HNU COR),
 * top-aligned tables, overflowing room names, Teacher columns, and TBA subjects.
 */
export function parseSchedulePdfItems(rawItems = []) {
  const items = rawItems.map(normalizePdfItem).filter(Boolean);
  if (items.length === 0) {
    return { courses: [], totalUnits: 0, declaredTotalUnits: null, semester: '' };
  }

  const allYRows = groupItemsByY(items, 4.5);
  let semester = '';
  let declaredTotalUnits = null;
  let headerIdx = -1;
  let colRanges = null;

  for (let i = 0; i < allYRows.length; i++) {
    const text = allYRows[i].items.map(it => it.str).join(' ');
    if (!semester) {
      const semMatch = /\b((?:1st|2nd|Summer|Midyear|First|Second)\s+(?:Semester|Term)\s*(?:\d{4}\s*[-–]\s*\d{4})?)/i.exec(
        text
      );
      if (semMatch) semester = semMatch[1].trim();
    }
    const totMatch = /\btotal\s+units\s*:?\s*(\d+(?:\.\d+)?)/i.exec(text);
    if (totMatch) {
      declaredTotalUnits = Number(totMatch[1]);
    }
    if (headerIdx === -1) {
      const headerYCand = allYRows[i].y;
      const bodyCand = items.filter(it => it.y < headerYCand - 3);
      const candidate = buildColumnIntervals(allYRows[i], bodyCand);
      if (candidate) {
        headerIdx = i;
        colRanges = candidate;
      }
    }
  }

  // Fallback to flat line parser if no multi-column header structure exists on page
  if (!colRanges || headerIdx === -1) {
    const fallback = parseScheduleLines(pdfItemsToTableLines(items));
    return {
      ...fallback,
      semester: fallback.semester || semester,
      declaredTotalUnits: fallback.declaredTotalUnits ?? declaredTotalUnits,
    };
  }

  const headerY = allYRows[headerIdx].y;
  let footerY = -Infinity;
  for (let i = headerIdx + 1; i < allYRows.length; i++) {
    const line = allYRows[i].items.map(it => it.str).join(' ').trim();
    if (/^(total\s+units|note:|official copy|run date:)/i.test(line)) {
      footerY = Math.max(footerY, allYRows[i].y + 2.5);
      break;
    }
  }

  const bodyItems = items.filter(it => it.y < headerY - 3 && it.y > footerY);
  const leftCols = new Set(['code', 'title', 'section', 'units']);
  const leftItems = [];
  const rightItems = [];

  for (const it of bodyItems) {
    const col = colRanges.find(r => it.x >= r.minX && it.x < r.maxX) || colRanges[0];
    const tagged = { ...it, col: col.kind };
    if (leftCols.has(col.kind)) leftItems.push(tagged);
    else rightItems.push(tagged);
  }

  // Group left-side items into Subject Anchors
  const leftRows = groupItemsByY(leftItems, 4.2);
  const anchors = [];
  for (const r of leftRows) {
    const byCol = {};
    for (const it of r.items) {
      byCol[it.col] = byCol[it.col] ? `${byCol[it.col]} ${it.str}`.trim() : it.str;
    }
    let code = String(byCol.code || byCol.title || '').trim();
    const title = String(byCol.title || '').trim();
    let section = String(byCol.section || '').trim().toUpperCase();
    const uMatch = /^\s*(\d+(?:\.\d+)?)\b/.exec(String(byCol.units || ''));
    let units = uMatch ? Number(uMatch[1]) : 3;
    if (!Number.isFinite(units) || units < 0.5 || units > 12) units = 3;

    // Clean accidental header/footer echoes
    if (!code && !title) continue;
    if (/^(catalog|section|units|total|note:|run date:|page)/i.test(code)) continue;

    // If a code cell didn't split section/units, allow parsePrefixCourseMeta helper
    if (!byCol.section && !byCol.units && !byCol.title) {
      const meta = parsePrefixCourseMeta(code);
      if (meta) {
        code = meta.code;
        section = meta.section || section;
        units = meta.units;
      }
    }

    anchors.push({
      y: r.y,
      code: code || title,
      name: title || code,
      section,
      units,
      instructor: '',
      meetings: [],
    });
  }

  anchors.sort((a, b) => b.y - a.y);

  // Merge stacked wrapped continuation title lines if an anchor has neither units nor section and sits very close below previous anchor with the same missing fields
  if (anchors.length === 0) {
    const fallback = parseScheduleLines(pdfItemsToTableLines(items));
    return {
      ...fallback,
      semester: fallback.semester || semester,
      declaredTotalUnits: fallback.declaredTotalUnits ?? declaredTotalUnits,
    };
  }

  // Group right-side items into Meeting Rows
  const rightRows = groupItemsByY(rightItems, 4.2);
  const meetingRows = [];
  for (const r of rightRows) {
    const byCol = {};
    for (const it of r.items) {
      byCol[it.col] = byCol[it.col] ? `${byCol[it.col]} ${it.str}`.trim() : it.str;
    }
    const dayRaw = String(byCol.day || '').trim();
    const timeRaw = String(byCol.time || '').trim();
    const roomRaw = String(byCol.room || '').trim();
    const teacherRaw = cleanTeacherLabel(byCol.teacher || '');

    const parsedCells = parseScheduleCellsFromRowText([timeRaw, dayRaw].filter(Boolean).join(' '));
    const explicitDays = dayRaw ? parseDayTokens(dayRaw) : [];

    const rowMeetings = [];
    for (const pc of parsedCells) {
      const days = pc.days.length > 0 ? pc.days : explicitDays;
      if (days.length === 0) continue;
      const { room, kind } = cleanRoomLabel(roomRaw);
      rowMeetings.push({
        days,
        startTime: pc.startTime,
        endTime: pc.endTime,
        room,
        kind,
      });
    }

    // Also handle compact single string across right columns (e.g. Time+Day glued)
    if (rowMeetings.length === 0 && !/tba|to be arranged/i.test(`${timeRaw} ${dayRaw}`)) {
      const joined = [dayRaw, timeRaw].filter(Boolean).join(' ');
      const td = TIME_DAYS_LINE_RE.exec(joined);
      const dt = !td ? DAYS_TIME_LINE_RE.exec(joined) : null;
      const range = td ? parseTimeRangeTo24h(td[1]) : dt ? parseTimeRangeTo24h(dt[2]) : null;
      const days = td ? parseDayTokens(td[2]) : dt ? parseDayTokens(dt[1]) : [];
      if (range && days.length > 0) {
        const { room, kind } = cleanRoomLabel(roomRaw);
        rowMeetings.push({ days, startTime: range.startTime, endTime: range.endTime, room, kind });
      }
    }

    meetingRows.push({
      y: r.y,
      meetings: rowMeetings,
      instructor: teacherRaw,
    });
  }

  // Auto-detect vertical alignment mode: top-aligned vs vertically-centered merged rows
  const alignedAnchors = anchors.filter(a =>
    meetingRows.some(m => Math.abs(m.y - a.y) <= 3.5)
  ).length;
  const hasMeetingAboveFirstAnchor = meetingRows.some(m => m.y > anchors[0].y + 3.5);
  const useTopAligned =
    anchors.length > 0 && alignedAnchors / anchors.length >= 0.65 && !hasMeetingAboveFirstAnchor;

  for (const mr of meetingRows) {
    let target = null;
    if (useTopAligned) {
      for (const a of anchors) {
        if (a.y >= mr.y - 3.5) target = a;
        else break;
      }
      if (!target) target = anchors[0];
    } else {
      let bestDist = Infinity;
      for (const a of anchors) {
        const dist = Math.abs(a.y - mr.y);
        if (dist < bestDist) {
          bestDist = dist;
          target = a;
        }
      }
    }
    if (!target) continue;
    for (const m of mr.meetings) target.meetings.push(m);
    if (!target.instructor && mr.instructor) target.instructor = mr.instructor;
  }

  // Merge duplicate rows of identical code+section while preserving TBA subjects
  const merged = [];
  for (const a of anchors) {
    const existing = merged.find(
      c =>
        c.code.toLowerCase() === a.code.toLowerCase() &&
        (c.section || '') === (a.section || '')
    );
    if (existing) {
      existing.meetings.push(...a.meetings);
      if (!existing.instructor && a.instructor) existing.instructor = a.instructor;
    } else {
      merged.push({
        code: a.code,
        name: a.name || a.code,
        section: a.section,
        units: a.units,
        instructor: a.instructor,
        meetings: a.meetings,
      });
    }
  }

  const totalUnits =
    Math.round(merged.reduce((sum, c) => sum + (Number(c.units) || 0), 0) * 100) / 100;

  return {
    courses: merged,
    totalUnits,
    declaredTotalUnits,
    semester,
  };
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
  const mergedCourses = [];
  let semester = '';
  let declaredTotalUnits = null;

  try {
    const cap = Math.min(doc.numPages || 1, 8);
    for (let p = 1; p <= cap; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rawItems = tc.items || [];
      allLines.push(...pdfItemsToTableLines(rawItems));

      const pageParsed = parseSchedulePdfItems(rawItems);
      if (!semester && pageParsed.semester) semester = pageParsed.semester;
      if (declaredTotalUnits == null && pageParsed.declaredTotalUnits != null) {
        declaredTotalUnits = pageParsed.declaredTotalUnits;
      }
      for (const c of pageParsed.courses || []) {
        const existing = mergedCourses.find(
          x =>
            x.code.toLowerCase() === c.code.toLowerCase() &&
            (x.section || '') === (c.section || '')
        );
        if (existing) {
          existing.meetings.push(...(c.meetings || []));
          if (!existing.instructor && c.instructor) existing.instructor = c.instructor;
        } else {
          mergedCourses.push({ ...c, meetings: [...(c.meetings || [])] });
        }
      }
      page.cleanup?.();
    }
  } finally {
    doc.destroy?.();
  }

  const totalUnits =
    Math.round(mergedCourses.reduce((sum, c) => sum + (Number(c.units) || 0), 0) * 100) / 100;

  return {
    courses: mergedCourses,
    totalUnits,
    declaredTotalUnits,
    semester,
    rawText: allLines.join('\n'),
  };
}

/** Optional AI fallback for scanned / unusual schedule layouts. */
export async function parseScheduleWithAI(rawText) {
  const clean = String(rawText || '').trim().slice(0, 7000);
  if (!clean) throw new Error('No schedule text available to parse.');

  const prompt = [
    'Extract all college classes and meeting times from this student class schedule into strict JSON only (no markdown fences).',
    'Format: {"semester":"string","courses":[{"code":"IPT 101A","name":"Integrative Programming","section":"C","units":3,"instructor":"Prof. Santos","meetings":[{"days":[2,4],"startTime":"16:30","endTime":"17:30","room":"IT 3","kind":"LEC"}]}]}',
    'Include instructor if shown (empty string if blank/signature box). Keep TBA courses with meetings: []. Weekday index map: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun. Keep 24-hour HH:MM strings.',
    '',
    clean,
  ].join('\n');

  const rawReply = await aiText({ user: prompt, maxTokens: 1800 });
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
      instructor: cleanTeacherLabel(c?.instructor || ''),
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
export async function commitImportedSchedule({
  courses = [],
  createFolders = true,
  replaceExisting = false,
} = {}) {
  let [existingCourses, existingSchedule, existingFolders] = await Promise.all([
    db.courses.toArray().catch(() => []),
    db.classSchedule.toArray().catch(() => []),
    db.folders.toArray().catch(() => []),
  ]);

  if (replaceExisting && existingSchedule.length > 0) {
    await Promise.all(
      existingSchedule.map(r => (r.id ? db.classSchedule.delete(r.id).catch(() => {}) : null))
    );
    existingSchedule = [];
  }

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
        ...(instructor ? { instructor } : {}),
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

    if (!replaceExisting) {
      // Strip any matching rows including "<CODE> lab" suffixes cleanly
      const oldIds = existingSchedule
        .filter(r => {
          if (r.courseId === savedCourse.id) return true;
          const baseSubj = String(r.subject || '').replace(/\s+lab$/i, '');
          return normCode(baseSubj) === key;
        })
        .map(r => r.id)
        .filter(Boolean);
      if (oldIds.length > 0) {
        await Promise.all(oldIds.map(id => db.classSchedule.delete(id).catch(() => {})));
        existingSchedule = existingSchedule.filter(r => !oldIds.includes(r.id));
      }
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
