/**
 * Client-side AI engine — ports the server's scan logic to run in-browser.
 * Input:  { note: string, subject: string, changedLines: number[] }
 * Output: { blocks: [...], flashcards: [...], quiz: [...] }
 */

import { getDirectConfig } from './aiConfig';

const SYSTEM_PROMPT = `You are an AI study assistant for a class notes app. The user saved a note. Your job is to explain the note so the student learns.

STRICT RULES (follow exactly):
1. NEVER rewrite, edit, delete, or rephrase the user's text. Return each line's text exactly as given.
2. Keep explanations short: about 40 words each, in simple clear language.
3. If you are unsure about something, write "not sure" in the explanation — never guess or invent facts.
4. Only flag a line as a mistake when you are confident it is wrong or incomplete. Include the reason and a suggested correction. Otherwise set "mistake" to null.
5. Reply in the same language the note is written in.
6. Ignore lines that are empty, just a title, or only punctuation — skip them entirely.
7. Also produce study materials from the note: flashcards and quiz questions.

OUTPUT: reply with ONLY valid JSON. No markdown, no code fences, no commentary. Shape:
{
  "blocks": [
    {
      "id": "line-<N>",
      "text": "<exact original line text>",
      "explanation": "<about 40 words>",
      "terms": [{"term": "<word>", "definition": "<short definition>"}],
      "mistake": null
    }
  ],
  "flashcards": [{"q": "<question>", "a": "<answer>"}],
  "quiz": [{"question": "<question>", "choices": ["<choice A>", "<choice B>", "<choice C>", "<choice D>"], "answer": 0}]
}
If a line has a mistake, use: "mistake": {"reason": "<why>", "correction": "<fix>"}
blocks[] should include one entry per meaningful line, in note order, using the line numbers given.
flashcards[]: 2-6 cards covering the key facts in the note. "answer" in quiz is the 0-based index of the correct choice.`;

const STUDY_SYSTEM_PROMPT = `You are an AI study assistant. From the note below, produce flashcards and a multiple-choice quiz.

RULES:
- Base every card/question strictly on the note. If unsure, skip rather than guess.
- Reply in the same language as the note.
- OUTPUT: ONLY valid JSON, no markdown, no fences. Shape:
{"flashcards": [{"q": "...", "a": "..."}], "quiz": [{"question": "...", "choices": ["A","B","C","D"], "answer": 0}]}
- 4-8 flashcards covering key facts. 3-5 quiz questions. "answer" is the 0-based index of the correct choice.`;

const CONSISTENCY_SYSTEM_PROMPT = `You are an AI study assistant. Review the explanations below for consistency.

RULES:
- Check for contradictions between explanations (e.g., one says X, another says not X).
- Check for terminology drift (same concept called different names).
- Fix any issues by returning corrected blocks ONLY.
- OUTPUT: ONLY valid JSON, no markdown, no fences. Shape:
{"blocks": [{"id": "line-N", "explanation": "...", "terms": [...], "mistake": null}]}
- Only include blocks that need fixing. If all good, return {"blocks": []}.
- Keep explanations ~40 words. Preserve original line IDs and text.`;

const CHUNK_SIZE = 20;
const MAX_CONCURRENT = 4;

