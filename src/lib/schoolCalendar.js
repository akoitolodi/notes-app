/**
 * schoolCalendar.js — Automatic Multi-Term Academic Calendar Maker & Mid-Semester Revision Engine (v2.6.0).
 *
 * Handles:
 * - Image (via aiVision), PDF/DOCX/TXT (via docImporter), and pasted text/memo extraction
 * - Multi-term AY parsing (First Semester, Second Semester, Summer, Enrollment)
 * - Smart cross-year & cross-month date inference (e.g., AY 2026-2027: Jul–Dec = 2026, Jan–Jun = 2027; Oct 29-Nov 7)
 * - Grad vs Non-Grad / Undergrad audience tagging + Admin Grade Deadline tagging
 * - Mid-semester revision diff engine (Moved / Added / Removed / Unchanged) supporting both
 *   full revised calendar uploads AND partial revision memos
 * - Non-destructive sync to `db.plannerItems` (only touches `source: 'school-calendar'`)
 */
import { db, localDateKey } from '../store/db';
import { aiText, aiVision } from './aiCore';
import { extractDocument } from './docImporter';

const MONTH_MAP = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_NAMES = '(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';

export const SCHOOL_CALENDAR_TERMS = [
  { id: 'first', label: '1st Sem' },
  { id: 'second', label: '2nd Sem' },
  { id: 'summer', label: 'Summer' },
];

function pad2(n) {
  return String(Number(n) || 0).padStart(2, '0');
}

export function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Detect `AY 2026-2027` or `2026–2027` from raw text; defaults around current year. */
export function detectAcademicYearSpan(text, fallbackDate = new Date()) {
  const m = /(?:a\.?\s*y\.?|academic\s*year|s\.?\s*y\.?)\s*[:.]?\s*(20\d{2})\s*[-–/]\s*(20\d{2})/i.exec(
    String(text || '')
  ) || /\b(20\d{2})\s*[-–]\s*(20\d{2})\b/.exec(String(text || ''));
  if (m) {
    const startYear = Number(m[1]);
    const endYear = Number(m[2]);
    if (endYear >= startYear && endYear - startYear <= 2) {
      return { startYear, endYear, academicYear: `${startYear}-${endYear}` };
    }
  }
  const yr = fallbackDate.getFullYear();
  const mo = fallbackDate.getMonth() + 1;
  const startYear = mo >= 6 ? yr : yr - 1;
  const endYear = startYear + 1;
  return { startYear, endYear, academicYear: `${startYear}-${endYear}` };
}

/**
 * Infer calendar year for a month inside an Academic Year (`startYear`-`endYear`).
 * Months Jul(7)–Dec(12) belong to `startYear`; Jan(1)–Jun(6) belong to `endYear`.
 */
export function inferYearForMonth(monthNum, startYear, endYear, explicitYear = null) {
  if (explicitYear && Number(explicitYear) >= 2000) return Number(explicitYear);
  const m = Number(monthNum);
  if (m >= 7) return Number(startYear);
  return Number(endYear || startYear + 1);
}

