/**
 * Shared AI scan logic — the single place where we call the AI.
 * Used by both the local dev server (server.js) and the serverless function (api/scan.js).
 *
 * Input:  { note: string, subject: string, changedLines: number[] }
 * Output: { blocks: [...], flashcards: [...], quiz: [...] }
 */

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

const BLOCKS_SYSTEM_PROMPT = `You are an AI study assistant for a class notes app. The user saved a note. Your job is to explain the note so the student learns.

STRICT RULES (follow exactly):
1. NEVER rewrite, edit, delete, or rephrase the user's text. Return each line's text exactly as given.
2. Keep explanations short: about 40 words each, in simple clear language.
3. If you are unsure about something, write "not sure" in the explanation — never guess or invent facts.
4. Only flag a line as a mistake when you are confident it is wrong or incomplete. Include the reason and a suggested correction. Otherwise set "mistake" to null.
5. Reply in the same language the note is written in.
6. Ignore lines that are empty, just a title, or only punctuation — skip them entirely.

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
  ]
}
If a line has a mistake, use: "mistake": {"reason": "<why>", "correction": "<fix>"}
blocks[] should include one entry per meaningful line, in note order, using the line numbers given.`;

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
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  if (typeof system !== 'string' || typeof user !== 'string') {
    throw new Error('callAI: system and user must be strings');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
  const end = Math.min(startIdx + CHUNK_SIZE, lines.length);
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

  const raw = await callAI({ system: BLOCKS_SYSTEM_PROMPT, user, maxTokens: 4096, timeoutMs: 180000 });
  const parsed = parseJsonSafe(raw);
  return parsed.blocks.filter(b => {
    const n = parseInt(String(b.id).replace('line-', ''), 10);
    return Number.isFinite(n) && n >= startIdx + 1 && n <= end;
  });
}

/** Consistency check pass — reviews all explanations for contradictions/terminology drift. */
async function checkConsistency(blocks, subject) {
  if (blocks.length === 0) return blocks;

  // Build a compact review payload: only id, text, explanation, terms
  const reviewPayload = blocks.map(b => ({
    id: b.id,
    text: b.text,
    explanation: b.explanation,
    terms: b.terms?.map(t => t.term) || [],
  }));

  const user = [
    `Subject: ${subject || 'General'}`,
    '',
    'Review these explanations for consistency:',
    '---',
    JSON.stringify(reviewPayload, null, 2),
    '---',
    '',
    'Return ONLY blocks that need fixing (contradictions, terminology drift).',
    'If all good, return {"blocks": []}.',
  ].join('\n');

  try {
    const raw = await callAI({
      system: CONSISTENCY_SYSTEM_PROMPT,
      user,
      maxTokens: 4096,
      timeoutMs: 120000,
    });
    const parsed = parseJsonSafe(raw);
    const fixes = parsed.blocks || [];

    // Merge fixes back into original blocks
    if (fixes.length === 0) return blocks;

    const fixMap = new Map(fixes.map(f => [f.id, f]));
    return blocks.map(b => {
      const fix = fixMap.get(b.id);
      if (!fix) return b;
      return {
        ...b,
        explanation: fix.explanation || b.explanation,
        terms: fix.terms || b.terms,
        mistake: fix.mistake !== undefined ? fix.mistake : b.mistake,
      };
    });
  } catch {
    // If consistency check fails, return original blocks (non-blocking)
    return blocks;
  }
}

export async function scanNote({ note, subject, changedLines }) {
  const lines = note.split('\n');
  const onlyChanged = Array.isArray(changedLines) && changedLines.length > 0;

  // Short notes or changed-lines only: single call (keeps current behavior fast for edits)
  if (onlyChanged || lines.length <= CHUNK_SIZE) {
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

  // Long note, full scan: chunked parallel scan + separate study-materials call
  const chunkStarts = [];
  for (let s = 0; s < lines.length; s += CHUNK_SIZE) chunkStarts.push(s);

  const [chunkResults, study] = await Promise.all([
    mapPool(chunkStarts, MAX_CONCURRENT, async start => {
      try { return await scanChunk(lines, start, subject); }
      catch { try { return await scanChunk(lines, start, subject); } catch { return null; } }
    }),
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

  // Consistency check pass (non-blocking, runs in background)
  const consistentBlocks = await checkConsistency(blocks, subject);

  return { blocks: consistentBlocks, flashcards: study?.flashcards || [], quiz: study?.quiz || [] };
}

/** Generic multi-message chat — powers all newer client-side AI features. */
export async function chat({ messages, maxTokens = 2048, timeoutMs = 180000 }) {
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('chat: "messages" must be a non-empty array');
  }
  if (messages.length > 60) throw new Error('chat: too many messages');
  const safeMaxTokens = Math.min(Math.max(Number(maxTokens) || 2048, 1), 4096);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: safeMaxTokens }),
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
      throw new Error('The AI needed more time and was stopped. Try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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

  // Strip markdown code fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const obj = extractFirstJsonObject(text);

  let parsed;
  try {
    parsed = JSON.parse(obj);
  } catch (e) {
    throw new Error(`AI reply was not valid JSON: ${e.message}`);
  }

  // Normalize / validate the shape so the frontend can trust it
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