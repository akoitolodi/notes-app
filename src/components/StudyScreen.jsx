/**
 * Study screen — flashcards, quiz, fill-in-the-blank, mnemonics,
 * practice grader, weakness detection — all generated from the note's AI scan.
 */
import { useState, useCallback } from 'react';
import { generateCloze, generateMnemonics, analyzeWeakness, gradeAnswer } from '../lib/aiFeatures';

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

function ClozeItem({ item, index, onToggle }) {
  const [show, setShow] = useState(false);
  return (
    <div className="explanation-card">
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{index + 1}. {item.text.replace('____', <span style={{ background: 'var(--accent)', color: 'var(--accent-text)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>____</span>)}</div>
      <button
        className="btn btn-secondary"
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => setShow(s => !s)}
      >
        {show ? <span style={{ color: 'var(--accent)' }}>✓ {item.answer}</span> : 'Reveal answer'}
      </button>
    </div>
  );
}

function MnemonicsSection({ mnemonics, busy, onGenerate }) {
  if (!mnemonics && !busy) return (
    <div className="explanation-card">
      <button className="btn btn-primary" onClick={onGenerate} style={{ width: '100%' }}>
        🧠 Generate mnemonics
      </button>
    </div>
  );
  return (
    <div>
      <div className="explanation-card" style={{ marginBottom: 12 }}>
        {mnemonics.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{m.term}</div>
            <div style={{ fontSize: 13, color: 'var(--accent)', fontStyle: 'italic' }}>{m.hook}</div>
          </div>
        ))}
        {busy && <div style={{ textAlign: 'center', padding: 12, color: 'var(--accent)' }}>Generating…</div>}
        {!busy && <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={onGenerate}>Regenerate</button>}
      </div>
    </div>
  );
}

function PracticeGrader({ note, onGrade }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleGrade = async () => {
    if (!question.trim() || !answer.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await import('../lib/aiFeatures').then(m => m.gradeAnswer({ note: note.body, question, answer, style: 'exam-prep' }));
      setResult(res);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="explanation-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Practice answer</div>
        <textarea
          className="ai-input"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Paste an exam question or write one yourself…"
          style={{ minHeight: 60, marginBottom: 10 }}
        />
        <textarea
          className="ai-input"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Your answer…"
          style={{ minHeight: 80, marginBottom: 12 }}
        />
        <button className="btn btn-primary" onClick={handleGrade} disabled={busy || !question.trim() || !answer.trim()} style={{ width: '100%' }}>
          {busy ? 'Grading…' : '📝 Grade my answer'}
        </button>
        {false && (
          <div className="explanation-mistake" style={{ marginTop: 12 }}>
            <svg className="mistake-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <div className="mistake-reason">Score: {result.score}/100 — {result.verdict}</div>
              <div className="mistake-correction">{result.feedback}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Main Study screen with 4 tabs: Cards / Quiz / Blanks / Practice */
export default function StudyScreen({ note, onBack }) {
  const [tab, setTab] = useState('cards'); // cards | quiz | blanks | practice
  const flashcards = note?.flashcards || [];
  const quiz = note?.quiz || [];

  const [cloze, setCloze] = useState([]);
  const [clozeBusy, setClozeBusy] = useState(false);
  const [mnemonics, setMnemonics] = useState([]);
  const [mnBusy, setMnBusy] = useState(false);
  const [graderResult, setGraderResult] = useState(null);
  const [weakness, setWeakness] = useState(null);
  const [weakBusy, setWeakBusy] = useState(false);

  const handleCloze = useCallback(async () => {
    setClozeBusy(true);
    try { const c = await import('../lib/aiFeatures').then(m => m.generateCloze({ note: note.body })); setCloze(c); }
    catch (e) { alert(e.message); }
    finally { setClozeBusy(false); }
  }, [note]);

  const handleMnemonics = useCallback(async () => {
    setMnBusy(true);
    try { const m = await import('../lib/aiFeatures').then(m => m.generateMnemonics({ note: note.body })); setMnemonics(m); }
    catch (e) { alert(e.message); }
    finally { setMnBusy(false); }
  }, [note]);

  const handleAnalyzeWeakness = useCallback(async () => {
    if (!note.quiz || !note.quiz.length) return;
    setWeakBusy(true);
    try {
      const w = await import('../lib/aiFeatures').then(m => m.analyzeWeakness({ note: note.body, quiz: note.quiz, answers: {}, style: 'exam-prep' }));
      setWeakness(w);
    } catch (e) { alert(e.message); }
    finally { setWeakBusy(false); }
  }, [note]);

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
        {['cards', 'quiz', 'blanks', 'practice'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 8,
              background: tab === t ? 'var(--bg)' : 'transparent',
              color: 'var(--text)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {t === 'cards' ? `Cards (${flashcards.length})` :
             t === 'quiz' ? `Quiz (${quiz.length})` :
             t === 'blanks' ? `Blanks` :
             `Practice`}
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
        {tab === 'blanks' && (
          <div className="editor" style={{ paddingTop: 12 }}>
            {cloze.length === 0 && !clozeBusy ? (
              <button className="btn btn-primary" onClick={handleCloze} disabled={clozeBusy} style={{ width: '100%', marginBottom: 16 }}>
                {clozeBusy ? 'Generating…' : '📝 Generate fill-in-the-blank'}
              </button>
            ) : (
              <div className="explanation-card" style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Fill-in-the-blank ({cloze.length})</div>
                {cloze.map((c, i) => <ClozeItem key={i} item={c} index={i} onToggle={() => {}} />)}
                <button className="btn btn-secondary" onClick={handleCloze} disabled={clozeBusy} style={{ width: '100%', marginTop: 12 }}>Regenerate</button>
              </div>
            )}
          </div>
        )}
        {tab === 'practice' && (
          <div className="editor" style={{ paddingTop: 12 }}>
            <MnemonicsSection mnemonics={mnemonics} busy={mnBusy} onGenerate={handleMnemonics} />
            <PracticeGrader note={note} busy={false} onGrade={null} />
            {weakness && (
              <div className="explanation-mistake" style={{ marginTop: 16 }}>
                <svg className="mistake-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <div className="mistake-reason" style={{ fontWeight: 600, marginBottom: 6 }}>Weak areas: {weakness.weakAreas.join(', ')}</div>
                  <div style={{ marginTop: 12 }}>
                    {weakness.practice.map((p, i) => (
                      <div key={i} className="explanation-card" style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{i + 1}. {p.question}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {p.choices.map((c, j) => (
                            <button key={j} className="btn btn-secondary" style={{ textAlign: 'left' }} disabled>
                              {String.fromCharCode(65 + j)}. {c}
                            </button>
                          ))}
                        <div className="mistake-correction" style={{ marginTop: 8 }}>Answer: {String.fromCharCode(65 + p.answer)}</div>
                      </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={handleAnalyzeWeakness} disabled={weakBusy} style={{ width: '100%' }}>
                {weakBusy ? 'Analyzing…' : '🔍 Analyze my weak areas'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}