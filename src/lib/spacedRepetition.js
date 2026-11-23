/**
 * SM-2 Spaced Repetition Engine + Daily Streak Tracker.
 *
 * 100% offline, deterministic, and backward-compatible with legacy
 * v1.3.0 string statuses ('known' | 'learning').
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const AGAIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes
export const REVIEW_STATS_KEY = 'aicn:reviewStats';

/** Normalize legacy ('known' | 'learning') or SM-2 card progress into a structured object. */
export function normalizeCardState(raw) {
  if (raw && typeof raw === 'object') {
    return {
      ease: Number.isFinite(raw.ease) ? Math.max(1.3, Math.min(3.0, raw.ease)) : 2.5,
      intervalDays: Number.isFinite(raw.intervalDays) ? Math.max(0, raw.intervalDays) : 0,
      reps: Number.isInteger(raw.reps) ? Math.max(0, raw.reps) : 0,
      lapses: Number.isInteger(raw.lapses) ? Math.max(0, raw.lapses) : 0,
      status: raw.status === 'known' ? 'known' : raw.status === 'learning' ? 'learning' : 'new',
      lastReviewedAt: Number.isFinite(raw.lastReviewedAt) ? raw.lastReviewedAt : 0,
      nextReviewAt: Number.isFinite(raw.nextReviewAt) ? raw.nextReviewAt : 0,
    };
  }
  if (raw === 'known') {
    return {
      ease: 2.5,
      intervalDays: 3,
      reps: 2,
      lapses: 0,
      status: 'known',
      lastReviewedAt: 0,
      nextReviewAt: 0,
    };
  }
  if (raw === 'learning') {
    return {
      ease: 2.3,
      intervalDays: 0,
      reps: 0,
      lapses: 1,
      status: 'learning',
      lastReviewedAt: 0,
      nextReviewAt: 0,
    };
  }
  return {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    status: 'new',
    lastReviewedAt: 0,
    nextReviewAt: 0,
  };
}

/**
 * Schedule the next review using Anki-calibrated SM-2 math.
 * @param {any} prevRaw Previous card state (null, legacy string, or SM-2 object)
 * @param {'again'|'hard'|'good'|'easy'|'learning'|'known'} rating User self-rating
 * @param {number} [now] Epoch ms timestamp
 */
export function scheduleCard(prevRaw, rating, now = Date.now()) {
  const prev = normalizeCardState(prevRaw);
  const normalizedRating =
    rating === 'learning' ? 'again' : rating === 'known' ? 'good' : rating;

  if (normalizedRating === 'again') {
    const ease = Math.max(1.3, +(prev.ease - 0.2).toFixed(2));
    return {
      ease,
      intervalDays: 0,
      reps: 0,
      lapses: prev.lapses + 1,
      status: 'learning',
      lastReviewedAt: now,
      nextReviewAt: now + AGAIN_DELAY_MS,
    };
  }

  if (normalizedRating === 'hard') {
    const ease = Math.max(1.3, +(prev.ease - 0.15).toFixed(2));
    const reps = Math.max(1, prev.reps + 1);
    const intervalDays =
      prev.reps === 0
        ? 1
        : Math.max(1, Math.round(Math.max(1, prev.intervalDays) * 1.2));
    return {
      ease,
      intervalDays,
      reps,
      lapses: prev.lapses,
      status: intervalDays >= 3 ? 'known' : 'learning',
      lastReviewedAt: now,
      nextReviewAt: now + intervalDays * DAY_MS,
    };
  }

  if (normalizedRating === 'easy') {
    const ease = Math.min(3.0, +(prev.ease + 0.15).toFixed(2));
    const reps = prev.reps + 1;
    let intervalDays;
    if (prev.reps === 0) intervalDays = 4;
    else if (prev.reps === 1) intervalDays = 6;
    else intervalDays = Math.max(prev.intervalDays + 2, Math.round(prev.intervalDays * prev.ease * 1.3));
    return {
      ease,
      intervalDays,
      reps,
      lapses: prev.lapses,
      status: 'known',
      lastReviewedAt: now,
      nextReviewAt: now + intervalDays * DAY_MS,
    };
  }

  // Default: 'good'
  const reps = prev.reps + 1;
  let intervalDays;
  if (prev.reps === 0) intervalDays = 1;
  else if (prev.reps === 1) intervalDays = 3;
  else intervalDays = Math.max(prev.intervalDays + 1, Math.round(prev.intervalDays * prev.ease));

  return {
    ease: prev.ease,
    intervalDays,
    reps,
    lapses: prev.lapses,
    status: 'known',
    lastReviewedAt: now,
    nextReviewAt: now + intervalDays * DAY_MS,
  };
}

