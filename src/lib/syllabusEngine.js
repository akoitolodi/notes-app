/**
 * syllabusEngine — AI Syllabus Analyzer, Relevance-Verified Multi-Source Fetcher,
 * Safe Formula Evaluator, Hybrid 3-Tier Practical Lab Engine, and Applied Mastery Loop.
 */
import { aiText, createAbortController } from './aiCore';
import { getTavilyKey } from './aiConfig';
import { ocrImage } from './aiFeatures';
import { extractDocument, titleFromFilename } from './docImporter';
import { searchWikipedia, searchOpenAlex } from './research';
import { recordLearningSignal } from './learnerMemory';
import {
  db,
  COURSE_PALETTE,
  createFolder,
  createNote,
  saveSyllabus,
  updateSyllabusTopicState,
  getSyllabusTopicCache,
  putSyllabusTopicCache,
  logStudyActivity,
} from '../store/db';
import { parseJsonObject, stripThinking } from '../../shared/aiParsers.js';

export const MASTERY_STATES = ['not_started', 'learned', 'practiced', 'mastered'];

export const MASTERY_META = {
  not_started: { label: 'Not Started', short: 'New', tone: 'neutral' },
  learned: { label: 'Learned', short: 'Learned', tone: 'indigo' },
  practiced: { label: 'Practiced', short: 'Practiced', tone: 'amber' },
  mastered: { label: 'Mastered', short: 'Mastered', tone: 'emerald' },
};

const VALID_LAB_TYPES = new Set([
  'native-code',
  'native-math',
  'native-logic',
  'native-net',
  'native-quant',
  'native-algo',
  'formula-calc',
  'case-simulator',
]);

