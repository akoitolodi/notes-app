/**
 * Frontend API client — /api/exam-summary.
 */
import { API_BASE } from '../config';

export async function examSummary(subject, notes) {
  const res = await fetch(`${API_BASE}/api/exam-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, notes }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Exam summary failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}