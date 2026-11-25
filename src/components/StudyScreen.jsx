/**
 * StudyScreen — persisted study & critical thinking workspace for a note:
 * - Cards: Interactive Flip Deck + Spaced Repetition mastery tracking
 * - Quiz: Live score summary, retake, and rationale
 * - Blanks: Type-to-check fill-in-the-blank recall
 * - Think: Challenge My Notes (Critical & Logical Audit), Feynman Technique Coach,
 *          Mnemonics, Answer Grader, and interactive Weakness Detection
 */
import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import {
  ChevronLeft,
  Sparkles,
  Brain,
  Check,
  X,
  Eye,
  EyeOff,
  RotateCw,
  FileCheck,
  Target,
  ShieldAlert,
  Lightbulb,
  MessageCircleQuestion,
  FileSpreadsheet,
} from 'lucide-react';
import {
  generateCloze,
  generateMnemonics,
  analyzeWeakness,
  gradeAnswer,
  critiqueNote,
  evaluateFeynman,
} from '../lib/aiFeatures';
import { db, updateNote } from '../store/db';
import { FlashcardDeck, QuizSection } from './study/StudyWidgets';
import FeynmanCoachTab from './study/FeynmanCoachTab';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

const LazySwipeCram = lazy(() =>
  import('./study/CramGamesTab').then(m => ({ default: m.SwipeCramGame }))
);
const LazyTermMatch = lazy(() =>
  import('./study/CramGamesTab').then(m => ({ default: m.TermMatchSpeedGame }))
);