function slugify(str, fallback = 'topic') {
  const s = String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

/**
 * Pure safe recursive-descent arithmetic expression evaluator for Tier 2 Formula Calculators.
 * Zero eval() / zero new Function() — supports + - * / ^ () and math helpers (sqrt, abs, log, ln, min, max, sin, cos, pow, round).
 */
export function evaluateFormulaSafe(expr, vars = {}) {
  const src = String(expr || '').trim();
  if (!src) return null;

  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < src.length && /[0-9.]/.test(src[i])) {
        num += src[i++];
      }
      const val = Number(num);
      if (!Number.isFinite(val)) return null;
      tokens.push({ type: 'num', val });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
        id += src[i++];
      }
      tokens.push({ type: 'id', val: id });
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      i += 1;
      continue;
    }
    return null;
  }

  let pos = 0;
  const peek = () => tokens[pos] || null;
  const consume = () => tokens[pos++] || null;

  const FUNCS = {
    sqrt: x => Math.sqrt(x),
    abs: x => Math.abs(x),
    ln: x => Math.log(x),
    log: x => Math.log10(x),
    exp: x => Math.exp(x),
    sin: x => Math.sin(x),
    cos: x => Math.cos(x),
    tan: x => Math.tan(x),
    round: x => Math.round(x),
    floor: x => Math.floor(x),
    ceil: x => Math.ceil(x),
    min: (...args) => Math.min(...args),
    max: (...args) => Math.max(...args),
    pow: (a, b) => Math.pow(a, b),
  };

  function parseExpr() {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek().val === '+' || peek().val === '-')) {
      const op = consume().val;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    while (peek()?.type === 'op' && (peek().val === '*' || peek().val === '/')) {
      const op = consume().val;
      const right = parsePower();
      if (op === '/') {
        if (right === 0) return NaN;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parsePower() {
    let base = parseUnary();
    if (peek()?.type === 'op' && peek().val === '^') {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary() {
    if (peek()?.type === 'op' && peek().val === '-') {
      consume();
      return -parseUnary();
    }
    if (peek()?.type === 'op' && peek().val === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'num') {
      consume();
      return t.val;
    }
    if (t.type === 'op' && t.val === '(') {
      consume();
      const val = parseExpr();
      if (peek()?.val === ')') consume();
      return val;
    }
    if (t.type === 'id') {
      consume();
      const lower = t.val.toLowerCase();
      if (peek()?.type === 'op' && peek().val === '(') {
        consume();
        const args = [];
        if (peek()?.val !== ')') {
          args.push(parseExpr());
          while (peek()?.type === 'op' && peek().val === ',') {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek()?.val === ')') consume();
        const fn = FUNCS[lower];
        if (!fn) throw new Error(`Unknown function: ${t.val}`);
        return fn(...args);
      }
      if (lower === 'pi') return Math.PI;
      if (lower === 'e') return Math.E;
      if (Object.prototype.hasOwnProperty.call(vars, t.val)) return Number(vars[t.val]);
      if (Object.prototype.hasOwnProperty.call(vars, lower)) return Number(vars[lower]);
      return 0;
    }
    throw new Error('Invalid token');
  }

  try {
    const out = parseExpr();
    if (pos < tokens.length || !Number.isFinite(out)) return null;
    return Math.round(out * 1e6) / 1e6;
  } catch {
    return null;
  }
}

/** Extract syllabus text from uploaded PDF/DOCX/PPTX/TXT, photo OCR, or pasted text. */
export async function extractSyllabusSource({ file = null, imageFile = null, pastedText = '' } = {}) {
  const pasted = String(pastedText || '').trim();
  if (pasted) {
    return { text: pasted, sourceTitle: 'Pasted Syllabus' };
  }
  if (imageFile) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read syllabus image.'));
      reader.readAsDataURL(imageFile);
    });
    const text = await ocrImage({ imageDataUrl: dataUrl, subject: 'Course Syllabus' });
    if (!text.trim()) throw new Error('Could not detect readable text from this syllabus photo.');
    return { text, sourceTitle: titleFromFilename(imageFile.name || 'Syllabus Photo') };
  }
  if (file) {
    const doc = await extractDocument(file);
    if (!doc?.markdown?.trim()) throw new Error('No readable text found in this syllabus file.');
    return { text: doc.markdown, sourceTitle: doc.title || titleFromFilename(file.name) };
  }
  throw new Error('Upload a PDF/DOCX/PPTX/TXT, take a photo, or paste your syllabus text.');
}

/** Normalize raw parsed syllabus JSON into a rock-solid roadmap schema. */
export function normalizeSyllabusData(rawParsed, fallbackTitle = 'Course Syllabus') {
  const d = rawParsed && typeof rawParsed === 'object' ? rawParsed : {};
  const name = String(d.name || d.courseName || fallbackTitle || 'Course Syllabus').trim();
  const code = String(d.code || d.courseCode || name.split(/\s+/).slice(0, 2).join(' ').toUpperCase())
    .trim()
    .slice(0, 24);
  const domain = String(d.domain || 'general').trim().toLowerCase();
  const overview = String(d.overview || d.description || '').trim();
  const units = Number.isFinite(Number(d.units)) && Number(d.units) > 0 ? Number(d.units) : 3;

  const gradingWeights = Array.isArray(d.gradingWeights)
    ? d.gradingWeights
        .filter(w => w && (w.label || w.name))
        .map(w => ({
          label: String(w.label || w.name).trim(),
          weight: Math.max(0, Math.min(100, Number(w.weight ?? w.pct ?? 0) || 0)),
        }))
        .slice(0, 10)
    : [];

  const assessments = Array.isArray(d.assessments)
    ? d.assessments
        .filter(a => a && a.title)
        .map(a => ({
          title: String(a.title).trim(),
          type: ['exam', 'assignment', 'todo'].includes(a.type) ? a.type : 'exam',
          week: Number.isFinite(Number(a.week)) ? Number(a.week) : null,
          dateHint: String(a.dateHint || a.date || '').trim(),
        }))
        .slice(0, 16)
    : [];

  const seenSlugs = new Set();
  const rawTopics = Array.isArray(d.topics) ? d.topics : [];
  const topics = rawTopics
    .filter(t => t && (t.title || t.name))
    .map((t, idx) => {
      const title = String(t.title || t.name).trim();
      let slug = slugify(t.slug || title, `topic-${idx + 1}`);
      if (seenSlugs.has(slug)) slug = `${slug}-${idx + 1}`;
      seenSlugs.add(slug);

      const labType = VALID_LAB_TYPES.has(t.labType)
        ? t.labType
        : /code|program|algorithm|python|java|sql|html|css|c\+\+/i.test(`${domain} ${title}`)
          ? 'native-code'
          : /subnet|network|firewall|tcp|ip|osi|ethernet/i.test(`${domain} ${title}`)
            ? 'native-net'
            : /logic|algebra|truth|discrete|calculus|equation|function/i.test(`${domain} ${title}`)
              ? 'native-logic'
              : /decision|linear programming|pert|cpm|eoq|queue|quant/i.test(`${domain} ${title}`)
                ? 'native-quant'
                : 'formula-calc';

      return {
        slug,
        week: Number.isFinite(Number(t.week)) ? Math.max(1, Number(t.week)) : idx + 1,
        module: String(t.module || `Module ${Math.floor(idx / 2) + 1}`).trim(),
        title,
        learningObjectives: Array.isArray(t.learningObjectives)
          ? t.learningObjectives.map(String).filter(Boolean).slice(0, 5)
          : [],
        practicalGoal: String(
          t.practicalGoal || `Apply ${title} hands-on with an interactive exercise`
        ).trim(),
        prerequisites: Array.isArray(t.prerequisites)
          ? t.prerequisites.map(String).filter(Boolean).slice(0, 4)
          : [],
        searchQueries:
          Array.isArray(t.searchQueries) && t.searchQueries.length > 0
            ? t.searchQueries.map(String).filter(Boolean).slice(0, 3)
            : [`${name} ${title}`, title],
        domainKeywords: Array.isArray(t.domainKeywords)
          ? t.domainKeywords.map(k => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 10)
          : [],
        labType,
        labLanguage: String(t.labLanguage || 'javascript').toLowerCase().trim(),
        starterTask: String(t.starterTask || '').trim(),
        masteryState: MASTERY_STATES.includes(t.masteryState) ? t.masteryState : 'not_started',
        practicalDone: Boolean(t.practicalDone),
        practicalSummary: String(t.practicalSummary || ''),
        masteryScore: Number.isFinite(Number(t.masteryScore)) ? Number(t.masteryScore) : null,
      };
    });

  return {
    code,
    name,
    domain,
    overview,
    units,
    gradingWeights,
    assessments,
    topics,
  };
}

/** Deep AI Syllabus Analysis (task: 'syllabus'). */
export async function analyzeSyllabusWithAI({
  rawText,
  courseHint = '',
  signal = null,
  onStatus = null,
} = {}) {
  const clean = String(rawText || '').trim();
  if (!clean) throw new Error('Syllabus text is empty.');
  onStatus?.('Analyzing full semester syllabus structure…');

  const sys = `You are an expert academic curriculum architect. Read the ENTIRE course syllabus and extract a complete, accurate semester roadmap.
Rules:
1. Extract EVERY module/week topic in chronological order (do not skip later weeks!).
2. For each topic, provide concrete "learningObjectives", a hands-on "practicalGoal" (how a student actually applies/builds/calculates this topic), "prerequisites", and 2 domain-qualified "searchQueries" (include field context so homonyms like "Tree" -> "Tree data structure computer science" never return botany!).
3. Assign the best "labType" from: "native-code" | "native-math" | "native-logic" | "native-net" | "native-quant" | "native-algo" | "formula-calc" | "case-simulator".
   - Use "formula-calc" for quantitative/math/physics/chem/finance/accounting/econ formulas.
   - Use "case-simulator" for business, law, ethics, biology, history, systems design, or qualitative applied tasks.
4. Extract "gradingWeights" (percentages) and key "assessments" (Midterm, Final, major exams/projects with week number & dateHint YYYY-MM-DD if stated).

OUTPUT ONLY VALID JSON:
{
  "code": "CS 201",
  "name": "Course Title",
  "domain": "computer-science",
  "overview": "2-sentence course summary",
  "units": 3,
  "gradingWeights": [{"label": "Midterm Exam", "weight": 30}],
  "assessments": [{"title": "Midterm Exam", "type": "exam", "week": 9, "dateHint": "2026-10-15"}],
  "topics": [
    {
      "slug": "topic-slug",
      "week": 1,
      "module": "Module 1",
      "title": "Topic Title",
      "learningObjectives": ["..."],
      "practicalGoal": "Concrete hands-on exercise goal",
      "prerequisites": [],
      "searchQueries": ["domain qualified query 1", "query 2"],
      "domainKeywords": ["kw1", "kw2", "kw3"],
      "labType": "formula-calc",
      "labLanguage": "javascript",
      "starterTask": "Short hands-on prompt or starter problem"
    }
  ]
}`;

  const raw = await aiText({
    system: sys,
    user: `${courseHint ? `Course Hint: ${courseHint}\n\n` : ''}SYLLABUS TEXT:\n---\n${clean.slice(0, 16000)}\n---`,
    maxTokens: 4500,
    timeoutMs: 240000,
    task: 'syllabus',
    signal,
  });

  const parsed = parseJsonObject(raw);
  const normalized = normalizeSyllabusData(parsed, courseHint || 'Course Syllabus');
  if (normalized.topics.length === 0) {
    throw new Error('Could not extract topics from this syllabus. Try pasting the weekly outline section.');
  }
  return normalized;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'can', 'will', 'use', 'used', 'using', 'about',
  'introduction', 'overview', 'module', 'week', 'lesson', 'chapter', 'unit', 'course',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Score a fetched external source against the course domain, topic title, keywords, and objectives
 * so homonyms (e.g., botanical trees vs CS data structure trees) are accurately filtered out.
 */
export function scoreSourceRelevance(source, syllabus = {}, topic = {}) {
  if (!source || !source.content) return 0;
  const corpus = `${source.title || ''} ${source.content || ''}`.toLowerCase();
  const titleLower = String(source.title || '').toLowerCase();

  const topicTokens = new Set([
    ...tokenize(topic.title),
    ...(Array.isArray(topic.domainKeywords) ? topic.domainKeywords.map(k => String(k).toLowerCase()) : []),
  ]);
  const domainTokens = new Set([
    ...tokenize(syllabus.name),
    ...tokenize(syllabus.domain),
    ...tokenize((topic.learningObjectives || []).join(' ')),
  ]);

  let score = 0;
  for (const tk of topicTokens) {
    if (titleLower.includes(tk)) score += 3;
    else if (corpus.includes(tk)) score += 1.5;
  }

  let domainHits = 0;
  for (const dk of domainTokens) {
    if (corpus.includes(dk)) domainHits += 1;
  }
  score += Math.min(4, domainHits * 1.1);

  // Penalize classic off-domain disambiguation / botanical / film / album homonyms
  if (/\bmay refer to\b|\bdisambiguation\b/i.test(corpus)) score -= 5;
  if (
    /computer|software|programming|data|math|algebra|network|physics|accounting|economics/i.test(
      `${syllabus.domain || ''} ${syllabus.name || ''}`
    ) &&
    /\b(?:species of|botanical|perennial|woody plant|genus of|studio album|television series|directed by)\b/i.test(
      corpus
    )
  ) {
    score -= 6;
  }

  return Math.round(score * 10) / 10;
}

async function searchWikibooks(query, limit = 2, signal = null) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ctrl = createAbortController(9000, signal);
  try {
    const url =
      'https://en.wikibooks.org/w/api.php?action=query&list=search&utf8=1&format=json&origin=*' +
      `&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data?.query?.search || [];
    return hits
      .map(h => {
        const title = h.title || '';
        const snippet = String(h.snippet || '').replace(/<[^>]+>/g, '').trim();
        if (!title || !snippet) return null;
        return {
          title,
          url: `https://en.wikibooks.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
          content: snippet.slice(0, 560),
          kind: 'wikibook',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    ctrl.cleanup();
  }
}

async function searchMdnDocs(query, limit = 2, signal = null) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ctrl = createAbortController(9000, signal);
  try {
    const res = await fetch(
      `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(q)}&locale=en-US`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.documents || [])
      .slice(0, limit)
      .map(d => ({
        title: d.title || '',
        url: d.mdn_url ? `https://developer.mozilla.org${d.mdn_url}` : 'https://developer.mozilla.org',
        content: String(d.summary || '').slice(0, 560),
        kind: 'mdn',
      }))
      .filter(d => d.title && d.content);
  } catch {
    return [];
  } finally {
    ctrl.cleanup();
  }
}

/**
 * Fetch multi-source open educational readings (Wikipedia, Wikibooks, OpenAlex, MDN, optional Tavily)
 * and verify relevance against the syllabus domain & learning objectives.
 */
export async function fetchVerifiedTopicSources({ syllabus, topic, signal = null } = {}) {
  const q1 = topic?.searchQueries?.[0] || `${syllabus?.name || ''} ${topic?.title || ''}`.trim();
  const q2 = topic?.searchQueries?.[1] || topic?.title || q1;
  const isWebOrCs = /web|html|css|javascript|typescript|http|dom|api|network|computer/i.test(
    `${syllabus?.domain || ''} ${syllabus?.name || ''} ${topic?.title || ''}`
  );
  const tavilyKey = getTavilyKey();

  const tasks = [
    searchWikipedia(q1, 2, signal),
    searchWikibooks(q2, 2, signal),
    searchOpenAlex(q1, 2, signal),
  ];
  if (isWebOrCs) tasks.push(searchMdnDocs(q2, 2, signal));
  if (tavilyKey) {
    const { webSearch } = await import('./aiCore');
    tasks.push(webSearch(q1, tavilyKey, 2, signal).catch(() => []));
  }

  const raw = (await Promise.all(tasks)).flat();
  const seen = new Set();
  const verified = [];
  let rejectedCount = 0;

  for (const item of raw) {
    if (!item || !item.title || !item.content) continue;
    const key = (item.url || item.title).toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);

    const score = scoreSourceRelevance(item, syllabus, topic);
    if (score < 1.5) {
      rejectedCount += 1;
      continue;
    }
    verified.push({ ...item, relevanceScore: score });
  }

  verified.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return {
    sources: verified.slice(0, 6).map((s, idx) => ({ ...s, index: idx + 1 })),
    rejectedCount,
    fetchedAt: Date.now(),
  };
}

