/**
 * SyllabusStudioScreen — Full Semester AI Syllabus Analyzer, Accurate Source Fetcher,
 * Hands-On Practical Lab Studio, and Applied Mastery Gate.
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  ChevronLeft,
  Sparkles,
  FileUp,
  Camera,
  BookOpen,
  Wrench,
  Award,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  Trash2,
  CalendarCheck,
  RefreshCw,
  ChevronRight,
  Brain,
} from 'lucide-react';
import {
  listSyllabi,
  getSyllabus,
  saveSyllabus,
  deleteSyllabus,
  createNote,
} from '../store/db';
import {
  MASTERY_META,
  extractSyllabusSource,
  analyzeSyllabusWithAI,
  fetchVerifiedTopicSources,
  generateTopicLesson,
  generateMasteryGate,
  evaluateMasteryGate,
  applySyllabusToWorkspace,
  updateSyllabusTopicState,
  getSyllabusTopicCache,
  putSyllabusTopicCache,
} from '../lib/syllabusEngine';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

const PracticalLabView = lazy(() => import('./syllabus/PracticalLabView'));

export default function SyllabusStudioScreen({
  onBack,
  onOpenNote,
  onChanged,
  initialSyllabusId = null,
}) {
  const { confirm, toast } = useDialog();
  const [syllabi, setSyllabi] = useState([]);
  const [activeSyllabus, setActiveSyllabus] = useState(null);
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [topicTab, setTopicTab] = useState('learn'); // learn | practical | mastery

  // Ingestion / Analyzer state
  const [creating, setCreating] = useState(false);
  const [courseHint, setCourseHint] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const [syncingWorkspace, setSyncingWorkspace] = useState(false);

  // Per-topic workspace state
  const [topicCache, setTopicCache] = useState(null);
  const [fetchingSources, setFetchingSources] = useState(false);
  const [generatingLesson, setGeneratingLesson] = useState(false);

  // Mastery Gate state
  const [gateData, setGateData] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateAnswers, setGateAnswers] = useState({});
  const [feynmanText, setFeynmanText] = useState('');
  const [gateEvaluating, setGateEvaluating] = useState(false);
  const [gateResult, setGateResult] = useState(null);

  const fileRef = useRef(null);
  const imgRef = useRef(null);

  const refreshList = async () => {
    const list = await listSyllabi();
    setSyllabi(list);
    return list;
  };

  useEffect(() => {
    refreshList().then(list => {
      if (initialSyllabusId) {
        const hit = list.find(s => s.id === initialSyllabusId);
        if (hit) setActiveSyllabus(hit);
      }
    });
  }, [initialSyllabusId]);

  const activeTopic =
    activeSyllabus?.topics?.find(t => t.slug === selectedSlug) || null;

  const cacheKeyFor = (sylId, slug) => `syl:${sylId}:${slug}`;

  useEffect(() => {
    if (!activeSyllabus || !activeTopic) {
      setTopicCache(null);
      setGateData(null);
      setGateResult(null);
      return;
    }
    let live = true;
    const key = cacheKeyFor(activeSyllabus.id, activeTopic.slug);
    getSyllabusTopicCache(key).then(rec => {
      if (!live) return;
      setTopicCache(rec || null);
      setGateData(rec?.gateData || null);
      setGateAnswers({});
      setFeynmanText('');
      setGateResult(null);
    });
    return () => {
      live = false;
    };
  }, [activeSyllabus?.id, activeTopic?.slug]);

  const updateCacheRecord = async patch => {
    if (!activeSyllabus || !activeTopic) return;
    const key = cacheKeyFor(activeSyllabus.id, activeTopic.slug);
    const merged = { ...(topicCache || {}), ...(patch || {}) };
    setTopicCache(merged);
    await putSyllabusTopicCache(key, activeSyllabus.id, merged);
  };

  const handleAnalyzeSource = async ({ file = null, imageFile = null, text = '' } = {}) => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeStatus('Reading syllabus document…');
    try {
      const extracted = await extractSyllabusSource({ file, imageFile, pastedText: text });
      const analyzed = await analyzeSyllabusWithAI({
        rawText: extracted.text,
        courseHint: courseHint || extracted.sourceTitle,
        onStatus: setAnalyzeStatus,
      });
      const saved = await saveSyllabus(analyzed);
      await refreshList();
      setActiveSyllabus(saved);
      setCreating(false);
      setPastedText('');
      setCourseHint('');
      onChanged?.();
      toast(`Analyzed ${saved.topics.length} topics from ${saved.code}!`, { type: 'success' });
    } catch (err) {
      toast(err.message || 'Could not analyze syllabus', { type: 'error', duration: 4500 });
    } finally {
      setAnalyzing(false);
      setAnalyzeStatus('');
    }
  };

  const handleSyncWorkspace = async () => {
    if (!activeSyllabus || syncingWorkspace) return;
    setSyncingWorkspace(true);
    try {
      const res = await applySyllabusToWorkspace({
        syllabus: activeSyllabus,
        syncCalendar: true,
        syncGrades: true,
      });
      setActiveSyllabus(res.syllabus);
      onChanged?.();
      toast(
        `Synced ${res.syllabus.code} to Courses, Folder & ${res.eventsAdded} Calendar items!`,
        { type: 'success' }
      );
    } catch (err) {
      toast(err.message || 'Sync failed', { type: 'error' });
    } finally {
      setSyncingWorkspace(false);
    }
  };

  const handleFetchAndExplain = async () => {
    if (!activeSyllabus || !activeTopic || fetchingSources || generatingLesson) return;
    setFetchingSources(true);
    try {
      const fetched = await fetchVerifiedTopicSources({
        syllabus: activeSyllabus,
        topic: activeTopic,
      });
      await updateCacheRecord({
        sources: fetched.sources,
        rejectedCount: fetched.rejectedCount,
      });
      setFetchingSources(false);

      setGeneratingLesson(true);
      const lessonMd = await generateTopicLesson({
        syllabus: activeSyllabus,
        topic: activeTopic,
        verifiedSources: fetched.sources,
      });
      await updateCacheRecord({
        sources: fetched.sources,
        rejectedCount: fetched.rejectedCount,
        lessonMd,
      });

      if (activeTopic.masteryState === 'not_started') {
        const updated = await updateSyllabusTopicState(activeSyllabus.id, activeTopic.slug, {
          masteryState: 'learned',
        });
        if (updated) setActiveSyllabus(updated);
      }
      toast('Verified sources & study guide ready!', { type: 'success' });
    } catch (err) {
      toast(err.message || 'Could not fetch topic resources', { type: 'error' });
    } finally {
      setFetchingSources(false);
      setGeneratingLesson(false);
    }
  };

  const handleSaveTopicNote = async () => {
    if (!activeSyllabus || !activeTopic) return;
    let syl = activeSyllabus;
    if (!syl.folderId) {
      const res = await applySyllabusToWorkspace({ syllabus: syl, syncCalendar: false, syncGrades: false });
      syl = res.syllabus;
      setActiveSyllabus(syl);
    }
    const sourcesMd = (topicCache?.sources || [])
      .map(s => `- [${s.index}] [${s.title}](${s.url})`)
      .join('\n');
    const body = [
      `## Practical Goal\n${activeTopic.practicalGoal || ''}`,
      topicCache?.lessonMd || '',
      sourcesMd ? `## Verified Sources\n${sourcesMd}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const created = await createNote(
      syl.folderId ?? null,
      `${syl.code}: ${activeTopic.title}`,
      body,
      syl.name
    );
    onChanged?.();
    toast('Saved lesson to Notes!', { type: 'success' });
    onOpenNote?.(created, { id: syl.folderId, name: syl.code || syl.name });
  };

  const handleLoadMasteryGate = async () => {
    if (!activeSyllabus || !activeTopic || gateLoading) return;
    setGateLoading(true);
    setGateResult(null);
    try {
      const gate = await generateMasteryGate({
        syllabus: activeSyllabus,
        topic: activeTopic,
        practicalSummary: activeTopic.practicalSummary || '',
        verifiedSources: topicCache?.sources || [],
      });
      setGateData(gate);
      setGateAnswers({});
      await updateCacheRecord({ gateData: gate });
    } catch (err) {
      toast(err.message || 'Could not generate Mastery Gate', { type: 'error' });
    } finally {
      setGateLoading(false);
    }
  };

  const handleSubmitMasteryGate = async () => {
    if (!gateData || gateEvaluating) return;
    setGateEvaluating(true);
    try {
      const res = await evaluateMasteryGate({
        syllabus: activeSyllabus,
        topic: activeTopic,
        questions: gateData.questions,
        answers: gateAnswers,
        feynmanText,
        practicalSummary: activeTopic.practicalSummary || '',
      });
      setGateResult(res);
      const nextState = res.passed
        ? 'mastered'
        : activeTopic.masteryState === 'not_started'
          ? 'learned'
          : activeTopic.masteryState;
      const updated = await updateSyllabusTopicState(activeSyllabus.id, activeTopic.slug, {
        masteryState: nextState,
        masteryScore: res.totalScore,
      });
      if (updated) setActiveSyllabus(updated);
      onChanged?.();
      toast(
        res.passed
          ? `Topic Mastered (${res.totalScore}%)!`
          : `Score ${res.totalScore}% — review weak spots in Daily Review!`,
        { type: res.passed ? 'success' : 'info' }
      );
    } catch (err) {
      toast(err.message || 'Could not evaluate Mastery Gate', { type: 'error' });
    } finally {
      setGateEvaluating(false);
    }
  };

  // =====================================================================
  // VIEW 3: TOPIC WORKSPACE (Learn | Practical Lab | Mastery Gate)
  // =====================================================================
  if (activeSyllabus && activeTopic) {
    const mMeta = MASTERY_META[activeTopic.masteryState] || MASTERY_META.not_started;
    return (
      <div className="screen list-pad-bottom">
        <header className="navbar">
          <button
            type="button"
            className="navbar-btn navbar-back"
            onClick={() => setSelectedSlug(null)}
          >
            <ChevronLeft size={20} /> Roadmap
          </button>
          <span className="navbar-title">{activeSyllabus.code} · Wk {activeTopic.week}</span>
          <span className={`syllabus-state-pill tone-${mMeta.tone}`}>{mMeta.label}</span>
        </header>

        <div className="large-title" style={{ fontSize: 22, paddingBottom: 6 }}>
          {activeTopic.title}
        </div>

        <div className="hub-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={topicTab === 'learn'}
            className={`hub-tab-btn${topicTab === 'learn' ? ' active' : ''}`}
            onClick={() => setTopicTab('learn')}
          >
            <BookOpen size={13} /> Learn
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={topicTab === 'practical'}
            className={`hub-tab-btn${topicTab === 'practical' ? ' active' : ''}`}
            onClick={() => setTopicTab('practical')}
          >
            <Wrench size={13} /> Practical Lab
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={topicTab === 'mastery'}
            className={`hub-tab-btn${topicTab === 'mastery' ? ' active' : ''}`}
            onClick={() => setTopicTab('mastery')}
          >
            <Award size={13} /> Mastery Gate
          </button>
        </div>

        <div className="editor">
          {topicTab === 'learn' && (
            <>
              {activeTopic.learningObjectives?.length > 0 && (
                <div className="explanation-card">
                  <div className="settings-label" style={{ marginTop: 0 }}>Learning Objectives</div>
                  <ul style={{ margin: '4px 0 0 18px', fontSize: 13.5, lineHeight: 1.5 }}>
                    {activeTopic.learningObjectives.map((obj, i) => (
                      <li key={i}>{obj}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-8" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={fetchingSources || generatingLesson}
                  onClick={handleFetchAndExplain}
                >
                  {fetchingSources ? (
                    <>
                      <span className="spinner" style={{ width: 12, height: 12 }} /> Verifying Sources…
                    </>
                  ) : generatingLesson ? (
                    <>
                      <span className="spinner" style={{ width: 12, height: 12 }} /> Writing Guide…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> {topicCache?.lessonMd ? 'Refresh Sources & Guide' : 'Fetch & Explain Topic'}
                    </>
                  )}
                </button>
                {topicCache?.lessonMd && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveTopicNote}>
                    <FilePlus2 size={14} /> Save to Notes
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setTopicTab('practical')}
                >
                  <Wrench size={14} /> Open Practical Lab
                </button>
              </div>

              {topicCache?.lessonMd && (
                <div className="explanation-card">
                  <MarkdownContent text={topicCache.lessonMd} sources={topicCache.sources || null} />
                </div>
              )}

              {topicCache?.sources?.length > 0 && (
                <div className="explanation-card">
                  <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
                    <span className="settings-label" style={{ margin: 0 }}>
                      Accuracy-Verified Sources ({topicCache.sources.length})
                    </span>
                    {topicCache.rejectedCount > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Filtered {topicCache.rejectedCount} off-topic match{topicCache.rejectedCount === 1 ? '' : 'es'}
                      </span>
                    )}
                  </div>
                  <div className="chat-sources">
                    {topicCache.sources.map(src => (
                      <a
                        key={src.index}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-source-link"
                      >
                        <span className={`source-kind-badge kind-${src.kind || 'web'}`}>
                          {src.kind.toUpperCase()}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          [{src.index}] {src.title}
                        </span>
                        <ExternalLink size={11} style={{ flexShrink: 0 }} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {topicTab === 'practical' && (
            <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading Practical Lab…</div>}>
              <PracticalLabView
                key={`${activeSyllabus.id}:${activeTopic.slug}`}
                syllabus={activeSyllabus}
                topic={activeTopic}
                verifiedSources={topicCache?.sources || []}
                cachedLabSpec={topicCache?.labSpec || null}
                cachedWidgetHtml={topicCache?.widgetHtml || ''}
                onCacheUpdate={updateCacheRecord}
                onPracticed={async summaryText => {
                  const nextState =
                    activeTopic.masteryState === 'mastered' ? 'mastered' : 'practiced';
                  const updated = await updateSyllabusTopicState(activeSyllabus.id, activeTopic.slug, {
                    masteryState: nextState,
                    practicalDone: true,
                    practicalSummary: summaryText,
                  });
                  if (updated) setActiveSyllabus(updated);
                }}
              />
            </Suspense>
          )}

          {topicTab === 'mastery' && (
            <div className="explanation-card">
              <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 750 }}>Applied Mastery Gate</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Connects your hands-on practical work with 3 scenario checks + Feynman explanation.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={gateLoading}
                  onClick={handleLoadMasteryGate}
                >
                  <Brain size={14} /> {gateLoading ? 'Preparing…' : gateData ? 'New Check' : 'Start Check'}
                </button>
              </div>

              {activeTopic.practicalSummary && (
                <div className="settings-tip" style={{ marginBottom: 10 }}>
                  Connected Practical Work: <strong>{activeTopic.practicalSummary}</strong>
                </div>
              )}

              {gateData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                  {gateData.questions.map((q, qIdx) => (
                    <div key={qIdx} className="mastery-q-card">
                      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>
                        {qIdx + 1}. {q.question}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {q.choices.map((ch, cIdx) => {
                          const picked = gateAnswers[qIdx] === cIdx;
                          return (
                            <button
                              key={cIdx}
                              type="button"
                              className={`quiz-choice${picked ? ' selected' : ''}`}
                              style={{ textAlign: 'left', padding: '8px 10px' }}
                              onClick={() => setGateAnswers(prev => ({ ...prev, [qIdx]: cIdx }))}
                            >
                              {ch}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div>
                    <div className="settings-label" style={{ marginBottom: 4 }}>
                      Feynman Check (In Your Own Words)
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      {gateData.feynmanPrompt}
                    </div>
                    <textarea
                      className="ai-input"
                      rows={4}
                      value={feynmanText}
                      onChange={e => setFeynmanText(e.target.value)}
                      placeholder="Explain how it works, why it matters, and a practical example…"
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={gateEvaluating}
                    onClick={handleSubmitMasteryGate}
                  >
                    <CheckCircle2 size={15} />{' '}
                    {gateEvaluating ? 'Evaluating Mastery…' : 'Submit & Verify Mastery'}
                  </button>
                </div>
              )}

              {gateResult && (
                <div className="practical-grade-card mt-12">
                  <div style={{ fontSize: 14, fontWeight: 800 }}>
                    Mastery Score: {gateResult.totalScore}% (Quiz {gateResult.mcqScore}% · Feynman{' '}
                    {gateResult.feynmanScore}%)
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{gateResult.feedback}</div>
                  {gateResult.flashcardsAdded > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Added {gateResult.flashcardsAdded} review card
                      {gateResult.flashcardsAdded === 1 ? '' : 's'} to Daily Review &amp; Learner Memory.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =====================================================================
  // VIEW 2: FULL SEMESTER ROADMAP FOR SELECTED SYLLABUS
  // =====================================================================
  if (activeSyllabus) {
    const total = activeSyllabus.topics?.length || 0;
    const masteredCount = (activeSyllabus.topics || []).filter(
      t => t.masteryState === 'mastered'
    ).length;
    const pct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;

    return (
      <div className="screen list-pad-bottom">
        <header className="navbar">
          <button
            type="button"
            className="navbar-btn navbar-back"
            onClick={() => setActiveSyllabus(null)}
          >
            <ChevronLeft size={20} /> Syllabi
          </button>
          <span className="navbar-title">{activeSyllabus.code}</span>
          <button
            type="button"
            className="navbar-btn"
            aria-label="Delete syllabus"
            onClick={async () => {
              const ok = await confirm({
                title: `Delete "${activeSyllabus.name}"?`,
                message: 'Removes this syllabus roadmap and cached topic guides.',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (!ok) return;
              await deleteSyllabus(activeSyllabus.id);
              setActiveSyllabus(null);
              refreshList();
              toast('Syllabus deleted');
            }}
          >
            <Trash2 size={17} />
          </button>
        </header>

        <div className="large-title" style={{ paddingBottom: 4 }}>
          {activeSyllabus.name}
        </div>
        {activeSyllabus.overview && (
          <div style={{ padding: '0 var(--gutter) 10px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            {activeSyllabus.overview}
          </div>
        )}

        <div className="explanation-card" style={{ margin: '0 var(--gutter) 12px' }}>
          <div className="flex items-center justify-between gap-8">
            <span style={{ fontSize: 13.5, fontWeight: 750 }}>
              Mastery Progress: {masteredCount} / {total} ({pct}%)
            </span>
            <button
              type="button"
              className="row-action-chip active-chip"
              disabled={syncingWorkspace}
              onClick={handleSyncWorkspace}
            >
              <CalendarCheck size={12} />{' '}
              {syncingWorkspace ? 'Syncing…' : activeSyllabus.courseId ? 'Re-sync Workspace' : 'Sync to Course & Calendar'}
            </button>
          </div>
          <div className="syllabus-progress-track mt-8">
            <div className="syllabus-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {activeSyllabus.gradingWeights?.length > 0 && (
            <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
              {activeSyllabus.gradingWeights.map((w, i) => (
                <span key={i} className="tag-pill">
                  {w.label} {w.weight}%
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="section-heading">Weekly Modules &amp; Practical Labs</div>
        <div className="list-group">
          {(activeSyllabus.topics || []).map(t => {
            const m = MASTERY_META[t.masteryState] || MASTERY_META.not_started;
            return (
              <button
                key={t.slug}
                type="button"
                className="list-item"
                onClick={() => {
                  setSelectedSlug(t.slug);
                  setTopicTab('learn');
                }}
              >
                <div className="syllabus-week-badge">W{t.week}</div>
                <div className="list-item-body">
                  <div className="list-item-title">
                    <span>{t.title}</span>
                    <span className={`syllabus-state-pill tone-${m.tone}`}>{m.short}</span>
                  </div>
                  <div className="list-item-subtitle">
                    {t.module} · {t.practicalGoal}
                  </div>
                </div>
                <ChevronRight size={17} className="list-item-chevron" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // =====================================================================
  // VIEW 1: SYLLABUS STUDIO HOME + ANALYZER WIZARD
  // =====================================================================
  return (
    <div className="screen list-pad-bottom-nav">
      <header className="navbar">
        <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
          <ChevronLeft size={20} /> Back
        </button>
        <span className="navbar-title">AI Syllabus Studio</span>
        <button
          type="button"
          className="navbar-btn"
          aria-label="Analyze new syllabus"
          onClick={() => setCreating(c => !c)}
        >
          <Sparkles size={18} />
        </button>
      </header>

      <div className="large-title" style={{ paddingBottom: 6 }}>
        Syllabus Studio
      </div>
      <div style={{ padding: '0 var(--gutter) 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
        Upload your semester syllabus (PDF, DOCX, PPTX, photo, or text). AI maps every topic, verifies open-source readings, and builds hands-on practical labs + mastery gates.
      </div>

      {(creating || syllabi.length === 0) && (
        <div className="explanation-card" style={{ margin: '0 var(--gutter) 14px' }}>
          <div className="settings-label" style={{ marginTop: 0 }}>
            Analyze Semester Syllabus
          </div>
          <input
            className="input-field"
            placeholder="Course code or title (optional, e.g. CS 201)"
            value={courseHint}
            onChange={e => setCourseHint(e.target.value)}
          />
          <textarea
            className="ai-input mt-8"
            rows={5}
            placeholder="Paste your syllabus outline, weekly topics, grading breakdown & exam dates — OR upload a file/photo below…"
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
          />

          <div className="flex gap-8 mt-10" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={analyzing || !pastedText.trim()}
              onClick={() => handleAnalyzeSource({ text: pastedText })}
            >
              <Sparkles size={14} /> {analyzing ? 'Analyzing…' : 'Analyze Pasted Text'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={analyzing}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={14} /> Upload PDF / DOCX / PPTX
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={analyzing}
              onClick={() => imgRef.current?.click()}
            >
              <Camera size={14} /> Scan Photo
            </button>
          </div>

          {analyzeStatus && (
            <div className="scan-indicator mt-8" style={{ justifyContent: 'flex-start' }}>
              <span className="spinner" /> {analyzeStatus}
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.pptx,.ppt,.md,.txt"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleAnalyzeSource({ file: f });
            }}
          />
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleAnalyzeSource({ imageFile: f });
            }}
          />
        </div>
      )}

      {syllabi.length > 0 && (
        <>
          <div className="home-section-row">
            <div className="section-heading" style={{ padding: 0 }}>Your Syllabi</div>
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => setCreating(c => !c)}
            >
              <Sparkles size={11} /> {creating ? 'Hide Form' : 'Analyze New'}
            </button>
          </div>
          <div className="list-group">
            {syllabi.map(s => {
              const total = s.topics?.length || 0;
              const mastered = (s.topics || []).filter(t => t.masteryState === 'mastered').length;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="list-item"
                  onClick={() => setActiveSyllabus(s)}
                >
                  <span className="list-item-icon tone-indigo">
                    <BookOpen size={17} />
                  </span>
                  <div className="list-item-body">
                    <div className="list-item-title">
                      <span>{s.code ? `${s.code} — ${s.name}` : s.name}</span>
                    </div>
                    <div className="list-item-subtitle">
                      {total} topics · {mastered} mastered
                    </div>
                  </div>
                  <ChevronRight size={17} className="list-item-chevron" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
