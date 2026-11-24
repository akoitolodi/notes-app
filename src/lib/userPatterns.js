/**
 * userPatterns — 100% Offline User Pattern Recognition Engine (Deterministic ML).
 *
 * Algorithms running purely on local IndexedDB history (<10ms, zero network):
 * 1. Multinomial Naive Bayes Folder Classifier — learns word signatures per subject
 *    folder and suggests auto-filing Quick/Blank notes in 1 tap.
 * 2. Offline Unigram + Bigram Cosine Related-Note Matcher — spots overlapping older notes.
 * 3. Circadian Study Rhythm & Writing Habit Analyzer — detects peak study window,
 *    strongest day of week, and dominant note-taking habits.
 * 4. Weak-Topic & Recurring Error Predictor — surfaces lowest-mastery flashcards,
 *    learnerMemory weak topics, and recurring Bug Log patterns.
 *
 * Privacy Invariant: Strictly excludes Zero-AI Vault folders & locked folders!
 */

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were',
  'will', 'your', 'you', 'about', 'into', 'when', 'what', 'which', 'how', 'why',
  'not', 'but', 'can', 'use', 'note', 'notes', 'untitled', 'new', 'general',
  'ang', 'mga', 'pero', 'kasi', 'dahil', 'para', 'yung', 'dito', 'kung', 'naman',
]);

export function extractPatternTokens(text) {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\u00C0-\u024F\s]/g, ' ');
  return clean
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function isFolderExcluded(folder) {
  if (!folder) return true;
  if (folder.isSystemVault || folder.locked) return true;
  if (folder.mode === 'vault' || folder.mode === 'journal') return true;
  return false;
}

/**
 * 1. Multinomial Naive Bayes Folder Classifier (100% offline).
 * Returns `{ folderId, folderName, confidence }` when confidence beats threshold
 * and suggests a different folder than `currentFolderId`.
 */
export function classifyFolderNaiveBayes(
  text,
  folders = [],
  notes = [],
  { currentFolderId = null, minConfidence = 0.58 } = {}
) {
  const inputTokens = extractPatternTokens(text);
  if (inputTokens.length < 4) return null;

  const eligibleFolders = folders.filter(f => !isFolderExcluded(f));
  if (eligibleFolders.length < 2) return null;

  const folderById = new Map(eligibleFolders.map(f => [f.id, f]));
  const classDocs = new Map(); // folderId -> token[]
  for (const f of eligibleFolders) {
    // Seed folder prior with its own folder name tokens (weighted x3)
    const fTokens = extractPatternTokens(f.name);
    classDocs.set(f.id, [...fTokens, ...fTokens, ...fTokens]);
  }

  for (const n of notes) {
    if (!n || n.trashed || n.mode === 'vault' || n.mode === 'journal') continue;
    if (!folderById.has(n.folderId)) continue;
    const arr = classDocs.get(n.folderId);
    const nToks = extractPatternTokens(`${n.title || ''} ${n.subject || ''} ${n.body || ''}`);
    for (let i = 0; i < Math.min(nToks.length, 300); i++) {
      arr.push(nToks[i]);
    }
  }

  // Filter classes with meaningful vocabulary
  const activeClasses = eligibleFolders.filter(f => (classDocs.get(f.id)?.length || 0) >= 3);
  if (activeClasses.length < 2) return null;

  const vocab = new Set();
  const classFreqs = new Map();
  const classTotals = new Map();
  for (const f of activeClasses) {
    const toks = classDocs.get(f.id) || [];
    const freq = Object.create(null);
    for (const t of toks) {
      freq[t] = (freq[t] || 0) + 1;
      vocab.add(t);
    }
    classFreqs.set(f.id, freq);
    classTotals.set(f.id, toks.length);
  }
  const V = Math.max(1, vocab.size);

  // Only keep tokens present in the corpus so random words don't wash out probabilities
  const knownInput = inputTokens.filter(t => vocab.has(t));
  if (knownInput.length < 2) return null;

  // Score via Laplace-smoothed log likelihood
  const scores = activeClasses.map(f => {
    const freq = classFreqs.get(f.id);
    const total = classTotals.get(f.id) || 0;
    const denom = total + V;
    let logProb = 0;
    for (const t of knownInput) {
      logProb += Math.log(((freq[t] || 0) + 1) / denom);
    }
    return { folder: f, logProb };
  });

  scores.sort((a, b) => b.logProb - a.logProb);
  const top = scores[0];
  if (!top || top.folder.id === currentFolderId) return null;

  // Compute softmax posterior confidence cleanly
  const maxLp = top.logProb;
  let sumExp = 0;
  for (const s of scores) {
    sumExp += Math.exp(Math.max(-30, s.logProb - maxLp));
  }
  const confidence = sumExp > 0 ? 1 / sumExp : 0;

  if (confidence < minConfidence) return null;
  // Never suggest moving *into* generic "General" folder
  if (String(top.folder.name || '').trim().toLowerCase() === 'general') return null;

  return {
    folderId: top.folder.id,
    folderName: top.folder.name,
    confidence: Math.round(confidence * 100),
  };
}

