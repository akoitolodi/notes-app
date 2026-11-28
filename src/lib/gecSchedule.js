/**
 * gecSchedule.js — Official GEC Set A / Set B F2F vs. Virtual Auto-Matcher & Schedule Integrator (v2.6.0).
 *
 * Handles:
 * - Set A / Set B F2F vs Virtual weekly/split-week matrices (e.g., Dec 1-2 F2F vs Dec 3-4 Virtual,
 *   and merged special periods like Adjustment Period, Midterm Exam, University Days, Holy Days, Final Exam)
 * - Optional Master Official GEC Room/Time Schedule upload (1-file combined OR 2-file workflow)
 * - Auto-matching against the student's enrolled `db.courses` / `db.classSchedule` using GEC alias dictionary
 * - Live date-range resolution returning `'f2f' | 'virtual' | 'special' | null`
 */
import { db, COURSE_PALETTE } from '../store/db';
import { aiText, aiVision } from './aiCore';
import { extractDocument } from './docImporter';
import { parseCalendarDateRange, detectAcademicYearSpan } from './schoolCalendar';
import { parseDayTokens, parseTimeRangeTo24h, cleanRoomLabel, parseScheduleLines } from './schedulePdfParser';
import { meetingsToScheduleRows } from './scheduleView';

export const GEC_SUBJECT_ALIASES = {
  art: ['art', 'art appreciation', 'arts', 'gec-aa', 'gec aa', 'gec-art', 'ge-art', 'artapp', 'gec 6', 'ge 6'],
  math: ['math', 'mathematics in the modern world', 'modern world', 'mmw', 'gec-mmw', 'gec mmw', 'ge-mmw', 'gec 4', 'ge 4'],
  rizal: ['rizal', 'life and works of rizal', 'rzl', 'gec-rzl', 'gec rzl', 'gec-rizal', 'ge-rzl', 'gec 9', 'ge 9'],
  world: ['world', 'contemporary world', 'tcw', 'gec-tcw', 'gec tcw', 'gec-cw', 'ge-cw', 'cw', 'gec 3', 'ge 3'],
  sts: ['sts', 'science technology and society', 'science, technology, and society', 'science tech', 'gec-sts', 'gec sts', 'ge-sts', 'gec 7', 'ge 7'],
  self: ['self', 'understanding the self', 'uts', 'gec-uts', 'gec uts', 'ge-uts', 'gec 1', 'ge 1'],
  com: ['com', 'comm', 'purposive communication', 'purposive', 'pcom', 'purcom', 'gec-pcom', 'gec pcom', 'gec-pc', 'gec 5', 'ge 5'],
  hist: ['hist', 'history', 'readings in philippine history', 'philippine history', 'rph', 'gec-rph', 'gec rph', 'ge-rph', 'gec 2', 'ge 2'],
  ethics: ['ethics', 'eth', 'gec-eth', 'gec eth', 'gec-ethics', 'ge-eth', 'gec 8', 'ge 8'],
};

function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCourseLookupKey(entry) {
  if (!entry) return '';
  if (entry.courseId) return `id:${entry.courseId}`;
  const raw = entry.code || entry.subject || entry.courseName || entry.name || '';
  return `name:${normStr(raw)}`;
}

/** Score how well a candidate GEC subject token (`"Self"`, `"Art"`, `"Ethics"`) matches an enrolled course. */
function matchCourseToToken(course, token) {
  const tokNorm = normStr(token);
  if (!tokNorm) return 0;

  const haystack = normStr(
    `${course.code || ''} ${course.nickname || ''} ${course.name || ''} ${course.subject || ''}`
  );
  if (!haystack) return 0;
  const hayWords = new Set(haystack.split(' '));

  // Build alias pool for token
  const aliases = new Set([tokNorm]);
  for (const [, list] of Object.entries(GEC_SUBJECT_ALIASES)) {
    const normList = list.map(normStr);
    if (normList.includes(tokNorm) || normList.some(a => tokNorm.includes(a) && a.length >= 3)) {
      normList.forEach(a => aliases.add(a));
    }
  }

  // Exact word or phrase match from aliases
  for (const alias of aliases) {
    if (!alias) continue;
    if (alias.includes(' ')) {
      if (haystack.includes(alias)) return 0.95;
    } else if (hayWords.has(alias)) {
      return alias.length >= 3 ? 0.92 : 0.8;
    } else if (alias.length >= 4 && haystack.includes(alias)) {
      return 0.85;
    }
  }

  return 0;
}

