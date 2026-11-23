/**
 * Shared Study UI Widgets — used by both StudyScreen and ExamSummaryScreen.
 *
 * - FlashcardDeck: interactive single-card flip deck with progress bar, Shuffle,
 *   Spaced Repetition ("Still learning" / "Got it"), and List view toggle.
 * - QuizSection: interactive multiple-choice quiz with live score summary,
 *   per-question rationale, and Retake button.
 */
import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Shuffle,
  RotateCcw,
  Check,
  X,
  LayoutList,
  Layers,
} from 'lucide-react';
import {
  scheduleCard,
  previewIntervals,
  isCardMastered,
  isCardLearning,
  formatInterval,
  normalizeCardState,
  recordCardReview,
} from '../../lib/spacedRepetition';
import MarkdownContent from '../ui/MarkdownContent';

export function FlashcardDeck({
  cards = [],
  progress = {}, // { [cardIndex]: SM2State | 'known' | 'learning' }
  onMarkCard = null,
}) {
  const [view, setView] = useState('deck'); // 'deck' | 'list'
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Re-sync order cleanly if card count changes
  const safeOrder = useMemo(() => {
    if (order.length === cards.length && order.every(i => i >= 0 && i < cards.length)) {
      return order;
    }
    return cards.map((_, i) => i);
  }, [order, cards]);

  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Layers size={26} />
        </div>
        <div className="empty-title">No flashcards yet</div>
        <div className="empty-text">
          Tap Explain in the note editor to generate flashcards automatically.
        </div>
      </div>
    );
  }

  const knownCount = Object.values(progress).filter(v => isCardMastered(v)).length;
  const currentIdx = safeOrder[Math.min(pos, safeOrder.length - 1)] ?? 0;
  const currentCard = cards[currentIdx];
  const currentStatus = progress[currentIdx];
  const currentMastered = isCardMastered(currentStatus);
  const currentLearning = isCardLearning(currentStatus);
  const intervals = previewIntervals(currentStatus);

  const go = delta => {
    setFlipped(false);
    setPos(p => (p + delta + safeOrder.length) % safeOrder.length);
  };

  const shuffleDeck = () => {
    const next = [...safeOrder];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setPos(0);
    setFlipped(false);
  };

  const rate = rating => {
    const nextState = scheduleCard(currentStatus, rating);
    recordCardReview();
    onMarkCard?.(currentIdx, nextState);
    if (pos < safeOrder.length - 1) {
      setFlipped(false);
      setPos(p => p + 1);
    } else {
      setFlipped(false);
    }
  };

  return (
    <div>
      <div className="deck-progress">
        <span>
          {view === 'deck'
            ? `Card ${pos + 1} of ${safeOrder.length}`
            : `${cards.length} flashcards`}
          {onMarkCard && knownCount > 0 ? ` · ${knownCount}/${cards.length} mastered` : ''}
        </span>
        <div className="flex items-center gap-6">
          {view === 'deck' && cards.length > 1 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={shuffleDeck}>
              <Shuffle size={14} /> Shuffle
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setView(v => (v === 'deck' ? 'list' : 'deck'))}
          >
            {view === 'deck' ? <LayoutList size={14} /> : <Layers size={14} />}
            {view === 'deck' ? 'List' : 'Deck'}
          </button>
        </div>
      </div>

      {view === 'deck' ? (
        <>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${((pos + 1) / safeOrder.length) * 100}%` }}
            />
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
                {(currentMastered || currentLearning) && (
                  <span
                    className="tag-pill"
                    style={{
                      background: currentMastered ? 'var(--ok-bg)' : 'var(--mistake-bg)',
                      color: currentMastered ? 'var(--ok)' : 'var(--mistake-ink)',
                    }}
                  >
                    {currentMastered
                      ? `Mastered${normalizeCardState(currentStatus).intervalDays > 0 ? ` · ${formatInterval(normalizeCardState(currentStatus).intervalDays)}` : ''}`
                      : 'Learning'}
                  </span>
                )}
              </div>
              <div className="flashcard-body">
                <MarkdownContent text={flipped ? currentCard.a || '—' : currentCard.q} />
              </div>
              <div className="flashcard-flip-hint">
                {flipped ? 'Tap to show question' : 'Tap to flip'}
              </div>
            </button>
          </div>

          {onMarkCard && flipped && (
            <div className="sm2-grid" style={{ marginBottom: 12 }} role="group" aria-label="Rate recall">
              <button type="button" className="sm2-btn sm2-again" onClick={() => rate('again')}>
                <span className="sm2-label">Again</span>
                <span className="sm2-int">{intervals.again}</span>
              </button>
              <button type="button" className="sm2-btn sm2-hard" onClick={() => rate('hard')}>
                <span className="sm2-label">Hard</span>
                <span className="sm2-int">{intervals.hard}</span>
              </button>
              <button type="button" className="sm2-btn sm2-good" onClick={() => rate('good')}>
                <span className="sm2-label">Good</span>
                <span className="sm2-int">{intervals.good}</span>
              </button>
              <button type="button" className="sm2-btn sm2-easy" onClick={() => rate('easy')}>
                <span className="sm2-label">Easy</span>
                <span className="sm2-int">{intervals.easy}</span>
              </button>
            </div>
          )}

          {cards.length > 1 && (
            <div className="flex justify-between gap-8">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => go(-1)}>
                <ChevronLeft size={17} /> Previous
              </button>
              <button type="button" className="btn btn-secondary flex-1" onClick={() => go(1)}>
                Next <ChevronRight size={17} />
              </button>
            </div>
          )}
        </>
      ) : (
        cards.map((c, i) => <ListFlashcard key={i} card={c} status={progress[i]} />)
      )}
    </div>
  );
}

function ListFlashcard({ card, status }) {
  const [flipped, setFlipped] = useState(false);
  const mastered = isCardMastered(status);
  const learning = isCardLearning(status);
  return (
    <button
      type="button"
      className="flashcard-btn"
      style={{ minHeight: 110, marginBottom: 10, padding: 16 }}
      onClick={() => setFlipped(f => !f)}
    >
      <div className="flex justify-between items-center w-full" style={{ marginBottom: 6 }}>
        <span className="flashcard-side-label" style={{ marginBottom: 0 }}>
          {flipped ? 'Answer' : 'Question'}
        </span>
        {(mastered || learning) && (
          <span
            className="tag-pill"
            style={{
              background: mastered ? 'var(--ok-bg)' : 'var(--mistake-bg)',
              color: mastered ? 'var(--ok)' : 'var(--mistake-ink)',
            }}
          >
            {mastered ? 'Mastered' : 'Learning'}
          </span>
        )}
      </div>
      <MarkdownContent text={flipped ? card.a || '—' : card.q} />
      <div className="flashcard-flip-hint" style={{ marginTop: 10 }}>
        {flipped ? 'Tap to show question' : 'Tap to flip'}
      </div>
    </button>
  );
}

export function QuizSection({
  quiz = [],
  answers = {},
  onPick = null,
  onReset = null,
}) {
  const [localAnswers, setLocalAnswers] = useState(answers);
  const currentAnswers = onPick ? answers : localAnswers;

  const handlePick = (qIdx, choiceIdx) => {
    if (currentAnswers[qIdx] != null) return;
    if (onPick) {
      onPick(qIdx, choiceIdx);
    } else {
      setLocalAnswers(prev => ({ ...prev, [qIdx]: choiceIdx }));
    }
  };

  const handleRetake = () => {
    if (onReset) onReset();
    else setLocalAnswers({});
  };

  if (quiz.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-title">No quiz questions yet</div>
        <div className="empty-text">
          Tap Explain in the note editor to generate practice questions.
        </div>
      </div>
    );
  }

  const answeredCount = Object.keys(currentAnswers).length;
  const correctCount = quiz.reduce(
    (sum, q, idx) => sum + (currentAnswers[idx] === q.answer ? 1 : 0),
    0
  );
  const pct = answeredCount > 0 ? Math.round((correctCount / quiz.length) * 100) : 0;

  return (
    <div>
      {answeredCount > 0 && (
        <div className="score-banner">
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Score: {correctCount} / {quiz.length}
              {answeredCount === quiz.length ? ` (${pct}%)` : ` · ${answeredCount} answered`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {answeredCount === quiz.length
                ? pct >= 80
                  ? 'Great mastery!'
                  : 'Review the missed items below.'
                : 'Keep going to see your final score.'}
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRetake}>
            <RotateCcw size={14} /> Retake
          </button>
        </div>
      )}

      {quiz.map((item, qIdx) => {
        const picked = currentAnswers[qIdx];
        const isCorrect = picked != null && picked === item.answer;
        return (
          <div key={qIdx} className="explanation-card">
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, lineHeight: 1.45 }}>
              {qIdx + 1}. {item.question}
            </div>
            <div className="flex" style={{ flexDirection: 'column', gap: 8 }}>
              {(item.choices || []).map((choice, cIdx) => {
                let cls = 'quiz-choice';
                if (picked != null) {
                  if (cIdx === item.answer) cls += ' correct';
                  else if (cIdx === picked) cls += ' wrong';
                }
                return (
                  <button
                    key={cIdx}
                    type="button"
                    className={cls}
                    disabled={picked != null}
                    onClick={() => handlePick(qIdx, cIdx)}
                  >
                    <strong>{String.fromCharCode(65 + cIdx)}.</strong> {choice}
                  </button>
                );
              })}
            </div>
            {picked != null && (
              <div style={{ marginTop: 10 }}>
                <div
                  className="flex items-center gap-6"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isCorrect ? 'var(--ok)' : 'var(--bad)',
                  }}
                >
                  {isCorrect ? <Check size={15} /> : <X size={15} />}
                  {isCorrect ? 'Correct' : 'Not quite'}
                </div>
                {item.explanation && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                    {item.explanation}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
