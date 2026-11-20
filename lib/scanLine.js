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
  } finally {
    clearTimeout(timeout);
  }
}

function parseLineJson(content) {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI reply did not contain a JSON object');
  }
  text = text.slice(start, end + 1);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(`AI reply was not valid JSON: ${e.message}`); }
  return { explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '' };
}