/**
 * Deterministic offline parser for Set A / Set B F2F vs Virtual schedule matrices.
 * Handles split weeks ("December 1 - 2, 2026" / "December 3-4"), missing years,
 * pipe/tab/double-space columns, and merged full-row special periods.
 */
export function parseGecMatrixText(rawText, { fallbackDate = new Date() } = {}) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const span = detectAcademicYearSpan(text, fallbackDate);

  // Extract Set A / Set B headings if present
  const sets = [];
  const fullTextJoined = lines.join('\n');
  const setARe = /Set\s*A\s*[:\-–\n]\s*([^\n]+)/i.exec(fullTextJoined);
  const setBRe = /Set\s*B\s*[:\-–\n]\s*([^\n]+)/i.exec(fullTextJoined);
  if (setARe) {
    sets.push({
      id: 'set-a',
      label: 'Set A',
      subjects: setARe[1]
        .split(/[|,/;]+/)
        .map(s => s.trim())
        .filter(s => s && !/^set\s*b/i.test(s)),
    });
  }
  if (setBRe) {
    sets.push({
      id: 'set-b',
      label: 'Set B',
      subjects: setBRe[1]
        .split(/[|,/;]+/)
        .map(s => s.trim())
        .filter(s => s && !/^set\s*a/i.test(s)),
    });
  }
  if (sets.length === 0) {
    sets.push(
      { id: 'set-a', label: 'Set A', subjects: ['Art', 'Math', 'Rizal', 'World'] },
      { id: 'set-b', label: 'Set B', subjects: ['STS', 'Self', 'Com', 'Hist', 'Ethics'] }
    );
  }

  const termMatch = /((?:1st|2nd|first|second|summer)\s+sem(?:ester)?(?:\s+AY\s*20\d{2}[-–]20\d{2})?)/i.exec(text);
  const termLabel = termMatch ? termMatch[1].replace(/\s+/g, ' ').trim() : `AY ${span.academicYear}`;

  const periods = [];
  let lastYear = span.startYear;

  const datePrefixRe =
    /^((?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+\d{1,2}(?:\s*[-–—to]+\s*(?:(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+)?\d{1,2})?(?:,?\s*(20\d{2}))?)\s*[|\t:\s]+(.+)$/i;

  for (const line of lines) {
    if (/^(?:date\s*\||general\s+education|face-to-face\s+and\s+virtual|f2f\/virtual|set\s*[ab]\b)/i.test(line)) {
      continue;
    }
    const m = datePrefixRe.exec(line);
    if (!m) continue;

    const explicitYear = m[2] ? Number(m[2]) : null;
    if (explicitYear) lastYear = explicitYear;

    const range = parseCalendarDateRange(m[1], {
      startYear: explicitYear || lastYear,
      endYear: span.endYear,
    });
    if (!range) continue;
    lastYear = Number(range.endDate.slice(0, 4)) || lastYear;

    const rest = m[3].trim();
    // Parse modalities: look for 2 occurrences of Face-to-Face / F2F / Virtual / Online
    const modMatches = [...rest.matchAll(/\b(face[-\s]*to[-\s]*face|f2f|virtual|online)\b/gi)].map(x =>
      /virtual|online/i.test(x[1]) ? 'virtual' : 'f2f'
    );

    if (modMatches.length >= 2) {
      periods.push({
        startDate: range.startDate,
        endDate: range.endDate,
        specialLabel: '',
        modalities: {
          [sets[0].id]: modMatches[0],
          [sets[1]?.id || 'set-b']: modMatches[1],
        },
      });
    } else if (modMatches.length === 1 && sets.length === 1) {
      periods.push({
        startDate: range.startDate,
        endDate: range.endDate,
        specialLabel: '',
        modalities: { [sets[0].id]: modMatches[0] },
      });
    } else {
      // Merged full-row special period (Adjustment Period, Midterm Exam, University Days, Holy Days, Final Exam)
      const specialLabel = rest.replace(/^\|+|\|+$/g, '').trim();
      if (specialLabel) {
        periods.push({
          startDate: range.startDate,
          endDate: range.endDate,
          specialLabel,
          modalities: {},
        });
      }
    }
  }

  return {
    termLabel,
    sets,
    periods: periods.sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
}

/**
 * Parse a Master Official GEC Room/Time table (PDF or text) into candidate class records.
 * Reuses `parseScheduleTextOffline` plus row-level fallback for space/pipe separated registrar tables.
 */
export function parseMasterGecClassText(rawText) {
  const fromStudyLoad = parseScheduleLines(String(rawText || '').replace(/\r\n/g, '\n').split('\n'));
  if (fromStudyLoad.length > 0) {
    return fromStudyLoad.map(c => ({
      code: c.code,
      name: c.name || c.code,
      section: c.section || '',
      instructor: c.instructor || '',
      units: c.units || 3,
      meetings: c.meetings || [],
    }));
  }

  // Fallback line-by-line parser for tabular GEC lists
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const time = parseTimeRangeTo24h(line);
    if (!time) continue;
    const codeMatch = /\b([A-Z]{2,5}[-\s]?\d{1,3}[A-Z]?)\b/.exec(line);
    if (!codeMatch) continue;
    const dayMatch = /\b(M|T|W|Th|F|S|MWF|TTh|MW|TF|WS|Sat)\b/i.exec(line);
    const days = parseDayTokens(dayMatch ? dayMatch[1] : 'MWF');
    const roomPart = line.split(/[|\t]/).pop() || '';
    const { room, kind } = cleanRoomLabel(roomPart.length < 40 ? roomPart : '');
    out.push({
      code: codeMatch[1].replace(/\s+/g, ' ').trim(),
      name: codeMatch[1].trim(),
      section: '',
      instructor: '',
      units: 3,
      meetings: [{ days: days.length ? days : [1, 3, 5], startTime: time.startTime, endTime: time.endTime, room, kind }],
    });
  }
  return out;
}

function safeParseJson(raw) {
  const clean = String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const f = clean.indexOf('{');
  const l = clean.lastIndexOf('}');
  if (f === -1 || l === -1) return null;
  try {
    return JSON.parse(clean.slice(f, l + 1));
  } catch {
    return null;
  }
}

async function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read schedule image'));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract GEC F2F/Virtual Matrix AND/OR Master GEC Room Schedule from 1 combined upload or 2 separate uploads.
 */
export async function extractGecFromInput({
  matrixFile = null,
  matrixImageDataUrl = '',
  matrixText = '',
  masterFile = null,
  masterImageDataUrl = '',
  masterText = '',
}) {
  let finalMatrixImg = matrixImageDataUrl || '';
  let finalMatrixText = String(matrixText || '').trim();
  let finalMasterImg = masterImageDataUrl || '';
  let finalMasterText = String(masterText || '').trim();

  if (matrixFile) {
    const isImg = matrixFile.type?.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(matrixFile.name || '');
    if (isImg && !finalMatrixImg) finalMatrixImg = await readImageFileAsDataUrl(matrixFile);
    else if (!isImg) {
      const imp = await extractDocument(matrixFile);
      finalMatrixText = [finalMatrixText, imp?.rawMarkdown || imp?.text || ''].filter(Boolean).join('\n\n');
    }
  }

  if (masterFile) {
    const isImg = masterFile.type?.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(masterFile.name || '');
    if (isImg && !finalMasterImg) finalMasterImg = await readImageFileAsDataUrl(masterFile);
    else if (!isImg) {
      const imp = await extractDocument(masterFile);
      finalMasterText = [finalMasterText, imp?.rawMarkdown || imp?.text || ''].filter(Boolean).join('\n\n');
    }
  }

  let matrixResult = null;
  let masterClasses = [];

  // 1. Parse Matrix (or combined image)
  if (finalMatrixImg) {
    const raw = await aiVision(
      finalMatrixImg,
      `Extract the General Education (GEC) Face-to-Face and Virtual schedule table into clean JSON.
Rules:
1. Extract every Set column (e.g., "Set A" with subjects ["Art", "Math", "Rizal", "World"], "Set B" with ["STS", "Self", "Com", "Hist", "Ethics"]).
2. Extract EVERY date row in order, even split weeks like Dec 1-2 vs Dec 3-4! If a row omits the year, inherit the year from adjacent rows / header.
3. For normal rows, set specialLabel: "" and modalities: { "set-a": "f2f"|"virtual", "set-b": "f2f"|"virtual" }.
4. For merged full-row rows (like "Adjustment Period", "Midterm Exam", "University Days", "Holy Days", "Final Exam"), set specialLabel to that text and modalities: {}.
5. If this single image ALSO lists specific class schedules (subject code, room, time, days), include them in "masterClasses".
Return ONLY valid JSON:
{
  "termLabel": "2nd Sem AY 2026-2027",
  "sets": [
    { "id": "set-a", "label": "Set A", "subjects": ["Art", "Math", "Rizal", "World"] },
    { "id": "set-b", "label": "Set B", "subjects": ["STS", "Self", "Com", "Hist", "Ethics"] }
  ],
  "periods": [
    { "startDate": "2026-11-23", "endDate": "2026-11-28", "specialLabel": "Adjustment Period", "modalities": {} },
    { "startDate": "2026-12-01", "endDate": "2026-12-02", "specialLabel": "", "modalities": { "set-a": "f2f", "set-b": "virtual" } }
  ],
  "masterClasses": []
}`,
      'You extract university GEC Face-to-Face vs Virtual schedules with exact dates and set labels. Return ONLY valid JSON.'
    );
    const json = safeParseJson(raw);
    if (json && Array.isArray(json.periods) && json.periods.length > 0) {
      matrixResult = {
        termLabel: json.termLabel || 'GEC Schedule',
        sets: Array.isArray(json.sets) && json.sets.length ? json.sets : [
          { id: 'set-a', label: 'Set A', subjects: ['Art', 'Math', 'Rizal', 'World'] },
          { id: 'set-b', label: 'Set B', subjects: ['STS', 'Self', 'Com', 'Hist', 'Ethics'] },
        ],
        periods: json.periods
          .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.startDate || ''))
          .map(p => ({
            startDate: p.startDate,
            endDate: /^\d{4}-\d{2}-\d{2}$/.test(p.endDate || '') ? p.endDate : p.startDate,
            specialLabel: String(p.specialLabel || '').trim(),
            modalities: p.modalities && typeof p.modalities === 'object' ? p.modalities : {},
          })),
      };
      if (Array.isArray(json.masterClasses) && json.masterClasses.length > 0) {
        masterClasses = json.masterClasses;
      }
    } else {
      throw new Error('Could not parse the GEC F2F/Virtual image. Try a clearer crop or paste the table text.');
    }
  } else if (finalMatrixText) {
    const offline = parseGecMatrixText(finalMatrixText);
    if (offline.periods.length >= 2) {
      matrixResult = offline;
    } else {
      const raw = await aiText(
        [
          { role: 'system', content: 'Convert this GEC F2F/Virtual schedule text to JSON. Return ONLY JSON.' },
          {
            role: 'user',
            content: `${finalMatrixText.slice(0, 10000)}\n\nSchema: { "termLabel": "...", "sets": [{"id":"set-a","label":"Set A","subjects":[...]}], "periods": [{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","specialLabel":"","modalities":{"set-a":"f2f","set-b":"virtual"}}] }`,
          },
        ],
        { task: 'fast', temperature: 0.1 }
      );
      const json = safeParseJson(raw);
      if (json && Array.isArray(json.periods) && json.periods.length > 0) {
        matrixResult = json;
      }
    }
  }

  // 2. Parse optional separate Master GEC Room/Time Schedule
  if (finalMasterImg) {
    const raw = await aiVision(
      finalMasterImg,
      `Extract all GEC class rows from this official Master GEC Class Schedule into JSON:
{ "classes": [ { "code": "GEC-UTS", "name": "Understanding the Self", "section": "A1", "days": "MWF", "startTime": "09:00", "endTime": "10:00", "room": "Room 204", "instructor": "" } ] }
Use 24h HH:MM times. Return ONLY valid JSON.`,
      'You extract official class timetable tables accurately into JSON.'
    );
    const json = safeParseJson(raw);
    if (json && Array.isArray(json.classes)) {
      masterClasses = [
        ...masterClasses,
        ...json.classes.map(c => ({
          code: String(c.code || '').trim(),
          name: String(c.name || c.code || '').trim(),
          section: String(c.section || '').trim(),
          instructor: String(c.instructor || '').trim(),
          units: 3,
          meetings: [
            {
              days: parseDayTokens(c.days || 'MWF'),
              startTime: c.startTime || '08:00',
              endTime: c.endTime || '09:30',
              room: cleanRoomLabel(c.room || '').room,
              kind: cleanRoomLabel(c.room || '').kind,
            },
          ],
        })),
      ];
    }
  } else if (finalMasterText) {
    const parsed = parseMasterGecClassText(finalMasterText);
    if (parsed.length > 0) masterClasses = [...masterClasses, ...parsed];
  }

  if (!matrixResult && masterClasses.length === 0) {
    throw new Error('Please upload or paste a GEC F2F/Virtual schedule or Master GEC class schedule.');
  }

  return {
    ...(matrixResult || { termLabel: 'GEC Schedule', sets: [], periods: [] }),
    masterClasses,
  };
}

