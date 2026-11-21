/**
 * Study screen — flashcards (tap to flip) and multiple-choice quiz,
 * generated from the note's AI scan.
 */
import { useState } from 'react';

function Flashcard({ card }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className="explanation-card"
      style={{ cursor: 'pointer', minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
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
            if (i === item.answer) { bg = 'rgba(52,199,89,0.2)'; color = '#34c759'; }
            else if (i === picked) { bg = 'rgba(255,69,58,0.2)'; color = '#ff453a'; }
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
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: correct ? '#34c759' : '#ff453a' }}>
          {correct ? '✓ Correct' : '✗ Not quite'}
        </div>
      )}
    </div>
  );
}

export default function StudyScreen({ note, onBack }) {
  const [tab, setTab] = useState('cards'); // cards | quiz
  const flashcards = note?.flashcards || [];
  const quiz = note?.quiz || [];

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back">
          ‹ Back
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>Study</span>
        <span style={{ width: 44 }} />
      </header>
      <div className="large-title">{note?.title || 'New Note'}</div>

      {/* Tabs */}
      <div style={{ display: 'flex', margin: '0 16px', background: 'var(--bg-elevated)', borderRadius: 10, padding: 3 }}>
        {['cards', 'quiz'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 8,
              background: tab === t ? 'var(--bg)' : 'transparent',
              color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {t === 'cards' ? `Flashcards (${flashcards.length})` : `Quiz (${quiz.length})`}
          </button>
        ))}
      </div>

      <div className="editor" style={{ paddingTop: 12 }}>
        {tab === 'cards' && (
          flashcards.length === 0
            ? <div className="empty-state"><div className="empty-icon">🃏</div><div className="empty-title">No flashcards yet</div><div className="empty-text">Save your note to generate flashcards.</div></div>
            : flashcards.map((c, i) => <Flashcard key={i} card={c} />)
        )}
        {tab === 'quiz' && (
          quiz.length === 0
            ? <div className="empty-state"><div className="empty-icon">❓</div><div className="empty-title">No quiz yet</div><div className="empty-text">Save your note to generate a quiz.</div></div>
            : quiz.map((q, i) => <QuizItem key={i} item={q} index={i} />)
        )}
      </div>
    </div>
  );
}