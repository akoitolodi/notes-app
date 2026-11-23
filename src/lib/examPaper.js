/**
 * Exam Paper Builder Engine — mix-and-match 8 classic college exam types,
 * resilient AI JSON parser, instant offline auto-grading for objective parts,
 * and optional 1-call AI grading for Problem Solving, Scenario & Essay answers.
 */
import { aiText } from './aiCore';
import { parseJsonObject } from '../../shared/aiParsers.js';

export const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const EXAM_SECTION_TYPES = [
  {
    type: 'mcq',
    label: 'Multiple Choice',
    shortLabel: 'MC',
    defaultEnabled: true,
    defaultCount: 5,
    min: 1,
    max: 25,
    pointsEach: 1,
    objective: true,
    directions: 'Choose the letter of the best answer for each item.',
  },
  {
    type: 'true_false',
    label: 'True or False',
    shortLabel: 'T/F',
    defaultEnabled: true,
    defaultCount: 5,
    min: 1,
    max: 20,
    pointsEach: 1,
    objective: true,
    directions: 'Select TRUE if the statement is correct, or FALSE if it is incorrect.',
  },
  {
    type: 'identification',
    label: 'Identification',
    shortLabel: 'ID',
    defaultEnabled: true,
    defaultCount: 5,
    min: 1,
    max: 20,
    pointsEach: 1,
    objective: true,
    directions: 'Write the exact term, concept, or name described by each item on the blank.',
  },
  {
    type: 'matching',
    label: 'Matching Type',
    shortLabel: 'Match',
    defaultEnabled: false,
    defaultCount: 5,
    min: 3,
    max: 12,
    pointsEach: 1,
    objective: true,
    directions: 'Match each item in Column A with the best corresponding option in Column B.',
  },
  {
    type: 'enumeration',
    label: 'Enumeration',
    shortLabel: 'Enum',
    defaultEnabled: false,
    defaultCount: 2,
    min: 1,
    max: 8,
    pointsEach: 3,
    objective: true,
    directions: 'Enumerate the required items clearly on the numbered blanks.',
  },
  {
    type: 'problem_solving',
    label: 'Problem Solving / Code',
    shortLabel: 'Solve',
    defaultEnabled: false,
    defaultCount: 2,
    min: 1,
    max: 8,
    pointsEach: 5,
    objective: false,
    directions: 'Show your step-by-step calculation, code trace, or solution inside the box.',
  },
  {
    type: 'scenario',
    label: 'Scenario / Case Study',
    shortLabel: 'Scenario',
    defaultEnabled: false,
    defaultCount: 1,
    min: 1,
    max: 5,
    pointsEach: 5,
    objective: false,
    directions: 'Read the situation carefully and justify your analysis based on key principles.',
  },
  {
    type: 'essay',
    label: 'Short Answer / Essay',
    shortLabel: 'Essay',
    defaultEnabled: false,
    defaultCount: 1,
    min: 1,
    max: 5,
    pointsEach: 5,
    objective: false,
    directions: 'Answer clearly and concisely in complete sentences using evidence from your notes.',
  },
];

export const EXAM_TYPE_MAP = Object.fromEntries(EXAM_SECTION_TYPES.map(t => [t.type, t]));

export function createDefaultExamConfig() {
  const sections = {};
  for (const t of EXAM_SECTION_TYPES) {
    sections[t.type] = { enabled: t.defaultEnabled, count: t.defaultCount, pointsEach: t.pointsEach };
  }
  return { difficulty: 'midterm', sections };
}

