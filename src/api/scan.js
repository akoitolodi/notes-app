/**
 * Frontend API client — calls /api/scan which proxies to the AI.
 */
export async function scanNote(note, subject, changedLines) {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note, subject, changedLines }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}