/**
 * Client-side AI engine — runs directly against the user's chosen OpenAI-compatible provider.
 * Reuses shared/aiPrompts.js and shared/aiParsers.js for 100% parity with the server engine.
 */
import { getDirectConfig, getExplainStyle } from './aiConfig';
import { createAbortController } from './aiCore';
import {
  CHUNK_SIZE,
  MAX_CONCURRENT,
  SYSTEM_PROMPT,
  BLOCKS_SYSTEM_PROMPT,
  STUDY_SYSTEM_PROMPT,
  buildScanNoteUserPrompt,
  buildScanChunkUserPrompt,
  buildScanLinePrompt,
  buildExamSummaryPrompt,
  mapPool,
} from '../../shared/aiPrompts.js';
import {
  parseScanResult,
  parseLineResult,
  parseExamResult,
} from '../../shared/aiParsers.js';

/** Call the configured direct provider with a timeout. */
export async function callAI({ system, user, maxTokens = 8192, timeoutMs = 180000, signal = null }) {
  const { baseUrl, key, model } = getDirectConfig();

  if (!key) throw new Error('No API key configured. Set your key in Settings → AI backend.');
  if (!baseUrl) throw new Error('No base URL configured for the selected provider.');
  if (!model) throw new Error('No model configured for the selected provider.');

  const ctrl = createAbortController(timeoutMs, signal);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: ctrl.signal,
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
      if (ctrl.wasTimeout()) {
        const e = new Error('__abort__');
        e.isAbortTimeout = true;
        throw e;
      }
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    throw err;
  } finally {
    ctrl.cleanup();
  }
}

/** Scan a single chunk using BLOCKS_SYSTEM_PROMPT (never redundantly requesting quiz/cards). */
async function scanChunk(lines, startIdx, subject, style, targetLines = null, signal = null) {
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
    signal,
  });
  const parsed = parseScanResult(raw);
  const allowed = targetLines ? new Set(targetLines) : null;
  return parsed.blocks.filter(b => {
    const n = parseInt(String(b.id).replace('line-', ''), 10);
    if (!Number.isFinite(n) || n < startIdx + 1 || n > endIdx) return false;
    return allowed ? allowed.has(n) : true;
  });
}

/** Scan a single line (explain simpler / give example). */
export async function scanLine(note, line, request = 'simpler', style = null) {
  const activeStyle = style || getExplainStyle();
  const prompt = buildScanLinePrompt({ note: note || '', line, request, style: activeStyle });

  const raw = await callAI({
    system: 'You explain class notes. Reply only with valid JSON.',
    user: prompt,
    maxTokens: 1024,
    timeoutMs: 120000,
  });

  return parseLineResult(raw);
}

/** Scan a full note or changed lines (chunks automatically when > CHUNK_SIZE lines). */
export async function scanNote({ note, subject, changedLines, style = null, signal = null }) {
  const activeStyle = style || getExplainStyle();
  const lines = String(note || '').split('\n');
  const validChanged = Array.isArray(changedLines)
    ? [...new Set(changedLines.filter(n => Number.isInteger(n) && n >= 1 && n <= lines.length))].sort((a, b) => a - b)
    : [];
  const onlyChanged = validChanged.length > 0;

  if ((onlyChanged && validChanged.length <= CHUNK_SIZE) || (!onlyChanged && lines.length <= CHUNK_SIZE)) {
    const userPrompt = buildScanNoteUserPrompt({
      lines,
      subject,
      changedLines: onlyChanged ? validChanged : null,
      style: activeStyle,
    });
    const timeoutMs = Math.min(60000 + lines.length * 4000, 480000);
    try {
      const content = await callAI({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 8192,
        timeoutMs,
        signal,
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

  // Chunked parallel scan for long notes OR large edits (> CHUNK_SIZE lines)
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
        return await scanChunk(lines, job.start, subject, activeStyle, job.targetLines, signal);
      } catch (e) {
        if (e?.isCancelled) throw e;
        try {
          return await scanChunk(lines, job.start, subject, activeStyle, job.targetLines, signal);
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
          signal,
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

  return {
    blocks,
    flashcards: study?.flashcards || [],
    quiz: study?.quiz || [],
  };
}

/** Exam summary from all notes in a folder. */
export async function examSummary({ subject, notes, style = null, signal = null }) {
  if (!notes?.length) throw new Error('No notes to summarize.');
  const activeStyle = style || getExplainStyle();
  const prompt = buildExamSummaryPrompt({ subject, notes, style: activeStyle });

  const raw = await callAI({
    system: 'You create exam study packs from class notes. Reply only with valid JSON.',
    user: prompt,
    maxTokens: 8192,
    timeoutMs: 300000,
    signal,
  });

  return parseExamResult(raw);
}