export const EXAM_PRESETS = [
  {
    id: 'quick',
    label: 'Quick Quiz',
    apply: () => ({
      difficulty: 'standard',
      sections: {
        mcq: { enabled: true, count: 5, pointsEach: 1 },
        true_false: { enabled: true, count: 5, pointsEach: 1 },
        identification: { enabled: false, count: 5, pointsEach: 1 },
        matching: { enabled: false, count: 5, pointsEach: 1 },
        enumeration: { enabled: false, count: 2, pointsEach: 3 },
        problem_solving: { enabled: false, count: 2, pointsEach: 5 },
        scenario: { enabled: false, count: 1, pointsEach: 5 },
        essay: { enabled: false, count: 1, pointsEach: 5 },
      },
    }),
  },
  {
    id: 'midterm',
    label: 'College Midterm',
    apply: () => ({
      difficulty: 'midterm',
      sections: {
        mcq: { enabled: true, count: 8, pointsEach: 1 },
        true_false: { enabled: true, count: 5, pointsEach: 1 },
        identification: { enabled: true, count: 5, pointsEach: 1 },
        matching: { enabled: true, count: 5, pointsEach: 1 },
        enumeration: { enabled: false, count: 2, pointsEach: 3 },
        problem_solving: { enabled: true, count: 2, pointsEach: 5 },
        scenario: { enabled: false, count: 1, pointsEach: 5 },
        essay: { enabled: false, count: 1, pointsEach: 5 },
      },
    }),
  },
  {
    id: 'comprehensive',
    label: 'Full Final Exam',
    apply: () => ({
      difficulty: 'final',
      sections: {
        mcq: { enabled: true, count: 10, pointsEach: 1 },
        true_false: { enabled: true, count: 5, pointsEach: 1 },
        identification: { enabled: true, count: 5, pointsEach: 1 },
        matching: { enabled: false, count: 5, pointsEach: 1 },
        enumeration: { enabled: true, count: 2, pointsEach: 3 },
        problem_solving: { enabled: true, count: 1, pointsEach: 5 },
        scenario: { enabled: true, count: 1, pointsEach: 5 },
        essay: { enabled: true, count: 1, pointsEach: 5 },
      },
    }),
  },
];

export function computeExamTotals(config) {
  let totalItems = 0;
  let totalPoints = 0;
  const activeSections = [];
  for (const meta of EXAM_SECTION_TYPES) {
    const cfg = config?.sections?.[meta.type];
    if (cfg?.enabled && cfg.count > 0) {
      const pts = Number(cfg.pointsEach) || meta.pointsEach;
      totalItems += cfg.count;
      totalPoints += cfg.count * pts;
      activeSections.push({ ...meta, count: cfg.count, pointsEach: pts });
    }
  }
  return { totalItems, totalPoints, activeSections };
}

