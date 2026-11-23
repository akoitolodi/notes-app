/**
 * Frontend API client — /api/exam-summary.
 */
import { getApiBase } from '../config';
import { getAiMode, getExplainStyle } from '../lib/aiConfig';
import { examSummary as directExamSummary } from '../lib/aiDirect';

export async function examSummary(subject, notes, { style = null, signal = null } = {}) {
  const activeStyle = style || getExplainStyle();
  if (getAiMode() === 'direct') {
    return directExamSummary({ subject, notes, style: activeStyle, signal });
  }

  const apiBase = getApiBase();
  let res;
  try {
    res = await fetch(`${apiBase}/api/exam-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, notes, style: activeStyle }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    throw new Error(
      `Can't reach the AI backend${apiBase ? ` at ${apiBase}` : ''}. ` +
        'Start the Termux server (node server.js) or switch to Direct API in Settings.'
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Exam summary failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}