/**
 * Auto-match enrolled courses (from `db.courses` + `db.classSchedule`) against extracted GEC sets
 * and optional Master GEC class rows (so non-enrolled GECs are skipped by default!).
 */
export function matchGecToEnrolled({
  sets = [],
  masterClasses = [],
  enrolledCourses = [],
  scheduleRows = [],
} = {}) {
  // Build unified list of enrolled courses (deduped by courseId / normalized code)
  const enrolledMap = new Map();
  for (const c of enrolledCourses || []) {
    if (c.archived) continue;
    const key = normalizeCourseLookupKey({ courseId: c.id, code: c.code, name: c.name });
    enrolledMap.set(key, {
      key,
      courseId: c.id,
      code: c.code || c.name,
      name: c.name || c.code,
      nickname: c.nickname || '',
      section: c.section || '',
    });
  }
  for (const row of scheduleRows || []) {
    const key = row.courseId
      ? normalizeCourseLookupKey({ courseId: row.courseId })
      : normalizeCourseLookupKey({ code: row.subject });
    if (!enrolledMap.has(key)) {
      enrolledMap.set(key, {
        key,
        courseId: row.courseId || null,
        code: row.subject || row.courseName || 'Class',
        name: row.courseName || row.subject || 'Class',
        nickname: '',
        section: '',
      });
    }
  }

  const matchedCourses = [];
  for (const ec of enrolledMap.values()) {
    let bestSet = null;
    let bestAlias = '';
    let bestScore = 0;
    for (const s of sets || []) {
      for (const tok of s.subjects || []) {
        const score = matchCourseToToken(ec, tok);
        if (score > bestScore) {
          bestScore = score;
          bestSet = s.id;
          bestAlias = tok;
        }
      }
    }

    // Also find matching rows from optional Master GEC upload
    const candidateSlots = (masterClasses || []).filter(mc => {
      const mNorm = normStr(`${mc.code} ${mc.name}`);
      const eCode = normStr(ec.code);
      const eName = normStr(ec.name);
      if (eCode && mNorm.includes(eCode)) return true;
      if (bestAlias && matchCourseToToken(mc, bestAlias) >= 0.8) return true;
      if (eName && mNorm.includes(eName)) return true;
      return false;
    });

    matchedCourses.push({
      ...ec,
      setId: bestScore >= 0.75 ? bestSet : null,
      matchedAlias: bestScore >= 0.75 ? bestAlias : '',
      confidence: bestScore,
      candidateSlots,
    });
  }

  // Non-enrolled rows from Master GEC upload -> shown separately as Skipped
  const usedMaster = new Set(matchedCourses.flatMap(m => m.candidateSlots));
  const unmatchedMasterClasses = (masterClasses || []).filter(mc => !usedMaster.has(mc));

  return { matchedCourses, unmatchedMasterClasses };
}

