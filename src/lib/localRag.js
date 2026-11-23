/**
 * Local Cross-Note RAG & Line Grounding (100% offline, 0 API calls).
 *
 * Uses a fast Unicode-safe BM25 scorer over IndexedDB notes so:
 * - Quick Chat extracts relevant note lines locally (cutting API calls from 2 -> 1).
 * - Chat, Deep Think, Research, and Critical Audit automatically pull relevant
 *   excerpts from sibling notes in the same subject folder.
 */

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'of', 'to', 'for',
  'with', 'by', 'as', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'be',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'but', 'if', 'then', 'than', 'so', 'not', 'no', 'can', 'could', 'will', 'would',
  'should', 'may', 'might', 'about', 'into', 'what', 'why', 'how', 'when', 'where',
  'who', 'explain', 'tell', 'me', 'my', 'note', 'notes', 'please', 'help', 'understand',
]);

export function tokenize(text) {
  const matches = String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!matches) return [];
  return matches.filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Compute BM25 scores for an array of string documents against a query string.
 */
export function scoreBM25(docs, query) {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !docs.length) return docs.map(() => 0);

  const tokenizedDocs = docs.map(tokenize);
  const N = docs.length;
  const avgLen =
    tokenizedDocs.reduce((sum, t) => sum + t.length, 0) / Math.max(1, N) || 1;

  // Document frequency per query term
  const df = new Map();
  for (const qt of qTerms) {
    let count = 0;
    for (const tokens of tokenizedDocs) {
      if (tokens.includes(qt)) count += 1;
    }
    df.set(qt, count);
  }

  const k1 = 1.5;
  const b = 0.75;
  const lowerQuery = String(query || '').toLowerCase().trim();

  return tokenizedDocs.map((tokens, idx) => {
    if (!tokens.length) return 0;
    const freq = new Map();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

    let score = 0;
    for (const qt of qTerms) {
      const tf = freq.get(qt) || 0;
      if (!tf) continue;
      const nq = df.get(qt) || 0;
      const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1);
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tokens.length / avgLen))));
    }

    // Small boost for exact substring match
    if (lowerQuery.length >= 4 && String(docs[idx] || '').toLowerCase().includes(lowerQuery)) {
      score += 2.0;
    }
    return score;
  });
}

/**
 * Extract the most relevant lines from the current note locally (zero LLM calls).
 * Includes immediate 1-line neighbors for context coherence.
 */
export function extractRelevantLines(noteBody, question, { maxLines = 14 } = {}) {
  const rawLines = String(noteBody || '').split('\n');
  const nonEmpty = rawLines
    .map((text, idx) => ({ idx, text: text.trim() }))
    .filter(l => l.text.length > 0);

  if (nonEmpty.length <= maxLines) {
    return nonEmpty.map(l => l.text);
  }

  const scores = scoreBM25(
    nonEmpty.map(l => l.text),
    question
  );

  const ranked = nonEmpty
    .map((l, i) => ({ ...l, score: scores[i] }))
    .filter(l => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.ceil(maxLines * 0.7));

  if (!ranked.length) return [];

  const keepIndices = new Set();
  for (const r of ranked) {
    keepIndices.add(r.idx);
    if (r.idx > 0 && rawLines[r.idx - 1].trim()) keepIndices.add(r.idx - 1);
    if (r.idx + 1 < rawLines.length && rawLines[r.idx + 1].trim()) keepIndices.add(r.idx + 1);
  }

  return [...keepIndices]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map(i => rawLines[i].trim())
    .filter(Boolean);
}

/** Split a note body into paragraph chunks (~300-600 chars each) for cross-note RAG. */
function chunkNoteBody(body) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length >= 20);

  if (paragraphs.length > 0) return paragraphs;
  const trimmed = String(body || '').trim();
  return trimmed.length >= 15 ? [trimmed] : [];
}

/**
 * Retrieve top relevant excerpts from sibling notes in the same subject folder.
 * Returns [{ noteId, title, excerpt, score }].
 */
