/**
 * Exam summary — generate a one-page summary, combined flashcards, and a
 * practice quiz from all notes in a folder.
 * Input: { subject: string, notes: [{title, body}] }
 * Output: { summary: string, flashcards: [{q,a}], quiz: [{question,choices[],answer}] }
 */
export async function examSummary({ subject, notes }) {
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  if (!notes || !notes.length) throw new Error('No notes to summarize');

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

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
          { role: 'system', content: 'You create exam study packs from class notes. Reply only with valid JSON.' },
          { role: 'user', content: prompt },
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

    return parseExamJson(content);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        'Building the exam summary took too long. Tap ↻ on the Exam Summary screen to try again.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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