/** Generate a clear, practical-ready concept breakdown grounded in verified sources. */
export async function generateTopicLesson({
  syllabus,
  topic,
  verifiedSources = [],
  signal = null,
} = {}) {
  const sourcesBlock =
    verifiedSources.length > 0
      ? verifiedSources
          .map(s => `[${s.index}] (${s.kind.toUpperCase()}) ${s.title}\n${s.content}`)
          .join('\n\n')
      : '(No external readings available — ground in standard university curriculum principles.)';

  const sys = `You are DeepTutor teaching "${topic.title}" in ${syllabus.code || ''} ${syllabus.name || ''}.
Create a clear, engaging study guide using ONLY clean Markdown:
- **Core Intuition**: Why this exists & plain-English mental model
- **Real-World Analogy**: 1 memorable concrete analogy
- **Key Mechanics / Formulas / Syntax**: Clear breakdown (use $...$ for math or \`\`\` code blocks)
- **Worked Walkthrough**: 1 concrete step-by-step example
- **Common Exam & Practical Traps**: 2-3 pitfalls to watch out for
Cite verified sources inline as [1], [2] when used.`;

  const user = [
    `Topic: ${topic.title}`,
    topic.learningObjectives?.length
      ? `Learning Objectives:\n- ${topic.learningObjectives.join('\n- ')}`
      : '',
    `Practical Goal: ${topic.practicalGoal || ''}`,
    `VERIFIED SOURCES:\n${sourcesBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await aiText({
    system: sys,
    user,
    maxTokens: 2000,
    timeoutMs: 180000,
    task: 'balanced',
    signal,
  });
  return stripThinking(raw);
}

/** Generate a validated Practical Lab spec (Tier 1 native prefill OR Tier 2 JSON calculator/case simulator). */
export async function generatePracticalLabSpec({
  syllabus,
  topic,
  verifiedSources = [],
  signal = null,
} = {}) {
  const labType = topic.labType || 'formula-calc';
  const isCode = labType === 'native-code';
  const isNative = labType.startsWith('native-');

  const sys = isNative
    ? `You design hands-on interactive lab exercises for "${topic.title}" (${syllabus.name}).
Lab mode: ${labType} (language: ${topic.labLanguage || 'javascript'}).
Return STRICT JSON ONLY:
{
  "mode": "${labType}",
  "title": "Short practical exercise title",
  "instructions": "2-3 sentence step-by-step hands-on challenge",
  "starterCode": "Working starter code/expression/dataset the student modifies and runs",
  "tasks": ["Task 1 to implement/observe", "Task 2 to verify"],
  "expectedOutcome": "What correct execution/output looks like",
  "hint": "1 helpful hint"
}`
    : labType === 'formula-calc'
      ? `You build interactive Formula & Model Calculators for "${topic.title}" (${syllabus.name}).
Return STRICT JSON ONLY:
{
  "mode": "formula-calc",
  "title": "Interactive Calculator Title",
  "description": "What this model computes and when to use it",
  "inputs": [
    {"id": "x", "label": "Input Name", "unit": "units", "defaultValue": 10, "min": 0, "max": 1000, "step": 1}
  ],
  "outputs": [
    {"label": "Result Name", "unit": "units", "formulaExpr": "x * 2", "explanation": "What this output means"}
  ],
  "challenge": {
    "prompt": "Hands-on scenario task asking the student to configure inputs or compute & explain the result",
    "hint": "1 helpful clue"
  }
}
CRITICAL: "formulaExpr" MUST ONLY use input ids, numbers, +, -, *, /, ^, (), and sqrt/abs/ln/log/min/max/pow.`
      : `You design hands-on real-world Case Simulators & Applied Exercises for "${topic.title}" (${syllabus.name}).
Return STRICT JSON ONLY:
{
  "mode": "case-simulator",
  "title": "Applied Case Lab Title",
  "scenario": "Realistic scenario with concrete numbers/constraints/facts",
  "artifact": "Given excerpt, data table, policy, or draft to analyze/apply",
  "tasks": ["Step 1", "Step 2", "Step 3"],
  "rubric": ["Criterion 1", "Criterion 2"],
  "hint": "1 helpful guiding clue"
}`;

  const srcHint = verifiedSources.slice(0, 2).map(s => `${s.title}: ${s.content}`).join('\n');
  const raw = await aiText({
    system: sys,
    user: `Topic: ${topic.title}\nPractical Goal: ${topic.practicalGoal || ''}\nStarter Hint: ${topic.starterTask || ''}\n${srcHint ? `Reference:\n${srcHint.slice(0, 1200)}` : ''}`,
    maxTokens: 1800,
    timeoutMs: 180000,
    task: isCode ? 'code' : 'syllabus',
    signal,
  });

  const parsed = parseJsonObject(raw);
  return {
    ...parsed,
    mode: parsed?.mode || labType,
    title: String(parsed?.title || `${topic.title} — Practical Lab`).trim(),
  };
}

/** Grade a student's hands-on practical submission (Tier 1 or Tier 2). */
export async function evaluatePracticalAttempt({
  syllabus,
  topic,
  labSpec,
  userWork,
  signal = null,
} = {}) {
  const sys = `You are a practical lab mentor grading hands-on student work for "${topic.title}" (${syllabus.name}).
Be encouraging, accurate, and concrete.
OUTPUT ONLY valid JSON:
{
  "passed": true,
  "score": 85,
  "strengths": "1 sentence on what worked well",
  "fixes": ["specific adjustment if needed"],
  "practicalSummary": "1 concise sentence summarizing what the student applied/built (used in Mastery Gate)"
}`;

  const raw = await aiText({
    system: sys,
    user: `Lab: ${labSpec?.title || topic.title}\nGoal: ${topic.practicalGoal || labSpec?.instructions || labSpec?.scenario || ''}\nStudent's Practical Work:\n---\n${String(userWork || '').slice(0, 4000)}\n---`,
    maxTokens: 1200,
    timeoutMs: 180000,
    task: 'reasoning',
    signal,
  });

  const d = parseJsonObject(raw);
  const score = Number.isFinite(Number(d.score)) ? Math.max(0, Math.min(100, Math.round(Number(d.score)))) : 75;
  const passed = typeof d.passed === 'boolean' ? d.passed : score >= 70;
  return {
    passed,
    score,
    strengths: String(d.strengths || 'Good hands-on attempt.').trim(),
    fixes: Array.isArray(d.fixes) ? d.fixes.map(String).filter(Boolean) : [],
    practicalSummary: String(d.practicalSummary || `Practiced ${topic.title}`).trim(),
  };
}

