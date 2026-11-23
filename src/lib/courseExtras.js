/**
 * courseExtras — Core engines for v1.9.0 Canvas-inspired Student Superpowers:
 * 1. Auto-Pinned Course Links extractor + 1-Tap Public Google Docs / Slides Link Importer
 * 2. Per-Course Grades, Syllabus Weights, Canvas "What-If" Grade Simulator & Semester GWA/GPA
 * 3. Customizable Class Attendance / Absence Guard (PH CHED 20% rule presets + Lates-to-Absence)
 * 4. Pre-Submit AI Rubric Checker
 */
import { fetchCanvasText } from './canvasSync';
import { percentToPhGwa, percentToUsGpa } from './gradeCalc';
import { aiText } from './aiCore';

export const WORKFLOW_STATUSES = [
  { id: 'not_started', label: 'Not Started' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'graded', label: 'Graded' },
];

export const DEFAULT_COURSE_WEIGHTS = [
  { id: 'quizzes', name: 'Quizzes & Activities', weight: 25 },
  { id: 'labs', name: 'Labs / Assignments', weight: 25 },
  { id: 'midterm', name: 'Midterm Exam', weight: 25 },
  { id: 'finals', name: 'Final Exam', weight: 25 },
];

export const ATTENDANCE_PRESETS = [
  { id: 'mwf', label: 'MWF (3x/wk)', maxAbsences: 10, latesPerAbsence: 3 },
  { id: 'tth', label: 'TTh (2x/wk)', maxAbsences: 7, latesPerAbsence: 3 },
  { id: 'once', label: '1x/wk / Lab', maxAbsences: 3, latesPerAbsence: 3 },
];

/** Classify an external URL into a clean badge label for the Course Links pinboard. */
export function classifyCourseLink(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('chat.google.com')) return { kind: 'Google Chat', importable: false };
  if (u.includes('docs.google.com/document/')) return { kind: 'Google Doc', importable: true };
  if (u.includes('docs.google.com/presentation/')) return { kind: 'Google Slides', importable: true };
  if (u.includes('drive.google.com')) return { kind: 'Google Drive', importable: false };
  if (u.includes('meet.google.com')) return { kind: 'Google Meet', importable: false };
  if (u.includes('zoom.us')) return { kind: 'Zoom', importable: false };
  if (u.includes('github.com')) return { kind: 'GitHub', importable: false };
  if (u.includes('instructure.com')) return { kind: 'Canvas', importable: false };
  if (u.includes('youtu.be') || u.includes('youtube.com')) return { kind: 'YouTube', importable: false };
  return { kind: 'Link', importable: false };
}

/**
 * Convert a public ("Anyone with link") Google Docs or Google Slides URL into its
 * clean plain-text export URL so Android phones can import it directly via CapacitorHttp!
 */
export function getPublicGoogleExportUrl(rawUrl) {
  const u = String(rawUrl || '').trim();
  const docMatch = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i.exec(u);
  if (docMatch) {
    return {
      exportUrl: `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`,
      kind: 'Google Doc',
      docId: docMatch[1],
    };
  }
  const slideMatch = /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/i.exec(u);
  if (slideMatch) {
    return {
      exportUrl: `https://docs.google.com/presentation/d/${slideMatch[1]}/export/txt`,
      kind: 'Google Slides',
      docId: slideMatch[1],
    };
  }
  return null;
}

/**
 * Extract & deduplicate all external links posted inside a course's Canvas Announcements
 * (both Markdown `[Label](https://...)` links and bare URLs).
 */
