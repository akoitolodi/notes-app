/**
 * Frontend API client — /api/exam-summary.
 */
import { API_BASE } from '../config';

export async function examSummary(subject, notes) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/exam-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, notes }),
    });
  } catch {
    throw new Error(
      `Can't reach the AI backend${API_BASE ? ` at ${API_BASE}` : ''}. ` +
      'If you are using the phone app, start the Termux server: node server.js'
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Exam summary failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}