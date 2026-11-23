/**
 * Voice-to-Notes & Lecture Dictation — Web Speech API wrapper.
 *
 * Works live on Android Chrome / Capacitor WebView (when Google Speech Services
 * is installed) and desktop Chromium/Edge/Safari, with automatic restart on
 * mobile silence timeouts, Pause/Resume, multi-language switching, and clear
 * fallback guidance when a WebView lacks SpeechRecognition.
 */

export const DICTATION_LANGS = [
  { code: '', label: 'Auto' },
  { code: 'en-US', label: 'English' },
  { code: 'fil-PH', label: 'Filipino' },
  { code: 'es-ES', label: 'Español' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文' },
];

const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

export function friendlySpeechError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied. Allow mic access in your device settings or use your keyboard microphone.';
    case 'audio-capture':
      return 'No microphone detected. Check that no other app is using your mic.';
    case 'network':
      return 'Speech service requires an internet connection on this device. Try your keyboard’s offline mic button.';
    case 'no-speech':
      return 'No speech detected — keep talking or tap Stop when finished.';
    default:
      return 'Voice dictation paused. Tap Resume or use your keyboard microphone.';
  }
}

/**
 * Request runtime mic permission gracefully on Android WebView / browsers
 * before launching SpeechRecognition.
 */
async function ensureMicPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      return false;
    }
    // Some WebViews reject getUserMedia even when SpeechRecognition works natively
    return true;
  }
}

/**
 * Create a controllable continuous dictation session.
 */
export function createDictationSession({
  lang = '',
  onInterim = null,
  onFinal = null,
  onError = null,
  onStateChange = null, // 'idle' | 'listening' | 'paused'
} = {}) {
  const Ctor = getSpeechRecognitionCtor();
  let recognition = null;
  let active = false;
  let paused = false;
  let currentLang = lang || '';
  let restartTimer = null;
  let consecutiveErrors = 0;

  const clearRestart = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const cleanupRec = () => {
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      // ignore already-stopped errors
    }
    recognition = null;
  };

  const spawn = () => {
    if (!Ctor || !active || paused) return;
    cleanupRec();

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = currentLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';

    rec.onresult = event => {
      consecutiveErrors = 0;
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res?.[0]?.transcript || '';
        if (res.isFinal) {
          finalChunk += text;
        } else {
          interim += text;
        }
      }
      onInterim?.(interim.trim());
      if (finalChunk.trim()) {
        onFinal?.(finalChunk.trim());
      }
    };

    rec.onerror = event => {
      const code = event?.error || 'unknown';
      if (code === 'aborted') return;
      if (code === 'no-speech') {
        // Common silence timeout on mobile — let onend silently restart
        return;
      }
      consecutiveErrors += 1;
      onError?.(friendlySpeechError(code), code);
      if (FATAL_ERRORS.has(code) || consecutiveErrors >= 3) {
        active = false;
        paused = false;
        clearRestart();
        cleanupRec();
        onInterim?.('');
        onStateChange?.('idle');
      }
    };

    rec.onend = () => {
      onInterim?.('');
      if (active && !paused) {
        // Auto-restart after Android Chrome's ~60s continuous speech cutoff
        clearRestart();
        restartTimer = setTimeout(() => {
          if (active && !paused) spawn();
        }, 200);
      }
    };

    recognition = rec;
    try {
      rec.start();
    } catch {
      // Retry once if browser was still tearing down previous instance
      clearRestart();
      restartTimer = setTimeout(() => {
        if (active && !paused) spawn();
      }, 300);
    }
  };

  return {
    async start() {
      if (!Ctor) {
        onError?.(
          'Live speech recognition is not available in this browser/WebView — tap the mic icon on your keyboard to dictate, then tap Clean with AI.',
          'unsupported'
        );
        return false;
      }
      const allowed = await ensureMicPermission();
      if (!allowed) {
        onError?.(friendlySpeechError('not-allowed'), 'not-allowed');
        return false;
      }
      active = true;
      paused = false;
      consecutiveErrors = 0;
      onStateChange?.('listening');
      spawn();
      return true;
    },

    pause() {
      if (!active || paused) return;
      paused = true;
      clearRestart();
      cleanupRec();
      onInterim?.('');
      onStateChange?.('paused');
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      consecutiveErrors = 0;
      onStateChange?.('listening');
      spawn();
    },

    stop() {
      active = false;
      paused = false;
      clearRestart();
      cleanupRec();
      onInterim?.('');
      onStateChange?.('idle');
    },

    setLang(nextLang) {
      currentLang = nextLang || '';
      if (active && !paused) {
        clearRestart();
        cleanupRec();
        restartTimer = setTimeout(() => {
          if (active && !paused) spawn();
        }, 150);
      }
    },

    isActive() {
      return active;
    },
  };
}
