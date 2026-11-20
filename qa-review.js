/**
 * QA script: ask an AI (via freellmapi) to review the app's key files.
 * Usage: node qa-review.js [model]
 */
import { readFileSync } from 'node:fs';

const apiKey = process.env.FREELLMAPI_API_KEY || '';
const baseUrl = process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1';
const model = process.argv[2] || 'gemini-3.8-flash';

// Only the files most likely to have logic bugs
const files = [
  'src/App.jsx',
  'src/components/NoteEditor.jsx',
  'src/components/SlideUpPanel.jsx',
  'src/store/db.js',
  'lib/ai.js',
  'lib/scanLine.js',
  'server.js',
  'api/scan.js',
];

const body = files
  .map(f => {
    try { return `===== ${f} =====\n${readFileSync(f, 'utf8')}\n`; }
    catch { return `===== ${f} =====\n(file not found)\n`; }
  })
  .join('\n');

const prompt = `You are a senior QA engineer. Review this mobile notes app (React + Vite + Express + IndexedDB). Find real bugs, crashes, and logic errors.

Produce FOUR sections:

## 1. BUGS FOUND
For each: File:line, title, what the bug is, how to reproduce (concrete steps), severity (critical/high/medium/low).

## 2. MISSING BEHAVIOR
What should the app do that it currently does not? Be specific.

## 3. TEST CASES
8-12 concrete test cases a human could run on a phone. One sentence each: action + expected result. Cover: save, scan, panel, inline, swipe, study, folders, search, delete, dark mode, offline.

## 4. CODE QUALITY
Rate 1-10 and give 3 specific improvements.

Be honest and critical. Do not flatter.

----- SOURCE CODE -----
${body}`;

console.log('Asking', model, 'to review', files.length, 'files...\n');

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: 'You are a senior QA engineer. Be honest and critical.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 8192,
  }),
});

if (!res.ok) {
  const err = await res.text().catch(() => '');
  throw new Error(`AI API error ${res.status}: ${err.slice(0, 300)}`);
}

const data = await res.json();
const content = data.choices?.[0]?.message?.content;
if (!content) throw new Error('AI returned no content');

console.log(content);