/** Run an array of async functions with a concurrency limit. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Call the AI with a timeout, return raw content string. */
async function callAI({ system, user, maxTokens = 8192, timeoutMs = 180000 }) {
  const { baseUrl, key, model } = await import('./aiConfig').then(m => m.getDirectConfig());

  if (!key) throw new Error('No API key configured. Set your key in Settings → AI backend.');
  if (!baseUrl) throw new Error('No base URL configured for the selected provider.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`AI API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI returned no content');

    return content;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('__abort__');
      e.isAbortTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Scan a single chunk of lines (with 3 lines of preceding context). */
async function scanChunk(lines, startIdx, subject) {
  const end = Math.min(startIdx + 20, lines.length);
  const ctxStart = Math.max(0, startIdx - 3);
  const contextText = lines.slice(ctxStart, startIdx).map((l, i) => `${ctxStart + i + 1}: ${l}`).join('\n') || '(none)';
  const bodyText = lines.slice(startIdx, end).map((l, i) => `${startIdx + i + 1}: ${l}`).join('\n');

  const user = [
    `Subject: ${subject || 'General'}`,
    '',
    'Lines BEFORE this excerpt — context only, do NOT explain or include them:',
    '---',
    contextText,
    '---',
    '',
    'Excerpt to explain (each line prefixed with its line number):',
    '---',
    bodyText,
    '---',
    '',
    'Explain every meaningful line of the excerpt. Return the JSON now.',
  ].join('\n');

  const raw = await callAI({ system: SYSTEM_PROMPT, user, maxTokens: 4096, timeoutMs: 180000 });
  const parsed = parseJsonSafe(raw);
  return parsed.blocks.filter(b => {
    const n = parseInt(String(b.id).replace('line-', ''), 10);
    return Number.isFinite(n) && n >= startIdx + 1 && n <= end;
  });
}

/** Scan a single line (explain simpler / give example). */
export async function scanLine(note, line, request) {
  const isSimpler = request === 'simpler';
  const instruction = isSimpler
    ? 'Explain this line in simpler terms, about 40 words. Use everyday language a student would understand.'
    : 'Give a concrete example that illustrates the concept in this line. Make it specific and relatable.';

  const prompt = [
    'You are explaining one line of a class note to help a student learn.',
    '',
    'Full note (for context):',
    '---',
    note,
    '---',
    '',
    'The line to explain:',
    `"${line}"`,
    '',
    'Request:',
    instruction,
    '',
    'STRICT RULES:',
    '- NEVER rewrite, edit, or rephrase the original line.',
    '- Reply in the same language as the note.',
    '- If you are unsure, say "not sure" — never guess.',
    '- Keep it to about 40 words.',
    '',
    'Return ONLY valid JSON (no markdown, no code fences):',
    '{ "explanation": "your answer here" }',
  ].join('\n');

  const raw = await callAI({
    system: 'You explain class notes. Reply only with valid JSON.',
    user: prompt,
    maxTokens: 1024,
    timeoutMs: 120000,
  });

  return parseLineJson(raw);
}

/** Scan a full note (single call for short notes, parallel chunks for long). */
export async function scanNote({ note, subject, changedLines }) {
  const lines = note.split('\n');
  const onlyChanged = Array.isArray(changedLines) && changedLines.length > 0;

  if (onlyChanged || lines.length <= 20) {
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
    const userPrompt = [
      `Subject: ${subject || 'General'}`,
      '',
      'Note text (each line prefixed with its line number):',
      '---',
      numbered,
      '---',
      '',
      onlyChanged
        ? `Explain ONLY these lines: ${changedLines.join(', ')}. All other lines are context only — do NOT include them in blocks[].`
        : 'Explain every meaningful line. Return the JSON now.',
    ].join('\n');

    const timeoutMs = Math.min(60000 + lines.length * 4000, 480000);
    try {
      const content = await callAI({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 8192, timeoutMs });
      return parseJsonSafe(content);
    } catch (err) {
      if (err.isAbortTimeout) {
        throw new Error('The AI needed more time for this note and was stopped. Tap Save again — it will resume where it left off.');
      }
      throw err;
    }
  }

  // Long note: parallel chunked scan + separate study-materials call
  const chunkStarts = [];
  for (let s = 0; s < lines.length; s += 20) chunkStarts.push(s);

  const [chunkResults, study] = await Promise.all([
    (async () => {
      const results = await mapPool(chunkStarts, 4, async start => {
        try { return await scanChunk(lines, start, subject); }
        catch { try { return await scanChunk(lines, start, subject); } catch { return null; } }
      });
      return results;
    })(),
    (async () => {
      const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
      try {
        const raw = await callAI({
          system: STUDY_SYSTEM_PROMPT,
          user: `Subject: ${subject || 'General'}\n\nNote:\n---\n${numbered}\n---\n\nProduce the JSON now.`,
          maxTokens: 2048,
          timeoutMs: 240000,
        });
        return parseJsonSafe(raw);
      } catch { return null; }
    })(),
  ]);

  const blocks = chunkResults.filter(Boolean).flat().sort((a, b) => {
    const na = parseInt(String(a.id).replace('line-', ''), 10);
    const nb = parseInt(String(b.id).replace('line-', ''), 10);
    return na - nb;
  });

  if (blocks.length === 0) {
    throw new Error('The AI could not scan this long note right now — the server may be busy. Tap Save again in a moment.');
  }

  return { blocks, flashcards: study?.flashcards || [], quiz: study?.quiz || [] };
}

/** Exam summary from all notes in a folder. */
export async function examSummary({ subject, notes }) {
  if (!notes?.length) throw new Error('No notes to summarize.');

  const notesText = notes
    .map((n, i) => `Note ${i + 1}: ${n.title || 'Untitled'}\n${n.body || ''}`)
    .join('\n\n---\n\n');

  const prompt = [
    `Subject: ${subject || 'General'}`,
    '',
    'The student is preparing for an exam. Read all the notes below and produce a study pack.',
    '',
    'NOTES:',
    '---',
    notesText,
    '---',
    '',
    'Return ONLY valid JSON (no markdown, no code fences, no commentary):',
    '{',
    '  "summary": "<one-page summary of the key concepts, in the same language as the notes, about 200-250 words>",',
    '  "flashcards": [{"q":"<question>","a":"<answer>"}],',
    '  "quiz": [{"question":"<question>","choices":["A","B","C","D"],"answer":0}]',
    '}',
    '',
    'Rules:',
    '- 2-6 flashcards covering the most important facts',
    '- 3-6 multiple-choice quiz questions, one correct answer each (answer = 0-based index)',
    '- Reply in the same language as the notes',
    '- If unsure, say "not sure" — never guess',
    '- Do not invent facts not present in the notes',
  ].join('\n');

  const raw = await callAI({
    system: 'You create exam study packs from class notes. Reply only with valid JSON.',
    user: prompt,
    maxTokens: 8192,
    timeoutMs: 300000,
  });

  return parseExamJson(raw);
}

/**
 * Extract the first complete, balanced JSON object from a string.
 * Handles: code fences, prose before/after, and multiple concatenated objects
 * (the model sometimes emits {"a":1}\n{"b":2} — we take the first).
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain a JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('AI reply contained an unterminated JSON object');
}

function parseJsonSafe(raw) {
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const obj = extractFirstJsonObject(text);

  let parsed;
  try {
    parsed = JSON.parse(obj);
  } catch (e) {
    throw new Error(`AI reply was not valid JSON: ${e.message}`);
  }

  return {
    blocks: Array.isArray(parsed.blocks)
      ? parsed.blocks.map((b, i) => {
          let id = typeof b.id === 'string' ? b.id : '';
          const digits = /\d+/.exec(id);
          return {
            id: digits ? `line-${parseInt(digits[0], 10)}` : `line-${i + 1}`,
            text: typeof b.text === 'string' ? b.text : '',
            explanation: typeof b.explanation === 'string' ? b.explanation : '',
            terms: Array.isArray(b.terms)
              ? b.terms
                  .filter((t) => t && typeof t.term === 'string')
                  .map((t) => ({
                    term: t.term,
                    definition: typeof t.definition === 'string' ? t.definition : '',
                  }))
              : [],
            mistake:
              b.mistake && typeof b.mistake === 'object'
                ? {
                    reason: String(b.mistake.reason || ''),
                    correction: String(b.mistake.correction || ''),
                  }
                : null,
          };
        })
      : [],
    flashcards: Array.isArray(parsed.flashcards)
      ? parsed.flashcards
          .filter((c) => c && typeof c.q === 'string')
          .map((c) => ({ q: c.q, a: typeof c.a === 'string' ? c.a : '' }))
      : [],
    quiz: Array.isArray(parsed.quiz)
      ? parsed.quiz
          .filter((q) => q && typeof q.question === 'string')
          .map((q) => {
            const n = Number(q.answer);
            return {
              question: q.question,
              choices: Array.isArray(q.choices) ? q.choices.map(String) : [],
              answer: Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : 0,
            };
          })
      : [],
  };
}

function parseLineJson(content) {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain a JSON object');

  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('AI reply contained an unterminated JSON object');

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`AI reply was not valid JSON: ${e.message}`);
  }
  return { explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '' };
}

function parseExamJson(content) {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain a JSON object');

  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('AI reply contained an unterminated JSON object');

  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); }
  catch (e) { throw new Error(`AI reply was not valid JSON: ${e.message}`); }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    flashcards: Array.isArray(parsed.flashcards)
      ? parsed.flashcards.filter(c => c && typeof c.q === 'string')
          .map(c => ({ q: c.q, a: typeof c.a === 'string' ? c.a : '' }))
      : [],
    quiz: Array.isArray(parsed.quiz)
      ? parsed.quiz.filter(q => q && typeof q.question === 'string')
          .map(q => ({
            question: q.question,
            choices: Array.isArray(q.choices) ? q.choices.map(String) : [],
            answer: Number.isInteger(q.answer) ? q.answer : 0,
          }))
      : [],
  };
}