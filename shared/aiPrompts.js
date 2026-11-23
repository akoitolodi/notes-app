/**
 * Shared AI prompts, chunking constants, and concurrency helper.
 * Single source of truth for both server (lib/) and direct client (src/lib/).
 */

export const CHUNK_SIZE = 35;
export const MAX_CONCURRENT = 4;

export const STYLE_DIRECTIVES = {
  default: '',
  simple: 'Use very simple, everyday beginner-friendly language and short analogies.',
  'exam-prep': 'Focus on definitions, key distinctions, common exam traps, and testable facts.',
  detailed: 'Be thorough and precise; explain the underlying mechanism or why it matters (up to ~60 words).',
};

export function styleLine(style) {
  const dir = STYLE_DIRECTIVES[style] || '';
  return dir ? `Explanation style: ${dir}` : '';
}

export const SYSTEM_PROMPT = `You are an AI study assistant for a class notes app. The user saved a note. Your job is to explain the note so the student learns.

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
  "quiz": [{"question": "<question>", "choices": ["<choice A>", "<choice B>", "<choice C>", "<choice D>"], "answer": 0, "explanation": "<1 short sentence why>"}]
}
If a line has a mistake, use: "mistake": {"reason": "<why>", "correction": "<fix>"}
blocks[] should include one entry per meaningful line, in note order, using the line numbers given.
flashcards[]: 2-6 cards covering the key facts in the note. "answer" in quiz is the 0-based index of the correct choice.`;

export const BLOCKS_SYSTEM_PROMPT = `You are an AI study assistant for a class notes app. The user saved a note. Your job is to explain the note so the student learns.

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

export const STUDY_SYSTEM_PROMPT = `You are an AI study assistant. From the note below, produce flashcards and a multiple-choice quiz that build genuine understanding and critical thinking.

RULES:
- Base every card/question strictly on the note. If unsure, skip rather than guess.
- For quiz questions, include higher-order reasoning (application, cause-and-effect, comparisons, or "what happens if…" edge cases), not only verbatim memorization.
- Include a concise 1-sentence "explanation" for each quiz question explaining why the correct choice holds.
- Reply in the same language as the note.
- OUTPUT: ONLY valid JSON, no markdown, no fences. Shape:
{"flashcards": [{"q": "...", "a": "..."}], "quiz": [{"question": "...", "choices": ["A","B","C","D"], "answer": 0, "explanation": "short rationale"}]}
- 4-8 flashcards covering key facts. 3-5 quiz questions. "answer" is the 0-based index of the correct choice.`;

export const CONSISTENCY_SYSTEM_PROMPT = `You are an AI study assistant. Review the explanations below for consistency.

RULES:
- Check for contradictions between explanations (e.g., one says X, another says not X).
- Check for terminology drift (same concept called different names).
- Fix any issues by returning corrected blocks ONLY.
- OUTPUT: ONLY valid JSON, no markdown, no fences. Shape:
{"blocks": [{"id": "line-N", "explanation": "...", "terms": [{"term": "...", "definition": "..."}], "mistake": null}]}
- Only include blocks that need fixing. If all good, return {"blocks": []}.
- Keep explanations ~40 words. Preserve original line IDs, text, and full term objects.`;

export function buildScanNoteUserPrompt({ lines, subject, changedLines, style }) {
  const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
  const onlyChanged = Array.isArray(changedLines) && changedLines.length > 0;
  const sLine = styleLine(style);
  return [
    `Subject: ${subject || 'General'}`,
    ...(sLine ? [sLine] : []),
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
}

export function buildScanChunkUserPrompt({ lines, startIdx, endIdx, subject, style, targetLines = null }) {
  const ctxStart = Math.max(0, startIdx - 3);
  const contextText =
    lines
      .slice(ctxStart, startIdx)
      .map((l, i) => `${ctxStart + i + 1}: ${l}`)
      .join('\n') || '(none)';
  const bodyText = lines
    .slice(startIdx, endIdx)
    .map((l, i) => `${startIdx + i + 1}: ${l}`)
    .join('\n');
  const sLine = styleLine(style);

  return [
    `Subject: ${subject || 'General'}`,
    ...(sLine ? [sLine] : []),
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
    targetLines?.length
      ? `Explain ONLY these lines from the excerpt: ${targetLines.join(', ')}. Return the JSON now.`
      : 'Explain every meaningful line of the excerpt. Return the JSON now.',
  ].join('\n');
}

export function buildScanLinePrompt({ note, line, request, style }) {
  const isSimpler = request === 'simpler';
  const instruction = isSimpler
    ? 'Explain this line in simpler terms, about 40 words. Use everyday language a student would understand.'
    : 'Give a concrete example that illustrates the concept in this line. Make it specific and relatable.';
  const sLine = styleLine(style);

  return [
    'You are explaining one line of a class note to help a student learn.',
    ...(sLine ? [sLine] : []),
    '',
    'Full note (for context):',
    '---',
    (note || '').slice(0, 8000),
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
}

export function buildExamSummaryPrompt({ subject, notes, style }) {
  const notesText = notes
    .map((n, i) => `Note ${i + 1}: ${n.title || 'Untitled'}\n${n.body || ''}`)
    .join('\n\n---\n\n');
  const sLine = styleLine(style);

  return [
    `Subject: ${subject || 'General'}`,
    ...(sLine ? [sLine] : []),
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
    '  "summary": "<structured markdown summary with headings & bullet points of the key concepts, in the same language as the notes, about 250-350 words>",',
    '  "flashcards": [{"q":"<question>","a":"<answer>"}],',
    '  "quiz": [{"question":"<question>","choices":["A","B","C","D"],"answer":0,"explanation":"<short rationale>"}]',
    '}',
    '',
    'Rules:',
    '- 4-8 flashcards covering the most important facts',
    '- 4-8 multiple-choice quiz questions, one correct answer each (answer = 0-based index)',
    '- Reply in the same language as the notes',
    '- If unsure, say "not sure" — never guess',
    '- Do not invent facts not present in the notes',
  ].join('\n');
}

/** Run an array of async functions with a concurrency limit. */
export async function mapPool(items, limit, fn) {
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
