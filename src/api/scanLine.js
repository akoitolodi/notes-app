/**
 * Frontend API client — calls /api/scan-line which proxies to the AI.
 */
import { API_BASE } from '../config';

export async function scanLine(note, line, request = 'simpler') {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/scan-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, line, request }),
    });
  } catch {
    throw new Error(
      `Can't reach the AI backend${API_BASE ? ` at ${API_BASE}` : ''}. ` +
      'If you are using the phone app, start the Termux server: node server.js'
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}