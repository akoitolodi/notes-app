/**
 * Shared server-side AI logic — used by server.js and api/* serverless handlers.
 * Uses shared/aiPrompts.js and shared/aiParsers.js so server and direct-API modes
 * share identical prompts, chunking, and response normalization.
 */
import {
  CHUNK_SIZE,
  MAX_CONCURRENT,
  SYSTEM_PROMPT,
  BLOCKS_SYSTEM_PROMPT,
  STUDY_SYSTEM_PROMPT,
  CONSISTENCY_SYSTEM_PROMPT,
  buildScanNoteUserPrompt,
  buildScanChunkUserPrompt,
  mapPool,
} from '../shared/aiPrompts.js';
import { parseScanResult, stripThinking } from '../shared/aiParsers.js';

function getServerAiConfig(modelOverride = null) {
  const apiKey = (process.env.FREELLMAPI_API_KEY || '').trim();
  const baseUrl = (process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1')
    .trim()
    .replace(/\/+$/, '');
  const model = (modelOverride || process.env.FREELLMAPI_MODEL || 'auto').trim();
  return { apiKey, baseUrl, model };
}

export function getAiConfigStatus() {
  const { apiKey, baseUrl, model } = getServerAiConfig();
  return {
    ok: true,
    configured: Boolean(apiKey),
    baseUrl,
    model,
  };
}

/** Call the configured OpenAI-compatible AI endpoint with a timeout. */
export async function callAI({
  system,
  user,
  maxTokens = 8192,
  timeoutMs = 180000,
  temperature = 0.3,
  modelOverride = null,
}) {
  const { apiKey, baseUrl, model } = getServerAiConfig(modelOverride);

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  if (typeof system !== 'string' || typeof user !== 'string') {
    throw new Error('callAI: system and user must be strings');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`AI API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI returned no content');
    return content;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('__abort__');
      e.isAbortTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Scan a single chunk of lines (with 3 lines of preceding context). */
async function scanChunk(lines, startIdx, subject, style, targetLines = null) {
  const endIdx = Math.min(startIdx + CHUNK_SIZE, lines.length);
  const user = buildScanChunkUserPrompt({
    lines,
    startIdx,
    endIdx,
    subject,
    style,
    targetLines,
  });

  const raw = await callAI({
    system: BLOCKS_SYSTEM_PROMPT,
    user,
    maxTokens: 4096,
    timeoutMs: 180000,
  });
  const parsed = parseScanResult(raw);
  const allowed = targetLines ? new Set(targetLines) : null;
  return parsed.blocks.filter(b => {
    const n = parseInt(String(b.id).replace('line-', ''), 10);
    if (!Number.isFinite(n) || n < startIdx + 1 || n > endIdx) return false;
    return allowed ? allowed.has(n) : true;
  });
}

/**
 * Consistency check pass — reviews multi-chunk explanations for contradictions/terminology drift.
 * Preserves full term objects (fixing the bug where terms were wiped out).
 */
async function checkConsistency(blocks, subject) {
  if (blocks.length <= 1) return blocks;

  const reviewPayload = blocks.map(b => ({
    id: b.id,
    text: b.text,
    explanation: b.explanation,
    terms: b.terms || [],
  }));

  const user = [
    `Subject: ${subject || 'General'}`,
    '',
    'Review these explanations for consistency:',
    '---',
    JSON.stringify(reviewPayload, null, 2),
    '---',
    '',
    'Return ONLY blocks that need fixing (contradictions, terminology drift).',
    'If all good, return {"blocks": []}.',
  ].join('\n');

  try {
    const raw = await callAI({
      system: CONSISTENCY_SYSTEM_PROMPT,
      user,
      maxTokens: 4096,
      timeoutMs: 90000,
    });
    const parsed = parseScanResult(raw);
    const fixes = parsed.blocks || [];
    if (fixes.length === 0) return blocks;

    const fixMap = new Map(fixes.map(f => [f.id, f]));
    return blocks.map(b => {
      const fix = fixMap.get(b.id);
      if (!fix) return b;
      return {
        ...b,
        explanation: fix.explanation || b.explanation,
        terms: fix.terms && fix.terms.length > 0 ? fix.terms : b.terms,
        mistake: fix.mistake !== undefined ? fix.mistake : b.mistake,
      };
    });
  } catch {
    return blocks;
  }
}

export async function scanNote({ note, subject, changedLines, style = 'default' }) {
  const lines = String(note || '').split('\n');
  const validChanged = Array.isArray(changedLines)
    ? [...new Set(changedLines.filter(n => Number.isInteger(n) && n >= 1 && n <= lines.length))].sort((a, b) => a - b)
    : [];
  const onlyChanged = validChanged.length > 0;

  // Fast single-call path: short full note OR small incremental edit (<= CHUNK_SIZE lines)
  if ((onlyChanged && validChanged.length <= CHUNK_SIZE) || (!onlyChanged && lines.length <= CHUNK_SIZE)) {
    const userPrompt = buildScanNoteUserPrompt({
      lines,
      subject,
      changedLines: onlyChanged ? validChanged : null,
      style,
    });
    const timeoutMs = Math.min(60000 + lines.length * 4000, 480000);
    try {
      const content = await callAI({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 8192,
        timeoutMs,
      });
      return parseScanResult(content);
    } catch (err) {
      if (err.isAbortTimeout) {
        throw new Error(
          'The AI needed more time for this note and was stopped. Tap Explain again — it will resume where it left off.'
        );
      }
      throw err;
    }
  }

  // Chunked parallel path: long full note OR large edit (> CHUNK_SIZE changed lines)
  const chunkJobs = [];
  if (onlyChanged) {
    const changedSet = new Set(validChanged);
    for (let s = 0; s < lines.length; s += CHUNK_SIZE) {
      const end = Math.min(s + CHUNK_SIZE, lines.length);
      const targets = [];
      for (let ln = s + 1; ln <= end; ln++) {
        if (changedSet.has(ln)) targets.push(ln);
      }
      if (targets.length > 0) chunkJobs.push({ start: s, targetLines: targets });
    }
  } else {
    for (let s = 0; s < lines.length; s += CHUNK_SIZE) {
      chunkJobs.push({ start: s, targetLines: null });
    }
  }

  const [chunkResults, study] = await Promise.all([
    mapPool(chunkJobs, MAX_CONCURRENT, async job => {
      try {
        return await scanChunk(lines, job.start, subject, style, job.targetLines);
      } catch {
        try {
          return await scanChunk(lines, job.start, subject, style, job.targetLines);
        } catch {
          return null;
        }
      }
    }),
    (async () => {
      const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
      try {
        const raw = await callAI({
          system: STUDY_SYSTEM_PROMPT,
          user: `Subject: ${subject || 'General'}\n\nNote:\n---\n${numbered.slice(0, 12000)}\n---\n\nProduce the JSON now.`,
          maxTokens: 2048,
          timeoutMs: 240000,
        });
        return parseScanResult(raw);
      } catch {
        return null;
      }
    })(),
  ]);

  const blocks = chunkResults
    .filter(Boolean)
    .flat()
    .sort((a, b) => {
      const na = parseInt(String(a.id).replace('line-', ''), 10);
      const nb = parseInt(String(b.id).replace('line-', ''), 10);
      return na - nb;
    });

  if (blocks.length === 0) {
    throw new Error(
      'The AI could not scan this long note right now — the server may be busy. Tap Explain again in a moment.'
    );
  }

  const consistentBlocks = chunkJobs.length > 1 ? await checkConsistency(blocks, subject) : blocks;

  return {
    blocks: consistentBlocks,
    flashcards: study?.flashcards || [],
    quiz: study?.quiz || [],
  };
}

/** Validate multi-message chat payload. */
export function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('chat: "messages" must be a non-empty array');
  }
  if (messages.length > 60) throw new Error('chat: too many messages');
  for (const m of messages) {
    if (!m || typeof m.role !== 'string' || !['system', 'user', 'assistant'].includes(m.role)) {
      throw new Error('chat: invalid message role');
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      throw new Error('chat: invalid message content');
    }
  }
}

/** Generic multi-message chat — powers Chat, Summary, OCR, Study features. */
export async function chat({ messages, maxTokens = 2048, timeoutMs = 180000, modelOverride = null }) {
  const { apiKey, baseUrl, model } = getServerAiConfig(modelOverride);

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  validateChatMessages(messages);
  const safeMaxTokens = Math.min(Math.max(Number(maxTokens) || 2048, 1), 4096);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: safeMaxTokens }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`AI API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI returned no content');
    return stripThinking(content);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('The AI needed more time and was stopped. Try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Streaming chat — returns upstream Response with text/event-stream body. */
export async function chatStream({ messages, maxTokens = 2048, modelOverride = null, signal = null }) {
  const { apiKey, baseUrl, model } = getServerAiConfig(modelOverride);

  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not configured');
  validateChatMessages(messages);
  const safeMaxTokens = Math.min(Math.max(Number(maxTokens) || 2048, 1), 4096);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: safeMaxTokens,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI API error ${response.status}: ${body.slice(0, 300)}`);
  }

  return response;
}
