/**
 * Frontend API client — /api/scan.
 * Routes cleanly to Direct API or Termux/Vercel backend with current explanation style.
 */
import { getApiBase } from '../config';
import { getAiMode, getExplainStyle } from '../lib/aiConfig';
import { scanNote as directScanNote } from '../lib/aiDirect';

export async function scanNote(
  note,
  subject,
  changedLines,
  { style = null, noteMode = 'study', signal = null } = {}
) {
  const activeStyle = style || getExplainStyle();
  if (getAiMode() === 'direct') {
    return directScanNote({ note, subject, changedLines, style: activeStyle, noteMode, signal });
  }

  const apiBase = getApiBase();
  let res;
  try {
    res = await fetch(`${apiBase}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, subject, changedLines, style: activeStyle, noteMode }),
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
    const err = await res.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}
