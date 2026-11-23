/**
 * Pluggable Writing & Grammar Engine:
 * - Default: LanguageTool Free public API (0 keys needed!)
 * - Optional: Grammarly EDU / Enterprise Writing Score API (OAuth 2.0 client_credentials or Bearer token)
 * - Optional: LanguageTool Plus / Self-hosted (username + API key + custom URL)
 * - Optional: Sapling AI (API key)
 */
import { getGrammarConfig } from './aiConfig';
import { getApiBase } from '../config';

async function checkLanguageTool(text, { url, username = '', apiKey = '' } = {}, signal = null) {
  const endpoint = (url || 'https://api.languagetool.org/v2/check').trim();
  const body = new URLSearchParams();
  body.set('text', text.slice(0, 12000));
  body.set('language', 'auto');
  if (username.trim()) body.set('username', username.trim());
  if (apiKey.trim()) body.set('apiKey', apiKey.trim());

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LanguageTool HTTP ${res.status}${errText ? `: ${errText.slice(0, 80)}` : ''}`);
  }
  const data = await res.json();
  const issues = (data.matches || []).slice(0, 25).map((m, idx) => ({
    id: `lt-${idx}-${m.offset}`,
    message: m.message || 'Possible issue',
    shortMessage: m.shortMessage || m.rule?.category?.name || 'Grammar',
    offset: Number(m.offset) || 0,
    length: Number(m.length) || 0,
    badText: text.slice(m.offset, m.offset + m.length),
    replacements: (m.replacements || []).slice(0, 4).map(r => r.value).filter(Boolean),
  }));

  return {
    engine: apiKey ? 'LanguageTool Plus' : 'LanguageTool Free',
    issues,
    writingScore: null,
  };
}

async function checkSapling(text, apiKey, signal = null) {
  if (!apiKey?.trim()) {
    throw new Error('Paste your Sapling API key in Settings → Writing & Grammar, or switch to Free (LT).');
  }
  const res = await fetch('https://api.sapling.ai/api/v1/edits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: apiKey.trim(),
      text: text.slice(0, 8000),
      session_id: 'notes-by-bai',
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Sapling HTTP ${res.status}`);
  }
  const data = await res.json();
  const issues = (data.edits || []).slice(0, 25).map((e, idx) => {
    const offset = Number(e.sentence_start || 0) + Number(e.start || 0);
    const length = Math.max(0, Number(e.end || 0) - Number(e.start || 0));
    return {
      id: `sp-${idx}-${offset}`,
      message: e.general_error_type || 'Suggested edit',
      shortMessage: e.error_type || 'Grammar',
      offset,
      length,
      badText: text.slice(offset, offset + length),
      replacements: e.replacement ? [e.replacement] : [],
    };
  });
  return { engine: 'Sapling AI', issues, writingScore: null };
}

/**
 * Optional Grammarly EDU / Enterprise Writing Score connector.
 * Exchanges Client ID + Secret (or uses Bearer token) via local /api/grammar relay
 * when available, falling back to direct fetch, and pairs with free LanguageTool
 * for inline per-word fixes.
 */
async function checkGrammarly(text, cfg, signal = null) {
  const hasCreds = Boolean(
    cfg.grammarlyToken?.trim() ||
      (cfg.grammarlyClientId?.trim() && cfg.grammarlyClientSecret?.trim())
  );

  // Always pair with free LanguageTool inline fixes so student still gets 1-tap edits
  const ltPromise = checkLanguageTool(text, {}, signal).catch(() => ({
    engine: 'LanguageTool Free',
    issues: [],
    writingScore: null,
  }));

  if (!hasCreds) {
    const lt = await ltPromise;
    return {
      ...lt,
      engine: 'Grammarly (no credentials yet · using Free LT)',
      notice:
        'Add your school Grammarly Client ID & Secret (or Bearer token) in Settings → Writing & Grammar to enable official Grammarly Writing Scores.',
    };
  }

  let writingScore = null;
  let notice = null;

  try {
    const apiBase = getApiBase();
    const proxyUrl = `${apiBase || ''}/api/grammar`;
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 10000),
        clientId: cfg.grammarlyClientId?.trim() || '',
        clientSecret: cfg.grammarlyClientSecret?.trim() || '',
        token: cfg.grammarlyToken?.trim() || '',
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.score) writingScore = data.score;
      else if (data?.error) notice = data.error;
    } else {
      notice =
        'Grammarly OAuth requires the local/Vercel backend (/api/grammar) to avoid browser CORS blocks. Showing inline LanguageTool fixes below.';
    }
  } catch {
    notice =
      'Could not reach /api/grammar relay for Grammarly OAuth (CORS-protected on mobile direct mode). Showing free LanguageTool fixes below.';
  }

  const lt = await ltPromise;
  return {
    engine: writingScore ? 'Grammarly Score + LanguageTool' : 'LanguageTool Free',
    issues: lt.issues,
    writingScore,
    notice,
  };
}

/** Run the user's selected Grammar & Writing check cleanly. */
export async function runGrammarCheck(text, { signal = null } = {}) {
  const clean = String(text || '').trim();
  if (!clean) {
    return { engine: 'Grammar', issues: [], writingScore: null };
  }
  const cfg = getGrammarConfig();
  if (cfg.provider === 'grammarly') {
    return checkGrammarly(clean, cfg, signal);
  }
  if (cfg.provider === 'languagetool-plus') {
    return checkLanguageTool(
      clean,
      { url: cfg.ltUrl, username: cfg.ltUsername, apiKey: cfg.ltApiKey },
      signal
    );
  }
  if (cfg.provider === 'sapling') {
    return checkSapling(clean, cfg.saplingKey, signal);
  }
  return checkLanguageTool(clean, {}, signal);
}

/** Apply a single grammar replacement safely to note text. */
export function applyGrammarFix(fullText, issue, replacement) {
  const text = String(fullText || '');
  if (!issue || typeof replacement !== 'string') return text;
  const start = issue.offset;
  const end = issue.offset + issue.length;
  // Guard against offset drift if user already edited earlier in the text
  if (issue.badText && text.slice(start, end) === issue.badText) {
    return text.slice(0, start) + replacement + text.slice(end);
  }
  if (issue.badText) {
    const idx = text.indexOf(issue.badText);
    if (idx !== -1) {
      return text.slice(0, idx) + replacement + text.slice(idx + issue.badText.length);
    }
  }
  return text;
}
