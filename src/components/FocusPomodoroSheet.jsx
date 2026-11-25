/**
 * FocusPomodoroSheet — Lazy-loaded 100% offline Pomodoro Focus Timer with
 * optional Web Audio Rain / Brown Noise and Study Heatmap logging.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Timer, Play, Pause, RotateCw, Volume2, X, Check } from 'lucide-react';
import {
  startAmbientSound,
  stopAmbientSound,
  playFocusChime,
} from '../lib/ambientAudio';
import { logStudyActivity } from '../store/db';
import { useDialog } from './ui/DialogProvider';

const PRESETS = [
  { id: '25-5', label: '25 / 5', focusMin: 25, breakMin: 5 },
  { id: '15-5', label: '15 / 5', focusMin: 15, breakMin: 5 },
  { id: '50-10', label: '50 / 10', focusMin: 50, breakMin: 10 },
];

export default function FocusPomodoroSheet({ courseLabel = '', onClose }) {
  const { toast } = useDialog();
  const [presetId, setPresetId] = useState('25-5');
  const [phase, setPhase] = useState('focus'); // 'focus' | 'break'
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [ambient, setAmbient] = useState('off'); // 'off' | 'rain' | 'brown'
  const [completedSessions, setCompletedSessions] = useState(0);

  const preset = PRESETS.find(p => p.id === presetId) || PRESETS[0];

  useEffect(() => () => stopAmbientSound(), []);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev > 1) return prev - 1;
        setRunning(false);
        playFocusChime();
        if (phase === 'focus') {
          setCompletedSessions(c => c + 1);
          logStudyActivity('reviews', 1).catch(() => {});
          toast('Focus block done! Logged to your Study Heatmap.', { type: 'success' });
          setPhase('break');
          return preset.breakMin * 60;
        }
        toast('Break finished — ready for another focus block!');
        setPhase('focus');
        return preset.focusMin * 60;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, phase, preset, toast]);

  const handleSelectPreset = p => {
    setPresetId(p.id);
    setRunning(false);
    setPhase('focus');
    setSecondsLeft(p.focusMin * 60);
  };

  const handleAmbientChange = next => {
    setAmbient(next);
    if (next === 'off') stopAmbientSound();
    else startAmbientSound(next);
  };

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const secs = String(secondsLeft % 60).padStart(2, '0');
  const totalPhaseSec = (phase === 'focus' ? preset.focusMin : preset.breakMin) * 60;
  const pct = Math.max(0, Math.min(100, Math.round(((totalPhaseSec - secondsLeft) / totalPhaseSec) * 100)));

  const modal = (
    <div
      className="export-overlay"
      onClick={() => {
        stopAmbientSound();
        onClose?.();
      }}
    >
      <div
        className="export-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Focus Pomodoro Timer"
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-8" style={{ fontWeight: 800, fontSize: 15 }}>
            <Timer size={17} style={{ color: 'var(--accent)' }} />
            <span>Focus Timer{courseLabel ? ` · ${courseLabel}` : ''}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close focus timer"
            onClick={() => {
              stopAmbientSound();
              onClose?.();
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 12px' }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`view-switch-btn${presetId === p.id ? ' active' : ''}`}
              onClick={() => handleSelectPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="pomodoro-face">
          <div className="pomodoro-phase-pill">
            {phase === 'focus' ? 'DEEP FOCUS' : 'SHORT BREAK'} · {completedSessions} done
          </div>
          <div className="pomodoro-clock">
            {mins}:{secs}
          </div>
          <div className="progress-bar-track" style={{ margin: '10px 0 4px' }}>
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex gap-8 mt-12">
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => setRunning(r => !r)}
          >
            {running ? <Pause size={16} /> : <Play size={16} />}
            {running ? 'Pause' : 'Start'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setRunning(false);
              setSecondsLeft((phase === 'focus' ? preset.focusMin : preset.breakMin) * 60);
            }}
            aria-label="Reset timer"
          >
            <RotateCw size={15} />
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            title="Mark focus block done now"
            onClick={() => {
              setRunning(false);
              setCompletedSessions(c => c + 1);
              logStudyActivity('reviews', 1).catch(() => {});
              playFocusChime();
              toast('Logged focus session to Study Heatmap!', { type: 'success' });
            }}
          >
            <Check size={15} /> Log
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="settings-help" style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Volume2 size={13} /> Offline Focus Sound
          </div>
          <div className="view-switcher view-switcher-inline" style={{ margin: 0 }}>
            {[
              ['off', 'Silent'],
              ['rain', 'Soft Rain'],
              ['brown', 'Brown Noise'],
            ].map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                className={`view-switch-btn${ambient === id ? ' active' : ''}`}
                onClick={() => handleAmbientChange(id)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
