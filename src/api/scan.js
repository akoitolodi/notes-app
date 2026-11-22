/**
 * Frontend API client — /api/scan.
 * Routes based on the AI backend mode (Settings → AI Backend):
 *   - 'termux' (default): POST to the local Termux server
 *   - 'direct': run the AI engine in-app against the chosen provider
 */
import { API_BASE } from '../config';
import { getAiMode } from '../lib/aiConfig';
import { scanNote as directScanNote } from '../lib/aiDirect';

export async function scanNote(note, subject, changedLines) {
  if (getAiMode() === 'direct') {
    return directScanNote({ note, subject, changedLines });
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, subject, changedLines }),
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