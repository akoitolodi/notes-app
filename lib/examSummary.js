/**
 * Exam summary — generate a structured summary, combined flashcards, and a
 * practice quiz from all notes in a folder.
 */
import { callAI } from './ai.js';
import { buildExamSummaryPrompt } from '../shared/aiPrompts.js';
import { parseExamResult } from '../shared/aiParsers.js';

export async function examSummary({ subject, notes, style = 'default' }) {
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error('No notes to summarize');
  }

  const prompt = buildExamSummaryPrompt({ subject, notes, style });
  try {
    const raw = await callAI({
      system: 'You create exam study packs from class notes. Reply only with valid JSON.',
      user: prompt,
      maxTokens: 8192,
      timeoutMs: 300000,
    });
    return parseExamResult(raw);
  } catch (err) {
    if (err?.isAbortTimeout) {
      throw new Error(
        'Building the exam summary took too long. Tap Regenerate on the Exam Summary screen to try again.'
      );
    }
    throw err;
  }
}