/** Tier 3 On-Demand Builder: self-contained sandboxed interactive HTML/CSS/JS simulator. */
export async function buildCustomInteractiveToolHtml({ syllabus, topic, signal = null } = {}) {
  const sys = `Build a self-contained, mobile-friendly interactive educational simulator/tool in a SINGLE HTML document for "${topic.title}" (${syllabus.name}).
STRICT RULES:
1. NO external scripts, CDNs, fonts, images, or fetch calls — 100% self-contained inline <style> and <script>.
2. Clean dark-friendly & readable styling (system-ui font, rounded cards, interactive sliders/buttons/visual SVG or canvas, live calculated readout, and a small "Try Challenge" button).
3. Fits cleanly in a 350px-wide mobile viewport without horizontal overflow.
4. Output ONLY raw HTML starting with <!DOCTYPE html> (no markdown fences or commentary).`;

  const raw = await aiText({
    system: sys,
    user: `Topic: ${topic.title}\nPractical Goal: ${topic.practicalGoal || ''}\nObjectives: ${(topic.learningObjectives || []).join('; ')}`,
    maxTokens: 3200,
    timeoutMs: 240000,
    task: 'code',
    signal,
  });

  let html = stripThinking(raw).trim();
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if (!/<html|<body|<div|<script/i.test(html)) {
    throw new Error('Could not generate a valid interactive widget. Tap Retry.');
  }
  return html;
}

