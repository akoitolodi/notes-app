/**
 * writingCoach — 100% offline, deterministic, LaTeX- & code-safe Writing Craft
 * & Style Coach.
 *
 * Helps students strengthen their own essays & study reports cleanly:
 * - Preserves fenced code blocks, inline code, and $LaTeX$ / $$LaTeX$$ math
 * - Computes Flesch-Kincaid readability grade level & reading time
 * - Scores sentence rhythm & cadence variety (flags monotonous runs)
 * - Detects repeated 3-gram phrases, passive voice, and wordy filler phrases
 *   with 1-tap safe replacements that never touch equations or code
 */

const PROTECTED_TOKEN_RE =
  /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;

const WORDY_RULES = [
  { phrase: 'in order to', replacement: 'to', note: 'Tighter phrasing' },
  { phrase: 'due to the fact that', replacement: 'because', note: 'More direct' },
  { phrase: 'at this point in time', replacement: 'now', note: 'Remove filler' },
  { phrase: 'for the purpose of', replacement: 'for', note: 'More concise' },
  { phrase: 'a large number of', replacement: 'many', note: 'Simpler quantifier' },
  { phrase: 'in the event that', replacement: 'if', note: 'More direct' },
  { phrase: 'has the ability to', replacement: 'can', note: 'Active verb' },
  { phrase: 'make a decision', replacement: 'decide', note: 'Stronger verb' },
  { phrase: 'in close proximity to', replacement: 'near', note: 'More concise' },
  { phrase: 'on a daily basis', replacement: 'daily', note: 'Tighter phrasing' },
  { phrase: 'it is important to note that', replacement: 'notably,', note: 'Trim throat-clearing' },
];

const PASSIVE_RE =
  /\b(?:am|is|are|was|were|be|been|being)\s+([a-z]{3,}ed|written|made|done|given|taken|shown|known|seen|built|found|used|sent|kept|held|told)\b(?:\s+by\b)?/gi;

/** Remove fenced code, inline code, LaTeX math, and Markdown syntax for clean prose analysis. */
export function extractProseForAnalysis(rawText) {
  return String(rawText || '')
    .replace(PROTECTED_TOKEN_RE, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s*(?:\[[ xX]\]\s*)?/gm, '')
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_, t, a) => a || t)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countSyllables(word) {
  const w = String(word || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Analyze writing craft deterministically offline while ignoring code & LaTeX equations. */
export function analyzeWritingCraft(rawText) {
  const prose = extractProseForAnalysis(rawText);
  if (!prose) {
    return {
      words: 0,
      sentences: 0,
      readingMinutes: 0,
      gradeLevel: 0,
      readabilityLabel: 'Start writing to analyze style',
      rhythmScore: 100,
      monotonousRuns: [],
      repeatedPhrases: [],
      passiveHits: [],
      wordyFixes: [],
      protectedCount: 0,
    };
  }

  const protectedMatches = String(rawText || '').match(PROTECTED_TOKEN_RE) || [];
  const wordsArr = prose.match(/[A-Za-z0-9'-]+/g) || [];
  const wordCount = wordsArr.length;
  const sentencesArr = prose
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => /[A-Za-z0-9]/.test(s));
  const sentenceCount = Math.max(1, sentencesArr.length);

  let totalSyllables = 0;
  for (const w of wordsArr) totalSyllables += countSyllables(w);

  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = wordCount > 0 ? totalSyllables / wordCount : 1;
  const rawGrade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  const gradeLevel = Math.max(1, Math.min(18, Math.round(rawGrade * 10) / 10));

  const readabilityLabel =
    gradeLevel <= 8
      ? 'Easy & Conversational'
      : gradeLevel <= 12
        ? 'Clear & Academic'
        : gradeLevel <= 15
          ? 'College / Technical'
          : 'Dense — consider shorter sentences';

  // Sentence rhythm & cadence variety
  const sentLengths = sentencesArr.map(s => (s.match(/[A-Za-z0-9'-]+/g) || []).length);
  const meanLen = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
  const variance =
    sentLengths.reduce((acc, len) => acc + Math.pow(len - meanLen, 2), 0) / sentLengths.length;
  const stdDev = Math.sqrt(variance);

  const monotonousRuns = [];
  for (let i = 0; i <= sentencesArr.length - 3; i++) {
    const firstWords = [0, 1, 2].map(k =>
      ((sentencesArr[i + k].match(/^[A-Za-z]+/) || [''])[0] || '').toLowerCase()
    );
    if (firstWords[0] && firstWords[0] === firstWords[1] && firstWords[1] === firstWords[2]) {
      monotonousRuns.push(`3 sentences in a row start with "${firstWords[0]}"`);
    }
  }

  let rhythmScore = sentenceCount < 3 ? 85 : Math.min(100, Math.round(55 + stdDev * 6));
  if (avgWordsPerSentence > 28) rhythmScore = Math.max(35, rhythmScore - 15);
  if (monotonousRuns.length > 0) rhythmScore = Math.max(30, rhythmScore - monotonousRuns.length * 12);

  // Repeated 3-gram phrases (ignore common glue phrases)
  const lowerWords = wordsArr.map(w => w.toLowerCase());
  const trigramCounts = new Map();
  for (let i = 0; i <= lowerWords.length - 3; i++) {
    const tri = `${lowerWords[i]} ${lowerWords[i + 1]} ${lowerWords[i + 2]}`;
    if (tri.length < 10) continue;
    trigramCounts.set(tri, (trigramCounts.get(tri) || 0) + 1);
  }
  const repeatedPhrases = [...trigramCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => ({ phrase, count }));

  // Passive voice detector
  const passiveHits = [];
  PASSIVE_RE.lastIndex = 0;
  let pm;
  while ((pm = PASSIVE_RE.exec(prose)) !== null && passiveHits.length < 6) {
    passiveHits.push(pm[0]);
  }

  // Deterministic wordiness fixes present in prose
  const lowerProse = prose.toLowerCase();
  const wordyFixes = WORDY_RULES.filter(rule => {
    const re = new RegExp(`\\b${rule.phrase.replace(/\s+/g, '\\s+')}\\b`, 'i');
    return re.test(lowerProse);
  });

  return {
    words: wordCount,
    sentences: sentencesArr.length,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 200)),
    gradeLevel,
    readabilityLabel,
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    rhythmScore,
    monotonousRuns: [...new Set(monotonousRuns)].slice(0, 3),
    repeatedPhrases,
    passiveHits: [...new Set(passiveHits)],
    wordyFixes,
    protectedCount: protectedMatches.length,
  };
}

/**
 * Safely apply a conciseness fix only to prose segments, NEVER modifying
 * fenced code blocks, inline code, or $LaTeX$ / $$LaTeX$$ math!
 */
export function applySafeWordyFix(rawText, badPhrase, replacement) {
  const parts = String(rawText || '').split(PROTECTED_TOKEN_RE);
  const re = new RegExp(`\\b${badPhrase.replace(/\s+/g, '\\s+')}\\b`, 'gi');
  return parts
    .map((segment, idx) => {
      // Odd indices are captured protected tokens (code/LaTeX) — keep untouched!
      if (idx % 2 === 1) return segment;
      return segment.replace(re, match => {
        if (match[0] && match[0] === match[0].toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    })
    .join('');
}