function normalizeAnswer(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ClozeItem({ item, index }) {
  const [guess, setGuess] = useState('');
  const [checked, setChecked] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const checkGuess = () => {
    if (!guess.trim()) return;
    const ok = normalizeAnswer(guess) === normalizeAnswer(item.answer);
    setChecked(ok ? 'correct' : 'wrong');
    if (ok) setRevealed(true);
  };

  const parts = String(item.text || '').split('____');

  return (
    <div className="explanation-card">
      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.55, marginBottom: 12 }}>
        {index + 1}.{' '}
        {parts.map((part, k) => (
          <span key={k}>
            {part}
            {k < parts.length - 1 && (
              <span
                style={{
                  background: revealed ? 'var(--ok-bg)' : 'var(--accent-tint)',
                  color: revealed ? 'var(--ok)' : 'var(--accent-ink)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontWeight: 700,
                }}
              >
                {revealed ? item.answer : '____'}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-8 items-center">
        <input
          className="ai-input"
          style={{ marginTop: 0, flex: 1 }}
          placeholder="Type missing word(s)…"
          value={guess}
          onChange={e => {
            setGuess(e.target.value);
            if (checked) setChecked(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') checkGuess();
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!guess.trim()}
          onClick={checkGuess}
        >
          Check
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setRevealed(r => !r)}
          title={revealed ? 'Hide answer' : 'Reveal answer'}
        >
          <Eye size={15} />
        </button>
      </div>

      {checked && (
        <div
          className="flex items-center gap-6"
          style={{
            marginTop: 8,
            fontSize: 13,
            fontWeight: 600,
            color: checked === 'correct' ? 'var(--ok)' : 'var(--bad)',
          }}
        >
          {checked === 'correct' ? (
            <>
              <Check size={15} /> Spot on!
            </>
          ) : (
            <>
              <X size={15} /> Not quite — tap the eye icon or try again.
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ item, index }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="critique-gap-card">
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, marginBottom: 8 }}>
        {index + 1}. {item.question}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm w-full"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <EyeOff size={14} /> : <Eye size={14} />}
        {open ? 'Hide model reasoning' : 'Reveal reasoning'}
      </button>
      {open && item.reasoning && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <MarkdownContent text={item.reasoning} />
        </div>
      )}
    </div>
  );
}

function CriticalAuditSection({ critique, busy, onRun }) {
  if (!critique && !busy) {
    return (
      <div className="explanation-card">
        <div className="flex items-center gap-6" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
          <ShieldAlert size={17} style={{ color: 'var(--accent-ink)' }} /> Challenge My Notes
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Audits your note (and related folder notes) for logical gaps, unstated assumptions, contradictions, and tough exam-style "What-if" challenges.
        </div>
        <button type="button" className="btn btn-primary w-full" onClick={onRun}>
          <ShieldAlert size={16} /> Audit logic & assumptions
        </button>
      </div>
    );
  }

  return (
    <div className="explanation-card">
      <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
        <span className="flex items-center gap-6" style={{ fontSize: 15, fontWeight: 700 }}>
          <ShieldAlert size={17} style={{ color: 'var(--accent-ink)' }} /> Critical Audit
        </span>
        {!busy && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRun}>
            <RotateCw size={13} /> Re-audit
          </button>
        )}
      </div>

      {busy ? (
        <div className="scan-indicator" style={{ padding: '6px 0' }}>
          <span className="spinner" /> Checking logic, assumptions & edge cases…
        </div>
      ) : (
        <>
          {critique.strengths?.length > 0 && (
            <div className="grade-box good" style={{ marginTop: 0, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                Solid reasoning
              </div>
              {critique.strengths.map((s, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>• {s}</div>
              ))}
            </div>
          )}

          {critique.contradictions?.length > 0 && (
            <div className="grade-box bad" style={{ marginTop: 0, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                Possible contradictions
              </div>
              {critique.contradictions.map((c, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>• {c}</div>
              ))}
            </div>
          )}

          {critique.gaps?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="settings-label" style={{ marginBottom: 6 }}>
                Logical gaps & hidden assumptions
              </div>
              {critique.gaps.map((g, i) => (
                <div key={i} className="critique-gap-card">
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{g.issue}</div>
                  {g.whyItMatters && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
                      <strong>Why it matters:</strong> {g.whyItMatters}
                    </div>
                  )}
                  {g.suggestion && (
                    <div style={{ fontSize: 13, color: 'var(--accent-ink)', marginTop: 3 }}>
                      <strong>Sharpen it:</strong> {g.suggestion}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {critique.challenges?.length > 0 && (
            <div>
              <div className="settings-label" style={{ marginBottom: 6 }}>
                Critical thinking challenges
              </div>
              {critique.challenges.map((c, i) => (
                <ChallengeCard key={i} item={c} index={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FeynmanCoach({ note }) {
  const { toast } = useDialog();
  const [concept, setConcept] = useState(note?.title || '');
  const [explanation, setExplanation] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleEvaluate = async () => {
    if (!concept.trim() || !explanation.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await evaluateFeynman({
        note: note.body,
        concept,
        explanation,
        subject: note.subject,
      });
      setResult(res);
    } catch (err) {
      toast(`Feynman check failed: ${err.message}`, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const tone = !result ? '' : result.score >= 75 ? 'good' : result.score >= 45 ? 'warn' : 'bad';

  return (
    <div className="explanation-card">
      <div className="flex items-center gap-6" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        <Lightbulb size={17} style={{ color: 'var(--accent-ink)' }} /> Feynman Technique Coach
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Explain a concept in plain words as if teaching a beginner. The AI catches hand-waving and logical leaps.
      </div>
      <input
        className="ai-input"
        value={concept}
        onChange={e => setConcept(e.target.value)}
        placeholder="Concept to explain (e.g. Osmosis, Derivatives)…"
        style={{ marginBottom: 8 }}
      />
      <textarea
        className="ai-input"
        value={explanation}
        onChange={e => setExplanation(e.target.value)}
        placeholder="Explain how & why it works in your own simple words…"
        style={{ minHeight: 88, marginBottom: 10 }}
      />
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={busy || !concept.trim() || !explanation.trim()}
        onClick={handleEvaluate}
      >
        {busy ? (
          <>
            <span className="spinner" style={{ width: 15, height: 15 }} /> Auditing clarity…
          </>
        ) : (
          <>
            <Lightbulb size={16} /> Check my explanation
          </>
        )}
      </button>

      {result && (
        <div className={`grade-box ${tone}`}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Clarity: {result.score}/100 — {result.verdict}
          </div>
          {result.strengths && (
            <div style={{ fontSize: 13, marginBottom: 6 }}>{result.strengths}</div>
          )}
          {result.gaps?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
                Gaps / hand-waving to tighten:
              </div>
              {result.gaps.map((g, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>• {g}</div>
              ))}
            </div>
          )}
          {result.followUpQuestion && (
            <div className="feynman-followup">
              <div className="flex items-center gap-6" style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
                <MessageCircleQuestion size={14} /> Follow-up probe
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>{result.followUpQuestion}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MnemonicsSection({ mnemonics, busy, onGenerate }) {
  if (!mnemonics && !busy) {
    return (
      <div className="explanation-card">
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Memory Hooks & Mnemonics</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Turn key terms and lists in this note into memorable acronyms and hooks.
        </div>
        <button type="button" className="btn btn-secondary w-full" onClick={onGenerate}>
          <Brain size={17} /> Generate mnemonics
        </button>
      </div>
    );
  }

  return (
    <div className="explanation-card">
      <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Mnemonics</span>
        {!busy && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate}>
            <RotateCw size={13} /> Regenerate
          </button>
        )}
      </div>
      {busy ? (
        <div className="scan-indicator" style={{ padding: '6px 0' }}>
          <span className="spinner" /> Creating memory hooks…
        </div>
      ) : (
        (mnemonics || []).map((m, i) => (
          <div
            key={i}
            style={{
              padding: '8px 0',
              borderBottom: i < mnemonics.length - 1 ? '0.5px solid var(--divider)' : 'none',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{m.term}</div>
            <div style={{ fontSize: 14, color: 'var(--accent-ink)', lineHeight: 1.45 }}>
              {m.hook}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PracticeGrader({ note }) {
  const { toast } = useDialog();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleGrade = async () => {
    if (!question.trim() || !answer.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await gradeAnswer({
        note: note.body,
        question,
        userAnswer: answer,
        style: 'exam-prep',
      });
      setResult(res);
    } catch (err) {
      toast(`Grading failed: ${err.message}`, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const gradeTone =
    !result ? '' : result.score >= 75 ? 'good' : result.score >= 45 ? 'warn' : 'bad';

  return (
    <div className="explanation-card">
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Practice Answer Grader</div>
      <textarea
        className="ai-input"
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Paste an exam question or write one yourself…"
        style={{ minHeight: 62, marginBottom: 10 }}
      />
      <textarea
        className="ai-input"
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder="Write your answer from memory…"
        style={{ minHeight: 84, marginBottom: 12 }}
      />
      <button
        type="button"
        className="btn btn-secondary w-full"
        onClick={handleGrade}
        disabled={busy || !question.trim() || !answer.trim()}
      >
        {busy ? (
          <>
            <span className="spinner" style={{ width: 15, height: 15 }} /> Grading…
          </>
        ) : (
          <>
            <FileCheck size={17} /> Grade my answer
          </>
        )}
      </button>

      {result && (
        <div className={`grade-box ${gradeTone}`}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Score: {result.score}/100 — {result.verdict}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{result.feedback}</div>
        </div>
      )}
    </div>
  );
}

export default function StudyScreen({ note, onBack, onOpenExamPaper = null }) {
  const { toast } = useDialog();
  const [tab, setTab] = useState('cards'); // cards | quiz | blanks | teach | think
  const [cardGameMode, setCardGameMode] = useState('deck'); // deck | swipe | match
  const flashcards = note?.flashcards || [];
  const quiz = note?.quiz || [];

  const initialStudy = note?.studyData || {};
  const [studyData, setStudyData] = useState(initialStudy);
  const studyRef = useRef(studyData);
  useEffect(() => {
    studyRef.current = studyData;
  }, [studyData]);

  const persistStudy = useCallback(
    patch => {
      const next = { ...studyRef.current, ...patch };
      studyRef.current = next;
      setStudyData(next);
      if (note?.id) {
        updateNote(note.id, { studyData: next }).catch(() => {});
      }
    },
    [note?.id]
  );

  const [clozeBusy, setClozeBusy] = useState(false);
  const [mnBusy, setMnBusy] = useState(false);
  const [weakBusy, setWeakBusy] = useState(false);
  const [critiqueBusy, setCritiqueBusy] = useState(false);

  const cloze = studyData.cloze || [];
  const mnemonics = studyData.mnemonics || null;
  const weakness = studyData.weakness || null;
  const critique = studyData.critique || null;
  const cardProgress = studyData.cardProgress || {};
  const quizAnswers = studyData.quizAnswers || {};
  const answeredCount = Object.keys(quizAnswers).length;

  const handleCloze = useCallback(async () => {
    if (!note?.body?.trim()) return toast('Add some text to this note first');
    setClozeBusy(true);
    try {
      const items = await generateCloze({ note: note.body, subject: note.subject });
      persistStudy({ cloze: items });
    } catch (e) {
      toast(`Failed to generate blanks: ${e.message}`, { type: 'error' });
    } finally {
      setClozeBusy(false);
    }
  }, [note, persistStudy, toast]);

  const handleMnemonics = useCallback(async () => {
    if (!note?.body?.trim()) return toast('Add some text to this note first');
    setMnBusy(true);
    try {
      const items = await generateMnemonics({ note: note.body, subject: note.subject });
      persistStudy({ mnemonics: items });
    } catch (e) {
      toast(`Failed to generate mnemonics: ${e.message}`, { type: 'error' });
    } finally {
      setMnBusy(false);
    }
  }, [note, persistStudy, toast]);

  const handleCritique = useCallback(async () => {
    if (!note?.body?.trim()) return toast('Add some text to this note first');
    setCritiqueBusy(true);
    try {
      let siblingNotes = [];
      if (typeof note.folderId === 'number') {
        const list = await db.notes.where('folderId').equals(note.folderId).toArray();
        siblingNotes = list.filter(n => n.id !== note.id && !n.trashed);
      }
      const res = await critiqueNote({
        note: note.body,
        title: note.title,
        subject: note.subject,
        siblingNotes,
      });
      persistStudy({ critique: res });
    } catch (e) {
      toast(`Critical audit failed: ${e.message}`, { type: 'error' });
    } finally {
      setCritiqueBusy(false);
    }
  }, [note, persistStudy, toast]);

  const handleAnalyzeWeakness = useCallback(async () => {
    if (!quiz.length) return;
    setWeakBusy(true);
    try {
      const w = await analyzeWeakness({
        note: note.body,
        quiz,
        answers: quizAnswers,
        style: 'exam-prep',
      });
      persistStudy({ weakness: w });
    } catch (e) {
      toast(`Weakness analysis failed: ${e.message}`, { type: 'error' });
    } finally {
      setWeakBusy(false);
    }
  }, [note, quiz, quizAnswers, persistStudy, toast]);

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to note"
        >
          <ChevronLeft size={20} /> Note
        </button>
        <span className="navbar-title">Study</span>
        {onOpenExamPaper ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenExamPaper({ sourceNote: note })}
            title="Convert this note into an answerable & printable bond-paper exam"
          >
            <FileSpreadsheet size={14} /> Exam Paper
          </button>
        ) : (
          <span style={{ width: 64 }} />
        )}
      </header>

      <div className="large-title">{note?.title || 'Study Mode'}</div>

      <div className="view-switcher">
        {[
          ['cards', `Cards (${flashcards.length})`],
          ['quiz', `Quiz (${quiz.length})`],
          ['blanks', `Blanks${cloze.length ? ` (${cloze.length})` : ''}`],
          ['teach', 'Teach AI'],
          ['think', 'Think'],
        ].map(([t, label]) => (
          <button
            key={t}
            type="button"
            className={`view-switch-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="editor">
        {tab === 'cards' && (
          <div>
            {flashcards.length >= 2 && (
              <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 12px' }}>
                {[
                  ['deck', 'Flip Deck'],
                  ['swipe', 'Swipe Cram'],
                  ['match', '60s Match'],
                ].map(([gid, glabel]) => (
                  <button
                    key={gid}
                    type="button"
                    className={`view-switch-btn${cardGameMode === gid ? ' active' : ''}`}
                    onClick={() => setCardGameMode(gid)}
                  >
                    {glabel}
                  </button>
                ))}
              </div>
            )}

            {cardGameMode === 'swipe' && flashcards.length >= 2 ? (
              <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading cram deck…</div>}>
                <LazySwipeCram
                  cards={flashcards}
                  onMarkCard={(idx, status) =>
                    persistStudy({ cardProgress: { ...cardProgress, [idx]: status } })
                  }
                />
              </Suspense>
            ) : cardGameMode === 'match' && flashcards.length >= 2 ? (
              <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading match game…</div>}>
                <LazyTermMatch cards={flashcards} />
              </Suspense>
            ) : (
              <FlashcardDeck
                cards={flashcards}
                progress={cardProgress}
                onMarkCard={(idx, status) =>
                  persistStudy({ cardProgress: { ...cardProgress, [idx]: status } })
                }
              />
            )}
          </div>
        )}

        {tab === 'quiz' && (
          <QuizSection
            quiz={quiz}
            answers={quizAnswers}
            onPick={(qi, pick) =>
              persistStudy({ quizAnswers: { ...quizAnswers, [qi]: pick } })
            }
            onReset={() => persistStudy({ quizAnswers: {} })}
          />
        )}

        {tab === 'blanks' && (
          <div>
            {clozeBusy ? (
              <div className="explanation-card">
                <div className="scan-indicator" style={{ padding: '10px 0' }}>
                  <span className="spinner" /> Generating fill-in-the-blank questions…
                </div>
              </div>
            ) : cloze.length === 0 ? (
              <div className="explanation-card">
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  Fill-in-the-Blank Recall
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                  Generate active-recall blanks from this note, type your answers, and check yourself.
                </div>
                <button type="button" className="btn btn-primary w-full" onClick={handleCloze}>
                  <Sparkles size={16} /> Generate fill-in-the-blank
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
                  <span className="settings-label">Fill-in-the-blank ({cloze.length})</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCloze}
                    disabled={clozeBusy}
                  >
                    <RotateCw size={13} /> Regenerate
                  </button>
                </div>
                {cloze.map((c, i) => (
                  <ClozeItem key={`${i}-${c.answer}`} item={c} index={i} />
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'teach' && <FeynmanCoachTab note={note} />}

        {tab === 'think' && (
          <div>
            <CriticalAuditSection
              critique={critique}
              busy={critiqueBusy}
              onRun={handleCritique}
            />

            <FeynmanCoach note={note} />

            <MnemonicsSection mnemonics={mnemonics} busy={mnBusy} onGenerate={handleMnemonics} />

            <PracticeGrader note={note} />

            <div className="explanation-card">
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                Weakness Detection
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Pinpoints topics you missed in the Quiz tab and builds targeted reasoning practice.
              </div>
              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={handleAnalyzeWeakness}
                disabled={weakBusy || answeredCount === 0}
              >
                {weakBusy ? (
                  <>
                    <span className="spinner" style={{ width: 15, height: 15 }} /> Analyzing…
                  </>
                ) : (
                  <>
                    <Target size={16} />{' '}
                    {weakness ? 'Re-analyze weak areas' : 'Analyze my weak areas'}
                  </>
                )}
              </button>
              {answeredCount === 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Answer questions in the Quiz tab first to unlock weakness detection.
                </div>
              )}

              {weakness && (
                <div style={{ marginTop: 14 }}>
                  {weakness.weakAreas?.length > 0 && (
                    <div className="grade-box warn" style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                        Focus areas to review
                      </div>
                      <div style={{ fontSize: 14 }}>{weakness.weakAreas.join(' · ')}</div>
                    </div>
                  )}
                  {weakness.practice?.length > 0 && (
                    <>
                      <div className="settings-label" style={{ marginBottom: 8 }}>
                        Targeted Practice Quiz
                      </div>
                      <QuizSection quiz={weakness.practice} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
