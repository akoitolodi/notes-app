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

export async function scanNote({ note, subject, changedLines }) {
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) {
    throw new Error('FREELLMAPI_API_KEY is not configured');
  }
  if (typeof note !== 'string') {
    throw new Error('scanNote: "note" must be a string');
  }

  const numbered = note
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  const userPrompt = [
    `Subject: ${subject || 'General'}`,
    '',
    'Note text (each line prefixed with its line number):',
    '---',
    numbered,
    '---',
    '',
    `Lines that are new or edited since the last scan: ${
      changedLines && changedLines.length ? changedLines.join(', ') : 'all lines (first scan)'
    }`,
    '',
    'Explain every meaningful line (not just the changed ones — the full note is included so explanations fit their context). Return the JSON now.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
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

    return parseJsonSafe(content);
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
      ? parsed.blocks.map((b, i) => ({
          id: typeof b.id === 'string' ? b.id : `line-${i + 1}`,
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
        }))
      : [],
    flashcards: Array.isArray(parsed.flashcards)
      ? parsed.flashcards
          .filter((c) => c && typeof c.q === 'string')
          .map((c) => ({ q: c.q, a: typeof c.a === 'string' ? c.a : '' }))
      : [],
    quiz: Array.isArray(parsed.quiz)
      ? parsed.quiz
          .filter((q) => q && typeof q.question === 'string')
          .map((q) => ({
            question: q.question,
            choices: Array.isArray(q.choices) ? q.choices.map(String) : [],
            answer: Number.isInteger(q.answer) ? q.answer : 0,
          }))
      : [],
  };
}