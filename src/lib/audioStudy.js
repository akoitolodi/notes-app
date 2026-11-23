/**
 * audioStudy — "Study Commute" Offline Web Speech TTS & 2-Voice Study Podcast Engine.
 *
 * - 100% offline text-to-speech via browser/Android WebView speechSynthesis
 * - Strips Markdown & LaTeX into clean, natural spoken phrasing
 * - Supports optional 1-call AI 2-Voice Podcast Script (Host + Tutor) with instant offline fallback
 */
import { aiText } from './aiCore';

/** Strip Markdown & common LaTeX into natural spoken sentences. */
export function stripForSpeech(md = '') {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' [code example] ')
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => ` ${latexToSpoken(m)} `)
    .replace(/\$([^$\n]+)\$/g, (_, m) => ` ${latexToSpoken(m)} `)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latexToSpoken(expr) {
  return String(expr || '')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2')
    .replace(/\\sqrt\{([^}]+)\}/g, 'square root of $1')
    .replace(/\\times/g, ' times ')
    .replace(/\\cdot/g, ' times ')
    .replace(/\\pi/g, ' pi ')
    .replace(/\\theta/g, ' theta ')
    .replace(/\\alpha/g, ' alpha ')
    .replace(/\\beta/g, ' beta ')
    .replace(/\\Delta/g, ' delta ')
    .replace(/\\sum/g, ' sum of ')
    .replace(/\\int/g, ' integral of ')
    .replace(/\\leq/g, ' less than or equal to ')
    .replace(/\\geq/g, ' greater than or equal to ')
    .replace(/\\neq/g, ' not equal to ')
    .replace(/\^2\b/g, ' squared')
    .replace(/\^3\b/g, ' cubed')
    .replace(/\^\{?([^}\s]+)\}?/g, ' to the power of $1')
    .replace(/\\([a-zA-Z]+)/g, ' $1 ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build instant 100% offline narration segments from note title + body. */
export function buildOfflineNarrationSegments({ title = '', body = '' }) {
  const segments = [];
  const cleanTitle = stripForSpeech(title);
  if (cleanTitle) {
    segments.push({ speaker: 'Narrator', text: cleanTitle });
  }
  const blocks = String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(b => stripForSpeech(b))
    .filter(b => b.length > 1);

  for (const blk of blocks) {
    if (blk.length <= 260) {
      segments.push({ speaker: 'Narrator', text: blk });
    } else {
      const sentences = blk.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [blk];
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > 260 && buf) {
          segments.push({ speaker: 'Narrator', text: buf.trim() });
          buf = s.trim();
        } else {
          buf = (buf + ' ' + s).trim();
        }
      }
      if (buf) segments.push({ speaker: 'Narrator', text: buf.trim() });
    }
  }
  return segments.length > 0 ? segments : [{ speaker: 'Narrator', text: 'This note is currently empty.' }];
}

/** Generate an engaging 2-voice (Host & Tutor) study podcast script using AI. */
export async function generateStudyPodcastScript({ title = '', body = '', subject = 'General', signal = null }) {
  const snippet = String(body || '').slice(0, 6500);
  const raw = await aiText({
    system:
      'You write crisp, natural 2-host audio study podcast scripts for students commuting to school. Output ONLY dialogue lines starting with "Host:" or "Tutor:" — no stage directions, no markdown bullets, no emojis, no sound effects. Aim for 10 to 16 lively back-and-forth lines covering the core concepts, one vivid analogy, and a quick recap.',
    user: `Subject: ${subject}\nNote Title: ${title || 'Class Notes'}\n\nNotes:\n${snippet}`,
    maxTokens: 1600,
    signal,
  });

  const lines = String(raw || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const segments = [];
  for (const line of lines) {
    const m = /^(host|tutor|student|teacher|speaker\s*[12])\s*[:\-]\s*(.+)$/i.exec(line);
    if (m) {
      const spk = /tutor|teacher|2/i.test(m[1]) ? 'Tutor' : 'Host';
      const txt = stripForSpeech(m[2]);
      if (txt) segments.push({ speaker: spk, text: txt });
    }
  }

  if (segments.length >= 2) return segments;
  return buildOfflineNarrationSegments({ title, body });
}

const nativePending = new Map();
let nativeSeq = 0;

function hasNativeAndroidTts() {
  try {
    return typeof window !== 'undefined' && Boolean(window.BaiNativeTts?.speak);
  } catch {
    return false;
  }
}

function ensureNativeCallbackRegistered() {
  if (typeof window === 'undefined') return;
  if (!window.__baiTtsCallback) {
    window.__baiTtsCallback = (utteranceId, eventType) => {
      const handler = nativePending.get(utteranceId);
      if (!handler) return;
      nativePending.delete(utteranceId);
      if (eventType === 'done') {
        handler.onEnd?.();
      } else {
        handler.onError?.(new Error('Android Text-to-Speech could not speak this line. Check Android TTS settings.'));
      }
    };
  }
}

export function isSpeechSupported() {
  if (hasNativeAndroidTts()) return true;
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function stopSpeech() {
  nativePending.clear();
  try {
    if (hasNativeAndroidTts()) {
      window.BaiNativeTts.stop();
    }
  } catch {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // ignore
  }
}

function pickVoiceForSpeaker(speaker) {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const english = voices.filter(v => /^en/i.test(v.lang));
    const pool = english.length > 0 ? english : voices;
    if (pool.length === 0) return null;
    if (speaker === 'Tutor' && pool.length > 1) return pool[1];
    return pool[0];
  } catch {
    return null;
  }
}

/** Speak a single utterance using Native Android TextToSpeech on APK or Web Speech API on desktop/browser. */
export function speakSegment({ text, rate = 1, speaker = 'Narrator', onEnd, onError }) {
  if (!isSpeechSupported()) {
    onError?.(new Error('Text-to-Speech is not available on this device browser.'));
    return null;
  }
  stopSpeech();
  const cleanText = stripForSpeech(text);
  const safeRate = Math.max(0.5, Math.min(2.0, Number(rate) || 1));
  const pitch = speaker === 'Tutor' ? 0.9 : speaker === 'Host' ? 1.08 : 1.0;

  if (hasNativeAndroidTts()) {
    ensureNativeCallbackRegistered();
    const id = `bai-tts-${++nativeSeq}-${Date.now()}`;
    nativePending.set(id, { onEnd, onError });
    try {
      window.BaiNativeTts.speak(cleanText, safeRate, pitch, id);
    } catch (err) {
      nativePending.delete(id);
      onError?.(err);
    }
    return { nativeId: id };
  }

  const utt = new SpeechSynthesisUtterance(cleanText);
  utt.rate = safeRate;
  utt.pitch = pitch;
  const voice = pickVoiceForSpeaker(speaker);
  if (voice) utt.voice = voice;
  utt.onend = () => onEnd?.();
  utt.onerror = e => {
    // 'interrupted' / 'canceled' happens on user Stop/Skip — treat cleanly
    if (e?.error === 'interrupted' || e?.error === 'canceled') return;
    onError?.(new Error(e?.error || 'Speech synthesis error'));
  };
  window.speechSynthesis.speak(utt);
  return utt;
}
