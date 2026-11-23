/**
 * Shared AI response parsers and normalizers.
 * Consumed by both server (lib/) and client direct engine (src/lib/)
 * so behavior never drifts between Termux/Vercel and Direct API modes.
 */

/**
 * Strip reasoning-model <think>...</think> blocks (e.g., DeepSeek-R1, QwQ).
 * IMPORTANT: Remove complete blocks FIRST, then any stray orphan tags.
 */
export function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

/**
 * Extract the first complete, balanced JSON object from a string.
 * Handles markdown code fences, prose before/after, and concatenated objects.
 */
export function extractFirstJsonObject(raw) {
  let text = stripThinking(raw);

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI reply did not contain a JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('AI reply contained an unterminated JSON object');
}

/**
 * Parse a JSON object from raw LLM text with a fallback that strips stray prose lines.
 */
export function parseJsonObject(raw) {
  try {
    const obj = extractFirstJsonObject(raw);
    return JSON.parse(obj);
  } catch (err) {
    const lines = stripThinking(raw)
      .split('\n')
      .filter(l => {
        const t = l.trim();
        return t.startsWith('{') || t.startsWith('"') || t.startsWith('[') || t.includes('}');
      });
    if (lines.length) {
      try {
        return JSON.parse(extractFirstJsonObject(lines.join('\n')));
      } catch {
        // Fall through to original error
      }
    }
    throw new Error(`AI reply was not valid JSON: ${err.message}`);
  }
}

/** Clamp a quiz answer index to a valid choice index. */
function normalizeQuiz(quiz) {
  if (!Array.isArray(quiz)) return [];
  return quiz
    .filter(q => q && typeof q.question === 'string' && q.question.trim())
    .map(q => {
      const choices = Array.isArray(q.choices) ? q.choices.map(String).filter(Boolean) : [];
      const n = Number(q.answer);
      const validAnswer =
        Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n < choices.length ? n : 0;
      return {
        question: q.question.trim(),
        choices,
        answer: validAnswer,
        ...(typeof q.explanation === 'string' && q.explanation.trim()
          ? { explanation: q.explanation.trim() }
          : {}),
      };
    })
    .filter(q => q.choices.length >= 2);
}

function normalizeFlashcards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter(c => c && typeof c.q === 'string' && c.q.trim())
    .map(c => ({
      q: c.q.trim(),
      a: typeof c.a === 'string' ? c.a.trim() : '',
    }));
}

function normalizeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms
    .filter(t => t && typeof t.term === 'string' && t.term.trim())
    .map(t => ({
      term: t.term.trim(),
      definition: typeof t.definition === 'string' ? t.definition.trim() : '',
    }));
}

export function parseScanResult(raw) {
  const parsed = parseJsonObject(raw);
  return {
    blocks: Array.isArray(parsed.blocks)
      ? parsed.blocks.map((b, i) => {
          const id = typeof b?.id === 'string' ? b.id : '';
          const digits = /\d+/.exec(id);
          return {
            id: digits ? `line-${parseInt(digits[0], 10)}` : `line-${i + 1}`,
            text: typeof b?.text === 'string' ? b.text : '',
            explanation: typeof b?.explanation === 'string' ? b.explanation.trim() : '',
            terms: normalizeTerms(b?.terms),
            mistake:
              b?.mistake && typeof b.mistake === 'object'
                ? {
                    reason: String(b.mistake.reason || '').trim(),
                    correction: String(b.mistake.correction || '').trim(),
                  }
                : null,
          };
        })
      : [],
    flashcards: normalizeFlashcards(parsed.flashcards),
    quiz: normalizeQuiz(parsed.quiz),
  };
}

export function parseLineResult(raw) {
  const parsed = parseJsonObject(raw);
  return {
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
  };
}

export function parseExamResult(raw) {
  const parsed = parseJsonObject(raw);
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    flashcards: normalizeFlashcards(parsed.flashcards),
    quiz: normalizeQuiz(parsed.quiz),
  };
}