/**
 * Commit parsed GEC Schedule + optional confirmed Master GEC class slots cleanly into Dexie.
 */
export async function commitGecSchedule({
  termLabel = 'GEC Schedule',
  sets = [],
  periods = [],
  courseSetMap = {},
  adoptedSlots = [],
}) {
  const now = Date.now();
  const prev = await db.gecSchedules.toArray().catch(() => []);
  for (const r of prev) {
    if (r.active) await db.gecSchedules.update(r.id, { active: 0 }).catch(() => {});
  }

  const id = await db.gecSchedules.add({
    termLabel: String(termLabel || 'GEC Schedule'),
    active: 1,
    sets,
    periods,
    courseSetMap,
    updatedAt: now,
  });

  // Adopt any user-confirmed Master GEC class rows into db.classSchedule without duplicates
  const existingRows = await db.classSchedule.toArray().catch(() => []);
  const slotSig = r => `${normStr(r.subject)}|${r.dayOfWeek}|${r.startTime}|${r.endTime}`;
  const existingSigs = new Set(existingRows.map(slotSig));
  let addedSlotsCount = 0;

  for (const slot of adoptedSlots || []) {
    if (!slot.checked) continue;
    const rows = meetingsToScheduleRows(slot.meetings || [], {
      courseId: slot.courseId || null,
      subject: slot.targetCode || slot.code,
      courseName: slot.targetName || slot.name || slot.code,
      instructor: slot.instructor || '',
      color: COURSE_PALETTE[0],
    });
    for (const r of rows) {
      const sig = slotSig(r);
      if (existingSigs.has(sig)) continue;
      existingSigs.add(sig);
      await db.classSchedule.add({ ...r, createdAt: now });
      addedSlotsCount += 1;
    }
  }

  const saved = await db.gecSchedules.get(id);
  return { saved, addedSlotsCount };
}

