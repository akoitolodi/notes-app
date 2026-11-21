/**
 * Per-line re-scan — "explain simpler" or "give example" for one line.
 * Reuses the same AI provider; only the prompt changes.
 * Input: { note: string, line: string, request: 'simpler' | 'example' }
 * Output: { explanation: string }
 */
export async function scanLine({ note, line, request }) {
  const apiKey = process.env.FREELLMAPI_API_KEY || '';
  const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
  const model = process.env.FREELLMAPI_MODEL || 'auto';

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  if (!line || !line.trim()) throw new Error('No line to explain');

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

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
          { role: 'system', content: 'You explain class notes. Reply only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
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

    return parseLineJson(content);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        'The AI needed more time and was stopped. Tap "Explain simpler" / "Give example" again.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLineJson(content) {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Extract the first complete, balanced JSON object (handles concatenated
  // objects like {"a":1}\n{"b":2} — we take the first).
  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain a JSON object');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
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