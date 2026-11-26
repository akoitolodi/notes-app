/**
 * Frontend API client — /api/scan-line.
 */
import { getApiBase } from '../config';
import { getAiMode, getExplainStyle } from '../lib/aiConfig';
import { scanLine as directScanLine, explainSnippetFast } from '../lib/aiDirect';

export async function scanLine(note, line, request = 'simpler', style = null) {
  const activeStyle = style || getExplainStyle();
  if (getAiMode() === 'direct') {
    return directScanLine(note, line, request, activeStyle);
  }

  const apiBase = getApiBase();
  let res;
  try {
    res = await fetch(`${apiBase}/api/scan-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, line, request, style: activeStyle }),
    });
  } catch {
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

/**
 * Fast initial explanation for a single tapped line OR highlighted partial snippet.
 * Uses compact ~600-char context in Direct mode (~1-2s) and falls back cleanly in Termux mode.
 */
export async function explainSnippet({ note, targetText, subject = 'General', style = null, isPartial = false }) {
  const activeStyle = style || getExplainStyle();
  if (getAiMode() === 'direct') {
    return explainSnippetFast({ note, targetText, subject, style: activeStyle, isPartial });
  }
  const promptLine = isPartial ? `Explain only this selected part: "${targetText}"` : targetText;
  return scanLine(note, promptLine, 'simpler', activeStyle);
}
