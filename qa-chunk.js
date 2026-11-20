/**
 * Chunked QA: review N files per call to keep prompts small.
 * Usage: node qa-chunk.js <model> <outFile> <file1> <file2> ...
 */
import { readFileSync } from 'node:fs';

const apiKey = process.env.FREELLMAPI_API_KEY || '';
const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
const model = process.argv[2];
const out = process.argv[3];
const files = process.argv.slice(4);

const body = files
  .map(f => `===== ${f} =====\n${readFileSync(f, 'utf8')}\n`)
  .join('\n');

const prompt = `You are a senior QA engineer. Review these source files of a mobile notes app (React + Vite + Express + IndexedDB + Capacitor). Find REAL bugs only — crashes, logic errors, broken behavior. No style nitpicks.

For each bug: File:line | title | what's wrong | how to reproduce | severity (critical/high/medium/low).
If you find none, say "No bugs found in these files."
Also list at most 2 risky-but-unconfirmed suspicions.

----- SOURCE -----
${body}`;

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 4096,
  }),
});

if (!res.ok) {
  const err = await res.text().catch(() => '');
  throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
}
const data = await res.json();
const content = data.choices?.[0]?.message?.content;
if (!content) throw new Error('no content');
const { writeFileSync } = await import('node:fs');
writeFileSync(out, `# Chunk review: ${files.join(', ')} (model: ${model})\n\n${content}\n`);
console.log('OK ->', out, `(${content.length} chars)`);
