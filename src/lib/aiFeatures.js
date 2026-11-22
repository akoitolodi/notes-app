/**
 * aiFeatures — prompt builders + parsers for every study AI feature.
 * All calls go through aiCore (works in Termux AND Direct API modes).
 */
import { aiText, aiVision } from './aiCore';

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error('AI reply contained an unterminated JSON object');
}

function parseJson(text) {
  try {
    return extractJson(text);
  } catch (e) {
    // One retry hint: strip any leading/trailing prose lines
    const lines = text.trim().split('\n').filter(l => l.trim().startsWith('{') || l.trim().startsWith('"') || l.includes('}'));
    if (lines.length) return extractJson(lines.join('\n'));
    throw e;
  }
}

const styleHint = style => (style && style !== 'default' ? `Explanation style: ${style}.` : '');

// ---------------- 1. Chat with a note ----------------
export async function chatWithNote({ note, title, subject, history = [], question, style }) {
  const sys = `You are a friendly study tutor for a student's class notes. Answer ONLY from the note content below unless the question is general knowledge. Keep answers under 120 words, clear and encouraging. ${styleHint(style)} Reply in the note's language.

NOTE TITLE: ${title || 'Untitled'}
SUBJECT: ${subject || 'General'}
NOTE:
---
${(note || '').slice(0, 6000)}
---`;
  return aiText({ system: sys, user: question, history: history.slice(-8), maxTokens: 1500, timeoutMs: 180000 });
}

// ---------------- 2. TL;DR summary ----------------
export async function summarizeNote({ note, subject, style }) {
  const sys = `Summarize the student's note in one short paragraph (max 80 words), capturing the key ideas a student must remember. ${styleHint(style)} Reply in the note's language. Output ONLY the summary text.`;
  return aiText({ system: sys, user: (note || '').slice(0, 6000), maxTokens: 500, timeoutMs: 120000 });
}

// ---------------- 3. OCR (photo → text) ----------------
export async function ocrImage({ imageDataUrl, subject }) {
  const sys = 'You are an OCR assistant. Transcribe ALL visible handwritten or printed text from the image exactly as written, preserving line breaks. Clean up obvious OCR artifacts but never invent content. Output ONLY the transcribed text.';
  return aiVision({
    system: sys,
    user: `Transcribe all text from this ${subject || ''} note photo. Output only the text.`,
    imageDataUrl,
    maxTokens: 2000,
  });
}

// ---------------- 4. Explain a photo ----------------
export async function explainImage({ imageDataUrl, noteContext, subject, style }) {
  const sys = `You are a study tutor. The student photographed part of their study material. Explain what the image shows and the key ideas to learn from it, in under 120 words. ${styleHint(style)} Reply in the same language as any text in the image.`;
  const ctx = noteContext ? `Note context (may help): ${noteContext.slice(0, 1500)}` : '';
  return aiVision({
    system: sys,
    user: `Explain this image for studying.${ctx ? '\n\n' + ctx : ''}`,
    imageDataUrl,
    maxTokens: 1200,
  });
}

// ---------------- 5. Fill-in-the-blank (cloze) ----------------
export async function generateCloze({ note, subject, count = 8 }) {
  const sys = `Create ${count} fill-in-the-blank study questions from the note. Each takes one KEY word or short phrase from the note and replaces it with "____".
OUTPUT: ONLY valid JSON: {"items": [{"text": "sentence with ____ inside", "answer": "the missing word(s)"}]}
Rules: answers must appear in the note; vary which concepts are tested; reply in the note's language.`;
  const raw = await aiText({ system: sys, user: (note || '').slice(0, 6000), maxTokens: 2000, timeoutMs: 180000 });
  const d = parseJson(raw);
  return (d.items || []).filter(i => i && i.text && i.answer);
}

// ---------------- 6. Mnemonics ----------------
export async function generateMnemonics({ note, subject }) {
  const sys = `From the note, extract up to 6 key terms/lists and create a memorable mnemonic or memory hook for each (acronyms, rhymes, vivid associations).
OUTPUT: ONLY valid JSON: {"items": [{"term": "the term or list", "hook": "the mnemonic"}]}
Reply in the note's language. Make hooks genuinely memorable, not generic.`;
  const raw = await aiText({ system: sys, user: (note || '').slice(0, 6000), maxTokens: 1500, timeoutMs: 180000 });
  const d = parseJson(raw);
  return (d.items || []).filter(i => i && i.term && i.hook);
}

