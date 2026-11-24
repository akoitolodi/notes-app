/**
 * ReviewDashboardScreen — cross-folder Spaced Repetition (SM-2) review session.
 *
 * Scans all due flashcards across every subject folder, runs Anki-style
 * Again / Hard / Good / Easy scheduling, re-queues missed ('Again') cards
 * within the same session, and tracks the user's daily review streak.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  Flame,
  CheckCircle2,
  RotateCcw,
  ExternalLink,
  Layers,
  Clock,
  Brain,
  Trash2,
  Headphones,
} from 'lucide-react';
import { db, getDueFlashcards, saveCardReviewResult, logStudyActivity } from '../store/db';
import AudioStudySheet from './AudioStudySheet';
import {
  recordLearningSignal,
  getLearnerMemory,
  deleteLearnerTopic,
  clearLearnerMemory,
} from '../lib/learnerMemory';
import { buildUserPatternProfile } from '../lib/userPatterns';
import {
  scheduleCard,
  previewIntervals,
  getReviewStats,
  recordCardReview,
  DAY_MS,
} from '../lib/spacedRepetition';
import MarkdownContent from './ui/MarkdownContent';

function formatNextDue(ts) {
  if (!ts) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)}m`;
  const hrs = Math.round(diff / 3600000);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(diff / DAY_MS);
  return `in ${days}d`;
}

export default function ReviewDashboardScreen({ onBack, onOpenNote, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    dueCards: [],
    allCards: [],
    totalCards: 0,
    dueCount: 0,
    masteredCount: 0,
    nextDueAt: null,
  });
  const [queue, setQueue] = useState([]);
  const [practiceMode, setPracticeMode] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [stats, setStats] = useState(() => getReviewStats());
  const [memoryRows, setMemoryRows] = useState([]);
  const [patternProfile, setPatternProfile] = useState(null);
  const [audioCardsOpen, setAudioCardsOpen] = useState(false);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    const [data, mem, folders, notes, activityLog, bugLogs] = await Promise.all([
      getDueFlashcards(),
      getLearnerMemory(),
      db.folders.toArray().catch(() => []),
      db.notes.toArray().catch(() => []),
      db.activityLog.toArray().catch(() => []),
      db.bugLogs.toArray().catch(() => []),
    ]);
    setSummary(data);
    setMemoryRows(mem);
    setPatternProfile(
      buildUserPatternProfile({
        folders,
        notes,
        activityLog,
        learnerMemory: mem,
        allCards: data.allCards,
        bugLogs,
      })
    );
    setQueue(data.dueCards);
    setPracticeMode(false);
    setFlipped(false);
    setStats(getReviewStats());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const currentItem = queue[0] || null;

  const handleRate = async rating => {
    if (!currentItem) return;
    const now = Date.now();
    const nextState = scheduleCard(currentItem.state, rating, now);

    await saveCardReviewResult(currentItem.noteId, currentItem.cardIndex, nextState);
    logStudyActivity('reviews', 1).catch(() => {});
    recordLearningSignal({
      subject: currentItem.folderName || currentItem.subject || 'General',
      topic: currentItem.card?.q || currentItem.noteTitle || 'Flashcard',
      correct: rating === 'good' || rating === 'easy',
      mistakeSummary: rating === 'again' ? 'Marked Again in Daily Review' : '',
      source: 'flashcard',
      noteMode: 'study',
    })
      .then(() => getLearnerMemory().then(setMemoryRows))
      .catch(() => {});
    const nextStats = recordCardReview(now);
    setStats(nextStats);
    setSessionReviewed(n => n + 1);
    setFlipped(false);

    setQueue(prev => {
      const [, ...rest] = prev;
      if (rating === 'again') {
        // Re-queue missed card a few slots later in this session for active reinforcement
        const updatedItem = { ...currentItem, state: nextState };
        const insertAt = Math.min(2, rest.length);
        return [...rest.slice(0, insertAt), updatedItem, ...rest.slice(insertAt)];
      }
      return rest;
    });

    // Keep background counts accurate
    getDueFlashcards().then(fresh => {
      setSummary(fresh);
      onChanged?.();
    });
  };

  const startPracticeAll = () => {
    const shuffled = [...summary.allCards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setQueue(shuffled);
    setPracticeMode(true);
    setFlipped(false);
    setSessionReviewed(0);
  };

  const handleJumpToNote = async item => {
    const freshNote = await db.notes.get(item.noteId);
    if (!freshNote) return;
    const f = item.folderId ? await db.folders.get(item.folderId) : null;
    onOpenNote?.(freshNote, f || { id: '__all__', name: 'All Notes' });
  };

  const totalSession = sessionReviewed + queue.length;
  const pct = totalSession > 0 ? Math.round((sessionReviewed / totalSession) * 100) : 100;
  const intervals = currentItem ? previewIntervals(currentItem.state) : null;

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to folders"
        >
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">Daily Review</span>
        <span className="streak-pill" title="Daily study streak">
          <Flame size={14} /> {stats.streak}d
        </span>
      </header>

      <div className="large-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
        <span>Spaced Repetition</span>
        {summary.allCards.length > 0 && (
          <button
            type="button"
            className="row-action-chip"
            onClick={() => setAudioCardsOpen(true)}
            title="Hands-free audio flashcard commute mode"
          >
            <Headphones size={13} /> Audio Cards
          </button>
        )}
      </div>

      {/* Compact Stats Bar */}
      <div className="review-stats-grid">
        <div className="review-stat-card">
          <div className="review-stat-num">{summary.dueCount}</div>
          <div className="review-stat-label">Due now</div>
        </div>
        <div className="review-stat-card">
          <div className="review-stat-num">{stats.todayCount}</div>
          <div className="review-stat-label">Reviewed today</div>
        </div>
        <div className="review-stat-card">
          <div className="review-stat-num">
            {summary.masteredCount}/{summary.totalCards}
          </div>
          <div className="review-stat-label">Mastered</div>
        </div>
      </div>

      <div className="editor">
        {loading ? (
          <div className="scan-indicator" style={{ paddingLeft: 0 }}>
            <span className="spinner" /> Loading due flashcards…
          </div>
        ) : summary.totalCards === 0 ? (
          <div className="empty-state" style={{ paddingTop: 28 }}>
            <div className="empty-icon">
              <Layers size={28} />
            </div>
            <div className="empty-title">No flashcards yet</div>
            <div className="empty-text">
              Open any note and tap <strong>Explain</strong> to generate flashcards automatically — they will appear here for daily SM-2 spaced review.
            </div>
          </div>
        ) : !currentItem ? (
          <div className="explanation-card review-done-card">
            <div className="review-done-icon">
              <CheckCircle2 size={36} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
              All caught up!
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
              {sessionReviewed > 0
                ? `You reviewed ${sessionReviewed} card${sessionReviewed === 1 ? '' : 's'} this session.`
                : 'You have 0 flashcards due right now.'}
              {stats.streak > 0 && ` Current streak: ${stats.streak} day${stats.streak === 1 ? '' : 's'}!`}
            </div>

            {summary.nextDueAt && (
              <div className="review-next-due">
                <Clock size={14} /> Next scheduled card due {formatNextDue(summary.nextDueAt)}
              </div>
            )}

            <div className="flex gap-8" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={startPracticeAll}
              >
                <RotateCcw size={15} /> Practice all ({summary.totalCards})
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={onBack}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="deck-progress">
              <span>
                {practiceMode ? 'Practice mode · ' : ''}
                {queue.length} remaining · {sessionReviewed} done
              </span>
              <button
                type="button"
                className="review-source-btn"
                onClick={() => handleJumpToNote(currentItem)}
                title="Open source note"
              >
                <span>
                  {currentItem.folderName} · {currentItem.noteTitle}
                </span>
                <ExternalLink size={12} />
              </button>
            </div>

            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${Math.max(4, pct)}%` }} />
            </div>

            <div className="flashcard-stage">
              <button
                type="button"
                className="flashcard-btn"
                onClick={() => setFlipped(f => !f)}
                aria-label={flipped ? 'Show question' : 'Reveal answer'}
              >
                <div className="flex justify-between items-center w-full" style={{ marginBottom: 8 }}>
                  <span className="flashcard-side-label" style={{ marginBottom: 0 }}>
                    {flipped ? 'Answer' : 'Question'}
                  </span>
                  <span className="tag-pill">{currentItem.folderName}</span>
                </div>
                <div className="flashcard-body">
                  <MarkdownContent
                    text={flipped ? currentItem.card.a || '—' : currentItem.card.q}
                  />
                </div>
                <div className="flashcard-flip-hint">
                  {flipped ? 'Rate how well you recalled this below' : 'Tap card to reveal answer'}
                </div>
              </button>
            </div>

            {!flipped ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={() => setFlipped(true)}
              >
                Show Answer
              </button>
            ) : (
              <div className="sm2-grid" role="group" aria-label="Rate your recall">
                <button
                  type="button"
                  className="sm2-btn sm2-again"
                  onClick={() => handleRate('again')}
                >
                  <span className="sm2-label">Again</span>
                  <span className="sm2-int">{intervals.again}</span>
                </button>
                <button
                  type="button"
                  className="sm2-btn sm2-hard"
                  onClick={() => handleRate('hard')}
                >
                  <span className="sm2-label">Hard</span>
                  <span className="sm2-int">{intervals.hard}</span>
                </button>
                <button
                  type="button"
                  className="sm2-btn sm2-good"
                  onClick={() => handleRate('good')}
                >
                  <span className="sm2-label">Good</span>
                  <span className="sm2-int">{intervals.good}</span>
                </button>
                <button
                  type="button"
                  className="sm2-btn sm2-easy"
                  onClick={() => handleRate('easy')}
                >
                  <span className="sm2-label">Easy</span>
                  <span className="sm2-int">{intervals.easy}</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* 100% Offline User Pattern Recognition Insights */}
        {patternProfile && (
          <div className="list-group settings-group" style={{ margin: '18px 0 0' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <span className="settings-label flex items-center gap-6" style={{ marginBottom: 0 }}>
                <Brain size={14} /> Your Study Patterns (100% Offline)
              </span>
              <span className="mode-badge mode-code">Local ML</span>
            </div>

            <div className="pattern-stats-grid">
              <div className="pattern-mini-card">
                <div className="pattern-mini-label">Peak Focus</div>
                <div className="pattern-mini-val">{patternProfile.rhythm.peakWindow}</div>
              </div>
              <div className="pattern-mini-card">
                <div className="pattern-mini-label">Strongest Day</div>
                <div className="pattern-mini-val">{patternProfile.rhythm.bestDay}</div>
              </div>
              <div className="pattern-mini-card">
                <div className="pattern-mini-label">Note Habit</div>
                <div className="pattern-mini-val">{patternProfile.rhythm.dominantHabit}</div>
              </div>
            </div>

            {patternProfile.topSubjects.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                Top subjects:{' '}
                <strong>
                  {patternProfile.topSubjects.map(s => `${s.name} (${s.count})`).join(' · ')}
                </strong>
              </div>
            )}

            {patternProfile.weakInsights.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {patternProfile.weakInsights.map((ins, i) => (
                  <div key={i} className="pattern-insight-row">
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{ins.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{ins.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DeepTutor Persistent Learner Memory Panel */}
        <div className="list-group settings-group" style={{ margin: '18px 0 0' }}>
          <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
            <span className="settings-label flex items-center gap-6" style={{ marginBottom: 0 }}>
              <Brain size={14} /> DeepTutor Learner Memory ({memoryRows.length})
            </span>
            {memoryRows.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await clearLearnerMemory();
                  setMemoryRows([]);
                }}
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          <div className="settings-tip" style={{ marginBottom: 8 }}>
            Tracks strengths &amp; weak concepts from Flashcards, Exam Papers, and Learn Coding so AI Chat &amp; Deep Think remember how you learn (never reads Hidden Vault or Passwords &amp; Keys).
          </div>
          {memoryRows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
              No topics tracked yet — rate flashcards, check an exam paper, or complete a coding challenge to build your memory profile.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {memoryRows.slice(0, 10).map(row => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 10,
                    background: 'var(--fill)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.topic}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      {row.subject} · Mastery {row.mastery}%{row.mistakesCount ? ` · ${row.mistakesCount} miss${row.mistakesCount === 1 ? '' : 'es'}` : ''}
                    </div>
                  </div>
                  <span
                    className={`mode-badge ${row.mastery >= 75 ? 'mode-code' : row.mastery < 55 ? 'mode-vault' : 'mode-explore'}`}
                  >
                    {row.mastery >= 75 ? 'Strong' : row.mastery < 55 ? 'Focus' : 'Growing'}
                  </span>
                  <button
                    type="button"
                    className="row-icon-btn"
                    aria-label={`Remove ${row.topic}`}
                    onClick={async () => {
                      await deleteLearnerTopic(row.id);
                      setMemoryRows(prev => prev.filter(x => x.id !== row.id));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AudioStudySheet
        open={audioCardsOpen}
        onClose={() => setAudioCardsOpen(false)}
        mode="cards"
        cards={queue.length > 0 ? queue : summary.allCards}
      />
    </div>
  );
}
