/**
 * Per-line re-scan — "explain simpler" or "give example" for one line.
 * Reuses shared prompt builder, parser, and callAI from lib/ai.js.
 */
import { callAI } from './ai.js';
import { buildScanLinePrompt } from '../shared/aiPrompts.js';
import { parseLineResult } from '../shared/aiParsers.js';

export async function scanLine({ note, line, request = 'simpler', style = 'default' }) {
  if (!line || !line.trim()) throw new Error('No line to explain');

  const prompt = buildScanLinePrompt({ note: note || '', line, request, style });
  try {
    const raw = await callAI({
      system: 'You explain class notes. Reply only with valid JSON.',
      user: prompt,
      maxTokens: 1024,
      timeoutMs: 120000,
    });
    return parseLineResult(raw);
  } catch (err) {
    if (err?.isAbortTimeout) {
      throw new Error(
        'The AI needed more time and was stopped. Tap "Explain simpler" / "Give example" again.'
      );
    }
    throw err;
  }
}
