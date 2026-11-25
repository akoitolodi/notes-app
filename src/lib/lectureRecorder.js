/**
 * lectureRecorder — Record classroom lectures cleanly with MediaRecorder and
 * transcribe Taglish (Filipino + English) audio via Groq's free Whisper endpoint
 * (`whisper-large-v3-turbo`), then structure into crisp study notes & flashcards.
 */
import { getKeyForProvider } from './aiConfig';
import { aiText } from './aiCore';

export function hasGroqTranscriptionKey() {
  return Boolean(getKeyForProvider('groq')?.trim());
}

export function isMediaRecorderSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/** Start capturing microphone audio into a Promise-based stoppable session. */
export async function startLectureAudioRecording() {
  if (!isMediaRecorderSupported()) {
    throw new Error('Audio recording is not supported in this WebView — use Live Dictation mode.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find(m => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m));
  const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = ev => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  recorder.start(500);
  return {
    mimeType: recorder.mimeType || preferredMime || 'audio/webm',
    stop: () =>
      new Promise((resolve, reject) => {
        try {
          recorder.onstop = () => {
            try {
              stream.getTracks().forEach(t => t.stop());
            } catch {
              // ignore
            }
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            resolve(blob);
          };
          recorder.onerror = err => reject(err?.error || new Error('Recording failed'));
          if (recorder.state !== 'inactive') recorder.stop();
          else resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        } catch (err) {
          reject(err);
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
    },
  };
}

/** Transcribe recorded Taglish lecture audio via user's free Groq API key. */
export async function transcribeLectureWithGroq(audioBlob) {
  const groqKey = getKeyForProvider('groq')?.trim();
  if (!groqKey) {
    throw new Error('Add a free Groq API key in Settings (or switch to Live Dictation mode offline).');
  }
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('No audio recorded yet.');
  }

  const ext = audioBlob.type?.includes('mp4') ? 'm4a' : audioBlob.type?.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', audioBlob, `lecture.${ext}`);
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append(
    'prompt',
    'College lecture in Taglish (mixed English and Filipino/Tagalog/Bisaya). Preserve technical IT/science terms accurately.'
  );

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}` },
    body: fd,
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`Groq Whisper HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
  }
  const data = await res.json();
  return String(data?.text || '').trim();
}

/** Format raw Taglish lecture transcript into clean study notes + offline flashcards. */
export async function formatLectureTranscriptToNotes({ transcript, subject = 'Lecture' }) {
  const raw = String(transcript || '').trim();
  if (!raw) throw new Error('Transcript is empty.');

  try {
    const prompt = [
      `Organize this classroom lecture transcript (may contain Taglish — translate casual filler cleanly while preserving technical terms and professor emphasis) into concise structured Markdown study notes for ${subject}.`,
      'Include:\n- A short crisp Title line on line 1 (`# Title`)\n- Key Takeaways & Definitions (`## Key Concepts`)\n- Exam / Assignment Warnings if any\n- End with 4–6 `Term: Definition` lines under `## Quick Review Terms`.',
      '',
      raw.slice(0, 8000),
    ].join('\n');
    const reply = await aiText(prompt, { maxTokens: 1200, temperature: 0.25 });
    const clean = String(reply || '').trim();
    if (clean) {
      const firstLine = /^#\s+(.+)$/m.exec(clean);
      const title = firstLine ? firstLine[1].trim() : `${subject} Lecture Notes`;
      const body = `${clean}\n\n---\n### Raw Transcript\n${raw}`;
      return { title, body };
    }
  } catch {
    // Offline or non-AI fallback: save crisp cleaned transcript directly!
  }

  const dateTag = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  return {
    title: `${subject} Lecture — ${dateTag}`,
    body: `# ${subject} Lecture Transcript (${dateTag})\n\n${raw}`,
  };
}