export function retrieveCrossNoteContext(
  currentNote,
  siblingNotes = [],
  question = '',
  { maxSnippets = 4, maxChars = 1800 } = {}
) {
  if (!Array.isArray(siblingNotes) || siblingNotes.length === 0) return [];

  const query = `${question || ''} ${currentNote?.title || ''}`.trim();
  if (!query) return [];

  const candidates = [];
  for (const n of siblingNotes) {
    if (!n || n.id === currentNote?.id || n.trashed) continue;
    const chunks = chunkNoteBody(n.body);
    for (const chunk of chunks) {
      candidates.push({
        noteId: n.id,
        title: n.title || 'Untitled',
        text: `${n.title || ''} ${chunk}`,
        excerpt: chunk.slice(0, 480),
      });
    }
  }

  if (candidates.length === 0) return [];

  const scores = scoreBM25(
    candidates.map(c => c.text),
    query
  );

  const ranked = candidates
    .map((c, i) => ({ ...c, score: scores[i] }))
    .filter(c => c.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  const selected = [];
  let usedChars = 0;
  const perNoteCount = new Map();

  for (const item of ranked) {
    if (selected.length >= maxSnippets) break;
    // Diversify across notes (max 2 snippets from the same sibling note)
    const cCount = perNoteCount.get(item.noteId) || 0;
    if (cCount >= 2) continue;
    if (usedChars + item.excerpt.length > maxChars && selected.length > 0) continue;

    selected.push({
      noteId: item.noteId,
      title: item.title,
      excerpt: item.excerpt,
      score: Number(item.score.toFixed(2)),
    });
    usedChars += item.excerpt.length;
    perNoteCount.set(item.noteId, cCount + 1);
  }

  return selected;
}

/** Extract 3-6 concise fallback search keywords from title + question (0 API calls). */
export function buildFallbackSearchQuery(question, noteTitle = '', subject = '') {
  const qTokens = tokenize(question);
  const titleTokens = tokenize(noteTitle).slice(0, 3);
  const subjTokens = subject && subject !== 'General' ? tokenize(subject).slice(0, 1) : [];
  const combined = [...new Set([...titleTokens, ...qTokens, ...subjTokens])];
  return combined.slice(0, 6).join(' ') || String(question || noteTitle || '').slice(0, 80);
}

/**
 * Retrieve top-K cited excerpts from a specific Course's uploaded materials/modules
 * (PDFs, PPTXs, DOCXs, pasted Canvas pages & linked unlocked notes) using offline BM25.
 * Falls back to leading overview chunks when the student asks a broad question ("summarize this module").
 */
export function retrieveCourseChunks(
  allChunks = [],
  query = '',
  { topK = 6, maxChars = 5200, materialIds = null } = {}
) {
  const filterSet = Array.isArray(materialIds) && materialIds.length > 0 ? new Set(materialIds) : null;
  const pool = allChunks.filter(c => c && c.text && (!filterSet || filterSet.has(c.materialId)));
  if (pool.length === 0) return [];

  const q = String(query || '').trim();
  const scores = q
    ? scoreBM25(
        pool.map(c => `${c.moduleName || ''} ${c.materialTitle || ''} ${c.label || ''} ${c.text}`),
        q
      )
    : pool.map(() => 0);

  const ranked = pool
    .map((c, idx) => ({ ...c, score: scores[idx] || 0 }))
    .sort((a, b) => b.score - a.score);

  const hasKeywordMatch = ranked.some(r => r.score >= 0.35);
  const ordered = hasKeywordMatch ? ranked : pool.map(c => ({ ...c, score: 0 }));

  const selected = [];
  let usedChars = 0;
  for (const item of ordered) {
    if (selected.length >= topK) break;
    const excerpt = String(item.text || '').slice(0, 950);
    if (usedChars + excerpt.length > maxChars && selected.length > 0) continue;
    const citation = [item.moduleName, item.materialTitle, item.label].filter(Boolean).join(' · ');
    selected.push({
      materialId: item.materialId,
      moduleName: item.moduleName || '',
      materialTitle: item.materialTitle || 'Material',
      label: item.label || '',
      citation,
      excerpt,
      score: Number((item.score || 0).toFixed(2)),
    });
    usedChars += excerpt.length;
  }
  return selected;
}
