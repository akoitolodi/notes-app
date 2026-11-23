/**
 * learnerMemory — Native on-device DeepTutor-inspired Persistent Learning Memory.
 *
 * Tracks strengths, weak spots, missed quiz/exam concepts, and coding struggles
 * locally in Dexie (`learnerMemory`) so Chat, Deep Think, Exam Papers, and
 * Learn Coding remember how you learn across sessions.
 *
 * Privacy guarantee: Strictly ignores Zero-AI Vault (`mode === 'vault'`) and
 * "Passwords & Keys" notes.
 */
import { db, SYSTEM_VAULT_FOLDER_NAME } from '../store/db';
import { isDeepTutorMemoryEnabled } from './aiConfig';

function cleanLabel(val, maxLen = 72) {
  return String(val || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Record a learning signal (flashcard rating, quiz miss, exam mistake, or coding challenge).
 * Safely skips vault / Zero-AI entries.
 */
export async function recordLearningSignal({
  subject = 'General',
  topic = '',
  correct = true,
  mistakeSummary = '',
  source = 'study',
  noteMode = 'study',
} = {}) {
  if (!isDeepTutorMemoryEnabled()) return null;
  if (noteMode === 'vault' || noteMode === 'journal') return null;

  const cleanSubj = cleanLabel(subject || 'General', 48);
  if (cleanSubj.toLowerCase() === SYSTEM_VAULT_FOLDER_NAME.toLowerCase()) return null;

  const cleanTopic = cleanLabel(topic, 80);
  if (!cleanTopic || cleanTopic.length < 2) return null;

  const now = Date.now();
  const all = await db.learnerMemory.toArray();
  const existing = all.find(
    r =>
      String(r.subject || '').toLowerCase() === cleanSubj.toLowerCase() &&
      String(r.topic || '').toLowerCase() === cleanTopic.toLowerCase()
  );

  if (existing) {
    const prevMastery = Number.isFinite(existing.mastery) ? existing.mastery : 50;
    const nextMastery = correct
      ? Math.min(100, prevMastery + 14)
      : Math.max(5, prevMastery - 18);
    const patch = {
      mastery: nextMastery,
      attemptsCount: (existing.attemptsCount || 0) + 1,
      mistakesCount: (existing.mistakesCount || 0) + (correct ? 0 : 1),
      lastMistake: !correct && mistakeSummary ? cleanLabel(mistakeSummary, 140) : existing.lastMistake || '',
      lastSource: source,
      lastPracticedAt: now,
    };
    await db.learnerMemory.update(existing.id, patch);
    return { ...existing, ...patch };
  }

  const entry = {
    subject: cleanSubj,
    topic: cleanTopic,
    mastery: correct ? 74 : 32,
    attemptsCount: 1,
    mistakesCount: correct ? 0 : 1,
    lastMistake: !correct && mistakeSummary ? cleanLabel(mistakeSummary, 140) : '',
    lastSource: source,
    lastPracticedAt: now,
  };
  const id = await db.learnerMemory.add(entry);
  return { id, ...entry };
}

/** Return learner memory entries (optionally filtered by subject), weakest first. */
export async function getLearnerMemory({ subject = null } = {}) {
  try {
    const all = await db.learnerMemory.toArray();
    const filtered = subject
      ? all.filter(
          r =>
            String(r.subject || '').toLowerCase() === String(subject).trim().toLowerCase() ||
            String(subject).trim().toLowerCase() === 'general'
        )
      : all;
    return filtered.sort((a, b) => {
      if ((a.mastery ?? 50) !== (b.mastery ?? 50)) return (a.mastery ?? 50) - (b.mastery ?? 50);
      return (b.lastPracticedAt || 0) - (a.lastPracticedAt || 0);
    });
  } catch {
    return [];
  }
}

export async function getWeakTopics(subject = null, limit = 6) {
  const rows = await getLearnerMemory({ subject });
  return rows.filter(r => (r.mastery ?? 50) < 70 || (r.mistakesCount || 0) > 0).slice(0, limit);
}

export async function getStrengthTopics(subject = null, limit = 5) {
  const rows = await getLearnerMemory({ subject });
  return rows
    .filter(r => (r.mastery ?? 0) >= 75)
    .sort((a, b) => (b.mastery ?? 0) - (a.mastery ?? 0))
    .slice(0, limit);
}

/**
 * Compact ~100-token learner context digest injected into Chat, Deep Think,
 * Exam Papers, and Learn Coding prompts when DeepTutor Memory is enabled.
 */
export async function getLearnerContextDigest(subject = null) {
  if (!isDeepTutorMemoryEnabled()) return '';
  const [weak, strong] = await Promise.all([
    getWeakTopics(subject, 5),
    getStrengthTopics(subject, 4),
  ]);
  if (weak.length === 0 && strong.length === 0) return '';

  const lines = ['[DeepTutor Persistent Learner Memory]'];
  if (weak.length > 0) {
    lines.push(
      `- Needs reinforcement: ${weak
        .map(w => `${w.topic} (${w.mastery}% mastery${w.mistakesCount ? `, ${w.mistakesCount} misses` : ''})`)
        .join('; ')}`
    );
  }
  if (strong.length > 0) {
    lines.push(`- Mastered strengths: ${strong.map(s => `${s.topic} (${s.mastery}%)`).join('; ')}`);
  }
  lines.push(
    'Adapt your explanation to reinforce weak spots with clear intuition while skipping redundant basics on mastered strengths.'
  );
  return lines.join('\n');
}

export async function deleteLearnerTopic(id) {
  await db.learnerMemory.delete(id);
}

export async function clearLearnerMemory() {
  await db.learnerMemory.clear();
}

/** Optional connection check to a self-hosted HKUDS/DeepTutor FastAPI server. */
export async function testDeepTutorBridge(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Enter a DeepTutor server URL first');
  const endpoints = [`${clean}/health`, `${clean}/api/health`, `${clean}/`];
  let lastErr = 'Unreachable';
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { method: 'GET' });
      if (res.ok) return { ok: true, endpoint: ep, status: res.status };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e?.message || 'Network error';
    }
  }
  throw new Error(`Could not connect to DeepTutor at ${clean} (${lastErr})`);
}
