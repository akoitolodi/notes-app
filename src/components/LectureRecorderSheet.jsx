/**
 * LectureRecorderSheet — Lazy-loaded Taglish Lecture Recorder -> Auto-Notes.
 * Supports Groq free Whisper (`whisper-large-v3-turbo`) audio transcription OR
 * 100% offline Live Dictation fallback, saving structured notes + flashcards directly.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, Sparkles, X, FilePlus2 } from 'lucide-react';
import {
  hasGroqTranscriptionKey,
  isMediaRecorderSupported,
  startLectureAudioRecording,
  transcribeLectureWithGroq,
  formatLectureTranscriptToNotes,
} from '../lib/lectureRecorder';
import { createDictationSession } from '../lib/voiceDictation';
import { db, createNote, logStudyActivity } from '../store/db';
import { useDialog } from './ui/DialogProvider';

export default function LectureRecorderSheet({ onSaved, onClose }) {
  const { toast } = useDialog();
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState('');
  const [mode, setMode] = useState(() =>
    hasGroqTranscriptionKey() && isMediaRecorderSupported() ? 'groq' : 'live'
  );
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [dictLang, setDictLang] = useState('');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const recorderRef = useRef(null);
  const dictRef = useRef(null);
  const elapsedRef = useRef(0);
  const chunkBusyRef = useRef(false);

  useEffect(() => {
    db.folders
      .toArray()
      .then(all => {
        const safe = all.filter(f => !f.locked && !f.isSystemVault && !f.isDecoyVault);
        setFolders(safe);
        const def = safe.find(f => f.name === 'General') || safe[0];
        if (def) setFolderId(String(def.id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel?.();
      dictRef.current?.stop?.();
    };
  }, []);

  // Rolling 25s auto-chunk upload during Groq Whisper lecture recording
  useEffect(() => {
    if (!recording) return undefined;
    elapsedRef.current = 0;
    const id = setInterval(() => {
      elapsedRef.current += 1;
      const next = elapsedRef.current;
      setElapsedSec(next);
      if (mode === 'groq' && next % 25 === 0 && recorderRef.current?.flushChunk && !chunkBusyRef.current) {
        chunkBusyRef.current = true;
        setStatusMsg('Transcribing chunk…');
        Promise.resolve(recorderRef.current.flushChunk())
          .then(blob => {
            if (!blob || blob.size <= 1200) return '';
            return transcribeLectureWithGroq(blob);
          })
          .then(txt => {
            if (txt) setTranscript(prev => (prev ? `${prev} ${txt}` : txt));
          })
          .catch(() => {})
          .finally(() => {
            chunkBusyRef.current = false;
            setStatusMsg('');
          });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [recording, mode]);

  const startRecording = async () => {
    if (recording || busy) return;
    setStatusMsg('');
    if (mode === 'groq') {
      try {
        const sess = await startLectureAudioRecording();
        recorderRef.current = sess;
        setElapsedSec(0);
        setRecording(true);
      } catch (err) {
        toast(err?.message || 'Could not access microphone', { type: 'error' });
      }
    } else {
      if (!dictRef.current) {
        dictRef.current = createDictationSession({
          lang: dictLang,
          onFinal: txt => {
            setInterim('');
            if (txt) setTranscript(prev => (prev ? `${prev} ${txt}` : txt));
          },
          onInterim: txt => {
            setInterim(txt || '');
          },
          onError: msg => toast(msg, { type: 'error' }),
          onStateChange: st => setRecording(st === 'listening'),
        });
      }
      dictRef.current.setLang?.(dictLang);
      setElapsedSec(0);
      await dictRef.current.start();
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    if (mode === 'groq' && recorderRef.current) {
      setRecording(false);
      setBusy(true);
      setStatusMsg('Transcribing Taglish audio…');
      try {
        const blob = await recorderRef.current.stop();
        recorderRef.current = null;
        if (blob && blob.size > 800) {
          const txt = await transcribeLectureWithGroq(blob);
          if (txt) {
            setTranscript(prev => (prev ? `${prev}\n${txt}` : txt));
            toast('Lecture transcribed!', { type: 'success' });
          } else {
            toast('No speech detected.');
          }
        }
      } catch (err) {
        toast(err?.message || 'Transcription failed', { type: 'error' });
      } finally {
        setBusy(false);
        setStatusMsg('');
      }
    } else {
      dictRef.current?.stop?.();
      setRecording(false);
      setInterim('');
    }
  };

  const handleSaveAsNote = async () => {
    const clean = transcript.trim();
    if (!clean || busy) return;
    setBusy(true);
    setStatusMsg('Formatting structured lecture notes…');
    try {
      const targetFolder = folders.find(f => String(f.id) === String(folderId)) || folders[0] || null;
      const { title, body } = await formatLectureTranscriptToNotes({
        transcript: clean,
        subject: targetFolder?.name || 'Lecture',
      });
      const created = await createNote(
        targetFolder?.id ?? null,
        title,
        body,
        targetFolder?.name || 'General'
      );
      await logStudyActivity('notes', 1);
      toast(`Saved lecture note in ${targetFolder?.name || 'Notes'}!`, { type: 'success' });
      onSaved?.(created, targetFolder);
    } catch (err) {
      toast(err?.message || 'Failed to save lecture note', { type: 'error' });
      setBusy(false);
      setStatusMsg('');
    }
  };

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Taglish Lecture Recorder"
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
          <div className="flex items-center gap-8" style={{ fontWeight: 800, fontSize: 15 }}>
            <Mic size={17} style={{ color: 'var(--accent)' }} />
            <span>Lecture Recorder → Auto-Notes</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 10px' }}>
          <button
            type="button"
            className={`view-switch-btn${mode === 'groq' ? ' active' : ''}`}
            disabled={recording}
            onClick={() => setMode('groq')}
          >
            Groq Taglish Whisper
          </button>
          <button
            type="button"
            className={`view-switch-btn${mode === 'live' ? ' active' : ''}`}
            disabled={recording}
            onClick={() => setMode('live')}
          >
            Offline Live Dictation
          </button>
        </div>

        <div className="settings-help" style={{ marginTop: 0 }}>
          {mode === 'groq'
            ? hasGroqTranscriptionKey()
              ? 'Records class audio in 25s chunks for Groq Whisper transcription.'
              : 'Add a Groq key in Settings for Whisper, or switch to Live Dictation.'
            : 'On-device speech recognition for continuous live note-taking.'}
        </div>

        {mode === 'live' && (
          <div className="flex gap-6 mt-8">
            {[
              ['', 'Auto'],
              ['en-US', 'English'],
              ['fil-PH', 'Filipino'],
            ].map(([code, lbl]) => (
              <button
                key={lbl}
                type="button"
                className={`row-action-chip${dictLang === code ? ' active-chip' : ''}`}
                disabled={recording}
                onClick={() => {
                  setDictLang(code);
                  dictRef.current?.setLang?.(code);
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-8 mt-10">
          <select
            className="input-field"
            style={{ flex: 1, fontSize: 12.5 }}
            value={folderId}
            onChange={e => setFolderId(e.target.value)}
            aria-label="Save into folder"
          >
            {folders.map(f => (
              <option key={f.id} value={f.id}>
                Save to: {f.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-sm ${recording ? 'btn-secondary' : 'btn-primary'}`}
            style={recording ? { color: '#ff375f' } : undefined}
            disabled={busy}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? (
              <>
                <Square size={14} /> Stop ({mm}:{ss})
              </>
            ) : (
              <>
                <Mic size={14} /> Record
              </>
            )}
          </button>
        </div>

        {statusMsg && (
          <div className="scan-indicator" style={{ marginTop: 8 }}>
            <span className="spinner" /> {statusMsg}
          </div>
        )}

        <textarea
          className="ai-input"
          style={{ marginTop: 10, minHeight: 120, fontSize: 13 }}
          placeholder="Transcript appears here (or paste lecture audio notes directly)…"
          value={interim ? `${transcript}${transcript ? ' ' : ''}${interim}` : transcript}
          onChange={e => setTranscript(e.target.value)}
        />

        <div className="flex gap-8 mt-10">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={!transcript.trim() || busy || recording}
            onClick={handleSaveAsNote}
          >
            {busy ? <Sparkles size={14} /> : <FilePlus2 size={14} />}
            Save Auto-Notes
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