/**
 * Resolve a scheduled class entry's live GEC modality for a specific calendar date (`YYYY-MM-DD`).
 * Returns:
 * - `null` if entry is not mapped to any GEC set
 * - `{ mode: 'special', label, setId, setLabel }`
 * - `{ mode: 'f2f', label: 'F2F', setId, setLabel, room }`
 * - `{ mode: 'virtual', label: 'VIRTUAL', setId, setLabel }`
 * - `{ mode: 'unscheduled', label: setLabel, setId, setLabel }`
 */
export function resolveGecModalityForDate(entry, dateKey, gecSchedule) {
  if (!entry || !gecSchedule || !Array.isArray(gecSchedule.sets)) return null;

  const map = gecSchedule.courseSetMap || {};
  const idKey = entry.courseId ? `id:${entry.courseId}` : '';
  const nameKey = normalizeCourseLookupKey({ code: entry.code || entry.subject });
  const altKey = normalizeCourseLookupKey({ code: entry.courseName || entry.title });

  let setId =
    (idKey && map[idKey]?.setId) ||
    map[nameKey]?.setId ||
    map[altKey]?.setId ||
    null;

  // Also check explicitly suppressed courses (`setId === 'none'`)
  if (setId === 'none') return null;

  // Fallback automatic alias match against active sets
  if (!setId) {
    let bestScore = 0;
    for (const s of gecSchedule.sets) {
      for (const tok of s.subjects || []) {
        const sc = matchCourseToToken(
          { code: entry.code || entry.subject, name: entry.courseName || entry.title || entry.subject },
          tok
        );
        if (sc > bestScore) {
          bestScore = sc;
          if (sc >= 0.78) setId = s.id;
        }
      }
    }
  }

  if (!setId) return null;
  const setObj = gecSchedule.sets.find(s => s.id === setId) || { id: setId, label: setId.toUpperCase() };

  const periods = Array.isArray(gecSchedule.periods) ? gecSchedule.periods : [];
  const period = periods.find(p => p.startDate <= dateKey && dateKey <= (p.endDate || p.startDate));
  if (!period) {
    return { mode: 'unscheduled', label: setObj.label, setId: setObj.id, setLabel: setObj.label };
  }

  if (period.specialLabel) {
    return {
      mode: 'special',
      label: period.specialLabel,
      setId: setObj.id,
      setLabel: setObj.label,
    };
  }

  const mod = period.modalities?.[setObj.id];
  if (mod === 'f2f') {
    return {
      mode: 'f2f',
      label: 'F2F',
      setId: setObj.id,
      setLabel: setObj.label,
      room: entry.room || '',
    };
  }
  if (mod === 'virtual') {
    return {
      mode: 'virtual',
      label: 'VIRTUAL',
      setId: setObj.id,
      setLabel: setObj.label,
    };
  }

  return { mode: 'unscheduled', label: setObj.label, setId: setObj.id, setLabel: setObj.label };
}

/** Return a short banner summary of the GEC matrix for any date (`"Set A F2F · Set B Virtual"` or `"Midterm Exam"`). */
export function getGecPeriodSummaryForDate(dateKey, gecSchedule) {
  if (!gecSchedule || !Array.isArray(gecSchedule.periods)) return null;
  const period = gecSchedule.periods.find(
    p => p.startDate <= dateKey && dateKey <= (p.endDate || p.startDate)
  );
  if (!period) return null;
  if (period.specialLabel) {
    return { kind: 'special', text: period.specialLabel, period };
  }
  const parts = (gecSchedule.sets || [])
    .map(s => {
      const m = period.modalities?.[s.id];
      if (!m) return null;
      return `${s.label} ${m === 'f2f' ? 'F2F' : 'Virtual'}`;
    })
    .filter(Boolean);
  if (!parts.length) return null;
  return { kind: 'modality', text: parts.join(' · '), period };
}
