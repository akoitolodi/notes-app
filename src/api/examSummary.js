/**
 * Frontend API client — /api/exam-summary.
 */
export async function examSummary(subject, notes) {
  const res = await fetch('/api/exam-summary', {
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