/**
 * 2. Offline Unigram + Bigram Cosine Similarity Matcher.
 * Spots an overlapping non-vault note cleanly with zero API calls.
 */
export function findSimilarNotesOffline(
  text,
  { currentNoteId = null, notes = [], folders = [], minScore = 0.25 } = {}
) {
  const inputUnigrams = extractPatternTokens(text);
  if (inputUnigrams.length < 5) return null;

  const excludedFolderIds = new Set(folders.filter(isFolderExcluded).map(f => f.id));

  const toFeatureSet = toks => {
    const set = new Set(toks);
    for (let i = 0; i < toks.length - 1; i++) {
      set.add(`${toks[i]}_${toks[i + 1]}`);
    }
    return set;
  };

  const queryVec = toFeatureSet(inputUnigrams);
  let best = null;

  for (const n of notes) {
    if (!n || n.trashed || n.id === currentNoteId) continue;
    if (excludedFolderIds.has(n.folderId) || n.mode === 'vault' || n.mode === 'journal') continue;
    const nToks = extractPatternTokens(`${n.title || ''} ${n.body || ''}`);
    if (nToks.length < 4) continue;
    const docVec = toFeatureSet(nToks.slice(0, 260));

    let overlap = 0;
    for (const f of queryVec) {
      if (docVec.has(f)) overlap += 1;
    }
    if (overlap < 3) continue;
    const cosine = overlap / Math.sqrt(queryVec.size * docVec.size);
    if (cosine >= minScore && (!best || cosine > best.rawScore)) {
      best = {
        noteId: n.id,
        title: n.title || 'Untitled Note',
        score: Math.round(cosine * 100),
        rawScore: cosine,
      };
    }
  }

  return best ? { noteId: best.noteId, title: best.title, score: best.score } : null;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hourWindowLabel(hr) {
  if (hr >= 5 && hr < 9) return 'Early Morning (5–9 AM)';
  if (hr >= 9 && hr < 12) return 'Morning (9 AM–12 PM)';
  if (hr >= 12 && hr < 17) return 'Afternoon (12–5 PM)';
  if (hr >= 17 && hr < 21) return 'Evening (5–9 PM)';
  return 'Late Night (9 PM–5 AM)';
}

/**
 * 3. Circadian Study Rhythm & Writing Habit Analyzer.
 */
export function analyzeStudyRhythm({ activityLog = [], notes = [], excludedFolderIds = new Set() } = {}) {
  const windowCounts = Object.create(null);
  const weekdayCounts = new Array(7).fill(0);

  let codeCount = 0;
  let mathCount = 0;
  let checklistCount = 0;
  let qaCount = 0;
  let activeNotes = 0;

  for (const n of notes) {
    if (!n || n.trashed || excludedFolderIds.has(n.folderId) || n.mode === 'vault') continue;
    activeNotes += 1;
    const ts = Number(n.updatedAt || n.createdAt);
    if (ts > 0) {
      const dt = new Date(ts);
      const win = hourWindowLabel(dt.getHours());
      windowCounts[win] = (windowCounts[win] || 0) + 1;
      weekdayCounts[dt.getDay()] += 1;
    }
    const b = String(n.body || '');
    if (/```|console\.log|def\s+\w+|#include|SELECT\s+/i.test(b)) codeCount += 1;
    if (/\$[^$\n]+\$|\b\d+x\s*[+-]|sin\(|sqrt\(/.test(b)) mathCount += 1;
    if (/^\s*-\s*\[[ xX]\]/m.test(b)) checklistCount += 1;
    if (/^(?:[-*]\s*)?[A-Za-z0-9\s/()'-]{2,48}:\s+.{6,}$/m.test(b)) qaCount += 1;
  }

  let totalActivityActions = 0;
  for (const row of activityLog) {
    if (!row?.dateKey) continue;
    const weight =
      (Number(row.reviews) || 0) +
      (Number(row.scans) || 0) +
      (Number(row.exams) || 0) +
      (Number(row.coding) || 0) +
      (Number(row.notes) || 0);
    totalActivityActions += weight;
    const parts = String(row.dateKey).split('-').map(Number);
    if (parts.length === 3 && weight > 0) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      if (!Number.isNaN(d.getTime())) weekdayCounts[d.getDay()] += Math.min(5, weight);
    }
  }

  let peakWindow = 'Evening (5–9 PM)';
  let peakWinCount = 0;
  for (const [win, cnt] of Object.entries(windowCounts)) {
    if (cnt > peakWinCount) {
      peakWinCount = cnt;
      peakWindow = win;
    }
  }

  let bestDayIdx = -1;
  let bestDayVal = 0;
  weekdayCounts.forEach((v, idx) => {
    if (v > bestDayVal) {
      bestDayVal = v;
      bestDayIdx = idx;
    }
  });

  const habits = [
    ['Code Snippets', codeCount],
    ['Math & Formulas', mathCount],
    ['Task Checklists', checklistCount],
    ['Q&A Flashcard Lists', qaCount],
  ].sort((a, b) => b[1] - a[1]);

  const dominantHabit = habits[0]?.[1] > 0 ? habits[0][0] : 'Structured Class Notes';

  return {
    activeNotes,
    totalActivityActions,
    peakWindow: peakWinCount > 0 ? peakWindow : 'No timing data yet',
    bestDay: bestDayIdx >= 0 ? WEEKDAY_NAMES[bestDayIdx] : 'Every day',
    dominantHabit,
  };
}

/**
 * 4. Weak-Topic & Recurring Error Cluster Predictor.
 */
export function analyzeWeakPatterns({ learnerMemory = [], allCards = [], bugLogs = [] } = {}) {
  const insights = [];

  // Weak learner memory topics
  const weakMem = [...learnerMemory]
    .filter(m => (Number(m.mistakesCount) || 0) > 0 || (Number(m.mastery) || 0) < 0.55)
    .sort((a, b) => (b.mistakesCount || 0) - (a.mistakesCount || 0) || (a.mastery || 0) - (b.mastery || 0));

  for (const m of weakMem.slice(0, 2)) {
    insights.push({
      kind: 'weak-topic',
      title: `Review "${m.topic}" (${m.subject || 'General'})`,
      detail:
        m.mistakesCount > 0
          ? `${m.mistakesCount} mistake signal${m.mistakesCount === 1 ? '' : 's'} — ${Math.round((m.mastery || 0) * 100)}% mastery`
          : `Low mastery (${Math.round((m.mastery || 0) * 100)}%)`,
    });
  }

  // Lapsed flashcards (SM-2)
  const lapsedNotes = new Map();
  for (const c of allCards) {
    const lapses = Number(c?.state?.lapses || 0);
    if (lapses >= 2) {
      lapsedNotes.set(c.noteTitle || 'Flashcards', (lapsedNotes.get(c.noteTitle || 'Flashcards') || 0) + lapses);
    }
  }
  const topLapsed = [...lapsedNotes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topLapsed) {
    insights.push({
      kind: 'lapsed-cards',
      title: `Tricky deck: ${topLapsed[0]}`,
      detail: `${topLapsed[1]} flashcard lapses — try Reverse Feynman Coach`,
    });
  }

  // Recurring bug types
  const bugFreq = Object.create(null);
  for (const b of bugLogs) {
    const k = String(b?.errorType || b?.language || '').trim();
    if (k) bugFreq[k] = (bugFreq[k] || 0) + 1;
  }
  const topBug = Object.entries(bugFreq).sort((a, b) => b[1] - a[1])[0];
  if (topBug && topBug[1] >= 2) {
    insights.push({
      kind: 'bug-cluster',
      title: `Recurring code bug: ${topBug[0]}`,
      detail: `Appeared ${topBug[1]} times in your Bug Log`,
    });
  }

  return insights.slice(0, 3);
}

/** Combined User Pattern Profile for Daily Review Dashboard (100% Offline). */
export function buildUserPatternProfile({
  folders = [],
  notes = [],
  activityLog = [],
  learnerMemory = [],
  allCards = [],
  bugLogs = [],
} = {}) {
  const excludedFolderIds = new Set(folders.filter(isFolderExcluded).map(f => f.id));
  const rhythm = analyzeStudyRhythm({ activityLog, notes, excludedFolderIds });
  const weakInsights = analyzeWeakPatterns({ learnerMemory, allCards, bugLogs });

  // Most active subjects
  const folderNameMap = new Map(folders.filter(f => !isFolderExcluded(f)).map(f => [f.id, f.name]));
  const subjCounts = Object.create(null);
  for (const n of notes) {
    if (!n || n.trashed || excludedFolderIds.has(n.folderId) || n.mode === 'vault') continue;
    const label = folderNameMap.get(n.folderId) || n.subject || 'General';
    subjCounts[label] = (subjCounts[label] || 0) + 1;
  }
  const topSubjects = Object.entries(subjCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  return {
    rhythm,
    weakInsights,
    topSubjects,
  };
}