/** Human-readable short interval badge for SM-2 rating buttons. */
export function formatInterval(days) {
  if (!days || days <= 0) return '10m';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Preview next intervals for all 4 SM-2 buttons before user clicks. */
export function previewIntervals(prevRaw, now = Date.now()) {
  return {
    again: formatInterval(scheduleCard(prevRaw, 'again', now).intervalDays),
    hard: formatInterval(scheduleCard(prevRaw, 'hard', now).intervalDays),
    good: formatInterval(scheduleCard(prevRaw, 'good', now).intervalDays),
    easy: formatInterval(scheduleCard(prevRaw, 'easy', now).intervalDays),
  };
}

/** True if the card is unreviewed or due for review at `now`. */
export function isCardDue(raw, now = Date.now()) {
  if (!raw) return true;
  const st = normalizeCardState(raw);
  if (!st.nextReviewAt) return true;
  return st.nextReviewAt <= now;
}

/** True if the card is currently mastered/known. */
export function isCardMastered(raw) {
  if (!raw) return false;
  if (raw === 'known') return true;
  return typeof raw === 'object' && raw.status === 'known';
}

/** True if the card is currently marked as still learning. */
export function isCardLearning(raw) {
  if (!raw) return false;
  if (raw === 'learning') return true;
  return typeof raw === 'object' && raw.status === 'learning';
}

// ---------------- Local-Time Streak & Daily Counter ----------------

/** Return local calendar date key 'YYYY-MM-DD' (respects device timezone). */
export function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar day difference between two YYYY-MM-DD strings (b - a). */
function diffCalendarDays(dateA, dateB) {
  if (!dateA || !dateB) return Infinity;
  const [ya, ma, da] = dateA.split('-').map(Number);
  const [yb, mb, db] = dateB.split('-').map(Number);
  const utcA = Date.UTC(ya, ma - 1, da);
  const utcB = Date.UTC(yb, mb - 1, db);
  return Math.round((utcB - utcA) / DAY_MS);
}

/** Pure streak updater for a newly completed flashcard review. */
export function computeNextReviewStats(prev, now = Date.now()) {
  const today = localDateKey(now);
  const base = prev && typeof prev === 'object' ? prev : {};
  const lastDate = base.lastStudyDate || null;
  const prevStreak = Number.isInteger(base.streak) ? base.streak : 0;
  const prevTotal = Number.isInteger(base.totalReviewed) ? base.totalReviewed : 0;
  const prevTodayCount = base.todayDate === today && Number.isInteger(base.todayCount) ? base.todayCount : 0;

  let streak = prevStreak;
  if (!lastDate) {
    streak = 1;
  } else {
    const gap = diffCalendarDays(lastDate, today);
    if (gap === 0) streak = Math.max(1, prevStreak);
    else if (gap === 1) streak = Math.max(1, prevStreak) + 1;
    else if (gap > 1) streak = 1;
  }

  return {
    streak,
    lastStudyDate: today,
    todayDate: today,
    todayCount: prevTodayCount + 1,
    totalReviewed: prevTotal + 1,
  };
}

/** Read current streak stats for display (returns active streak 0 if gap > 1 day). */
export function getReviewStats(now = Date.now()) {
  const today = localDateKey(now);
  const fallback = { streak: 0, lastStudyDate: null, todayDate: today, todayCount: 0, totalReviewed: 0 };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(REVIEW_STATS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const gap = diffCalendarDays(raw.lastStudyDate, today);
    const activeStreak = gap <= 1 ? (raw.streak || 0) : 0;
    const todayCount = raw.todayDate === today ? (raw.todayCount || 0) : 0;
    return {
      streak: activeStreak,
      lastStudyDate: raw.lastStudyDate || null,
      todayDate: today,
      todayCount,
      totalReviewed: raw.totalReviewed || 0,
    };
  } catch {
    return fallback;
  }
}

/** Persist one completed card review and update the user's daily streak. */
export function recordCardReview(now = Date.now()) {
  let prev = null;
  if (typeof localStorage !== 'undefined') {
    try {
      prev = JSON.parse(localStorage.getItem(REVIEW_STATS_KEY) || 'null');
    } catch {
      prev = null;
    }
  }
  const next = computeNextReviewStats(prev, now);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(REVIEW_STATS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }
  return next;
}