/** Generate Mastery Gate (3 applied scenario questions tied to practical work + 1 Feynman prompt). */
export async function generateMasteryGate({
  syllabus,
  topic,
  practicalSummary = '',
  verifiedSources = [],
  signal = null,
} = {}) {
  const sys = `You create a Mastery Gate checking deep understanding AND practical application of "${topic.title}" (${syllabus.name}).
Connect the questions directly to real scenarios and what the student practiced.
OUTPUT ONLY valid JSON:
{
  "questions": [
    {
      "question": "Applied scenario question...",
      "choices": ["A", "B", "C", "D"],
      "answer": 0,
      "explanation": "Why this is correct and why traps fail"
    }
  ],
  "feynmanPrompt": "Explain in your own words how ${topic.title} works, why it matters, and give one concrete practical example."
}
Include exactly 3 high-signal applied MCQs.`;

  const srcText = verifiedSources.slice(0, 2).map(s => s.content).join('\n');
  const raw = await aiText({
    system: sys,
    user: `Topic: ${topic.title}\nPractical Goal: ${topic.practicalGoal || ''}\n${practicalSummary ? `Student's Practical Work: ${practicalSummary}\n` : ''}${srcText ? `Reference:\n${srcText.slice(0, 1200)}` : ''}`,
    maxTokens: 1800,
    timeoutMs: 180000,
    task: 'reasoning',
    signal,
  });

  const d = parseJsonObject(raw);
  const questions = Array.isArray(d.questions)
    ? d.questions
        .filter(q => q && q.question && Array.isArray(q.choices) && q.choices.length >= 2)
        .slice(0, 4)
        .map(q => {
          const choices = q.choices.map(String);
          const ans = Number(q.answer);
          return {
            question: String(q.question).trim(),
            choices,
            answer: Number.isInteger(ans) && ans >= 0 && ans < choices.length ? ans : 0,
            explanation: String(q.explanation || '').trim(),
          };
        })
    : [];

  return {
    questions,
    feynmanPrompt: String(
      d.feynmanPrompt ||
        `Explain ${topic.title} in plain language and describe how you applied it in practice.`
    ).trim(),
  };
}