/** Parse a date or date-range expression into `{ startDate, endDate }` (`YYYY-MM-DD`). */
export function parseCalendarDateRange(rawExpr, { startYear, endYear, term = 'first' } = {}) {
  const s = String(rawExpr || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // ISO format YYYY-MM-DD [to YYYY-MM-DD]
  const isoMatch = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:[-–—]|to)\s*(\d{4}-\d{2}-\d{2}))?$/.exec(s);
  if (isoMatch) {
    return {
      startDate: isoMatch[1],
      endDate: isoMatch[2] || isoMatch[1],
    };
  }

  const sy = Number(startYear) || new Date().getFullYear();
  const ey = Number(endYear) || sy + 1;

  // Cross-month range: "Oct 29 - Nov 7, 2026" or "October 29-November 7"
  const crossRe = new RegExp(
    `(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:,\\s*(20\\d{2}))?\\s*[-–—to]+\\s*(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?`,
    'i'
  );
  const cm = crossRe.exec(s);
  if (cm) {
    const m1 = MONTH_MAP[cm[1].toLowerCase()];
    const d1 = Number(cm[2]);
    const y1Explicit = cm[3] ? Number(cm[3]) : null;
    const m2 = MONTH_MAP[cm[4].toLowerCase()];
    const d2 = Number(cm[5]);
    const y2Explicit = cm[6] ? Number(cm[6]) : null;
    if (m1 && m2) {
      let y1 = y1Explicit || (y2Explicit && m1 <= m2 ? y2Explicit : y2Explicit && m1 > m2 ? y2Explicit - 1 : inferYearForMonth(m1, sy, ey));
      let y2 = y2Explicit || (m2 < m1 ? y1 + 1 : inferYearForMonth(m2, sy, ey));
      if (term === 'summer' && !y1Explicit && !y2Explicit) {
        y1 = ey;
        y2 = ey;
      }
      const startDate = toIsoDate(y1, m1, d1);
      const endDate = toIsoDate(y2, m2, d2);
      if (startDate && endDate) return { startDate, endDate };
    }
  }

  // Same-month range or single day: "September 1-7, 2026" or "July 8" or "Feb 1-6"
  const singleOrSameRe = new RegExp(
    `(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:\\s*[-–—to]+\\s*(\\d{1,2}))?(?:,?\\s*(20\\d{2}))?`,
    'i'
  );
  const sm = singleOrSameRe.exec(s);
  if (sm) {
    const m = MONTH_MAP[sm[1].toLowerCase()];
    const d1 = Number(sm[2]);
    const d2 = sm[3] ? Number(sm[3]) : d1;
    const yExp = sm[4] ? Number(sm[4]) : null;
    if (m) {
      let y = inferYearForMonth(m, sy, ey, yExp);
      if (term === 'summer' && !yExp && m >= 6) y = ey;
      const startDate = toIsoDate(y, m, d1);
      const endDate = toIsoDate(y, m, d2);
      if (startDate && endDate) return { startDate, endDate };
    }
  }

  return null;
}

export function slugifyCalendarTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/non-?grad(?:uate)?(?:\s*stud(?:ents?)?)?/g, 'nongrad')
    .replace(/grad(?:uate)?\s*stud(?:ents?)?/g, 'grad')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Classify event kind & audience (`grad`, `undergrad`, `all`) from title text. */
export function classifyCalendarEvent(title = '') {
  const t = String(title || '').trim();
  let audience = 'all';
  if (/\bnon-?grad\b|\bundergrad/i.test(t)) {
    audience = 'undergrad';
  } else if (/\bgrad(?:uate)?\s*(?:stud|students|level)?\b/i.test(t) || /-\s*grad\b/i.test(t)) {
    audience = 'grad';
  }

  let kind = 'event';
  if (/deadline\b/i.test(t)) {
    kind = 'deadline';
  } else if (/\b(midterm|final\s*exam|finals|prelim|prefinal|examination|exams?)\b/i.test(t)) {
    kind = 'exam';
  } else if (
    /\b(no\s*class|suspend|suspension|cancellation|typhoon|last\s*school\s*day|semestral\s*break|christmas\s*break)\b/i.test(t)
  ) {
    kind = 'no-class';
  } else if (
    /\b(holiday|ninoy\s*aquino|heroes|all\s*saints|all\s*souls|cpg\s*day|edsa|eid|holy\s*days|araw\s*ng\s*kagitingan|good\s*friday|maundy|easter|rizal\s*day|bonifacio|labor\s*day|independence|new\s*year)\b/i.test(
      t
    )
  ) {
    kind = 'holiday';
  } else if (/\b(start\s*of\s*class|last\s*day\s*of\s*class|class\s*adjustment|adjustment|enrollment)\b/i.test(t)) {
    kind = 'milestone';
  }

  return { kind, audience };
}

function normalizeEventObject(raw, { term = 'first', startYear, endYear } = {}) {
  const title = String(raw?.title || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const evTerm = ['first', 'second', 'summer', 'enrollment'].includes(raw?.term) ? raw.term : term;

  let startDate = raw?.startDate || '';
  let endDate = raw?.endDate || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const parsed = parseCalendarDateRange(raw?.dateText || startDate || title, {
      startYear,
      endYear,
      term: evTerm,
    });
    if (!parsed) return null;
    startDate = parsed.startDate;
    endDate = parsed.endDate;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) endDate = startDate;
  if (endDate < startDate) endDate = startDate;

  const auto = classifyCalendarEvent(title);
  const kind = ['exam', 'holiday', 'no-class', 'milestone', 'event', 'deadline'].includes(raw?.kind)
    ? raw.kind
    : auto.kind;
  const audience = ['all', 'undergrad', 'grad'].includes(raw?.audience) ? raw.audience : auto.audience;
  const eventKey = `${evTerm}:${slugifyCalendarTitle(title) || startDate}`;

  return {
    eventKey,
    term: evTerm,
    title,
    startDate,
    endDate,
    kind,
    audience,
    notes: String(raw?.notes || '').trim(),
  };
}

