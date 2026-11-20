/**
 * Frontend API client — calls /api/scan-line which proxies to the AI.
 */
export async function scanLine(note, line, request = 'simpler') {
  const res = await fetch('/api/scan-line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note, line, request }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}