/** Normalize answers for fuzzy-but-fair offline comparison. */
export function normalizeTextAnswer(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[^\w\s+/#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sanitize and normalize AI exam JSON into a rock-solid bond-paper structure. */
export function parseExamPaperJson(raw, { title = 'Practice Examination', subtitle = '', difficulty = 'midterm' } = {}) {
  const data = typeof raw === 'string' ? parseJsonObject(raw) : raw || {};
  const rawParts = Array.isArray(data.parts) ? data.parts : [];
  const parts = [];

  for (const p of rawParts) {
    if (!p || !EXAM_TYPE_MAP[p.type] || !Array.isArray(p.items) || p.items.length === 0) continue;
    const meta = EXAM_TYPE_MAP[p.type];
    const pointsEach = Number(p.pointsEach) > 0 ? Number(p.pointsEach) : meta.pointsEach;

    if (p.type === 'matching') {
      const colB = Array.isArray(p.columnB)
        ? p.columnB
            .filter(c => c && (c.letter || c.text))
            .map((c, idx) => ({
              letter: String(c.letter || String.fromCharCode(65 + idx)).trim().toUpperCase().slice(0, 2),
              text: String(c.text || '').trim(),
            }))
        : [];
      const items = p.items
        .filter(it => it && (it.prompt || it.question))
        .map(it => ({
          prompt: String(it.prompt || it.question).trim(),
          answerLetter: String(it.answerLetter || it.answer || 'A').trim().toUpperCase().slice(0, 2),
          explanation: String(it.explanation || '').trim(),
        }));
      if (items.length > 0 && colB.length > 0) {
        parts.push({
          type: 'matching',
          heading: p.heading || meta.label,
          directions: p.directions || meta.directions,
          pointsEach,
          columnB: colB,
          items,
        });
      }
      continue;
    }

    const items = [];
    for (const it of p.items) {
      if (!it) continue;
      if (p.type === 'mcq') {
        const choices = Array.isArray(it.choices) ? it.choices.map(String).filter(Boolean) : [];
        if (!it.question || choices.length < 2) continue;
        const idx = Number(it.answerIndex ?? it.answer);
        items.push({
          question: String(it.question).trim(),
          choices,
          answerIndex: Number.isInteger(idx) && idx >= 0 && idx < choices.length ? idx : 0,
          explanation: String(it.explanation || '').trim(),
        });
      } else if (p.type === 'true_false') {
        const stmt = String(it.statement || it.question || '').trim();
        if (!stmt) continue;
        const ansBool =
          typeof it.answer === 'boolean'
            ? it.answer
            : String(it.answer || '').toLowerCase() === 'true';
        items.push({
          statement: stmt,
          answer: ansBool,
          explanation: String(it.explanation || '').trim(),
        });
      } else if (p.type === 'identification') {
        const q = String(it.question || it.clue || '').trim();
        const ans = String(it.answer || '').trim();
        if (!q || !ans) continue;
        items.push({
          question: q,
          answer: ans,
          acceptable: Array.isArray(it.acceptable) ? it.acceptable.map(String).filter(Boolean) : [],
          explanation: String(it.explanation || '').trim(),
        });
      } else if (p.type === 'enumeration') {
        const q = String(it.question || it.prompt || '').trim();
        const expected = Array.isArray(it.answers) ? it.answers.map(String).filter(Boolean) : [];
        if (!q || expected.length === 0) continue;
        items.push({
          question: q,
          answers: expected,
          explanation: String(it.explanation || '').trim(),
        });
      } else if (p.type === 'problem_solving' || p.type === 'scenario' || p.type === 'essay') {
        const q = String(it.question || it.prompt || '').trim();
        if (!q) continue;
        items.push({
          scenario: p.type === 'scenario' ? String(it.scenario || '').trim() : '',
          question: q,
          solution: String(it.solution || it.modelAnswer || it.answer || '').trim(),
          rubric: Array.isArray(it.rubric) ? it.rubric.map(String).filter(Boolean) : [],
        });
      }
    }

    if (items.length > 0) {
      parts.push({
        type: p.type,
        heading: p.heading || meta.label,
        directions: p.directions || meta.directions,
        pointsEach,
        items,
      });
    }
  }

  return {
    title: String(data.title || title).trim(),
    subtitle: String(subtitle || data.subtitle || '').trim(),
    difficulty,
    parts,
    generatedAt: Date.now(),
  };
}

/** Generate a complete multi-part bond-paper exam from note(s) in 1 compact AI call. */
export async function generateExamPaper({
  examTitle,
  subtitle = '',
  subject = 'General',
  notesText,
  config,
  signal = null,
}) {
  const { activeSections } = computeExamTotals(config);
  if (activeSections.length === 0) {
    throw new Error('Select at least one test type before generating the exam.');
  }
  const cleanNotes = String(notesText || '').trim();
  if (!cleanNotes) {
    throw new Error('Add some content to your note(s) first.');
  }

  const diffDesc =
    config.difficulty === 'final'
      ? 'Final / Board Exam level — rigorous application, synthesis, edge cases, and subtle distractors.'
      : config.difficulty === 'standard'
        ? 'Standard quiz level — clear definitions, direct comprehension, and core concepts.'
        : 'College Midterm level — balanced mix of conceptual understanding, analysis, and applied problems.';

  const specLines = activeSections
    .map(
      (s, i) =>
        `${i + 1}. type="${s.type}" (${s.label}): EXACTLY ${s.count} item(s), ${s.pointsEach} pt(s) each`
    )
    .join('\n');

  const sys = `You are a university professor crafting a realistic, well-written college examination paper strictly grounded in the student's provided notes.

DIFFICULTY: ${diffDesc}

STRICT RULES:
- Base EVERY question strictly on the provided notes (for math/coding problem solving, you may create fresh numerical/code variations testing the exact concepts in the notes).
- Write in the same language as the notes.
- Follow the EXACT requested types and item counts.
- Output ONLY valid JSON (no markdown fences, no commentary) matching this schema:
{
  "title": "${examTitle || `${subject} Examination`}",
  "parts": [
    // Include ONLY the requested part types in order:
    // For "mcq":
    {"type": "mcq", "heading": "Multiple Choice", "pointsEach": 1, "items": [{"question": "...", "choices": ["A text", "B text", "C text", "D text"], "answerIndex": 0, "explanation": "short rationale"}]},
    // For "true_false":
    {"type": "true_false", "heading": "True or False", "pointsEach": 1, "items": [{"statement": "...", "answer": true, "explanation": "why"}]},
    // For "identification":
    {"type": "identification", "heading": "Identification", "pointsEach": 1, "items": [{"question": "Definition or clue...", "answer": "Exact Term", "acceptable": ["Alt spelling/acronym"], "explanation": "..."}]},
    // For "matching": (include 1-2 extra distractors in columnB!)
    {"type": "matching", "heading": "Matching Type", "pointsEach": 1, "columnB": [{"letter": "A", "text": "..."}, {"letter": "B", "text": "..."}], "items": [{"prompt": "Column A item...", "answerLetter": "A", "explanation": "..."}]},
    // For "enumeration":
    {"type": "enumeration", "heading": "Enumeration", "pointsEach": 3, "items": [{"question": "Enumerate 3 ...", "answers": ["Item 1", "Item 2", "Item 3"], "explanation": "..."}]},
    // For "problem_solving": (use LaTeX $...$ for math or fenced code for coding traces)
    {"type": "problem_solving", "heading": "Problem Solving", "pointsEach": 5, "items": [{"question": "...", "solution": "Step-by-step final answer...", "rubric": ["Point 1", "Point 2"]}]},
    // For "scenario":
    {"type": "scenario", "heading": "Situational Analysis", "pointsEach": 5, "items": [{"scenario": "Short realistic case paragraph...", "question": "What should be done and why?", "solution": "Model analysis...", "rubric": ["Criterion 1", "Criterion 2"]}]},
    // For "essay":
    {"type": "essay", "heading": "Short Answer / Essay", "pointsEach": 5, "items": [{"question": "...", "solution": "Model concise essay answer...", "rubric": ["Key point 1", "Key point 2"]}]}
  ]
}`;

  const user = `SUBJECT: ${subject}
EXAM TITLE: ${examTitle || `${subject} Practice Exam`}

REQUESTED PARTS:
${specLines}

SOURCE NOTES:
---
${cleanNotes.slice(0, 12000)}
---

Generate the complete exam JSON now.`;

  const raw = await aiText({
    system: sys,
    user,
    maxTokens: 4500,
    timeoutMs: 240000,
    signal,
  });

  const parsed = parseExamPaperJson(raw, {
    title: examTitle || `${subject} Examination`,
    subtitle,
    difficulty: config.difficulty,
  });

  if (parsed.parts.length === 0) {
    throw new Error('The AI did not return any valid exam sections. Tap Generate again.');
  }
  return parsed;
}

/**
 * Instant 100% offline auto-grader for all objective sections
 * (MC, True/False, Identification, Matching, Enumeration).
 */
export function gradeExamPaperOffline(paper, answers = {}, writtenScores = {}) {
  const itemResults = {};
  let objectiveEarned = 0;
  let objectiveMax = 0;
  let writtenEarned = 0;
  let writtenMax = 0;
  const writtenKeys = [];

  (paper?.parts || []).forEach((part, pIdx) => {
    const pts = Number(part.pointsEach) || 1;
    (part.items || []).forEach((item, iIdx) => {
      const key = `${pIdx}-${iIdx}`;
      const userVal = answers[key];

      if (part.type === 'mcq') {
        objectiveMax += pts;
        const correct = userVal === item.answerIndex;
        const earned = correct ? pts : 0;
        objectiveEarned += earned;
        itemResults[key] = { correct, earned, max: pts, kind: 'objective' };
      } else if (part.type === 'true_false') {
        objectiveMax += pts;
        const correct = userVal === item.answer;
        const earned = correct ? pts : 0;
        objectiveEarned += earned;
        itemResults[key] = { correct, earned, max: pts, kind: 'objective' };
      } else if (part.type === 'matching') {
        objectiveMax += pts;
        const correct =
          typeof userVal === 'string' &&
          userVal.trim().toUpperCase() === String(item.answerLetter || '').trim().toUpperCase();
        const earned = correct ? pts : 0;
        objectiveEarned += earned;
        itemResults[key] = { correct, earned, max: pts, kind: 'objective' };
      } else if (part.type === 'identification') {
        objectiveMax += pts;
        const normUser = normalizeTextAnswer(userVal);
        const candidates = [item.answer, ...(item.acceptable || [])]
          .map(normalizeTextAnswer)
          .filter(Boolean);
        const correct = Boolean(
          normUser &&
            candidates.some(
              c =>
                normUser === c ||
                (normUser.length >= 4 && c.length >= 4 && (c.includes(normUser) || normUser.includes(c)))
            )
        );
        const earned = correct ? pts : 0;
        objectiveEarned += earned;
        itemResults[key] = { correct, earned, max: pts, kind: 'objective' };
      } else if (part.type === 'enumeration') {
        objectiveMax += pts;
        const expected = (item.answers || []).map(normalizeTextAnswer).filter(Boolean);
        const userList = Array.isArray(userVal)
          ? userVal.map(normalizeTextAnswer).filter(Boolean)
          : [];
        const matchedExpected = new Set();
        for (const u of userList) {
          const hitIdx = expected.findIndex(
            (e, ei) => !matchedExpected.has(ei) && (u === e || (u.length >= 4 && (e.includes(u) || u.includes(e))))
          );
          if (hitIdx !== -1) matchedExpected.add(hitIdx);
        }
        const ratio = expected.length > 0 ? matchedExpected.size / expected.length : 0;
        const earned = Math.round(ratio * pts * 10) / 10;
        objectiveEarned += earned;
        itemResults[key] = {
          correct: matchedExpected.size === expected.length && expected.length > 0,
          partial: matchedExpected.size > 0 && matchedExpected.size < expected.length,
          matchedCount: matchedExpected.size,
          expectedCount: expected.length,
          earned,
          max: pts,
          kind: 'objective',
        };
      } else {
        // Problem Solving, Scenario, Essay
        writtenMax += pts;
        writtenKeys.push(key);
        const existing = writtenScores[key];
        const earned =
          existing && Number.isFinite(Number(existing.earned))
            ? Math.max(0, Math.min(pts, Number(existing.earned)))
            : 0;
        writtenEarned += earned;
        itemResults[key] = {
          earned,
          max: pts,
          graded: Boolean(existing),
          feedback: existing?.feedback || '',
          kind: 'written',
        };
      }
    });
  });

  const totalMax = objectiveMax + writtenMax;
  const totalEarned = Math.round((objectiveEarned + writtenEarned) * 10) / 10;

  return {
    objectiveEarned: Math.round(objectiveEarned * 10) / 10,
    objectiveMax,
    writtenEarned: Math.round(writtenEarned * 10) / 10,
    writtenMax,
    totalEarned,
    totalMax,
    writtenKeys,
    itemResults,
  };
}

/** Optional 1-call AI grader for all Problem Solving, Scenario & Essay answers. */
export async function gradeWrittenAnswersWithAI({ paper, answers, subject = 'General', signal = null }) {
  const payload = [];
  (paper?.parts || []).forEach((part, pIdx) => {
    if (!['problem_solving', 'scenario', 'essay'].includes(part.type)) return;
    const maxPts = Number(part.pointsEach) || 5;
    (part.items || []).forEach((item, iIdx) => {
      const key = `${pIdx}-${iIdx}`;
      payload.push({
        key,
        type: part.type,
        maxPoints: maxPts,
        question: item.scenario ? `${item.scenario}\n${item.question}` : item.question,
        modelSolution: item.solution,
        rubric: item.rubric || [],
        studentAnswer: String(answers[key] || '').trim() || '(no answer written)',
      });
    });
  });

  if (payload.length === 0) return {};

  const sys = `You are a fair university examiner grading a student's written exam answers against the model solutions & rubrics.
OUTPUT ONLY valid JSON:
{"grades": {"<key>": {"earned": <number 0..maxPoints>, "feedback": "1-2 concise sentences explaining score & what to improve"}}}
Give 0 points if the answer is blank or completely off-topic; award fair partial credit for valid reasoning.`;

  const raw = await aiText({
    system: sys,
    user: `SUBJECT: ${subject}\n\nITEMS TO GRADE:\n${JSON.stringify(payload, null, 2).slice(0, 10000)}`,
    maxTokens: 1600,
    timeoutMs: 180000,
    signal,
  });

  const parsed = parseJsonObject(raw);
  const out = {};
  const grades = parsed.grades || parsed;
  for (const item of payload) {
    const g = grades?.[item.key];
    if (g && typeof g === 'object') {
      const earned = Math.max(0, Math.min(item.maxPoints, Number(g.earned) || 0));
      out[item.key] = {
        earned: Math.round(earned * 10) / 10,
        feedback: String(g.feedback || '').trim(),
      };
    }
  }
  return out;
}