// ---------------- 7. Exam predictor ----------------
export async function predictExamQuestions({ notes, subject, count = 6 }) {
  const notesText = notes.map((n, i) => `Note ${i + 1} — ${n.title || 'Untitled'}:\n${(n.body || '').slice(0, 1500)}`).join('\n\n');
  const sys = `You are an experienced examiner. From these ${subject || ''} class notes, predict ${count} likely EXAM questions and write a model answer (2-4 sentences) for each.
OUTPUT: ONLY valid JSON: {"items": [{"question": "...", "answer": "model answer"}]}
Questions should test understanding, not trivia. Vary difficulty. Reply in the notes' language.`;
  const raw = await aiText({ system: sys, user: notesText.slice(0, 8000), maxTokens: 3000, timeoutMs: 240000 });
  const d = parseJson(raw);
  return (d.items || []).filter(i => i && i.question && i.answer);
}

// ---------------- 8. Weakness detection ----------------
export async function analyzeWeakness({ note, quiz, answers, style }) {
  // quiz: [{question, choices, answer}], answers: {index: pickedIndex or null}
  const qa = quiz.map((q, i) => ({
    question: q.question,
    correct: q.choices[q.answer],
    yourAnswer: answers[i] != null ? q.choices[answers[i]] : '(skipped)',
    correct_: answers[i] === q.answer,
  }));
  const sys = `A student took a quiz on their notes. Identify their weak areas and create 3 targeted practice questions.
OUTPUT: ONLY valid JSON: {"weakAreas": ["area1", "area2"], "practice": [{"question": "...", "choices": ["A","B","C","D"], "answer": 0}]}
Base everything on the quiz results and the note. Reply in the note's language.`;
  const user = `NOTE:\n---\n${(note || '').slice(0, 4000)}\n---\nQUIZ RESULTS:\n${JSON.stringify(qa, null, 1)}${styleHint(style)}`;
  const raw = await aiText({ system: sys, user, maxTokens: 2000, timeoutMs: 180000 });
  const d = parseJson(raw);
  return { weakAreas: d.weakAreas || [], practice: (d.practice || []).filter(p => p.question && Array.isArray(p.choices) && p.choices.length >= 2) };
}

// ---------------- 9. Answer grader ----------------
export async function gradeAnswer({ note, question, userAnswer, style }) {
  const sys = `You are a strict but fair examiner. Grade the student's answer against the study notes.
OUTPUT: ONLY valid JSON: {"score": <0-100>, "verdict": "excellent|good|partial|poor", "feedback": "2-3 sentences: what was right, what was missing, how to improve"}
Grade on accuracy and completeness vs the notes, not writing style. Reply in the notes' language. ${styleHint(style)}`;
  const user = `NOTES:\n---\n${(note || '').slice(0, 5000)}\n---\nQUESTION: ${question}\n\nSTUDENT ANSWER: ${userAnswer || '(empty)'}`;
  const raw = await aiText({ system: sys, user, maxTokens: 1200, timeoutMs: 180000 });
  const d = parseJson(raw);
  return {
    score: Number.isFinite(Number(d.score)) ? Math.max(0, Math.min(100, Number(d.score))) : 0,
    verdict: typeof d.verdict === 'string' ? d.verdict : 'unknown',
    feedback: typeof d.feedback === 'string' ? d.feedback : '',
  };
}

// ---------------- 10. Cross-note links ----------------
export async function findRelatedNotes({ currentNote, otherNotes }) {
  const list = otherNotes.map((n, i) => `${i}: ${(n.title || 'Untitled')} — ${(n.body || '').slice(0, 300).replace(/\n/g, ' ')}`).join('\n');
  const sys = `Identify which of the student's OTHER notes relate to the current note (shared concepts, prerequisites, same topic).
OUTPUT: ONLY valid JSON: {"links": [{"index": <number from the list>, "reason": "why they relate (one short sentence)"}]}
Only include genuinely related notes (max 4). If none relate, return {"links": []}. Reply in the current note's language.`;
  const user = `CURRENT NOTE: ${(currentNote.title || 'Untitled')}\n${(currentNote.body || '').slice(0, 2500)}\n\nOTHER NOTES:\n${list.slice(0, 7000)}`;
  const raw = await aiText({ system: sys, user, maxTokens: 1200, timeoutMs: 180000 });
  const d = parseJson(raw);
  return (d.links || []).filter(l => Number.isInteger(l.index) && otherNotes[l.index]).map(l => ({
    note: otherNotes[l.index],
    reason: l.reason || '',
  }));
}