export function extractCourseLinks(announcements = []) {
  const byUrl = new Map();
  const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  const bareUrlRe = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

  for (const ann of announcements) {
    const text = String(ann?.description || '');
    let m;
    while ((m = mdLinkRe.exec(text)) !== null) {
      const label = m[1].trim();
      const url = m[2].trim().replace(/[.,;!?]+$/, '');
      if (!byUrl.has(url)) {
        const meta = classifyCourseLink(url);
        byUrl.set(url, {
          url,
          label: label || meta.kind,
          kind: meta.kind,
          importable: meta.importable,
          fromTitle: ann.title || '',
          dateKey: ann.dateKey || '',
        });
      }
    }
    const withoutMd = text.replace(mdLinkRe, ' ');
    let bm;
    while ((bm = bareUrlRe.exec(withoutMd)) !== null) {
      const url = bm[0].trim().replace(/[.,;!?]+$/, '');
      if (!byUrl.has(url)) {
        const meta = classifyCourseLink(url);
        byUrl.set(url, {
          url,
          label: meta.kind === 'Link' ? url.replace(/^https?:\/\//i, '').slice(0, 42) : `${meta.kind} Link`,
          kind: meta.kind,
          importable: meta.importable,
          fromTitle: ann.title || '',
          dateKey: ann.dateKey || '',
        });
      }
    }
  }
  return [...byUrl.values()];
}

/**
 * Fetch a public ("Anyone with link") Google Doc or Google Slides text export natively on Android/Web.
 */
export async function importPublicGoogleLink(rawUrl) {
  const info = getPublicGoogleExportUrl(rawUrl);
  if (!info) {
    throw new Error('Paste a public Google Docs or Google Slides link (docs.google.com/document/d/... or /presentation/d/...).');
  }
  const text = await fetchCanvasText(info.exportUrl);
  const clean = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!clean || /^<!doctype html|<html/i.test(clean)) {
    throw new Error(
      'This Google file requires sign-in (not set to "Anyone with the link"). Download it from Google Drive and tap Share → Notes by Bai!'
    );
  }
  const firstLine = clean.split(/\r?\n/).map(l => l.trim()).find(Boolean) || info.kind;
  return {
    title: firstLine.slice(0, 72),
    extractedText: clean,
    kind: info.kind === 'Google Slides' ? 'pptx' : 'docx',
    pageCount: Math.max(1, Math.ceil(clean.length / 2400)),
  };
}

/**
 * Compute live Per-Course Grade standing (percentage, PH GWA, US GPA) supporting:
 * - Weighted categories (syllabus weights) OR unweighted points fallback
 * - Canvas "What-If" temporary overrides (`whatIfMap: { [entryId]: percentOrEarned }`)
 */
export function computeCourseGrade({
  weights = DEFAULT_COURSE_WEIGHTS,
  entries = [],
  whatIfMap = {},
}) {
  const cats = Array.isArray(weights) && weights.length > 0 ? weights : DEFAULT_COURSE_WEIGHTS;
  const byCat = new Map(cats.map(c => [c.id, { ...c, earned: 0, possible: 0, count: 0 }]));

  let totalEarnedAll = 0;
  let totalPossibleAll = 0;

  for (const e of entries) {
    const possible = Number(e.possible);
    if (!Number.isFinite(possible) || possible <= 0) continue;
    const override = whatIfMap[e.id];
    const hasOverride = override !== undefined && override !== '' && Number.isFinite(Number(override));
    const earned = hasOverride ? Number(override) : Number(e.earned);
    if (!hasOverride && (e.earned === '' || e.earned === null || e.earned === undefined || !Number.isFinite(earned))) {
      continue;
    }

    totalEarnedAll += earned;
    totalPossibleAll += possible;

    const bucket = byCat.get(e.categoryId) || byCat.values().next().value;
    if (bucket) {
      bucket.earned += earned;
      bucket.possible += possible;
      bucket.count += 1;
    }
  }

  let weightedSum = 0;
  let activeWeight = 0;
  const breakdown = [];

  for (const b of byCat.values()) {
    const w = Math.max(0, Number(b.weight) || 0);
    const pct = b.possible > 0 ? (b.earned / b.possible) * 100 : null;
    if (pct !== null && w > 0) {
      weightedSum += (pct * w) / 100;
      activeWeight += w;
    }
    breakdown.push({
      id: b.id,
      name: b.name,
      weight: w,
      count: b.count,
      percent: pct !== null ? Math.round(pct * 10) / 10 : null,
    });
  }

  let standing = null;
  if (activeWeight > 0) {
    standing = (weightedSum / activeWeight) * 100;
  } else if (totalPossibleAll > 0) {
    standing = (totalEarnedAll / totalPossibleAll) * 100;
  }

  const rounded = standing !== null ? Math.round(standing * 10) / 10 : null;
  return {
    standing: rounded,
    completedWeight: Math.round(activeWeight * 10) / 10,
    remainingWeight: Math.max(0, Math.round((100 - activeWeight) * 10) / 10),
    phGwa: rounded !== null ? percentToPhGwa(rounded) : null,
    usGpa: rounded !== null ? percentToUsGpa(rounded) : null,
    breakdown,
  };
}

