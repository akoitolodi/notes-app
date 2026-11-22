/**
 * Frontend API client — /api/scan-line.
 * Routes based on the AI backend mode (Settings → AI Backend).
 */
import { API_BASE } from '../config';
import { getAiMode } from '../lib/aiConfig';
import { scanLine as directScanLine } from '../lib/aiDirect';

export async function scanLine(note, line, request = 'simpler') {
  if (getAiMode() === 'direct') {
    return directScanLine(note, line, request);
  }

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