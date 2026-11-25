/**
 * PinLockSheet — clean, tactile 4–6 digit PIN modal (portaled to document.body)
 * for setting up or unlocking Private Vault folders (like a Personal Diary).
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Unlock, X, Delete, HelpCircle } from 'lucide-react';
import {
  setupVaultPin,
  verifyVaultPin,
  getVaultHint,
  isValidPin,
  getDecoyConfig,
  unlockDecoyVaultSession,
} from '../lib/vault';
import { ensureDecoyVaultSeeded } from '../store/db';

export default function PinLockSheet({
  mode = 'unlock', // 'unlock' | 'verify' | 'setup' | 'change'
  title = '',
  subtitle = '',
  onSuccess,
  onClose,
}) {
  const [step, setStep] = useState(() =>
    mode === 'change'
      ? 'verify'
      : mode === 'verify'
        ? 'verify-action'
        : mode === 'setup'
          ? 'create'
          : 'unlock'
  );
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [hint, setHint] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const decoyCfg = getDecoyConfig();
  const decoyArmedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const savedHint = getVaultHint();

  const clearDigitHold = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearDigitHold(), []);

  const submitPin = async value => {
    const clean = String(value || '').trim();
    if (!isValidPin(clean)) {
      setError('Enter 4 to 6 digits');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Stealth decoy mode: when long-press trigger digit was held, ANY 4–6 digits open the harmless Dummy Vault
      if (decoyArmedRef.current && (mode === 'unlock' || mode === 'setup') && decoyCfg.enabled) {
        decoyArmedRef.current = false;
        await ensureDecoyVaultSeeded();
        unlockDecoyVaultSession();
        onSuccess?.({ decoy: true });
        return;
      }
      if (step === 'unlock' || step === 'verify-action') {
        const ok = await verifyVaultPin(clean);
        if (!ok) {
          setError('Incorrect PIN. Try again.');
          setPin('');
          return;
        }
        onSuccess?.();
      } else if (step === 'verify') {
        const ok = await verifyVaultPin(clean);
        if (!ok) {
          setError('Current PIN is incorrect.');
          setPin('');
          return;
        }
        setPin('');
        setStep('create');
      } else if (step === 'create') {
        setFirstPin(clean);
        setPin('');
        setStep('confirm');
      } else if (step === 'confirm') {
        if (clean !== firstPin) {
          setError('PINs did not match — enter again.');
          setPin('');
          return;
        }
        await setupVaultPin(clean, hint);
        onSuccess?.();
      }
    } catch (err) {
      setError(err?.message || 'PIN verification failed');
    } finally {
      setBusy(false);
    }
  };

  // Physical keyboard support (digits, Backspace, Enter, Escape)
  useEffect(() => {
    const onKey = e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        onClose?.();
      } else if (/^\d$/.test(e.key)) {
        setPin(p => (p.length < 6 ? p + e.key : p));
        setError('');
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1));
        setError('');
      } else if (e.key === 'Enter' && pin.length >= 4) {
        submitPin(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const appendDigit = d => {
    if (busy || pin.length >= 6) return;
    setError('');
    setPin(p => p + d);
  };

  const handleDigitPointerDown = d => {
    clearDigitHold();
    longPressTriggeredRef.current = false;
    if (!decoyCfg.enabled || (mode !== 'unlock' && mode !== 'setup')) return;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredRef.current = true;
      if (d === decoyCfg.triggerDigit) {
        decoyArmedRef.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          // ignore
        }
      }
      appendDigit(d);
    }, 450);
  };

  const handleDigitClick = d => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    appendDigit(d);
  };

  const heading =
    title ||
    (step === 'unlock'
      ? 'Unlock Hidden Vault'
      : step === 'verify-action'
        ? 'Confirm PIN to Continue'
        : step === 'verify'
          ? 'Enter Current PIN'
          : step === 'create'
            ? 'Create Vault PIN'
            : 'Confirm Vault PIN');

  const desc =
    subtitle ||
    (step === 'unlock'
      ? 'Enter your 4–6 digit PIN to reveal your Hidden Vault folders.'
      : step === 'verify-action'
        ? 'Enter your 4–6 digit PIN to authorize this security change.'
        : step === 'verify'
          ? 'Confirm your existing PIN before changing it.'
          : step === 'create'
            ? 'Choose a 4–6 digit PIN to protect your Hidden Vault & lock settings.'
            : 'Re-enter your PIN to confirm.');

  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet pin-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
          <div className="flex items-center gap-6" style={{ fontWeight: 700, fontSize: 15 }}>
            {step === 'unlock' ? <Lock size={16} /> : <Unlock size={16} />}
            <span>{heading}</span>
          </div>
          <button type="button" className="navbar-btn" aria-label="Close PIN sheet" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>{desc}</div>

        {/* Visual PIN Dots (4–6 slots) */}
        <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, Math.min(6, Math.max(pin.length, 4))) }).map((_, i) => (
            <span key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
          ))}
        </div>

        {step === 'confirm' && (
          <div style={{ marginBottom: 12 }}>
            <input
              type="text"
              className="ai-input"
              placeholder="Optional memory hint (e.g. lucky numbers)"
              value={hint}
              maxLength={80}
              onChange={e => setHint(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div className="inline-mistake" style={{ marginBottom: 10, textAlign: 'center' }}>
            {error}
          </div>
        )}

        {(step === 'unlock' || step === 'verify' || step === 'verify-action') && savedHint && (
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            {showHint ? (
              <span className="tag-pill">Hint: {savedHint}</span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowHint(true)}
              >
                <HelpCircle size={13} /> Forgot? Show my hint
              </button>
            )}
          </div>
        )}

        {/* Tactile Numeric Keypad */}
        <div className="pin-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button
              key={d}
              type="button"
              className="pin-key"
              disabled={busy}
              onPointerDown={() => handleDigitPointerDown(d)}
              onPointerUp={clearDigitHold}
              onPointerLeave={clearDigitHold}
              onPointerCancel={clearDigitHold}
              onContextMenu={e => e.preventDefault()}
              onClick={() => handleDigitClick(d)}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            className="pin-key pin-key-util"
            disabled={busy || !pin.length}
            onClick={() => {
              decoyArmedRef.current = false;
              setPin('');
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="pin-key"
            disabled={busy}
            onPointerDown={() => handleDigitPointerDown('0')}
            onPointerUp={clearDigitHold}
            onPointerLeave={clearDigitHold}
            onPointerCancel={clearDigitHold}
            onContextMenu={e => e.preventDefault()}
            onClick={() => handleDigitClick('0')}
          >
            0
          </button>
          <button
            type="button"
            className="pin-key pin-key-util"
            aria-label="Backspace"
            disabled={busy || !pin.length}
            onClick={() => setPin(p => p.slice(0, -1))}
          >
            <Delete size={18} />
          </button>
        </div>

        <div className="flex gap-8" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={busy || pin.length < 4}
            onClick={() => submitPin(pin)}
          >
            {step === 'create'
              ? 'Next'
              : step === 'confirm'
                ? 'Save PIN'
                : step === 'verify-action'
                  ? 'Confirm PIN'
                  : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