/** Roll up all graded courses into an overall Semester PH GWA & US GPA. */
export function computeSemesterGwa(courseStandings = []) {
  const valid = courseStandings.filter(c => c && typeof c.standing === 'number' && Number.isFinite(c.standing));
  if (valid.length === 0) return null;
  let totalUnits = 0;
  let weightedPh = 0;
  let weightedUs = 0;
  let weightedPct = 0;
  for (const c of valid) {
    const units = Math.max(1, Number(c.units) || 3);
    totalUnits += units;
    weightedPh += percentToPhGwa(c.standing) * units;
    weightedUs += percentToUsGpa(c.standing) * units;
    weightedPct += c.standing * units;
  }
  return {
    courseCount: valid.length,
    avgPercent: Math.round((weightedPct / totalUnits) * 10) / 10,
    phGwa: Math.round((weightedPh / totalUnits) * 100) / 100,
    usGpa: Math.round((weightedUs / totalUnits) * 100) / 100,
  };
}

/**
 * Compute exact PH College Attendance / FDA Guard status.
 * `effectiveAbsences = absences + floor(lates / latesPerAbsence)` (when latesPerAbsence > 0).
 */
export function computeAttendanceStatus(att = {}) {
  const absences = Math.max(0, Number(att.absences) || 0);
  const lates = Math.max(0, Number(att.lates) || 0);
  const maxAbsences = Math.max(1, Number(att.maxAbsences) || 7);
  const latesPerAbsence = Math.max(0, Number(att.latesPerAbsence ?? 3));

  const latePenalty = latesPerAbsence > 0 ? Math.floor(lates / latesPerAbsence) : 0;
  const effectiveAbsences = absences + latePenalty;
  const remaining = maxAbsences - effectiveAbsences;
  const pctUsed = Math.min(100, Math.round((effectiveAbsences / maxAbsences) * 100));

  let riskLevel = 'ok';
  if (remaining <= 0) riskLevel = 'danger';
  else if (remaining <= 2 || pctUsed >= 70) riskLevel = 'warn';

  return {
    absences,
    lates,
    latePenalty,
    effectiveAbsences,
    maxAbsences,
    latesPerAbsence,
    remaining,
    pctUsed,
    riskLevel,
  };
}

/** Pre-Submit AI Rubric Checker — evaluates a student's draft against teacher rubric criteria before submitting on Canvas. */
export async function evaluateAgainstRubric({
  courseName = 'Course',
  assignmentTitle = 'Assignment',
  rubricText = '',
  draftText = '',
  signal = null,
}) {
  if (!rubricText.trim() || !draftText.trim()) {
    throw new Error('Paste both the assignment rubric/instructions and your draft first.');
  }
  return aiText({
    system: `You are a fair, constructive college professor reviewing a student's draft BEFORE they submit it on Canvas for "${courseName}".
Grade the draft strictly against the provided Rubric / Prompt.
Return clean Markdown with:
1. **Estimated Score**: e.g. \`88 / 100\`
2. **Rubric Breakdown**: bullet list checking each criterion (✅ Met / ⚠️ Partial / ❌ Missing) with 1-sentence reason.
3. **Top 3 Fixes Before Submitting**: concrete, specific edits that will boost their score immediately.`,
    user: `Assignment: ${assignmentTitle}\n\nTeacher Prompt / Rubric:\n${rubricText.slice(0, 3500)}\n\nStudent Draft:\n${draftText.slice(0, 5500)}`,
    maxTokens: 1400,
    signal,
  });
}