/**
 * Deterministic offline parser for standard university Academic Calendar text
 * (First Semester / Second Semester / Summer + Enrollment Schedule).
 */
export function parseSchoolCalendarText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const { startYear, endYear, academicYear } = detectAcademicYearSpan(text);
  const schoolMatch = /^([^\n]*(?:university|college|institute|school|academy)[^\n]*)/im.exec(text);
  const schoolName = schoolMatch ? schoolMatch[1].replace(/\s+/g, ' ').trim().slice(0, 72) : 'Academic Calendar';

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let curTerm = 'first';
  const rawEvents = [];

  const lineDateRe = new RegExp(
    `^((?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:\\s*[-–—to]+\\s*(?:(?:${MONTH_NAMES})\\.?\\s+)?\\d{1,2})?(?:,?\\s*20\\d{2})?)\\s*(?:[|:\\-–]\\s*|\\s{1,})(.+)$`,
    'i'
  );

  let pendingDate = null;
  for (const line of lines) {
    if (/^first\s+semester\b/i.test(line)) {
      curTerm = 'first';
      pendingDate = null;
      continue;
    }
    if (/^second\s+semester\b/i.test(line)) {
      curTerm = 'second';
      pendingDate = null;
      continue;
    }
    if (/^summer\b/i.test(line)) {
      curTerm = 'summer';
      pendingDate = null;
      continue;
    }
    if (/^enrollment\s+schedule\b/i.test(line)) {
      curTerm = 'enrollment';
      pendingDate = null;
      continue;
    }
    if (/^(summary|legend|approved\s+by|months\s+weeks)/i.test(line)) {
      pendingDate = null;
      continue;
    }

    // Handle enrollment line: "First semester: May 18-July 7, 2026"
    const enrMatch = /^(first\s+semester|second\s+semester|summer)\s*:\s*(.+)$/i.exec(line);
    if (enrMatch && curTerm === 'enrollment') {
      const termTag = /first/i.test(enrMatch[1]) ? 'first' : /second/i.test(enrMatch[1]) ? 'second' : 'summer';
      const parsed = parseCalendarDateRange(enrMatch[2], { startYear, endYear, term: termTag });
      if (parsed) {
        const ev = normalizeEventObject(
          {
            term: termTag,
            title: `${enrMatch[1]} Enrollment`,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            kind: 'milestone',
            audience: 'all',
          },
          { term: termTag, startYear, endYear }
        );
        if (ev) rawEvents.push(ev);
      }
      continue;
    }

    const dm = lineDateRe.exec(line);
    if (dm) {
      const dateRange = parseCalendarDateRange(dm[1], { startYear, endYear, term: curTerm });
      if (dateRange) {
        pendingDate = dateRange;
        const title = dm[2].replace(/\s+/g, ' ').trim();
        const ev = normalizeEventObject(
          { term: curTerm, title, startDate: dateRange.startDate, endDate: dateRange.endDate },
          { term: curTerm, startYear, endYear }
        );
        if (ev) rawEvents.push(ev);
        continue;
      }
    }

    // Continuation event on exact previous date (e.g., "Deadline of INC Grades for First Sem..." below "Last Day of Classes")
    if (pendingDate && /^(deadline\b|last\s+day\b|final\s+exam|midterm\s+exam)/i.test(line)) {
      const ev = normalizeEventObject(
        { term: curTerm, title: line, startDate: pendingDate.startDate, endDate: pendingDate.endDate },
        { term: curTerm, startYear, endYear }
      );
      if (ev) rawEvents.push(ev);
    } else if (!/^(for\s+(?:first|second|summer)|20\d{2}[-–]20\d{2})/i.test(line)) {
      pendingDate = null;
    }
  }

  // Deduplicate exact same (term + title + startDate)
  const seen = new Set();
  const events = [];
  for (const ev of rawEvents) {
    const k = `${ev.eventKey}:${ev.startDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push(ev);
  }

  return {
    schoolName,
    academicYear,
    startYear,
    endYear,
    activeTerm: detectActiveTermForDate(events),
    events,
  };
}

/** Auto-detect which semester is active around a given dateKey (`YYYY-MM-DD`). */
export function detectActiveTermForDate(events = [], dateKey = localDateKey()) {
  const byTerm = new Map();
  for (const ev of events || []) {
    if (!['first', 'second', 'summer'].includes(ev.term)) continue;
    const prev = byTerm.get(ev.term) || { min: ev.startDate, max: ev.endDate };
    if (ev.startDate < prev.min) prev.min = ev.startDate;
    if (ev.endDate > prev.max) prev.max = ev.endDate;
    byTerm.set(ev.term, prev);
  }
  for (const [term, span] of byTerm.entries()) {
    if (dateKey >= span.min && dateKey <= span.max) return term;
  }
  // Nearest upcoming term
  const upcoming = [...byTerm.entries()]
    .filter(([, span]) => span.max >= dateKey)
    .sort((a, b) => a[1].min.localeCompare(b[1].min));
  if (upcoming.length > 0) return upcoming[0][0];
  if (byTerm.has('second')) return 'second';
  if (byTerm.has('first')) return 'first';
  return 'first';
}

function titleTokenSet(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      .replace(/examination/g, 'exam')
      .replace(/exams/g, 'exam')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !['of', 'the', 'for', 'and', 'in', 'to'].includes(w))
  );
}

function titlesSimilar(a, b) {
  const sa = titleTokenSet(a);
  const sb = titleTokenSet(b);
  if (sa.size === 0 || sb.size === 0) return false;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = new Set([...sa, ...sb]).size;
  return inter / union >= 0.5 || inter >= Math.min(sa.size, sb.size);
}

/**
 * Deterministic offline partial revision memo parser
 * Handles lines like:
 * - "Midterm Examination moved to Feb 8-13"
 * - "Feb 25 no classes" / "Nov 3 classes suspended"
 * - "Cancel University Days" / "Intramurals removed"
 */
export function parsePartialRevisionMemoOffline(memoText, existingCalendar) {
  const text = String(memoText || '').replace(/\r\n/g, '\n');
  const startYear = existingCalendar?.startYear || detectAcademicYearSpan(text).startYear;
  const endYear = existingCalendar?.endYear || startYear + 1;
  const defaultTerm = existingCalendar?.activeTerm || 'second';
  const existingEvents = Array.isArray(existingCalendar?.events) ? existingCalendar.events : [];

  const clauses = text
    .split(/[\n;]+/)
    .map(c => c.trim())
    .filter(Boolean);

  const patches = [];
  for (const clause of clauses) {
    const cancelMatch = /\b(?:cancel(?:led|ed)?|remove(?:d)?|postpone(?:d)?\s+indefinitely|no\s+longer)\b/i.test(
      clause
    );
    const dateRange = parseCalendarDateRange(clause, { startYear, endYear, term: defaultTerm });

    if (cancelMatch && !dateRange) {
      const matched = existingEvents.find(ev => titlesSimilar(ev.title, clause));
      if (matched) {
        patches.push({
          action: 'remove',
          eventKey: matched.eventKey,
          targetTitle: matched.title,
          term: matched.term,
        });
      }
      continue;
    }

    if (dateRange) {
      // Find whether clause references an existing event ("Midterms moved to Feb 8-13")
      const matched = existingEvents.find(
        ev =>
          (ev.term === defaultTerm || existingEvents.filter(x => titlesSimilar(x.title, clause)).length === 1) &&
          titlesSimilar(ev.title, clause)
      );
      if (matched && !/\b(?:add|new|suspend|suspension|typhoon|holiday)\b/i.test(clause)) {
        patches.push({
          action: 'move',
          eventKey: matched.eventKey,
          targetTitle: matched.title,
          term: matched.term,
          title: matched.title,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          kind: matched.kind,
          audience: matched.audience,
        });
      } else {
        // Strip leading/trailing date text to form a clean title
        const cleanTitle = clause
          .replace(
            new RegExp(
              `(${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:\\s*[-–—to]+\\s*(?:(?:${MONTH_NAMES})\\.?\\s+)?\\d{1,2})?(?:,?\\s*20\\d{2})?`,
              'gi'
            ),
            ''
          )
          .replace(/^(?:moved\s+to|shifted\s+to|rescheduled\s+to|:|-|–)\s*/i, '')
          .trim() || clause;
        const auto = classifyCalendarEvent(cleanTitle);
        patches.push({
          action: 'add',
          term: defaultTerm,
          title: cleanTitle,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          kind: auto.kind,
          audience: auto.audience,
        });
      }
    }
  }
  return patches;
}

/**
 * Compute Mid-Semester Revision Diff between current calendar events and incoming
 * full calendar OR partial revision patches.
 * Returns `{ moved, added, removed, unchanged }`.
 */
export function diffSchoolCalendarEvents(
  currentEvents = [],
  incoming,
  { isPartialPatch = false } = {}
) {
  const cur = Array.isArray(currentEvents) ? currentEvents : [];

  if (isPartialPatch) {
    const patches = Array.isArray(incoming) ? incoming : [];
    const moved = [];
    const added = [];
    const removed = [];
    const touchedKeys = new Set();

    for (const p of patches) {
      if (p.action === 'remove') {
        const hit =
          cur.find(e => p.eventKey && e.eventKey === p.eventKey) ||
          cur.find(e => (!p.term || e.term === p.term) && titlesSimilar(e.title, p.targetTitle || p.title));
        if (hit && !touchedKeys.has(hit.eventKey)) {
          touchedKeys.add(hit.eventKey);
          removed.push({ id: `rem-${hit.eventKey}`, event: hit, checked: true });
        }
        continue;
      }

      if (p.action === 'move') {
        const hit =
          cur.find(e => p.eventKey && e.eventKey === p.eventKey) ||
          cur.find(e => (!p.term || e.term === p.term) && titlesSimilar(e.title, p.targetTitle || p.title));
        if (hit) {
          touchedKeys.add(hit.eventKey);
          const nextEv = {
            ...hit,
            title: p.title || hit.title,
            startDate: p.startDate,
            endDate: p.endDate || p.startDate,
            kind: p.kind || hit.kind,
            notes: p.notes || hit.notes || '',
          };
          if (hit.startDate !== nextEv.startDate || hit.endDate !== nextEv.endDate) {
            moved.push({
              id: `mov-${hit.eventKey}`,
              prev: hit,
              next: nextEv,
              checked: true,
            });
          }
          continue;
        }
      }

      // Add
      const ev = normalizeEventObject(p, { term: p.term || 'second' });
      if (ev) {
        const existingHit = cur.find(e => e.eventKey === ev.eventKey);
        if (existingHit && !touchedKeys.has(existingHit.eventKey)) {
          touchedKeys.add(existingHit.eventKey);
          if (existingHit.startDate !== ev.startDate || existingHit.endDate !== ev.endDate) {
            moved.push({
              id: `mov-${existingHit.eventKey}`,
              prev: existingHit,
              next: ev,
              checked: true,
            });
          }
        } else if (!existingHit) {
          added.push({ id: `add-${ev.eventKey}`, event: ev, checked: true });
        }
      }
    }

    const unchanged = cur.filter(e => !touchedKeys.has(e.eventKey));
    return { moved, added, removed, unchanged };
  }

  // Full calendar comparison
  const nextList = Array.isArray(incoming) ? incoming : [];
  const nextTerms = new Set(nextList.map(e => e.term));
  const matchedCurIdx = new Set();
  const matchedNextIdx = new Set();
  const moved = [];
  const added = [];
  const removed = [];
  const unchanged = [];

  nextList.forEach((nEv, nIdx) => {
    const cIdx = cur.findIndex(
      (cEv, idx) =>
        !matchedCurIdx.has(idx) &&
        cEv.term === nEv.term &&
        (cEv.eventKey === nEv.eventKey || titlesSimilar(cEv.title, nEv.title))
    );
    if (cIdx !== -1) {
      matchedCurIdx.add(cIdx);
      matchedNextIdx.add(nIdx);
      const cEv = cur[cIdx];
      if (cEv.startDate !== nEv.startDate || cEv.endDate !== nEv.endDate || cEv.title !== nEv.title) {
        moved.push({
          id: `mov-${cEv.eventKey}`,
          prev: cEv,
          next: { ...nEv, eventKey: cEv.eventKey },
          checked: true,
        });
      } else {
        unchanged.push(nEv);
      }
    }
  });

  nextList.forEach((nEv, nIdx) => {
    if (!matchedNextIdx.has(nIdx)) {
      added.push({ id: `add-${nEv.eventKey}`, event: nEv, checked: true });
    }
  });

  cur.forEach((cEv, cIdx) => {
    if (!matchedCurIdx.has(cIdx)) {
      if (nextTerms.size === 0 || nextTerms.has(cEv.term)) {
        removed.push({ id: `rem-${cEv.eventKey}`, event: cEv, checked: true });
      } else {
        unchanged.push(cEv);
      }
    }
  });

  return { moved, added, removed, unchanged };
}

/** Merge confirmed diff items back into an updated events array. */
export function applyCalendarDiffSelection(currentEvents = [], diff) {
  const movedByKey = new Map();
  for (const m of diff.moved || []) {
    if (m.checked) movedByKey.set(m.prev.eventKey, m.next);
  }
  const removeKeys = new Set(
    (diff.removed || []).filter(r => r.checked).map(r => r.event.eventKey)
  );
  const out = [];
  for (const ev of currentEvents) {
    if (removeKeys.has(ev.eventKey)) continue;
    if (movedByKey.has(ev.eventKey)) {
      out.push(movedByKey.get(ev.eventKey));
    } else {
      out.push(ev);
    }
  }
  for (const a of diff.added || []) {
    if (a.checked && !out.some(e => e.eventKey === a.event.eventKey)) {
      out.push(a.event);
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function safeParseJsonObject(raw) {
  const clean = String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Extract a structured School Calendar or Mid-Semester Revision Patch from
 * an uploaded image, PDF/DOCX/TXT file, or pasted memo text.
 */
export async function extractSchoolCalendarFromInput({
  file = null,
  imageDataUrl = '',
  text = '',
  mode = 'new',
  existingCalendar = null,
}) {
  let docText = String(text || '').trim();
  let finalImageUrl = imageDataUrl || '';

  if (file) {
    const isImage =
      file.type?.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(file.name || '');
    if (isImage && !finalImageUrl) {
      finalImageUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read calendar image'));
        reader.readAsDataURL(file);
      });
    } else if (!isImage) {
      const imp = await extractDocument(file);
      docText = [docText, imp?.rawMarkdown || imp?.text || ''].filter(Boolean).join('\n\n');
    }
  }

  // Case A: Image upload -> Vision AI extraction
  if (finalImageUrl) {
    const baseYearHint = existingCalendar?.academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    const sys =
      'You extract official university academic calendars accurately into JSON. Return ONLY valid JSON (no markdown fences).';
    const userPrompt = `Read this official school academic calendar carefully (including header AY e.g. ${baseYearHint}, ALL terms like First Semester, Second Semester, Summer, Enrollment Schedule, Holidays, and Exam periods).
Critical rules:
1. If event lines omit the year (e.g. "November 23" or "January 4"), infer the year from the Academic Year header (Jul-Dec -> start year, Jan-Jun -> end year).
2. Convert cross-month ranges like "Oct 29-Nov 7" into exact YYYY-MM-DD startDate and endDate.
3. For each event set term: "first" | "second" | "summer" | "enrollment".
4. Set audience: "grad" ONLY if specifically for Graduate Students; "undergrad" if Non-Grad/Undergrad; otherwise "all".
5. Set kind: "exam" | "holiday" | "no-class" | "milestone" | "deadline" | "event".
Return JSON schema:
{
  "schoolName": "...",
  "academicYear": "2026-2027",
  "startYear": 2026,
  "endYear": 2027,
  "events": [
    { "term": "first", "title": "...", "startDate": "2026-07-08", "endDate": "2026-07-08", "kind": "milestone", "audience": "all" }
  ]
}`;
    const raw = await aiVision({
      system: sys,
      user: userPrompt,
      imageDataUrl: finalImageUrl,
      maxTokens: 3200,
    });
    const json = safeParseJsonObject(raw);
    if (!json || !Array.isArray(json.events) || json.events.length === 0) {
      throw new Error('Could not extract calendar events from this image. Try a clearer photo or paste text.');
    }
    const span = detectAcademicYearSpan(`${json.academicYear || ''} ${baseYearHint}`);
    const startYear = Number(json.startYear) || span.startYear;
    const endYear = Number(json.endYear) || span.endYear;
    const events = json.events
      .map(ev => normalizeEventObject(ev, { startYear, endYear }))
      .filter(Boolean);
    return {
      isPartialPatch: false,
      schoolName: json.schoolName || existingCalendar?.schoolName || 'School Calendar',
      academicYear: json.academicYear || span.academicYear,
      startYear,
      endYear,
      events,
      patches: [],
    };
  }

  // Case B: Revision memo / short text update
  if (mode === 'revise' && existingCalendar && docText.split('\n').length <= 12 && !/first\s+semester[\s\S]+second\s+semester/i.test(docText)) {
    const offlinePatches = parsePartialRevisionMemoOffline(docText, existingCalendar);
    if (offlinePatches.length > 0) {
      return {
        isPartialPatch: true,
        schoolName: existingCalendar.schoolName,
        academicYear: existingCalendar.academicYear,
        startYear: existingCalendar.startYear,
        endYear: existingCalendar.endYear,
        events: [],
        patches: offlinePatches,
      };
    }

    // AI partial revision memo fallback
    const existingList = (existingCalendar.events || [])
      .map(e => `- [${e.term}] ${e.title}: ${e.startDate} to ${e.endDate}`)
      .join('\n');
    const raw = await aiText({
      system:
        'You convert a school calendar revision memo into structured JSON patches against the existing calendar. Return ONLY JSON.',
      user: `Academic Year: ${existingCalendar.academicYear}, Active Term: ${existingCalendar.activeTerm}.
Existing events:
${existingList}

Revision memo:
${docText}

Return JSON:
{ "patches": [ { "action": "move"|"add"|"remove", "targetTitle": "existing title if move/remove", "term": "first"|"second"|"summer", "title": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "kind": "exam"|"holiday"|"no-class"|"milestone"|"event"|"deadline" } ] }`,
      task: 'fast',
      maxTokens: 2048,
    });
    const json = safeParseJsonObject(raw);
    if (json && Array.isArray(json.patches) && json.patches.length > 0) {
      return {
        isPartialPatch: true,
        schoolName: existingCalendar.schoolName,
        academicYear: existingCalendar.academicYear,
        startYear: existingCalendar.startYear,
        endYear: existingCalendar.endYear,
        events: [],
        patches: json.patches,
      };
    }
    throw new Error('Could not detect any date changes in that revision memo.');
  }

  // Case C: Full PDF or full calendar text -> offline parser first, AI fallback if sparse
  const offlineParsed = parseSchoolCalendarText(docText);
  if (offlineParsed.events.length >= 3) {
    return {
      isPartialPatch: false,
      ...offlineParsed,
      patches: [],
    };
  }

  if (docText.length >= 20) {
    const span = detectAcademicYearSpan(docText);
    const raw = await aiText({
      system:
        'Extract all official academic calendar dates into clean JSON. Infer year from AY header (Jul-Dec = startYear, Jan-Jun = endYear). Return ONLY valid JSON.',
      user: `Calendar text (${span.academicYear}):\n${docText.slice(0, 12000)}\n\nReturn:\n{ "schoolName": "...", "academicYear": "${span.academicYear}", "startYear": ${span.startYear}, "endYear": ${span.endYear}, "events": [{ "term": "first"|"second"|"summer", "title": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "kind": "exam"|"holiday"|"no-class"|"milestone"|"deadline"|"event", "audience": "all"|"undergrad"|"grad" }] }`,
      task: 'fast',
      maxTokens: 3200,
    });
    const json = safeParseJsonObject(raw);
    if (json && Array.isArray(json.events) && json.events.length > 0) {
      const sy = Number(json.startYear) || span.startYear;
      const ey = Number(json.endYear) || span.endYear;
      const events = json.events.map(ev => normalizeEventObject(ev, { startYear: sy, endYear: ey })).filter(Boolean);
      return {
        isPartialPatch: false,
        schoolName: json.schoolName || offlineParsed.schoolName,
        academicYear: json.academicYear || span.academicYear,
        startYear: sy,
        endYear: ey,
        activeTerm: detectActiveTermForDate(events),
        events,
        patches: [],
      };
    }
  }

  throw new Error('No calendar dates found. Upload a clearer file/photo or paste lines like "Feb 1-6 Midterm Examination".');
}

/**
 * Filter events according to active term, grad toggle, and admin deadline toggle.
 */
export function filterCalendarEventsForDisplay(calendar) {
  if (!calendar || !Array.isArray(calendar.events)) return [];
  const activeTerm = calendar.activeTerm || 'second';
  const includeGrad = Boolean(calendar.includeGradExams);
  const showAdminDeadlines = calendar.showAdminDeadlines !== false;
  return calendar.events.filter(ev => {
    if (ev.term && ev.term !== activeTerm && ev.term !== 'enrollment') return false;
    if (!includeGrad && ev.audience === 'grad') return false;
    if (!showAdminDeadlines && ev.kind === 'deadline') return false;
    return true;
  });
}

/**
 * Save/update a `schoolCalendars` record and safely sync its active-term events to `db.plannerItems`
 * using `source: 'school-calendar'` without modifying personal tasks or Canvas items.
 */
export async function saveAndSyncSchoolCalendar(calendarPayload) {
  const now = Date.now();
  const prevRows = await db.schoolCalendars.toArray().catch(() => []);
  for (const r of prevRows) {
    if (r.id !== calendarPayload.id && r.active) {
      await db.schoolCalendars.update(r.id, { active: 0 }).catch(() => {});
    }
  }

  const record = {
    schoolName: calendarPayload.schoolName || 'School Calendar',
    academicYear: calendarPayload.academicYear || '',
    startYear: Number(calendarPayload.startYear) || new Date().getFullYear(),
    endYear: Number(calendarPayload.endYear) || new Date().getFullYear() + 1,
    activeTerm: calendarPayload.activeTerm || detectActiveTermForDate(calendarPayload.events),
    includeGradExams: Boolean(calendarPayload.includeGradExams),
    showAdminDeadlines: calendarPayload.showAdminDeadlines !== false,
    version: Number(calendarPayload.version) || 1,
    active: 1,
    revisions: Array.isArray(calendarPayload.revisions) ? calendarPayload.revisions : [],
    events: Array.isArray(calendarPayload.events) ? calendarPayload.events : [],
    updatedAt: now,
  };

  let calId = calendarPayload.id;
  if (calId) {
    await db.schoolCalendars.update(calId, record);
  } else {
    calId = await db.schoolCalendars.add(record);
  }
  const saved = await db.schoolCalendars.get(calId);

  // Sync ONLY source === 'school-calendar' plannerItems (so exams trigger countdowns/notifications)
  const visibleEvents = filterCalendarEventsForDisplay(saved);
  const existingSynced = await db.plannerItems
    .where('source')
    .equals('school-calendar')
    .toArray()
    .catch(() => []);
  const byUid = new Map(existingSynced.map(it => [it.externalUid, it]));
  const wantedUids = new Set();

  for (const ev of visibleEvents) {
    const uid = `schoolcal:${calId}:${ev.eventKey}`;
    wantedUids.add(uid);
    const plannerType = ev.kind === 'exam' ? 'exam' : 'todo';
    const timeLabel =
      ev.endDate && ev.endDate !== ev.startDate
        ? `Thru ${ev.endDate}`
        : ev.kind === 'holiday'
          ? 'Holiday'
          : ev.kind === 'no-class'
            ? 'No Classes'
            : 'School Calendar';
    const payload = {
      title: ev.title,
      course: saved.schoolName || 'School Calendar',
      type: plannerType,
      source: 'school-calendar',
      calendarKind: ev.kind,
      endDateKey: ev.endDate || ev.startDate,
      externalUid: uid,
      dateKey: ev.startDate,
      timeLabel,
      dueAt: new Date(`${ev.startDate}T08:00:00`).getTime(),
      description: ev.notes || '',
      done: false,
      priority: ev.kind === 'exam' ? 'high' : 'normal',
      updatedAt: now,
    };
    const prev = byUid.get(uid);
    if (prev) {
      await db.plannerItems.update(prev.id, { ...payload, done: Boolean(prev.done) });
    } else {
      await db.plannerItems.add({ ...payload, createdAt: now });
    }
  }

  // Delete school-calendar plannerItems that were removed or switched to another term
  for (const old of existingSynced) {
    if (!wantedUids.has(old.externalUid)) {
      await db.plannerItems.delete(old.id).catch(() => {});
    }
  }

  return saved;
}

/** Return school calendar events covering a specific `dateKey` (`startDate <= dateKey <= endDate`). */
export function getCalendarEventsForDate(calendar, dateKey) {
  return filterCalendarEventsForDisplay(calendar).filter(
    ev => ev.startDate <= dateKey && dateKey <= (ev.endDate || ev.startDate)
  );
}

/** Compute next upcoming exam & next holiday from the active school calendar. */
export function getUpcomingCalendarHighlights(calendar, todayKey = localDateKey()) {
  const events = filterCalendarEventsForDisplay(calendar)
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const nextExam = events.find(ev => ev.kind === 'exam' && (ev.endDate || ev.startDate) >= todayKey) || null;
  const nextBreak =
    events.find(
      ev => (ev.kind === 'holiday' || ev.kind === 'no-class') && (ev.endDate || ev.startDate) >= todayKey
    ) || null;
  const activeToday = events.filter(ev => ev.startDate <= todayKey && todayKey <= (ev.endDate || ev.startDate));
  return { nextExam, nextBreak, activeToday };
}