/** Evaluate Mastery Gate, update topic mastery, push weak flashcards to Daily Review & Learner Memory. */
export async function evaluateMasteryGate({
  syllabus,
  topic,
  questions = [],
  answers = {},
  feynmanText = '',
  practicalSummary = '',
  signal = null,
} = {}) {
  let correctCount = 0;
  const missed = [];
  questions.forEach((q, idx) => {
    if (answers[idx] === q.answer) correctCount += 1;
    else missed.push({ q: q.question, a: q.choices[q.answer], why: q.explanation });
  });
  const mcqScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 100;

  let feynmanScore = 80;
  let feynmanFeedback = 'Clear explanation.';
  let weakConcepts = [];
  let flashcardsToAdd = missed.map(m => ({ q: m.q, a: `${m.a}${m.why ? ` — ${m.why}` : ''}` }));

  if (String(feynmanText || '').trim().length >= 12) {
    const sys = `Grade the student's plain-language Feynman explanation of "${topic.title}" (${syllabus.name}).
Check if they explain the mechanism clearly and connect it to practical application (not vague buzzwords).
OUTPUT ONLY valid JSON:
{
  "score": 82,
  "feedback": "2-sentence constructive critique",
  "weakConcepts": ["missed concept if any"],
  "flashcard": {"q": "Targeted recall question for any weak spot", "a": "Crisp accurate answer"}
}`;
    const raw = await aiText({
      system: sys,
      user: `Topic: ${topic.title}\nPractical Context: ${practicalSummary || topic.practicalGoal || ''}\nStudent Explanation:\n${feynmanText}`,
      maxTokens: 1000,
      timeoutMs: 180000,
      task: 'reasoning',
      signal,
    });
    const d = parseJsonObject(raw);
    if (Number.isFinite(Number(d.score))) {
      feynmanScore = Math.max(0, Math.min(100, Math.round(Number(d.score))));
    }
    if (typeof d.feedback === 'string' && d.feedback.trim()) {
      feynmanFeedback = d.feedback.trim();
    }
    if (Array.isArray(d.weakConcepts)) {
      weakConcepts = d.weakConcepts.map(String).filter(Boolean);
    }
    if (d.flashcard?.q && d.flashcard?.a && feynmanScore < 85) {
      flashcardsToAdd.push({ q: String(d.flashcard.q).trim(), a: String(d.flashcard.a).trim() });
    }
  } else {
    feynmanScore = 0;
    feynmanFeedback = 'Write a short explanation in your own words to complete the Feynman check.';
  }

  const totalScore = Math.round(mcqScore * 0.55 + feynmanScore * 0.45);
  const passed = totalScore >= 75 && feynmanScore >= 55;

  // Record into DeepTutor Learner Memory
  await recordLearningSignal({
    subject: syllabus.code || syllabus.name || 'General',
    topic: topic.title,
    correct: passed,
    mistakeSummary: weakConcepts[0] || missed[0]?.q || '',
    source: 'syllabus-mastery',
  }).catch(() => {});

  // Persist flashcards into the linked folder for Daily Review if any weak spots surfaced
  if (flashcardsToAdd.length > 0 && syllabus?.folderId) {
    try {
      const folderNotes = await db.notes.where('folderId').equals(syllabus.folderId).toArray();
      const targetNote = folderNotes.find(
        n => !n.trashed && n.mode !== 'vault' && String(n.title || '').includes(topic.title)
      );
      if (targetNote) {
        const merged = [...(targetNote.flashcards || []), ...flashcardsToAdd].slice(0, 40);
        await db.notes.update(targetNote.id, { flashcards: merged });
      } else {
        const created = await createNote(
          syllabus.folderId,
          `${syllabus.code || syllabus.name}: ${topic.title} (Review Cards)`,
          `## ${topic.title}\nPractical Goal: ${topic.practicalGoal || ''}\n\nAuto-saved weak-spot review cards from Mastery Gate.`,
          syllabus.name
        );
        await db.notes.update(created.id, { flashcards: flashcardsToAdd });
      }
    } catch {
      // non-fatal
    }
  }

  await logStudyActivity('reviews', 1).catch(() => {});

  return {
    passed,
    totalScore,
    mcqScore,
    feynmanScore,
    feedback: feynmanFeedback,
    weakConcepts,
    flashcardsAdded: flashcardsToAdd.length,
  };
}

