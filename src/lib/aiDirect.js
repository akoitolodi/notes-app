/**
 * Client-side AI engine — runs directly against the user's chosen OpenAI-compatible provider.
 * Reuses shared/aiPrompts.js and shared/aiParsers.js for 100% parity with the server engine.
 */
import { getExplainStyle } from './aiConfig';
import { aiText } from './aiCore';
import { cleanAiOutputText } from './cleanAiText';
import { getScanModeDirective } from './noteModes';
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
  parseJsonObject,
} from '../../shared/aiParsers.js';

/** Call the configured direct provider through aiCore (gains automatic 429 retry & backup failover). */
export async function callAI({ system, user, maxTokens = 8192, timeoutMs = 180000, signal = null }) {
  return aiText({ system, user, maxTokens, timeoutMs, signal });
}

/** Scan a single chunk using BLOCKS_SYSTEM_PROMPT (never redundantly requesting quiz/cards). */
async function scanChunk(lines, startIdx, subject, style, targetLines = null, signal = null, noteMode = 'study') {
  const endIdx = Math.min(startIdx + CHUNK_SIZE, lines.length);
  const user = buildScanChunkUserPrompt({
    lines,
    startIdx,
    endIdx,
    subject,
    style,
    targetLines,
  });
  const modeDir = getScanModeDirective(noteMode);
  const system = modeDir ? `${BLOCKS_SYSTEM_PROMPT}\n\n${modeDir}` : BLOCKS_SYSTEM_PROMPT;

  const raw = await callAI({
    system,
    user,
    maxTokens: 4096,
    timeoutMs: 180000,
    signal,
  });
  const parsed = parseScanResult(raw);
  const allowed = targetLines ? new Set(targetLines) : null;
  return parsed.blocks
    .filter(b => {
      const n = parseInt(String(b.id).replace('line-', ''), 10);
      if (!Number.isFinite(n) || n < startIdx + 1 || n > endIdx) return false;
      return allowed ? allowed.has(n) : true;
    })
    .map(b => (noteMode === 'journal' ? { ...b, mistake: null } : b));
}

/** Scan a single line (explain simpler / give example). */
export async function scanLine(note, line, request = 'simpler', style = null) {
  const activeStyle = style || getExplainStyle();
  const prompt = buildScanLinePrompt({ note: note || '', line, request, style: activeStyle });

  const raw = await callAI({
    system: 'You explain class notes. Reply only with valid JSON.',
    user: prompt,
    maxTokens: 700,
    timeoutMs: 45000,
  });

  const parsed = parseLineResult(raw);
  return {
    ...parsed,
    explanation: cleanAiOutputText(parsed?.explanation || ''),
  };
}

/**
 * Fast lightweight explanation for a tapped line OR highlighted partial snippet (~1-2s).
 * Sends only a compact nearby context window and skips heavy flashcard/quiz generation.
 */
export async function explainSnippetFast({
  note = '',
  targetText = '',
  subject = 'General',
  style = null,
  isPartial = false,
} = {}) {
  const cleanTarget = String(targetText || '').trim();
  if (!cleanTarget) throw new Error('Select text or a line to explain.');
  const activeStyle = style || getExplainStyle();

  // Extract a small ~600-char local context window around targetText
  const full = String(note || '');
  const idx = full.indexOf(cleanTarget);
  let context = '';
  if (idx !== -1) {
    const start = Math.max(0, idx - 260);
    const end = Math.min(full.length, idx + cleanTarget.length + 260);
    context = full.slice(start, end).trim();
  } else {
    context = full.slice(0, 500).trim();
  }

  const userPrompt = [
    `Subject: ${subject || 'General'} | Style: ${activeStyle}`,
    isPartial ? `Selected phrase to explain ONLY:\n"${cleanTarget}"` : `Line to explain:\n"${cleanTarget}"`,
    context && context !== cleanTarget ? `Nearby note context:\n${context}` : '',
    'Reply ONLY with valid JSON: {"explanation":"concise clear explanation in plain text (no markdown * or #)","terms":[{"term":"...","definition":"..."}]} (0-2 key terms).',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await callAI({
    system:
      'You are a concise, fast study tutor. Explain ONLY the target phrase/line clearly in 2-4 sentences using plain text (no *, **, #, or $). Output valid JSON only.',
    user: userPrompt,
    maxTokens: 450,
    timeoutMs: 35000,
  });

  let parsed = null;
  try {
    parsed = parseJsonObject(raw);
  } catch {
    parsed = { explanation: raw, terms: [] };
  }
  const terms = Array.isArray(parsed?.terms)
    ? parsed.terms
        .filter(t => t && (t.term || t.definition || t.meaning))
        .map(t => ({
          term: cleanAiOutputText(t.term || ''),
          definition: cleanAiOutputText(t.definition || t.meaning || ''),
        }))
        .filter(t => t.term && t.definition)
    : [];
  return {
    explanation: cleanAiOutputText(parsed?.explanation || raw || ''),
    terms,
  };
}

/** Scan a full note or changed lines (chunks automatically when > CHUNK_SIZE lines). */
export async function scanNote({ note, subject, changedLines, style = null, noteMode = 'study', signal = null }) {
  const activeStyle = style || getExplainStyle();
  const modeDir = getScanModeDirective(noteMode);
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
        system: modeDir ? `${SYSTEM_PROMPT}\n\n${modeDir}` : SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 8192,
        timeoutMs,
        signal,
      });
      const res = parseScanResult(content);
      if (noteMode === 'journal') {
        return {
          blocks: (res.blocks || []).map(b => ({ ...b, mistake: null })),
          flashcards: [],
          quiz: [],
        };
      }
      return res;
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
        return await scanChunk(lines, job.start, subject, activeStyle, job.targetLines, signal, noteMode);
      } catch (e) {
        if (e?.isCancelled) throw e;
        try {
          return await scanChunk(lines, job.start, subject, activeStyle, job.targetLines, signal, noteMode);
        } catch {
          return null;
        }
      }
    }),
    noteMode === 'journal'
      ? Promise.resolve({ flashcards: [], quiz: [] })
      : (async () => {
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
