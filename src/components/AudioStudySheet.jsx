/**
 * AudioStudySheet — "Study Commute" bottom-sheet player.
 *
 * Supports two modes:
 * - mode="note": Offline Read Aloud OR 2-Voice AI Study Podcast with highlighted script queue.
 * - mode="cards": Hands-Free Audio Flashcards (Question -> 4s countdown -> Answer -> auto-advance).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Headphones,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  X,
  Eye,
} from 'lucide-react';
import {
  buildOfflineNarrationSegments,
  generateStudyPodcastScript,
  isSpeechSupported,
  speakSegment,
  stopSpeech,
  stripForSpeech,
} from '../lib/audioStudy';
import { useDialog } from './ui/DialogProvider';

const SPEEDS = [0.85, 1, 1.25, 1.5];

export default function AudioStudySheet({
  open,
  onClose,
  mode = 'note', // 'note' | 'cards'
  title = '',
  body = '',
  subject = 'General',
  cards = [],
}) {
  const { toast } = useDialog();
  const [speechStyle, setSpeechStyle] = useState('offline'); // 'offline' | 'podcast'
  const [segments, setSegments] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [generatingPodcast, setGeneratingPodcast] = useState(false);

  // Hands-Free Flashcard state
  const [cardIdx, setCardIdx] = useState(0);
  const [cardPhase, setCardPhase] = useState('idle'); // idle | question | countdown | answer
  const [countdownSec, setCountdownSec] = useState(4);
  const [thinkDelay, setThinkDelay] = useState(4);

  const playingRef = useRef(false);
  const timerRef = useRef(null);
  const abortRef = useRef(null);
  const rateRef = useRef(rate);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setCardPhase('idle');
    clearTimers();
    stopSpeech();
  }, [clearTimers]);

  // Reset when opened/closed
  useEffect(() => {
    if (!open) {
      stopAll();
      abortRef.current?.abort();
      return;
    }
    if (mode === 'note') {
      setSpeechStyle('offline');
      setSegments(buildOfflineNarrationSegments({ title, body }));
      setActiveIdx(0);
    } else {
      setCardIdx(0);
      setCardPhase('idle');
    }
    return () => {
      stopAll();
      abortRef.current?.abort();
    };
  }, [open, mode, title, body, stopAll]);

  // ---- NOTE MODE PLAYBACK ----
  const playSegmentAt = useCallback(
    (idx, list = segments) => {
      if (!list || idx < 0 || idx >= list.length) {
        stopAll();
        return;
      }
      setActiveIdx(idx);
      playingRef.current = true;
      setPlaying(true);
      const seg = list[idx];
      speakSegment({
        text: seg.text,
        speaker: seg.speaker,
        rate: rateRef.current,
        onEnd: () => {
          if (!playingRef.current) return;
          if (idx + 1 < list.length) {
            playSegmentAt(idx + 1, list);
          } else {
            stopAll();
          }
        },
        onError: err => {
          toast(err.message || 'Speech playback failed', { type: 'error' });
          stopAll();
        },
      });
    },
    [segments, stopAll, toast]
  );

  const handleTogglePlayNote = () => {
    if (playing) {
      stopAll();
    } else {
      playSegmentAt(activeIdx >= segments.length ? 0 : activeIdx, segments);
    }
  };

  const handleSwitchStyle = async nextStyle => {
    stopAll();
    setSpeechStyle(nextStyle);
    if (nextStyle === 'offline') {
      setSegments(buildOfflineNarrationSegments({ title, body }));
      setActiveIdx(0);
      return;
    }
    // Generate 2-voice AI podcast script
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeneratingPodcast(true);
    try {
      const script = await generateStudyPodcastScript({
        title,
        body,
        subject,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setSegments(script);
      setActiveIdx(0);
      toast(`Podcast ready (${script.length} dialogue turns)! Tap Play.`, { type: 'success' });
    } catch (err) {
      if (!err?.isCancelled) {
        toast(`Could not build AI podcast: ${err.message}. Falling back to offline narration.`, {
          type: 'error',
        });
        setSpeechStyle('offline');
        setSegments(buildOfflineNarrationSegments({ title, body }));
      }
    } finally {
      setGeneratingPodcast(false);
    }
  };

  // ---- HANDS-FREE AUDIO FLASHCARDS PLAYBACK ----
  const runCardAt = useCallback(
    idx => {
      if (!cards || cards.length === 0 || idx >= cards.length) {
        stopAll();
        toast('Hands-free flashcard deck finished!', { type: 'success' });
        return;
      }
      const item = cards[idx];
      const qText = stripForSpeech(item?.card?.q || item?.q || '');
      const aText = stripForSpeech(item?.card?.a || item?.a || '');
      setCardIdx(idx);
      setCardPhase('question');
      playingRef.current = true;
      setPlaying(true);

      const speakAnswer = () => {
        if (!playingRef.current) return;
        setCardPhase('answer');
        speakSegment({
          text: `Answer: ${aText}`,
          speaker: 'Tutor',
          rate: rateRef.current,
          onEnd: () => {
            if (!playingRef.current) return;
            timerRef.current = setTimeout(() => {
              if (!playingRef.current) return;
              runCardAt(idx + 1);
            }, 1300);
          },
          onError: () => stopAll(),
        });
      };

      speakSegment({
        text: `Question ${idx + 1}. ${qText}`,
        speaker: 'Host',
        rate: rateRef.current,
        onEnd: () => {
          if (!playingRef.current) return;
          setCardPhase('countdown');
          let rem = thinkDelay;
          setCountdownSec(rem);
          timerRef.current = setInterval(() => {
            if (!playingRef.current) {
              clearTimers();
              return;
            }
            rem -= 1;
            setCountdownSec(Math.max(0, rem));
            if (rem <= 0) {
              clearTimers();
              speakAnswer();
            }
          }, 1000);
        },
        onError: err => {
          toast(err.message || 'Audio unavailable', { type: 'error' });
          stopAll();
        },
      });
    },
    [cards, thinkDelay, clearTimers, stopAll, toast]
  );

  const handleTogglePlayCards = () => {
    if (playing) {
      stopAll();
    } else {
      runCardAt(cardIdx >= cards.length ? 0 : cardIdx);
    }
  };

  if (!open) return null;

  const supported = isSpeechSupported();
  const currentCard = cards[cardIdx];

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel audio-study-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Headphones size={18} color="var(--accent-ink)" />
            <span className="sheet-title">
              {mode === 'cards' ? 'Hands-Free Audio Flashcards' : 'Study Commute Audio'}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close audio player">
            <X size={18} />
          </button>
        </div>

        {!supported && (
          <div className="inline-mistake" style={{ marginBottom: 10 }}>
            Web Speech TTS is unavailable in this browser environment. Try Chrome or the Android APK.
          </div>
        )}

        {/* Speed Selector */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 8 }}>
          <span className="settings-help" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Volume2 size={14} /> Speed
          </span>
          <div className="flex gap-6">
            {SPEEDS.map(sp => (
              <button
                key={sp}
                type="button"
                className={`row-action-chip${rate === sp ? ' active-chip' : ''}`}
                onClick={() => setRate(sp)}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        {mode === 'note' ? (
          <>
            {/* Mode Switcher: Offline Read Aloud vs 2-Voice AI Podcast */}
            <div className="view-switcher" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`view-switch-btn${speechStyle === 'offline' ? ' active' : ''}`}
                onClick={() => handleSwitchStyle('offline')}
              >
                Read Aloud (Offline)
              </button>
              <button
                type="button"
                className={`view-switch-btn${speechStyle === 'podcast' ? ' active' : ''}`}
                disabled={generatingPodcast}
                onClick={() => handleSwitchStyle('podcast')}
              >
                <Sparkles size={13} style={{ marginRight: 4 }} />
                {generatingPodcast ? 'Writing Script…' : '2-Voice Podcast (AI)'}
              </button>
            </div>

            {/* Playback Controls */}
            <div className="audio-controls-row">
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous line"
                onClick={() => playSegmentAt(Math.max(0, activeIdx - 1))}
              >
                <SkipBack size={20} />
              </button>
              <button
                type="button"
                className="btn btn-primary audio-play-btn"
                disabled={generatingPodcast || !supported}
                onClick={handleTogglePlayNote}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
                <span>{playing ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Stop playback"
                onClick={stopAll}
              >
                <Square size={17} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next line"
                onClick={() => playSegmentAt(Math.min(segments.length - 1, activeIdx + 1))}
              >
                <SkipForward size={20} />
              </button>
            </div>

            {/* Live Highlighted Script List */}
            <div className="audio-script-list">
              {segments.map((seg, i) => (
                <button
                  key={i}
                  type="button"
                  className={`audio-seg-row${i === activeIdx ? ' active' : ''}`}
                  onClick={() => playSegmentAt(i)}
                >
                  {seg.speaker !== 'Narrator' && (
                    <span className={`mode-badge ${seg.speaker === 'Tutor' ? 'mode-code' : 'mode-study'}`}>
                      {seg.speaker}
                    </span>
                  )}
                  <span className="audio-seg-text">{seg.text}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          /* Hands-Free Flashcards Mode */
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span className="settings-help" style={{ margin: 0 }}>
                Think pause before answer:
              </span>
              <div className="flex gap-6">
                {[3, 4, 6].map(sec => (
                  <button
                    key={sec}
                    type="button"
                    className={`row-action-chip${thinkDelay === sec ? ' active-chip' : ''}`}
                    onClick={() => setThinkDelay(sec)}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {cards.length === 0 ? (
              <div className="settings-help">No flashcards available to play yet.</div>
            ) : (
              <>
                <div className="audio-card-stage">
                  <div className="settings-help" style={{ margin: '0 0 6px' }}>
                    Card {cardIdx + 1} of {cards.length} ·{' '}
                    {cardPhase === 'question'
                      ? 'Reading Question…'
                      : cardPhase === 'countdown'
                        ? `Think! Revealing in ${countdownSec}s…`
                        : cardPhase === 'answer'
                          ? 'Reading Answer…'
                          : 'Ready for hands-free commute'}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.45 }}>
                    {stripForSpeech(currentCard?.card?.q || currentCard?.q || '')}
                  </div>
                  {cardPhase === 'countdown' && (
                    <div className="progress-bar-track" style={{ marginTop: 12 }}>
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.max(5, (countdownSec / thinkDelay) * 100)}%` }}
                      />
                    </div>
                  )}
                  {cardPhase === 'answer' && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 10,
                        borderTop: '1px solid var(--sep)',
                        fontSize: 14.5,
                        color: 'var(--accent-ink)',
                        lineHeight: 1.5,
                      }}
                    >
                      {stripForSpeech(currentCard?.card?.a || currentCard?.a || '')}
                    </div>
                  )}
                </div>

                <div className="audio-controls-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Previous card"
                    onClick={() => runCardAt(Math.max(0, cardIdx - 1))}
                  >
                    <SkipBack size={20} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary audio-play-btn"
                    disabled={!supported}
                    onClick={handleTogglePlayCards}
                  >
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                    <span>{playing ? 'Pause' : 'Start Hands-Free'}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Skip countdown & reveal"
                    title="Show answer now"
                    onClick={() => {
                      clearTimers();
                      setCardPhase('answer');
                      const aText = stripForSpeech(currentCard?.card?.a || currentCard?.a || '');
                      speakSegment({
                        text: `Answer: ${aText}`,
                        speaker: 'Tutor',
                        rate: rateRef.current,
                        onEnd: () => {
                          if (playingRef.current) runCardAt(cardIdx + 1);
                        },
                      });
                    }}
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Next card"
                    onClick={() => runCardAt(Math.min(cards.length - 1, cardIdx + 1))}
                  >
                    <SkipForward size={20} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