/** 1-Tap Auto-Setup: link/create Course + Folder, import grading weights, and sync exam/milestone items to Calendar. */
export async function applySyllabusToWorkspace({
  syllabus,
  syncCalendar = true,
  syncGrades = true,
} = {}) {
  if (!syllabus) throw new Error('No syllabus to sync.');

  const allFolders = await db.folders.toArray();
  let folder = allFolders.find(
    f =>
      !f.locked &&
      !f.isSystemVault &&
      (f.id === syllabus.folderId ||
        f.name.toLowerCase() === String(syllabus.code || '').toLowerCase() ||
        f.name.toLowerCase() === String(syllabus.name || '').toLowerCase())
  );
  if (!folder) {
    const fid = await createFolder(syllabus.code || syllabus.name, { mode: 'study', locked: false });
    folder = await db.folders.get(fid);
  }

  const allCourses = await db.courses.toArray();
  let course = allCourses.find(
    c =>
      c.id === syllabus.courseId ||
      (syllabus.code && String(c.code || '').toLowerCase() === syllabus.code.toLowerCase()) ||
      String(c.name || '').toLowerCase() === String(syllabus.name || '').toLowerCase()
  );

  const coursePatch = {
    code: syllabus.code || 'COURSE',
    name: syllabus.name || 'Course',
    units: syllabus.units || 3,
    folderId: folder?.id ?? null,
  };
  if (syncGrades && Array.isArray(syllabus.gradingWeights) && syllabus.gradingWeights.length > 0) {
    coursePatch.weights = syllabus.gradingWeights;
  }

  if (course) {
    await db.courses.update(course.id, coursePatch);
    course = await db.courses.get(course.id);
  } else {
    const cid = await db.courses.add({
      ...coursePatch,
      nickname: syllabus.code || '',
      instructor: '',
      color: COURSE_PALETTE[allCourses.length % COURSE_PALETTE.length],
      archived: false,
      createdAt: Date.now(),
    });
    course = await db.courses.get(cid);
  }

  let eventsAdded = 0;
  if (syncCalendar && Array.isArray(syllabus.assessments) && syllabus.assessments.length > 0) {
    const existing = await db.plannerItems.toArray();
    const existingKeys = new Set(existing.map(it => `${it.course}::${it.title}`.toLowerCase()));
    const now = Date.now();
    for (const a of syllabus.assessments) {
      const k = `${syllabus.code || syllabus.name}::${a.title}`.toLowerCase();
      if (existingKeys.has(k)) continue;
      let dateKey = /^\d{4}-\d{2}-\d{2}$/.test(a.dateHint || '') ? a.dateHint : '';
      if (!dateKey && a.week) {
        const d = new Date(now + (a.week - 1) * 7 * 86400000);
        dateKey = d.toISOString().slice(0, 10);
      }
      if (!dateKey) {
        dateKey = new Date(now + 14 * 86400000).toISOString().slice(0, 10);
      }
      await db.plannerItems.add({
        title: a.title,
        course: syllabus.code || syllabus.name,
        type: a.type || 'exam',
        source: 'syllabus',
        dateKey,
        timeLabel: a.week ? `Week ${a.week}` : 'Syllabus',
        dueAt: new Date(`${dateKey}T23:59:00`).getTime(),
        description: `Extracted from ${syllabus.name} syllabus`,
        done: false,
        priority: 'high',
        createdAt: now,
        updatedAt: now,
      });
      eventsAdded += 1;
    }
  }

  const updated = await saveSyllabus({
    ...syllabus,
    courseId: course?.id || null,
    folderId: folder?.id || null,
  });

  return { syllabus: updated, course, folder, eventsAdded };
}

export {
  saveSyllabus,
  updateSyllabusTopicState,
  getSyllabusTopicCache,
  putSyllabusTopicCache,
};
