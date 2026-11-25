/**
 * CramGamesTab — 100% offline Swipe Cram & 60-Second Term-Match Speed Game
 * inside Study Mode to make pre-quiz cramming effortless.
 */
import { useState, useEffect, useMemo } from 'react';
import { RotateCw, Check, X, Flame, Timer, Trophy, Shuffle } from 'lucide-react';
import { logStudyActivity } from '../../store/db';

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function SwipeCramGame({ cards = [], onMarkCard }) {
  const [deck, setDeck] = useState(() => cards.map((c, idx) => ({ ...c, _origIdx: idx })));
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);

  const current = deck[0] || null;
  const totalCards = cards.length;
  const doneCount = totalCards - deck.length;

  const handleDecision = gotIt => {
    if (!current) return;
    setFlipped(false);
    if (gotIt) {
      setKnown(k => k + 1);
      onMarkCard?.(current._origIdx, 'good');
      setDeck(prev => prev.slice(1));
      logStudyActivity('reviews', 1).catch(() => {});
    } else {
      setAgain(a => a + 1);
      onMarkCard?.(current._origIdx, 'again');
      // Re-queue near end of deck so student sees missed card again
      setDeck(prev => [...prev.slice(1), current]);
    }
  };

  const resetDeck = () => {
    setDeck(shuffleArray(cards.map((c, idx) => ({ ...c, _origIdx: idx }))));
    setFlipped(false);
    setKnown(0);
    setAgain(0);
  };

  if (!current) {
    return (
      <div className="explanation-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
        <Trophy size={32} style={{ color: 'var(--accent)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 17, fontWeight: 800 }}>Cram Round Complete!</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {known} nailed · {again} extra retries
        </div>
        <button type="button" className="btn btn-primary btn-sm mt-12" onClick={resetDeck}>
          <Shuffle size={14} /> Shuffle &amp; Cram Again
        </button>
      </div>
    );
  }

  return (
    <div className="cram-wrap">
      <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {deck.length} left · {doneCount}/{totalCards} cleared
        </span>
        <button type="button" className="row-action-chip" onClick={resetDeck}>
          <Shuffle size={12} /> Shuffle
        </button>
      </div>

      <div className="progress-bar-track" style={{ marginBottom: 12 }}>
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.round((doneCount / Math.max(1, totalCards)) * 100)}%` }}
        />
      </div>

      <button
        type="button"
        className={`cram-swipe-card${flipped ? ' is-flipped' : ''}`}
        onClick={() => setFlipped(f => !f)}
      >
        <span className="mode-badge mode-study" style={{ marginBottom: 10 }}>
          {flipped ? 'ANSWER' : 'TERM — TAP TO FLIP'}
        </span>
        <div className="cram-card-text">{flipped ? current.a : current.q}</div>
      </button>

      <div className="flex gap-8 mt-12">
        <button
          type="button"
          className="btn btn-secondary flex-1"
          style={{ color: '#ff375f' }}
          onClick={() => handleDecision(false)}
        >
          <X size={16} /> Review Again
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => handleDecision(true)}
        >
          <Check size={16} /> Got It
        </button>
      </div>
    </div>
  );
}

export function TermMatchSpeedGame({ cards = [] }) {
  const pairs = useMemo(() => shuffleArray(cards).slice(0, 6), [cards]);
  const [tiles, setTiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [matchedIds, setMatchedIds] = useState([]);
  const [mismatchPair, setMismatchPair] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [mistakes, setMistakes] = useState(0);
  const [started, setStarted] = useState(false);

  const setupRound = () => {
    const picked = shuffleArray(cards).slice(0, 6);
    const allTiles = [];
    picked.forEach((c, idx) => {
      allTiles.push({ uid: `q-${idx}`, pairIdx: idx, kind: 'q', text: c.q });
      allTiles.push({ uid: `a-${idx}`, pairIdx: idx, kind: 'a', text: c.a });
    });
    setTiles(shuffleArray(allTiles));
    setSelectedId(null);
    setMatchedIds([]);
    setMismatchPair(null);
    setSecondsLeft(60);
    setMistakes(0);
    setStarted(true);
  };

  useEffect(() => {
    setupRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs.length]);

  const allCleared = tiles.length > 0 && matchedIds.length === tiles.length;
  const gameOver = secondsLeft <= 0 && !allCleared;

  useEffect(() => {
    if (!started || allCleared || gameOver) return undefined;
    const id = setInterval(() => {
      setSecondsLeft(s => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [started, allCleared, gameOver]);

  const handleTileTap = tile => {
    if (allCleared || gameOver || matchedIds.includes(tile.uid)) return;
    if (!selectedId) {
      setSelectedId(tile.uid);
      return;
    }
    if (selectedId === tile.uid) {
      setSelectedId(null);
      return;
    }
    const first = tiles.find(t => t.uid === selectedId);
    if (!first) return;
    if (first.pairIdx === tile.pairIdx && first.kind !== tile.kind) {
      const nextMatched = [...matchedIds, first.uid, tile.uid];
      setMatchedIds(nextMatched);
      setSelectedId(null);
      if (nextMatched.length === tiles.length) {
        logStudyActivity('reviews', 1).catch(() => {});
      }
    } else {
      setMistakes(m => m + 1);
      setMismatchPair([first.uid, tile.uid]);
      setSelectedId(null);
      setTimeout(() => setMismatchPair(null), 420);
    }
  };

  if (allCleared) {
    return (
      <div className="explanation-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
        <Flame size={32} style={{ color: '#ff9f0a', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 17, fontWeight: 800 }}>
          Cleared in {60 - secondsLeft}s!
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {mistakes === 0 ? 'Perfect accuracy — 0 mistakes!' : `${mistakes} miss${mistakes === 1 ? '' : 'es'}`}
        </div>
        <button type="button" className="btn btn-primary btn-sm mt-12" onClick={setupRound}>
          <RotateCw size={14} /> Play Again
        </button>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="explanation-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
        <Timer size={30} style={{ color: '#ff375f', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 17, fontWeight: 800 }}>Time&apos;s Up!</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Matched {matchedIds.length / 2} of {tiles.length / 2} pairs
        </div>
        <button type="button" className="btn btn-primary btn-sm mt-12" onClick={setupRound}>
          <RotateCw size={14} /> Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
        <span className="streak-pill">
          <Timer size={13} /> {secondsLeft}s
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
          {matchedIds.length / 2}/{tiles.length / 2} matched · {mistakes} miss
        </span>
        <button type="button" className="row-action-chip" onClick={setupRound}>
          <RotateCw size={12} /> Reset
        </button>
      </div>

      <div className="match-grid">
        {tiles.map(t => {
          const isMatched = matchedIds.includes(t.uid);
          const isSelected = selectedId === t.uid;
          const isWrong = mismatchPair?.includes(t.uid);
          return (
            <button
              key={t.uid}
              type="button"
              disabled={isMatched}
              className={`match-tile${isSelected ? ' is-selected' : ''}${isMatched ? ' is-matched' : ''}${isWrong ? ' is-wrong' : ''}`}
              onClick={() => handleTileTap(t)}
            >
              <span className="match-tile-tag">{t.kind === 'q' ? 'TERM' : 'DEF'}</span>
              <span className="match-tile-text">{t.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
