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
  "flashcards": [],
  "quiz": []
}
If a line has a mistake, use: "mistake": {"reason": "<why>", "correction": "<fix>"}
blocks[] should include one entry per meaningful line, in note order, using the line numbers given.`;

export async function scanNote({ note, subject, changedLines }) {
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) {
    throw new Error('FREELLMAPI_API_KEY is not configured');
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

    return parseAiJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract the JSON object from the model's reply.
 * Models sometimes wrap JSON in code fences or add prose; strip that.
 */
function parseAiJson(content) {
  let text = content.trim();

  // Strip markdown code fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Find the first { and last } to extract the object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI reply did not contain a JSON object');
  }
  text = text.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
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