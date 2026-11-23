/**
 * Exam summary screen — one-page summary, combined flashcards, and practice
 * quiz generated from all notes in a folder.
 */
import { useState, useEffect, useCallback } from 'react';
import { getNotesInFolder, db } from '../store/db';
import { examSummary } from '../api/examSummary';

export default function ExamSummaryScreen({ folder, onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [tab, setTab] = useState('summary'); // summary | cards | quiz

  const generate = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setFromCache(false);
    try {
      // Serve the cached pack instantly unless the user explicitly regenerates
      if (!force) {
        const cached = await db.examCache.get(folder.id);
        if (cached?.result) {
          setResult(cached.result);
          setFromCache(true);
          setLoading(false);
          return;
        }
      }
      const notes = await getNotesInFolder(folder.id);
      const usable = notes.filter(n => (n.body || '').trim().length > 0);
      if (usable.length === 0) {
        throw new Error('This folder has no notes with content yet.');
      }
      // Keep the prompt small: cap each note's body
      const capped = usable.map(n => ({
        title: n.title || 'Untitled',
        body: (n.body || '').slice(0, 2500),
      }));
      const data = await examSummary(folder.name, capped);
      setResult(data);
      await db.examCache.put({ folderId: folder.id, result: data, at: Date.now() });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => { generate(); }, [generate]);

  const flashcards = result?.flashcards || [];
  const quiz = result?.quiz || [];

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back">
          ‹ Back
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>Exam Summary</span>
        <button className="navbar-btn" style={{ width: 'auto' }} onClick={() => generate(true)} disabled={loading} aria-label="Regenerate">
          ↻
        </button>
      </header>
      <div className="large-title">{folder.name}</div>

      {fromCache && !loading && (
        <div className="scan-indicator" style={{ paddingTop: 0 }}>
          Saved study pack — tap ↻ to rebuild with the latest notes.
        </div>
      )}

      {loading && (
        <div className="scan-indicator">
          <span className="spinner" /> Building your study pack…
        </div>
      )}
      {error && (
        <div className="scan-indicator" style={{ color: 'var(--mistake)' }}>{error}</div>
      )}

      {result && (
        <>
          <div className="view-switcher" style={{ marginTop: 4 }}>
            {[['summary', 'Summary'], ['cards', `Cards (${flashcards.length})`], ['quiz', `Quiz (${quiz.length})`]].map(([t, label]) => (
              <button
                key={t}
                className={`view-switch-btn${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="editor" style={{ paddingTop: 12 }}>
            {tab === 'summary' && (
              <div className="explanation-card" style={{ fontSize: 15, lineHeight: 1.6 }}>
                {result.summary || 'No summary generated.'}
              </div>
            )}

            {tab === 'cards' && (
              flashcards.length === 0
                ? <div className="empty-state"><div className="empty-icon">🃏</div><div className="empty-title">No flashcards</div></div>
                : flashcards.map((c, i) => <Flashcard key={i} card={c} />)
            )}

            {tab === 'quiz' && (
              quiz.length === 0
                ? <div className="empty-state"><div className="empty-icon">❓</div><div className="empty-title">No quiz questions</div></div>
                : quiz.map((q, i) => <QuizItem key={i} item={q} index={i} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Flashcard({ card }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className="explanation-card"
      style={{ cursor: 'pointer', minHeight: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      onClick={() => setFlipped(f => !f)}
    >
      {flipped ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Answer</div>
          <div style={{ fontSize: 16, lineHeight: 1.5 }}>{card.a || '—'}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Question</div>
          <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.5 }}>{card.q}</div>
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 10 }}>Tap to flip</div>
        </>
      )}
    </div>
  );
}

function QuizItem({ item, index }) {
  const [picked, setPicked] = useState(null);
  const correct = picked != null && picked === item.answer;

  return (
    <div className="explanation-card">
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{index + 1}. {item.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {item.choices.map((choice, i) => {
          let bg = 'var(--bg-elevated)';
          let color = 'var(--text)';
          if (picked != null) {
            if (i === item.answer) { bg = 'rgba(52,199,89,0.2)'; color = 'var(--ok)'; }
            else if (i === picked) { bg = 'rgba(255,69,58,0.2)'; color = 'var(--bad)'; }
          }
          return (
            <button
              key={i}
              onClick={() => picked == null && setPicked(i)}
              style={{
                textAlign: 'left', padding: '10px 14px', borderRadius: 10,
                border: '1px solid var(--divider)', background: bg, color,
                fontSize: 14, fontFamily: 'inherit', cursor: picked == null ? 'pointer' : 'default',
              }}
            >
              {String.fromCharCode(65 + i)}. {choice}
            </button>
          );
        })}
      </div>
      {picked != null && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: correct ? 'var(--ok)' : 'var(--bad)' }}>
          {correct ? '✓ Correct' : '✗ Not quite'}
        </div>
      )}
    </div>
  );
}