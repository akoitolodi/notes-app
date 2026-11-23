/**
 * DialogProvider — custom iOS-style Confirm, Prompt, and Toast system.
 * Eliminates all native browser alert() / confirm() / prompt() popups
 * and fixes untracked overlapping toast timers.
 */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    return {
      toast: () => {},
      confirm: async () => false,
      prompt: async () => null,
    };
  }
  return ctx;
}

export default function DialogProvider({ children }) {
  const [toastState, setToastState] = useState(null); // { message, type }
  const toastTimer = useRef(null);

  const [dialog, setDialog] = useState(null); // { kind: 'confirm'|'prompt', ...opts, resolve }
  const [promptVal, setPromptVal] = useState('');
  const promptInputRef = useRef(null);

  const toast = useCallback((message, { type = 'info', duration = 2600 } = {}) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ message: String(message), type });
    toastTimer.current = setTimeout(() => {
      setToastState(null);
      toastTimer.current = null;
    }, duration);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const confirm = useCallback(opts => {
    const normalized = typeof opts === 'string' ? { message: opts } : opts || {};
    return new Promise(resolve => {
      setDialog({
        kind: 'confirm',
        title: normalized.title || 'Confirm',
        message: normalized.message || '',
        confirmLabel: normalized.confirmLabel || 'Confirm',
        cancelLabel: normalized.cancelLabel || 'Cancel',
        destructive: Boolean(normalized.destructive),
        resolve,
      });
    });
  }, []);

  const prompt = useCallback(opts => {
    const normalized = typeof opts === 'string' ? { title: opts } : opts || {};
    setPromptVal(normalized.defaultValue || '');
    return new Promise(resolve => {
      setDialog({
        kind: 'prompt',
        title: normalized.title || 'Enter value',
        message: normalized.message || '',
        placeholder: normalized.placeholder || '',
        confirmLabel: normalized.confirmLabel || 'Save',
        cancelLabel: normalized.cancelLabel || 'Cancel',
        resolve,
      });
    });
  }, []);

  const closeDialog = useCallback(result => {
    setDialog(prev => {
      if (prev?.resolve) prev.resolve(result);
      return null;
    });
  }, []);

  // Escape closes active dialog
  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === 'prompt') {
      setTimeout(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.select();
      }, 30);
    }
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(dialog.kind === 'confirm' ? false : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, closeDialog]);

  // Listen for non-fatal global unhandled rejections to surface cleanly as toasts
  useEffect(() => {
    const onRejection = e => {
      console.error('[unhandledrejection]', e.reason);
      const msg = e.reason?.message || String(e.reason || '');
      if (msg && !/AbortError|Cancelled/i.test(msg)) {
        toast(`Something went wrong: ${msg.slice(0, 90)}`, { type: 'error', duration: 3500 });
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [toast]);

  return (
    <DialogContext.Provider value={{ toast, confirm, prompt }}>
      {children}

      {dialog && (
        <div
          className="modal-overlay"
          onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="dialog-title" className="modal-title">{dialog.title}</h2>
            {dialog.message && <p className="modal-message">{dialog.message}</p>}

            {dialog.kind === 'prompt' && (
              <input
                ref={promptInputRef}
                className="ai-input modal-input"
                value={promptVal}
                placeholder={dialog.placeholder}
                onChange={e => setPromptVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && promptVal.trim()) {
                    e.preventDefault();
                    closeDialog(promptVal.trim());
                  }
                }}
              />
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}
              >
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn flex-1 ${dialog.destructive ? 'btn-danger' : 'btn-primary'}`}
                disabled={dialog.kind === 'prompt' && !promptVal.trim()}
                onClick={() =>
                  closeDialog(dialog.kind === 'confirm' ? true : promptVal.trim())
                }
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastState && (
        <div
          className={`toast toast-${toastState.type}`}
          role="status"
          aria-live="polite"
        >
          {toastState.message}
        </div>
      )}
    </DialogContext.Provider>
  );
}
