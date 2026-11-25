/**
 * ambientAudio — 100% offline Web Audio procedural synthesizer (Rain & Brown Noise)
 * plus a gentle completion chime for the Focus Pomodoro Timer. Zero audio files required.
 */

let _ctx = null;
let _source = null;
let _gain = null;
let _activeMode = 'off';

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new Ctx();
  }
  if (_ctx.state === 'suspended') {
    _ctx.resume().catch(() => {});
  }
  return _ctx;
}

export function stopAmbientSound() {
  try {
    _source?.stop?.();
    _source?.disconnect?.();
    _gain?.disconnect?.();
  } catch {
    // ignore cleanup errors
  }
  _source = null;
  _gain = null;
  _activeMode = 'off';
}

export function getAmbientMode() {
  return _activeMode;
}

/** Start procedural offline ambient sound ('off' | 'rain' | 'brown'). */
export function startAmbientSound(mode = 'rain', volume = 0.22) {
  stopAmbientSound();
  if (mode === 'off') return 'off';

  const ctx = getAudioContext();
  if (!ctx) return 'off';

  const bufferSize = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = buffer.getChannelData(0);

  if (mode === 'brown') {
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.025 * white) / 1.025;
      lastOut = output[i];
      output[i] *= 3.2;
    }
  } else {
    // Soft pink/rain filtered noise
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      output[i] = (b0 + b1 + b2 + white * 0.04) * 1.4;
    }
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = mode === 'brown' ? 420 : 1850;

  const gain = ctx.createGain();
  gain.gain.value = Math.max(0.02, Math.min(0.6, volume));

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();

  _source = src;
  _gain = gain;
  _activeMode = mode;
  return mode;
}

/** Play a soft two-tone study chime offline when a Pomodoro interval completes. */
export function playFocusChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.14, now + i * 0.18 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.58);
    });
  } catch {
    // ignore Web Audio blocks
  }
}
