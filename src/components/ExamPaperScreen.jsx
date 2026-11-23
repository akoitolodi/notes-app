/**
 * ExamPaperScreen — Interactive Answerable & Printable Bond-Paper Exam Builder.
 *
 * Works for either a single Note OR an entire Subject Folder:
 * 1. Mix & match any of the 8 college exam types with custom item counts.
 * 2. Answer directly on the authentic white bond-paper sheet on-screen,
 *    with instant offline auto-grading for objective parts + rubric/AI grading for written parts.
 * 3. Export clean Short Bond Paper (8.5" x 11") PDF (Exam + Separate Answer Key,
 *    Blank Exam Only, or Answered Copy) or Print directly.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  Sparkles,
  FileDown,
  Printer,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  RotateCcw,
  SlidersHorizontal,
  X,
  Wand2,
  Minus,
  Plus,
} from 'lucide-react';
import {
  EXAM_SECTION_TYPES,
  EXAM_PRESETS,
  ROMAN_NUMERALS,
  createDefaultExamConfig,
  computeExamTotals,
  generateExamPaper,
  gradeExamPaperOffline,
  gradeWrittenAnswersWithAI,
} from '../lib/examPaper';
import { db, updateNote } from '../store/db';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

export default function ExamPaperScreen({
  sourceNote = null,
  sourceFolder = null,
  onBack,
}) {
  const { toast } = useDialog();

  const defaultTitle = sourceNote
    ? `${sourceNote.title || 'Note'} — Practice Exam`
    : `${sourceFolder?.name || 'Subject'} Examination`;
  const subjectName = sourceNote?.subject || sourceFolder?.name || 'General';

  const [examTitle, setExamTitle] = useState(defaultTitle);
  const [subtitle, setSubtitle] = useState(subjectName);
  const [config, setConfig] = useState(() => createDefaultExamConfig());
  const [composerOpen, setComposerOpen] = useState(true);

  const [paper, setPaper] = useState(null);
  const [answers, setAnswers] = useState({});
  const [writtenScores, setWrittenScores] = useState({});
  const [checked, setChecked] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [studentInfo, setStudentInfo] = useState({
    name: '',
    section: '',
    date: new Date().toLocaleDateString(),
  });

  const [busy, setBusy] = useState(false);
  const [gradingAi, setGradingAi] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef(null);

  // Restore cached exam paper + typed answers if already generated for this note/folder
  useEffect(() => {
    let live = true;
    const loadSaved = async () => {
      if (sourceNote?.id) {
        const fresh = await db.notes.get(sourceNote.id);
        const saved = fresh?.studyData?.examPaper;
        if (live && saved?.paper?.parts?.length) {
          setPaper(saved.paper);
          setAnswers(saved.answers || {});
          setWrittenScores(saved.writtenScores || {});
          setChecked(Boolean(saved.checked));
          setExamTitle(saved.paper.title || defaultTitle);
          setSubtitle(saved.paper.subtitle || subjectName);
          setComposerOpen(false);
        }
      } else if (sourceFolder?.id) {
        const rec = await db.examCache.get(sourceFolder.id);
        const saved = rec?.examPaper;
        if (live && saved?.paper?.parts?.length) {
          setPaper(saved.paper);
          setAnswers(saved.answers || {});
          setWrittenScores(saved.writtenScores || {});
          setChecked(Boolean(saved.checked));
          setExamTitle(saved.paper.title || defaultTitle);
          setSubtitle(saved.paper.subtitle || subjectName);
          setComposerOpen(false);
        }
      }
    };
    loadSaved().catch(() => {});
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [sourceNote?.id, sourceFolder?.id, defaultTitle, subjectName]);

  const persistExamState = async nextPayload => {
    try {
      if (sourceNote?.id) {
        const fresh = await db.notes.get(sourceNote.id);
        if (!fresh) return;
        const nextStudy = { ...(fresh.studyData || {}), examPaper: nextPayload };
        await db.notes.update(sourceNote.id, { studyData: nextStudy });
      } else if (sourceFolder?.id) {
        const existing = (await db.examCache.get(sourceFolder.id)) || { folderId: sourceFolder.id };
        await db.examCache.put({ ...existing, folderId: sourceFolder.id, examPaper: nextPayload });
      }
    } catch {
      // non-fatal
    }
  };

  const updateAnswer = (key, val) => {
    setAnswers(prev => {
      const next = { ...prev, [key]: val };
      if (paper) persistExamState({ paper, answers: next, writtenScores, checked });
      return next;
    });
  };

  const updateEnumAnswer = (key, idx, val, expectedLen) => {
    setAnswers(prev => {
      const arr = Array.isArray(prev[key])
        ? [...prev[key]]
        : Array.from({ length: expectedLen }, () => '');
      arr[idx] = val;
      const next = { ...prev, [key]: arr };
      if (paper) persistExamState({ paper, answers: next, writtenScores, checked });
      return next;
    });
  };

  const toggleSection = type => {
    setConfig(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [type]: { ...prev.sections[type], enabled: !prev.sections[type].enabled },
      },
    }));
  };

  const stepSectionCount = (type, delta, min, max) => {
    setConfig(prev => {
      const cur = prev.sections[type];
      const nextCount = Math.max(min, Math.min(max, (cur.count || min) + delta));
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [type]: { ...cur, enabled: true, count: nextCount },
        },
      };
    });
  };

  const handleGenerate = async () => {
    if (busy) return;
    const { activeSections } = computeExamTotals(config);
    if (activeSections.length === 0) {
      return toast('Turn on at least one test type first', { type: 'error' });
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    try {
      let notesText = '';
      if (sourceNote) {
        notesText = `# ${sourceNote.title || 'Note'}\n${sourceNote.body || ''}`;
      } else if (sourceFolder?.id) {
        const list = (await db.notes.where('folderId').equals(sourceFolder.id).toArray()).filter(
          n => !n.trashed
        );
        notesText = list
          .map(n => `## ${n.title || 'Note'}\n${(n.body || '').slice(0, 3000)}`)
          .join('\n\n');
      }

      const generated = await generateExamPaper({
        examTitle,
        subtitle,
        subject: subjectName,
        notesText,
        config,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setPaper(generated);
      setAnswers({});
      setWrittenScores({});
      setChecked(false);
      setShowKey(false);
      setComposerOpen(false);
      await persistExamState({ paper: generated, answers: {}, writtenScores: {}, checked: false });
      toast('Exam paper ready! Answer right on screen or export to bond-paper PDF.', {
        type: 'success',
      });
    } catch (err) {
      if (!err?.isCancelled) {
        toast(`Exam generation failed: ${err.message}`, { type: 'error', duration: 4000 });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCheckPaper = () => {
    setChecked(true);
    if (paper) persistExamState({ paper, answers, writtenScores, checked: true });
    toast('Objective items graded! Check your score at the top of the paper.', { type: 'success' });
  };

  const handleAiGradeWritten = async () => {
    if (!paper || gradingAi) return;
    setGradingAi(true);
    try {
      const graded = await gradeWrittenAnswersWithAI({
        paper,
        answers,
        subject: subjectName,
      });
      const merged = { ...writtenScores, ...graded };
      setWrittenScores(merged);
      setChecked(true);
      await persistExamState({ paper, answers, writtenScores: merged, checked: true });
      toast('Written answers graded by AI!', { type: 'success' });
    } catch (err) {
      toast(`AI grading failed: ${err.message}`, { type: 'error' });
    } finally {
      setGradingAi(false);
    }
  };

  const handleSelfScore = (key, earned) => {
    setWrittenScores(prev => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), earned } };
      if (paper) persistExamState({ paper, answers, writtenScores: next, checked });
      return next;
    });
  };

  const handleRetake = () => {
    setAnswers({});
    setWrittenScores({});
    setChecked(false);
    setShowKey(false);
    if (paper) persistExamState({ paper, answers: {}, writtenScores: {}, checked: false });
    toast('Answers cleared — ready to retake!');
  };

  const handleExportPdf = async exportMode => {
    if (!paper) return;
    setExportOpen(false);
    setExporting(true);
    try {
      const { buildExamPaperPDF, saveExamPaperPDF } = await import('../lib/examPaperPdf');
      const doc = buildExamPaperPDF({
        paper,
        studentInfo,
        answers,
        writtenScores,
        exportMode,
      });
      const how = await saveExamPaperPDF(doc, paper.title || 'exam-paper');
      toast(
        how === 'shared' ? 'Bond-paper PDF ready to print or share' : 'Bond-paper PDF downloaded',
        { type: 'success' }
      );
    } catch (err) {
      toast(`PDF export failed: ${err.message}`, { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const totals = computeExamTotals(config);
  const grade = paper ? gradeExamPaperOffline(paper, answers, writtenScores) : null;

  const exportModal =
    exportOpen &&
    typeof document !== 'undefined' &&
    document.body &&
    createPortal(
      <div className="export-overlay" onClick={() => setExportOpen(false)}>
        <div className="export-sheet" onClick={e => e.stopPropagation()}>
          <div className="export-title">Export Short Bond Paper (8.5&quot; × 11&quot;)</div>
          <button
            type="button"
            className="export-btn"
            onClick={() => handleExportPdf('exam_with_key')}
          >
            <FileDown size={18} /> Blank Exam + Separate Answer Key Page
          </button>
          <button
            type="button"
            className="export-btn"
            onClick={() => handleExportPdf('exam_only')}
          >
            <FileDown size={18} /> Blank Exam Paper Only (Student Copy)
          </button>
          <button
            type="button"
            className="export-btn"
            onClick={() => handleExportPdf('answered')}
          >
            <FileDown size={18} /> My Answered &amp; Scored Paper
          </button>
          <button
            type="button"
            className="export-btn"
            onClick={() => {
              setExportOpen(false);
              document.body.classList.add('printing-bond-paper');
              setTimeout(() => {
                try {
                  window.print();
                } finally {
                  setTimeout(() => document.body.classList.remove('printing-bond-paper'), 400);
                }
              }, 120);
            }}
          >
            <Printer size={18} /> Print Directly
          </button>
          <button
            type="button"
            className="export-btn cancel"
            onClick={() => setExportOpen(false)}
          >
            Cancel
          </button>
        </div>
      </div>,
      document.body
    );

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeft size={20} /> Back
        </button>
        <span className="navbar-title">Exam Paper</span>
        <div className="flex items-center gap-6">
          {paper && (
            <>
              <button
                type="button"
                className="navbar-btn"
                onClick={() => setComposerOpen(o => !o)}
                aria-label="Customize exam sections"
                title="Customize test types & numbers"
              >
                <SlidersHorizontal size={18} />
              </button>
              <button
                type="button"
                className="navbar-btn"
                disabled={exporting}
                onClick={() => setExportOpen(true)}
                aria-label="Export or print PDF"
                title="Export / Print Bond Paper PDF"
              >
                <FileDown size={19} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="editor" style={{ paddingBottom: 48 }}>
        {/* Step 1: Mix-and-Match Exam Builder Controls */}
        {composerOpen && (
          <div className="explanation-card" style={{ marginBottom: 16 }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 750 }}>Build Custom Exam Paper</span>
              {paper && (
                <button
                  type="button"
                  className="navbar-btn"
                  style={{ width: 28, height: 28 }}
                  onClick={() => setComposerOpen(false)}
                  aria-label="Collapse composer"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Quick Presets */}
            <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
              {EXAM_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfig(p.apply())}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="exam-header-inputs">
              <input
                type="text"
                className="ai-input"
                value={examTitle}
                onChange={e => setExamTitle(e.target.value)}
                placeholder="Exam Title (e.g. Midterm Exam)"
              />
              <input
                type="text"
                className="ai-input"
                value={subtitle}
                onChange={e => setSubtitle(e.target.value)}
                placeholder="Course / Subject subtitle"
              />
            </div>

            <div className="settings-label mt-12">Difficulty</div>
            <div className="mode-picker-row" style={{ marginBottom: 12 }}>
              {[
                ['standard', 'Standard'],
                ['midterm', 'Midterm'],
                ['final', 'Final / Board'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`mode-pick-chip${config.difficulty === id ? ' active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, difficulty: id }))}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <span className="settings-label" style={{ marginBottom: 0 }}>
                Combine Test Types &amp; Item Counts
              </span>
              <span className="tag-pill">
                {totals.totalItems} items · {totals.totalPoints} pts
              </span>
            </div>

            <div className="exam-type-grid">
              {EXAM_SECTION_TYPES.map(t => {
                const st = config.sections[t.type];
                return (
                  <div key={t.type} className={`exam-type-row${st.enabled ? ' enabled' : ''}`}>
                    <button
                      type="button"
                      className="exam-type-toggle"
                      onClick={() => toggleSection(t.type)}
                    >
                      <span className={`check-box${st.enabled ? ' checked' : ''}`} style={{ width: 17, height: 17 }}>
                        {st.enabled && '✓'}
                      </span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {st.pointsEach} pt{st.pointsEach === 1 ? '' : 's'} each
                        </div>
                      </div>
                    </button>

                    <div className="exam-stepper">
                      <button
                        type="button"
                        className="exam-step-btn"
                        aria-label={`Decrease ${t.label} count`}
                        onClick={() => stepSectionCount(t.type, -1, t.min, t.max)}
                      >
                        <Minus size={13} />
                      </button>
                      <span className="exam-step-num">{st.count}</span>
                      <button
                        type="button"
                        className="exam-step-btn"
                        aria-label={`Increase ${t.label} count`}
                        onClick={() => stepSectionCount(t.type, 1, t.min, t.max)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-8 mt-12">
              {busy ? (
                <button
                  type="button"
                  className="btn btn-danger w-full"
                  onClick={() => abortRef.current?.abort()}
                >
                  <X size={16} /> Stop Generating
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={totals.totalItems === 0}
                  onClick={handleGenerate}
                >
                  <Sparkles size={16} />
                  {paper ? 'Regenerate Exam Paper' : 'Generate Bond-Paper Exam'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Interactive Answerable Bond Paper */}
        {paper && grade && (
          <>
            <div className="exam-action-bar">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleCheckPaper}>
                <CheckCircle2 size={15} /> {checked ? 'Re-check Score' : 'Check & Score'}
              </button>
              {grade.writtenKeys.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={gradingAi}
                  onClick={handleAiGradeWritten}
                >
                  {gradingAi ? (
                    <span className="spinner" style={{ width: 13, height: 13 }} />
                  ) : (
                    <Wand2 size={14} />
                  )}
                  {gradingAi ? 'Grading…' : 'AI Grade Written'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowKey(k => !k)}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                {showKey ? 'Hide Key' : 'Answer Key'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleRetake}>
                <RotateCcw size={14} /> Clear
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={exporting}
                onClick={() => setExportOpen(true)}
              >
                <FileDown size={14} /> PDF / Print
              </button>
            </div>

            <div className="bond-paper" id="bond-paper-sheet">
              <div className="bond-header">
                <div className="bond-title">{paper.title}</div>
                {paper.subtitle && <div className="bond-subtitle">{paper.subtitle}</div>}
                <div className="bond-meta-grid">
                  <label className="bond-meta-field">
                    <span>Name:</span>
                    <input
                      type="text"
                      value={studentInfo.name}
                      onChange={e => setStudentInfo(s => ({ ...s, name: e.target.value }))}
                      placeholder="Your Name"
                    />
                  </label>
                  <label className="bond-meta-field">
                    <span>Section:</span>
                    <input
                      type="text"
                      value={studentInfo.section}
                      onChange={e => setStudentInfo(s => ({ ...s, section: e.target.value }))}
                      placeholder="Section"
                    />
                  </label>
                  <label className="bond-meta-field">
                    <span>Date:</span>
                    <input
                      type="text"
                      value={studentInfo.date}
                      onChange={e => setStudentInfo(s => ({ ...s, date: e.target.value }))}
                    />
                  </label>
                  <div className="bond-score-box">
                    <span>Score:</span>
                    <strong>
                      {checked ? `${grade.totalEarned} / ${grade.totalMax}` : `___ / ${grade.totalMax}`}
                    </strong>
                  </div>
                </div>
              </div>

              {(paper.parts || []).map((part, pIdx) => {
                const roman = ROMAN_NUMERALS[pIdx] || String(pIdx + 1);
                const partPts = (part.items?.length || 0) * (Number(part.pointsEach) || 1);

                return (
                  <section key={`${part.type}-${pIdx}`} className="bond-part">
                    <div className="bond-part-head">
                      PART {roman}. {String(part.heading || '').toUpperCase()}{' '}
                      <span className="bond-part-pts">({partPts} pts)</span>
                    </div>
                    {part.directions && (
                      <div className="bond-directions">
                        <em>Directions:</em> {part.directions}
                      </div>
                    )}

                    {/* MATCHING TYPE (Side-by-side Column A & Column B) */}
                    {part.type === 'matching' ? (
                      <div className="bond-matching-grid">
                        <div className="bond-matching-col">
                          <div className="bond-col-title">Column A</div>
                          {part.items.map((item, iIdx) => {
                            const key = `${pIdx}-${iIdx}`;
                            const res = checked ? grade.itemResults[key] : null;
                            return (
                              <div key={key} className="bond-match-item">
                                <select
                                  className={`bond-match-select${
                                    res ? (res.correct ? ' is-right' : ' is-wrong') : ''
                                  }`}
                                  aria-label={`Answer for item ${iIdx + 1}`}
                                  value={answers[key] || ''}
                                  onChange={e => updateAnswer(key, e.target.value)}
                                >
                                  <option value="">—</option>
                                  {(part.columnB || []).map(c => (
                                    <option key={c.letter} value={c.letter}>
                                      {c.letter}
                                    </option>
                                  ))}
                                </select>
                                <span>
                                  <strong>{iIdx + 1}.</strong> {item.prompt}
                                  {(checked || showKey) && (
                                    <span className="bond-inline-key">
                                      {' '}
                                      [Ans: {item.answerLetter}]
                                    </span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="bond-matching-col">
                          <div className="bond-col-title">Column B</div>
                          {(part.columnB || []).map(c => (
                            <div key={c.letter} className="bond-col-b-row">
                              <strong>{c.letter}.</strong> {c.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      part.items.map((item, iIdx) => {
                        const key = `${pIdx}-${iIdx}`;
                        const res = checked ? grade.itemResults[key] : null;
                        const num = iIdx + 1;

                        if (part.type === 'mcq') {
                          return (
                            <div key={key} className="bond-item">
                              <div className="bond-q">
                                <strong>{num}.</strong> {item.question}
                              </div>
                              <div className="bond-choices">
                                {item.choices.map((ch, ci) => {
                                  const ltr = String.fromCharCode(65 + ci);
                                  const picked = answers[key] === ci;
                                  const isRightChoice = ci === item.answerIndex;
                                  let cls = 'bond-choice';
                                  if (picked) cls += ' picked';
                                  if (checked || showKey) {
                                    if (isRightChoice) cls += ' is-right';
                                    else if (picked) cls += ' is-wrong';
                                  }
                                  return (
                                    <button
                                      key={ci}
                                      type="button"
                                      className={cls}
                                      onClick={() => updateAnswer(key, ci)}
                                    >
                                      <span className="bond-choice-bubble">{ltr}</span>
                                      <span>{ch}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {(checked || showKey) && item.explanation && (
                                <div className="bond-rationale">{item.explanation}</div>
                              )}
                            </div>
                          );
                        }

                        if (part.type === 'true_false') {
                          return (
                            <div key={key} className="bond-item">
                              <div className="bond-tf-row">
                                <div className="bond-tf-pills">
                                  {[true, false].map(val => {
                                    const picked = answers[key] === val;
                                    let cls = 'bond-tf-btn';
                                    if (picked) cls += ' picked';
                                    if (checked || showKey) {
                                      if (item.answer === val) cls += ' is-right';
                                      else if (picked) cls += ' is-wrong';
                                    }
                                    return (
                                      <button
                                        key={String(val)}
                                        type="button"
                                        className={cls}
                                        onClick={() => updateAnswer(key, val)}
                                      >
                                        {val ? 'T' : 'F'}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="bond-q" style={{ flex: 1 }}>
                                  <strong>{num}.</strong> {item.statement}
                                </div>
                              </div>
                              {(checked || showKey) && item.explanation && (
                                <div className="bond-rationale">
                                  <strong>{item.answer ? 'TRUE' : 'FALSE'}</strong> — {item.explanation}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (part.type === 'identification') {
                          return (
                            <div key={key} className="bond-item">
                              <div className="bond-id-row">
                                <input
                                  type="text"
                                  className={`bond-blank-input${
                                    res ? (res.correct ? ' is-right' : ' is-wrong') : ''
                                  }`}
                                  placeholder="Type answer…"
                                  value={answers[key] || ''}
                                  onChange={e => updateAnswer(key, e.target.value)}
                                />
                                <div className="bond-q" style={{ flex: 1 }}>
                                  <strong>{num}.</strong> {item.question}
                                </div>
                              </div>
                              {(checked || showKey) && (
                                <div className="bond-rationale">
                                  {res &&
                                    (res.correct ? (
                                      <CheckCircle2 size={13} style={{ color: '#1b7a34', verticalAlign: -2, marginRight: 4 }} />
                                    ) : (
                                      <XCircle size={13} style={{ color: '#c62828', verticalAlign: -2, marginRight: 4 }} />
                                    ))}
                                  <strong>Answer:</strong> {item.answer}
                                  {item.explanation ? ` — ${item.explanation}` : ''}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (part.type === 'enumeration') {
                          const count = item.answers?.length || 3;
                          const curArr = Array.isArray(answers[key]) ? answers[key] : [];
                          return (
                            <div key={key} className="bond-item">
                              <div className="bond-q">
                                <strong>{num}.</strong> {item.question}{' '}
                                <span className="bond-part-pts">({part.pointsEach} pts)</span>
                              </div>
                              <div className="bond-enum-list">
                                {Array.from({ length: count }).map((_, k) => (
                                  <div key={k} className="bond-enum-row">
                                    <span>{String.fromCharCode(97 + k)}.</span>
                                    <input
                                      type="text"
                                      className="bond-blank-input flex-1"
                                      placeholder={`Item ${k + 1}…`}
                                      value={curArr[k] || ''}
                                      onChange={e => updateEnumAnswer(key, k, e.target.value, count)}
                                    />
                                  </div>
                                ))}
                              </div>
                              {(checked || showKey) && (
                                <div className="bond-rationale">
                                  <strong>Expected ({res ? `${res.earned}/${res.max} pts` : `${count} items`}):</strong>{' '}
                                  {(item.answers || []).join(', ')}
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Problem Solving, Scenario, Essay
                        const wScore = writtenScores[key];
                        return (
                          <div key={key} className="bond-item">
                            {item.scenario && (
                              <div className="bond-scenario-box">{item.scenario}</div>
                            )}
                            <div className="bond-q">
                              <strong>{num}.</strong>{' '}
                              <span style={{ display: 'inline' }}>
                                <MarkdownContent text={item.question} />
                              </span>
                            </div>
                            <textarea
                              className="bond-written-box"
                              rows={part.type === 'problem_solving' ? 5 : 4}
                              placeholder={
                                part.type === 'problem_solving'
                                  ? 'Write your step-by-step calculation or code trace here…'
                                  : 'Write your answer here…'
                              }
                              value={answers[key] || ''}
                              onChange={e => updateAnswer(key, e.target.value)}
                            />
                            {(checked || showKey) && (
                              <div className="bond-solution-box">
                                <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                                  <strong>Model Solution &amp; Rubric</strong>
                                  <label className="bond-self-score">
                                    <span>Points:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={part.pointsEach}
                                      step={0.5}
                                      value={wScore?.earned ?? 0}
                                      onChange={e =>
                                        handleSelfScore(
                                          key,
                                          Math.max(0, Math.min(part.pointsEach, Number(e.target.value) || 0))
                                        )
                                      }
                                    />
                                    <span>/ {part.pointsEach}</span>
                                  </label>
                                </div>
                                {wScore?.feedback && (
                                  <div style={{ marginBottom: 6, color: '#1b5e20', fontSize: 12.5 }}>
                                    <strong>AI Feedback:</strong> {wScore.feedback}
                                  </div>
                                )}
                                <MarkdownContent text={item.solution || '—'} />
                                {item.rubric?.length > 0 && (
                                  <div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
                                    <strong>Key Points:</strong> {item.rubric.join(' · ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
      {exportModal}
    </div>
  );
}
