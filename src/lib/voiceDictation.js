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

export function hasNativeAndroidSpeech() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.BaiNativeSpeech) &&
    typeof window.BaiNativeSpeech.start === 'function'
  );
}

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported() {
  return hasNativeAndroidSpeech() || Boolean(getSpeechRecognitionCtor());
}

export function friendlySpeechError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied. Allow mic access in your device settings or use your keyboard microphone.';
    case 'audio-capture':
      return 'No microphone detected or mic is busy in another app. Check your mic and try again.';
    case 'network':
      return 'Speech service requires internet or an offline speech language pack on this device.';
    case 'no-speech':
      return 'No speech detected — keep talking or tap Stop when finished.';
    case 'unsupported':
      return 'Google Speech Recognition service is disabled or missing on this phone. Enable "Speech Recognition & Synthesis from Google" or use your keyboard mic.';
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
  // Native Android APK SpeechRecognizer bridge (works even when Android WebView lacks Web Speech!)
  if (hasNativeAndroidSpeech()) {
    let active = false;
    let paused = false;
    let currentLang = lang || '';
    let lastInterim = '';

    const flushInterim = () => {
      const leftover = lastInterim.trim();
      lastInterim = '';
      onInterim?.('');
      if (leftover) onFinal?.(leftover);
    };

    const bindCallback = () => {
      window.__baiSpeechCallback = (eventType, payload) => {
        if (eventType === 'interim') {
          if (active && !paused) {
            lastInterim = String(payload || '').trim();
            onInterim?.(lastInterim);
          }
          return;
        }
        if (eventType === 'final') {
          const clean = String(payload || '').trim();
          lastInterim = '';
          onInterim?.('');
          if (clean && active && !paused) onFinal?.(clean);
          return;
        }
        if (eventType === 'error') {
          const code = String(payload || 'unknown');
          flushInterim();
          onError?.(friendlySpeechError(code), code);
          if (FATAL_ERRORS.has(code) || code === 'network' || code === 'unsupported' || code.startsWith('speech-error-')) {
            active = false;
            paused = false;
            onStateChange?.('idle');
          }
          return;
        }
        if (eventType === 'state') {
          if (payload === 'idle') {
            if (!paused) {
              flushInterim();
              active = false;
              onStateChange?.('idle');
            }
          } else if (payload === 'listening' && active && !paused) {
            onStateChange?.('listening');
          }
        }
      };
    };

    return {
      async start() {
        const bridge = window.BaiNativeSpeech;
        const avail = typeof bridge.isAvailable === 'function' ? bridge.isAvailable() : true;
        if (!avail) {
          onError?.(friendlySpeechError('unsupported'), 'unsupported');
          return false;
        }
        bindCallback();
        active = true;
        paused = false;
        lastInterim = '';
        onStateChange?.('listening');
        bridge.start(currentLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US');
        return true;
      },
      pause() {
        if (!active || paused) return;
        flushInterim();
        paused = true;
        onStateChange?.('paused');
        try {
          window.BaiNativeSpeech.stop();
        } catch {
          // ignore
        }
      },
      resume() {
        if (!active || !paused) return;
        bindCallback();
        paused = false;
        lastInterim = '';
        onStateChange?.('listening');
        window.BaiNativeSpeech.start(currentLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US');
      },
      stop() {
        flushInterim();
        active = false;
        paused = false;
        onStateChange?.('idle');
        if (typeof window !== 'undefined' && window.__baiSpeechCallback) {
          window.__baiSpeechCallback = null;
        }
        try {
          window.BaiNativeSpeech.stop();
        } catch {
          // ignore
        }
      },
      setLang(nextLang) {
        currentLang = nextLang || '';
        if (active && !paused) {
          flushInterim();
          try {
            window.BaiNativeSpeech.stop();
          } catch {
            // ignore
          }
          setTimeout(() => {
            if (active && !paused && hasNativeAndroidSpeech()) {
              window.BaiNativeSpeech.start(currentLang || 'en-US');
            }
          }, 120);
        }
      },
      isActive() {
        return active;
      },
    };
  }

  const Ctor = getSpeechRecognitionCtor();
  let recognition = null;
  let active = false;
  let paused = false;
  let currentLang = lang || '';
  let restartTimer = null;
  let consecutiveErrors = 0;
  let lastInterim = '';

  const flushWebInterim = () => {
    const leftover = lastInterim.trim();
    lastInterim = '';
    onInterim?.('');
    if (leftover) onFinal?.(leftover);
  };

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
      lastInterim = interim.trim();
      onInterim?.(lastInterim);
      if (finalChunk.trim()) {
        onFinal?.(finalChunk.trim());
      }
    };

    rec.onerror = event => {
      const code = event?.error || 'unknown';
      if (code === 'aborted') return;
      if (code === 'no-speech') {
        flushWebInterim();
        return;
      }
      consecutiveErrors += 1;
      flushWebInterim();
      if (FATAL_ERRORS.has(code) || consecutiveErrors >= 4) {
        onError?.(friendlySpeechError(code), code);
        active = false;
        paused = false;
        clearRestart();
        cleanupRec();
        onStateChange?.('idle');
      }
    };

    rec.onend = () => {
      flushWebInterim();
      if (active && !paused) {
        // Fast auto-restart after Android Chrome's continuous speech cutoff
        clearRestart();
        restartTimer = setTimeout(() => {
          if (active && !paused) spawn();
        }, 90);
      }
    };

    recognition = rec;
    try {
      rec.start();
    } catch {
      clearRestart();
      restartTimer = setTimeout(() => {
        if (active && !paused) spawn();
      }, 220);
    }
  };

  return {
    async start() {
      if (!Ctor) {
        onError?.(
          'Live speech recognition unavailable here — use your keyboard mic, then tap Clean with AI.',
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
      lastInterim = '';
      consecutiveErrors = 0;
      onStateChange?.('listening');
      spawn();
      return true;
    },

    pause() {
      if (!active || paused) return;
      flushWebInterim();
      paused = true;
      clearRestart();
      cleanupRec();
      onStateChange?.('paused');
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      lastInterim = '';
      consecutiveErrors = 0;
      onStateChange?.('listening');
      spawn();
    },

    stop() {
      flushWebInterim();
      active = false;
      paused = false;
      clearRestart();
      cleanupRec();
      onStateChange?.('idle');
    },

    setLang(nextLang) {
      currentLang = nextLang || '';
      if (active && !paused) {
        flushWebInterim();
        clearRestart();
        cleanupRec();
        restartTimer = setTimeout(() => {
          if (active && !paused) spawn();
        }, 120);
      }
    },

    isActive() {
      return active;
    },
  };
}
