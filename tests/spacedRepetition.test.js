import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DAY_MS,
  normalizeCardState,
  scheduleCard,
  previewIntervals,
  formatInterval,
  isCardDue,
  isCardMastered,
  computeNextReviewStats,
} from '../src/lib/spacedRepetition.js';
import {
  db,
  createFolder,
  createNote,
  updateNote,
  deleteNote,
  getDueFlashcards,
  saveCardReviewResult,
} from '../src/store/db.js';

describe('SM-2 Spaced Repetition Engine', () => {
  const T0 = Date.UTC(2026, 4, 10, 12, 0, 0);

  it('progresses intervals cleanly on consecutive Good ratings', () => {
    const r1 = scheduleCard(null, 'good', T0);
    expect(r1.intervalDays).toBe(1);
    expect(r1.reps).toBe(1);
    expect(r1.status).toBe('known');
    expect(r1.nextReviewAt).toBe(T0 + 1 * DAY_MS);

    const r2 = scheduleCard(r1, 'good', T0 + 1 * DAY_MS);
    expect(r2.intervalDays).toBe(3);
    expect(r2.reps).toBe(2);

    const r3 = scheduleCard(r2, 'good', T0 + 4 * DAY_MS);
    expect(r3.intervalDays).toBe(8); // round(3 * 2.5) = 8
    expect(r3.reps).toBe(3);
  });

  it('resets reps, increments lapses, and schedules short 10m retry on Again', () => {
    const mastered = scheduleCard(scheduleCard(null, 'good', T0), 'good', T0 + DAY_MS);
    const lapsed = scheduleCard(mastered, 'again', T0 + 4 * DAY_MS);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.status).toBe('learning');
    expect(lapsed.ease).toBeCloseTo(2.3, 2);
    expect(lapsed.nextReviewAt).toBeGreaterThan(T0 + 4 * DAY_MS);
    expect(lapsed.nextReviewAt - (T0 + 4 * DAY_MS)).toBe(10 * 60 * 1000);
  });

  it('handles Easy boost and Hard moderation within ease bounds [1.3, 3.0]', () => {
    const easy = scheduleCard(null, 'easy', T0);
    expect(easy.intervalDays).toBe(4);
    expect(easy.ease).toBeCloseTo(2.65, 2);

    let st = null;
    for (let i = 0; i < 15; i++) st = scheduleCard(st, 'again', T0 + i * 1000);
    expect(st.ease).toBe(1.3);

    let st2 = null;
    for (let i = 0; i < 15; i++) st2 = scheduleCard(st2, 'easy', T0 + i * 1000);
    expect(st2.ease).toBe(3.0);
  });

  it('migrates legacy v1.3.0 string statuses ("known" | "learning") without data loss', () => {
    const known = normalizeCardState('known');
    expect(known.status).toBe('known');
    expect(isCardMastered('known')).toBe(true);
    expect(isCardDue('known', T0)).toBe(true); // unscheduled legacy card enters SM-2 queue

    const learning = normalizeCardState('learning');
    expect(learning.status).toBe('learning');
    expect(learning.lapses).toBe(1);
    expect(isCardMastered('learning')).toBe(false);
  });

  it('formats preview intervals cleanly for UI buttons', () => {
    const p = previewIntervals(null, T0);
    expect(p).toEqual({ again: '10m', hard: '1d', good: '1d', easy: '4d' });
    expect(formatInterval(0)).toBe('10m');
    expect(formatInterval(14)).toBe('2w');
    expect(formatInterval(60)).toBe('2mo');
    expect(formatInterval(365)).toBe('1.0y');
  });

  it('tracks daily streaks across same day, consecutive day, and missed day gaps', () => {
    const day1 = new Date(2026, 4, 10, 9, 0, 0).getTime();
    const day1Later = new Date(2026, 4, 10, 18, 0, 0).getTime();
    const day2 = new Date(2026, 4, 11, 8, 30, 0).getTime();
    const day5 = new Date(2026, 4, 14, 10, 0, 0).getTime();

    const s1 = computeNextReviewStats(null, day1);
    expect(s1.streak).toBe(1);
    expect(s1.todayCount).toBe(1);

    const s2 = computeNextReviewStats(s1, day1Later);
    expect(s2.streak).toBe(1);
    expect(s2.todayCount).toBe(2);
    expect(s2.totalReviewed).toBe(2);

    const s3 = computeNextReviewStats(s2, day2);
    expect(s3.streak).toBe(2);
    expect(s3.todayCount).toBe(1);
    expect(s3.totalReviewed).toBe(3);

    const s4 = computeNextReviewStats(s3, day5);
    expect(s4.streak).toBe(1);
    expect(s4.todayCount).toBe(1);
  });
});

describe('Dexie Cross-Folder Due Flashcards', () => {
  beforeEach(async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.examCache.clear();
    await db.attachments.clear();
  });

  it('collects due flashcards across folders, excludes trashed notes, and preserves updatedAt', async () => {
    const bioId = await createFolder('Biology');
    const physId = await createFolder('Physics');

    const n1 = await createNote(bioId, 'Cell Respiration', 'ATP synthesis');
    await updateNote(n1.id, {
      flashcards: [
        { q: 'Where does glycolysis occur?', a: 'Cytoplasm' },
        { q: 'What is the main energy currency?', a: 'ATP' },
      ],
    });
    const originalUpdatedAt = (await db.notes.get(n1.id)).updatedAt;

    const n2 = await createNote(physId, 'Kinematics', 'v = u + at');
    await updateNote(n2.id, {
      flashcards: [{ q: 'Unit of acceleration?', a: '$m/s^2$' }],
    });

    const trashed = await createNote(physId, 'Old Draft', 'discard');
    await updateNote(trashed.id, {
      flashcards: [{ q: 'Should not appear', a: 'Nope' }],
    });
    await deleteNote(trashed.id);

    const now = Date.now();
    const initial = await getDueFlashcards(now);
    expect(initial.totalCards).toBe(3);
    expect(initial.dueCount).toBe(3);

    // Review card 0 as Good -> scheduled 1 day ahead, updatedAt unchanged
    const nextState = scheduleCard(null, 'good', now);
    await saveCardReviewResult(n1.id, 0, nextState);

    const refreshedNote = await db.notes.get(n1.id);
    expect(refreshedNote.updatedAt).toBe(originalUpdatedAt);

    const after = await getDueFlashcards(now + 1000);
    expect(after.totalCards).toBe(3);
    expect(after.dueCount).toBe(2);
    expect(after.masteredCount).toBe(1);
    expect(after.nextDueAt).toBe(nextState.nextReviewAt);
  });
});
