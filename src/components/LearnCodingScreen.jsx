/**
 * LearnCodingScreen — Online Multi-Language Coding Studio inside Notes by Bai.
 *
 * Fetches real, free open-source resources dynamically over the internet
 * (Learn X in Y Minutes lessons, Exercism practice challenges, MDN + Wikipedia CS docs)
 * and caches opened modules locally in IndexedDB, paired with:
 * - Instant offline JavaScript & HTML/CSS execution
 * - Live multi-language cloud execution via Codapi (Python, C, C++, Java, SQL, Rust, Go, PHP, etc.)
 * - Automatic AI Virtual Compiler + Step-by-Step Tracer + Language Translator
 * - DeepTutor Learner Memory integration & 1-tap "Save to Notes"
 */
import { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  Code2,
  BookOpen,
  Play,
  Trophy,
  Search,
  RefreshCw,
  Sparkles,
  ArrowRightLeft,
  CheckCircle2,
  FilePlus2,
  Lightbulb,
  ExternalLink,
  Terminal,
  Globe,
  Eye,
  BarChart3,
} from 'lucide-react';
import {
  CODING_LANGUAGES,
  CODING_CHALLENGES,
  getLanguageMeta,
  fetchLanguageLessons,
  fetchExercismChallenge,
  searchOnlineDocs,
  getCodingProgress,
  markLessonCompleted,
  markChallengeSolved,
} from '../lib/codingCatalog';
import {
  executeCode,
  traceCodeStepByStep,
  translateCodeBetweenLanguages,
  evaluateChallengeWithAI,
} from '../lib/codeRunner';
import { getLearnerContextDigest, recordLearningSignal } from '../lib/learnerMemory';
import { aiTextStream } from '../lib/aiCore';
import { db, createFolder, createNote, logStudyActivity } from '../store/db';
import AlgoVisualizer from './AlgoVisualizer';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

const CATEGORIES = ['All', 'General', 'Web', 'Systems', 'Data & Shell'];

export default function LearnCodingScreen({ onBack, onOpenNote }) {
  const { toast } = useDialog();
  const [selectedLangId, setSelectedLangId] = useState(null); // null -> Language catalog grid
  const [standaloneVisual, setStandaloneVisual] = useState(false);
  const [category, setCategory] = useState('All');
  const [tab, setTab] = useState('lessons'); // 'lessons' | 'playground' | 'practice' | 'docs' | 'visual'
  const [progress, setProgress] = useState(() => getCodingProgress());

  // Online Lessons state
  const [lessonDoc, setLessonDoc] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState('');
  const [activeChapterIdx, setActiveChapterIdx] = useState(0);
  const [chapterExplain, setChapterExplain] = useState('');
  const [explainBusy, setExplainBusy] = useState(false);

  // Playground state
  const [code, setCode] = useState('');
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiBusyMode, setAiBusyMode] = useState(''); // '' | 'trace' | 'translate'
  const [translateTarget, setTranslateTarget] = useState('python');

  // Practice Challenges state
  const [activeChallengeSlug, setActiveChallengeSlug] = useState('two-fer');
  const [challengeDoc, setChallengeDoc] = useState(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeError, setChallengeError] = useState('');
  const [challengeCode, setChallengeCode] = useState('');
  const [challengeFeedback, setChallengeFeedback] = useState('');
  const [challengeBusy, setChallengeBusy] = useState('');

  // Online Docs state
  const [docQuery, setDocQuery] = useState('');
  const [docResults, setDocResults] = useState([]);
  const [docBusy, setDocBusy] = useState(false);

  const abortRef = useRef(null);
  const lang = selectedLangId ? getLanguageMeta(selectedLangId) : null;

  useEffect(() => () => abortRef.current?.abort(), []);

  // Load language lessons when entering a language
  const loadLessons = async (langId, forceRefresh = false) => {
    setLessonLoading(true);
    setLessonError('');
    setChapterExplain('');
    try {
      const data = await fetchLanguageLessons(langId, { forceRefresh });
      setLessonDoc(data);
      setActiveChapterIdx(0);
      if (forceRefresh) toast('Refreshed live lessons from GitHub', { type: 'success' });
    } catch (err) {
      setLessonError(err.message);
    } finally {
      setLessonLoading(false);
    }
  };

  const openLanguage = langId => {
    const meta = getLanguageMeta(langId);
    setSelectedLangId(langId);
    setTab('lessons');
    setCode(meta.starterCode);
    setChallengeCode(meta.starterCode);
    setRunResult(null);
    setAiAnalysis('');
    setChallengeFeedback('');
    setTranslateTarget(langId === 'python' ? 'javascript' : 'python');
    loadLessons(langId, false);
  };

  // Load Exercism challenge when switching to Practice or changing challenge
  const loadChallenge = async (slug, forceRefresh = false) => {
    setActiveChallengeSlug(slug);
    setChallengeLoading(true);
    setChallengeError('');
    setChallengeFeedback('');
    try {
      const data = await fetchExercismChallenge(slug, { forceRefresh });
      setChallengeDoc(data);
    } catch (err) {
      setChallengeError(err.message);
    } finally {
      setChallengeLoading(false);
    }
  };

  useEffect(() => {
    if (selectedLangId && tab === 'practice' && (!challengeDoc || challengeDoc.slug !== activeChallengeSlug)) {
      loadChallenge(activeChallengeSlug, false);
    }
  }, [selectedLangId, tab]);

  // Save a lesson, code snippet, or challenge into a "Coding" folder inside Notes by Bai
  const handleSaveToNotes = async (noteTitle, noteBody) => {
    try {
      const folders = await db.folders.toArray();
      let target = folders.find(f => !f.isSystemVault && f.name.toLowerCase() === 'coding');
      if (!target) {
        const id = await createFolder('Coding', { mode: 'code', locked: false });
        target = await db.folders.get(id);
      }
      const created = await createNote(target.id, noteTitle, noteBody, lang?.name || 'Coding');
      toast(`Saved "${noteTitle}" to Coding folder`, { type: 'success' });
      onOpenNote?.(created, target);
    } catch (err) {
      toast(`Could not save note: ${err.message}`, { type: 'error' });
    }
  };

  const handleRunPlayground = async (sourceCode = code) => {
    if (!lang || runBusy) return;
    setRunBusy(true);
    setRunResult(null);
    try {
      const res = await executeCode({ langId: lang.id, code: sourceCode, allowAiFallback: true });
      setRunResult(res);
      logStudyActivity('coding', 1).catch(() => {});
    } catch (err) {
      setRunResult({ ok: false, stdout: '', stderr: err.message, durationMs: 0, engine: 'Runner' });
    } finally {
      setRunBusy(false);
    }
  };

  const handleExplainChapter = async chapter => {
    if (!lang || !chapter || explainBusy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExplainBusy(true);
    setChapterExplain('');
    try {
      const memory = await getLearnerContextDigest(lang.name);
      const out = await aiTextStream({
        system: `You are DeepTutor teaching ${lang.name}. Explain this coding lesson clearly in beginner-friendly terms with a real-world analogy, 3 key takeaways, and 1 common mistake to avoid.${memory ? `\n\n${memory}` : ''}`,
        user: `Lesson: ${chapter.title}\n\n${chapter.summary}\n\n\`\`\`${chapter.lang}\n${String(chapter.code || '').slice(0, 3500)}\n\`\`\``,
        maxTokens: 1600,
        timeoutMs: 90000,
        signal: ctrl.signal,
        onToken: partial => setChapterExplain(partial),
      });
      setChapterExplain(out);
    } catch (err) {
      if (!err?.isCancelled) toast(`AI tutor failed: ${err.message}`, { type: 'error' });
    } finally {
      setExplainBusy(false);
    }
  };

  const handleTracePlayground = async () => {
    if (!lang || !code.trim() || aiBusyMode) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiBusyMode('trace');
    setAiAnalysis('');
    try {
      const out = await traceCodeStepByStep({
        langName: lang.name,
        code,
        signal: ctrl.signal,
        onToken: partial => setAiAnalysis(partial),
      });
      setAiAnalysis(out);
    } catch (err) {
      if (!err?.isCancelled) toast(`Trace failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusyMode('');
    }
  };

  const handleTranslatePlayground = async () => {
    if (!lang || !code.trim() || aiBusyMode) return;
    const toMeta = getLanguageMeta(translateTarget);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiBusyMode('translate');
    setAiAnalysis('');
    try {
      const out = await translateCodeBetweenLanguages({
        code,
        fromLang: lang.name,
        toLang: toMeta.name,
        signal: ctrl.signal,
        onToken: partial => setAiAnalysis(partial),
      });
      setAiAnalysis(out);
    } catch (err) {
      if (!err?.isCancelled) toast(`Translate failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusyMode('');
    }
  };

  const handleChallengeAI = async action => {
    if (!lang || !challengeDoc || challengeBusy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setChallengeBusy(action);
    setChallengeFeedback('');
    try {
      const memory = await getLearnerContextDigest(lang.name);
      const out = await evaluateChallengeWithAI({
        challengeTitle: challengeDoc.title,
        description: challengeDoc.description,
        langName: lang.name,
        code: challengeCode,
        action,
        learnerContext: memory,
        signal: ctrl.signal,
        onToken: partial => setChallengeFeedback(partial),
      });
      setChallengeFeedback(out);
      if (action === 'check') {
        const passed = /\bPASS\b/i.test(out) && !/\bNEEDS FIX\b/i.test(out);
        await recordLearningSignal({
          subject: lang.name,
          topic: `${challengeDoc.title} (${challengeDoc.topic})`,
          correct: passed,
          mistakeSummary: passed ? '' : `Needs fix on ${challengeDoc.title} in ${lang.name}`,
          source: 'coding',
          noteMode: 'code',
        });
        if (passed) {
          setProgress(markChallengeSolved(lang.id, challengeDoc.slug));
          toast(`Challenge passed! Recorded in DeepTutor Memory`, { type: 'success' });
        }
      }
    } catch (err) {
      if (!err?.isCancelled) toast(`Challenge check failed: ${err.message}`, { type: 'error' });
    } finally {
      setChallengeBusy('');
    }
  };

  const handleDocsSearch = async e => {
    e?.preventDefault?.();
    if (!docQuery.trim() || docBusy) return;
    setDocBusy(true);
    try {
      const res = await searchOnlineDocs(docQuery, lang?.name || '');
      setDocResults(res);
      if (res.length === 0) toast('No matching docs found — try a shorter keyword');
    } catch (err) {
      toast(`Docs search failed: ${err.message}`, { type: 'error' });
    } finally {
      setDocBusy(false);
    }
  };

  if (standaloneVisual) {
    return (
      <div className="screen list-pad-bottom">
        <header className="navbar">
          <button
            type="button"
            className="navbar-btn navbar-back"
            onClick={() => setStandaloneVisual(false)}
          >
            <ChevronLeft size={20} /> Languages
          </button>
          <span className="navbar-title">Algorithm Visualizer</span>
          <span style={{ width: 64 }} />
        </header>
        <div className="large-title">Algorithm Visualizer</div>
        <div className="coding-panel">
          <AlgoVisualizer />
        </div>
      </div>
    );
  }

  // ---------- Language Catalog Home ----------
  if (!selectedLangId) {
    const visibleLangs =
      category === 'All'
        ? CODING_LANGUAGES
        : CODING_LANGUAGES.filter(l => l.category === category);

    return (
      <div className="screen list-pad-bottom">
        <header className="navbar">
          <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
            <ChevronLeft size={20} /> Folders
          </button>
          <span className="navbar-title">Learn Coding</span>
          <span style={{ width: 64 }} />
        </header>

        <div className="large-title">Learn Coding</div>
        <div
          style={{
            margin: '0 var(--gutter) 12px',
            fontSize: '0.84rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
          }}
        >
          Live open-source lessons, Exercism practice challenges &amp; real multi-language code execution right inside <strong>Notes by Bai</strong>. Opened lessons cache locally for offline review.
        </div>

        {/* 1-Tap Offline Algorithm & Data Structure Visualizer Banner */}
        <div className="list-group" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="list-item"
            onClick={() => setStandaloneVisual(true)}
          >
            <span className="list-item-icon">
              <BarChart3 size={17} />
            </span>
            <div className="list-item-body">
              <div className="list-item-title">
                <span>Algorithm &amp; DS Visualizer</span>
                <span className="mode-badge mode-study">Offline</span>
              </div>
              <div className="list-item-subtitle">
                Animated Sorting, Binary Search, BFS/DFS/Dijkstra &amp; Call Stack
              </div>
            </div>
            <ChevronLeft size={16} style={{ transform: 'rotate(180deg)', opacity: 0.45 }} />
          </button>
        </div>

        <div className="coding-cat-row">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              className={`mode-pick-chip${category === c ? ' active' : ''}`}
              style={{ flex: 'none', padding: '6px 12px', fontSize: 12.5 }}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="coding-lang-grid">
          {visibleLangs.map(item => {
            const p = progress[item.id] || { lessons: [], solved: [] };
            return (
              <button
                key={item.id}
                type="button"
                className="coding-lang-card"
                onClick={() => openLanguage(item.id)}
              >
                <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
                  <span className="coding-lang-name">{item.name}</span>
                  <span className="provider-badge">{item.badge}</span>
                </div>
                <div className="coding-lang-desc">{item.description}</div>
                <div className="coding-lang-meta">
                  <span>{p.lessons.length} lessons read</span>
                  <span>·</span>
                  <span>{p.solved.length} solved</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Active Language Workspace ----------
  const chapters = lessonDoc?.chapters || [];
  const activeChapter = chapters[activeChapterIdx] || null;
  const langProg = progress[lang.id] || { lessons: [], solved: [] };

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={() => setSelectedLangId(null)}
        >
          <ChevronLeft size={20} /> Languages
        </button>
        <span className="navbar-title">{lang.name}</span>
        <button
          type="button"
          className="navbar-btn"
          title="Refresh lessons live from online source"
          onClick={() => loadLessons(lang.id, true)}
        >
          <RefreshCw size={17} className={lessonLoading ? 'spin' : ''} />
        </button>
      </header>

      {/* Studio Mode Tabs */}
      <div className="coding-tabs">
        {[
          ['lessons', 'Lessons', BookOpen],
          ['playground', 'Playground', Terminal],
          ['practice', 'Practice', Trophy],
          ['docs', 'Docs', Globe],
          ['visual', 'Visual', BarChart3],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={`coding-tab-btn${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: LIVE ONLINE LESSONS */}
      {tab === 'lessons' && (
        <div className="coding-panel">
          {lessonLoading && (
            <div className="scan-indicator">
              <span className="spinner" /> Fetching {lang.name} guide from Learn X in Y Minutes…
            </div>
          )}

          {lessonError && (
            <div className="inline-mistake" style={{ marginBottom: 12 }}>
              <div>{lessonError}</div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadLessons(lang.id, true)}
                >
                  <RefreshCw size={13} /> Retry Online Fetch
                </button>
              </div>
            </div>
          )}

          {chapters.length > 0 && (
            <>
              <div className="coding-chapter-strip">
                {chapters.map((ch, idx) => {
                  const done = langProg.lessons.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      className={`coding-chapter-pill${idx === activeChapterIdx ? ' active' : ''}${done ? ' done' : ''}`}
                      onClick={() => {
                        setActiveChapterIdx(idx);
                        setChapterExplain('');
                      }}
                    >
                      {done && <CheckCircle2 size={12} />}
                      <span>
                        {idx + 1}. {ch.title}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeChapter && (
                <div className="list-group settings-group" style={{ margin: '10px 0' }}>
                  <div className="flex justify-between items-center gap-6" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{activeChapter.title}</div>
                    <span className="provider-badge">
                      {activeChapterIdx + 1}/{chapters.length}
                    </span>
                  </div>

                  {activeChapter.summary && (
                    <div
                      style={{
                        fontSize: 13.5,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        marginBottom: 10,
                      }}
                    >
                      {activeChapter.summary}
                    </div>
                  )}

                  {activeChapter.code && (
                    <div className="code-card" style={{ marginTop: 6 }}>
                      <div className="code-card-head">
                        <span className="code-card-lang">{activeChapter.lang || lang.name}</span>
                        <button
                          type="button"
                          className="code-card-btn"
                          onClick={() => {
                            setCode(activeChapter.code);
                            setRunResult(null);
                            setTab('playground');
                            toast('Loaded snippet into Playground');
                          }}
                        >
                          <Play size={12} /> Try in Playground
                        </button>
                      </div>
                      <pre className="code-card-pre">
                        <code>{activeChapter.code}</code>
                      </pre>
                    </div>
                  )}

                  <div className="flex gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={explainBusy}
                      onClick={() => handleExplainChapter(activeChapter)}
                    >
                      <Sparkles size={14} /> {explainBusy ? 'Explaining…' : 'Explain Simply (AI)'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        setProgress(markLessonCompleted(lang.id, activeChapter.id));
                        await recordLearningSignal({
                          subject: lang.name,
                          topic: activeChapter.title,
                          correct: true,
                          source: 'coding',
                          noteMode: 'code',
                        });
                        toast('Lesson marked complete!', { type: 'success' });
                      }}
                    >
                      <CheckCircle2 size={14} />{' '}
                      {langProg.lessons.includes(activeChapter.id) ? 'Completed' : 'Mark Complete'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        handleSaveToNotes(
                          `${lang.name}: ${activeChapter.title}`,
                          `${activeChapter.summary}\n\n\`\`\`${activeChapter.lang || lang.highlightLang}\n${activeChapter.code || ''}\n\`\`\`${chapterExplain ? `\n\n## AI Tutor Breakdown\n${chapterExplain}` : ''}`
                        )
                      }
                    >
                      <FilePlus2 size={14} /> Save to Notes
                    </button>
                  </div>

                  {chapterExplain && (
                    <div className="coding-ai-box mt-12">
                      <MarkdownContent text={chapterExplain} />
                    </div>
                  )}

                  <div className="flex justify-between mt-16">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={activeChapterIdx === 0}
                      onClick={() => {
                        setActiveChapterIdx(i => Math.max(0, i - 1));
                        setChapterExplain('');
                      }}
                    >
                      ← Previous
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={activeChapterIdx >= chapters.length - 1}
                      onClick={() => {
                        setActiveChapterIdx(i => Math.min(chapters.length - 1, i + 1));
                        setChapterExplain('');
                      }}
                    >
                      Next Chapter →
                    </button>
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8 }}>
                    Source: {lessonDoc?.sourceLabel || 'Learn X in Y Minutes (CC BY-SA)'} · Cached locally for offline study
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: LIVE PLAYGROUND & MULTI-LANGUAGE RUNNER */}
      {tab === 'playground' && (
        <div className="coding-panel">
          <div className="list-group settings-group" style={{ margin: '6px 0 12px' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                <Code2 size={15} style={{ verticalAlign: -2, marginRight: 5 }} />
                {lang.name} Playground
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setCode(lang.starterCode);
                  setRunResult(null);
                  setAiAnalysis('');
                }}
              >
                Reset Starter
              </button>
            </div>

            <textarea
              className="coding-editor-area"
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck="false"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={`${lang.name} code editor`}
            />

            <div className="flex gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={runBusy}
                onClick={() => handleRunPlayground(code)}
              >
                <Play size={14} /> {runBusy ? 'Running…' : 'Run Live'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(aiBusyMode)}
                onClick={handleTracePlayground}
              >
                <Sparkles size={14} /> {aiBusyMode === 'trace' ? 'Tracing…' : 'Trace Step-by-Step'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  handleSaveToNotes(
                    `${lang.name} Playground Snippet`,
                    `\`\`\`${lang.highlightLang}\n${code}\n\`\`\`${runResult?.stdout ? `\n\n## Output\n\`\`\`\n${runResult.stdout}\n\`\`\`` : ''}`
                  )
                }
              >
                <FilePlus2 size={14} /> Save to Notes
              </button>
            </div>

            {/* Translate to another language row */}
            <div className="flex items-center gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Translate to:</span>
              <select
                className="dictation-lang"
                value={translateTarget}
                onChange={e => setTranslateTarget(e.target.value)}
                aria-label="Target programming language"
              >
                {CODING_LANGUAGES.filter(l => l.id !== lang.id).map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(aiBusyMode)}
                onClick={handleTranslatePlayground}
              >
                <ArrowRightLeft size={13} />{' '}
                {aiBusyMode === 'translate' ? 'Translating…' : 'Convert & Compare'}
              </button>
            </div>
          </div>

          {/* Output Console or Live HTML Preview */}
          {runResult && (
            <div className="list-group settings-group" style={{ margin: '0 0 12px' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {runResult.mode === 'preview' ? (
                    <>
                      <Eye size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> Live Preview
                    </>
                  ) : (
                    <>
                      <Terminal size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> Output
                    </>
                  )}
                </span>
                <span className="provider-badge">
                  {runResult.engine} · {runResult.durationMs}ms
                </span>
              </div>

              {runResult.notice && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {runResult.notice}
                </div>
              )}

              {runResult.mode === 'preview' ? (
                <iframe
                  title="Live HTML Preview"
                  sandbox="allow-scripts"
                  srcDoc={runResult.html}
                  className="coding-html-preview"
                />
              ) : (
                <>
                  {runResult.stdout && (
                    <pre className="coding-console-out">{runResult.stdout}</pre>
                  )}
                  {runResult.stderr && (
                    <pre className="coding-console-err">{runResult.stderr}</pre>
                  )}
                </>
              )}
            </div>
          )}

          {aiAnalysis && (
            <div className="list-group settings-group" style={{ margin: '0 0 12px' }}>
              <div className="settings-label">AI Step-by-Step Analysis</div>
              <MarkdownContent text={aiAnalysis} />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LIVE EXERCISM OPEN-SOURCE PRACTICE CHALLENGES */}
      {tab === 'practice' && (
        <div className="coding-panel">
          <div className="coding-chapter-strip" style={{ marginBottom: 10 }}>
            {CODING_CHALLENGES.map(ch => {
              const solved = langProg.solved.includes(ch.slug);
              return (
                <button
                  key={ch.slug}
                  type="button"
                  className={`coding-chapter-pill${activeChallengeSlug === ch.slug ? ' active' : ''}${solved ? ' done' : ''}`}
                  onClick={() => loadChallenge(ch.slug, false)}
                >
                  {solved && <CheckCircle2 size={12} />}
                  <span>
                    {ch.title} · {ch.difficulty}
                  </span>
                </button>
              );
            })}
          </div>

          {challengeLoading && (
            <div className="scan-indicator">
              <span className="spinner" /> Fetching challenge from Exercism…
            </div>
          )}

          {challengeError && <div className="inline-mistake">{challengeError}</div>}

          {challengeDoc && (
            <div className="list-group settings-group" style={{ margin: '0 0 12px' }}>
              <div className="flex justify-between items-center gap-6" style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{challengeDoc.title}</div>
                <span className="provider-badge">
                  {challengeDoc.difficulty} · {challengeDoc.topic}
                </span>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
                <MarkdownContent text={challengeDoc.description} />
              </div>

              <div className="settings-label">Your {lang.name} Solution</div>
              <textarea
                className="coding-editor-area"
                value={challengeCode}
                onChange={e => setChallengeCode(e.target.value)}
                spellCheck="false"
                aria-label="Challenge solution editor"
              />

              <div className="flex gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={Boolean(challengeBusy)}
                  onClick={() => handleChallengeAI('check')}
                >
                  <CheckCircle2 size={14} />{' '}
                  {challengeBusy === 'check' ? 'Checking…' : 'Check Solution (DeepTutor)'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={runBusy}
                  onClick={() => handleRunPlayground(challengeCode)}
                >
                  <Play size={14} /> Run Live
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={Boolean(challengeBusy)}
                  onClick={() => handleChallengeAI('hint')}
                >
                  <Lightbulb size={14} /> {challengeBusy === 'hint' ? 'Thinking…' : 'Socratic Hint'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={Boolean(challengeBusy)}
                  onClick={() => handleChallengeAI('solution')}
                >
                  Walkthrough
                </button>
              </div>

              {runResult && (
                <div style={{ marginTop: 10 }}>
                  {runResult.stdout && <pre className="coding-console-out">{runResult.stdout}</pre>}
                  {runResult.stderr && <pre className="coding-console-err">{runResult.stderr}</pre>}
                </div>
              )}

              {challengeFeedback && (
                <div className="coding-ai-box mt-12">
                  <MarkdownContent text={challengeFeedback} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE ONLINE DOCS SEARCH (MDN + WIKIPEDIA CS) */}
      {tab === 'docs' && (
        <div className="coding-panel">
          <form className="flex gap-8" style={{ marginBottom: 12 }} onSubmit={handleDocsSearch}>
            <input
              type="text"
              className="ai-input flex-1"
              value={docQuery}
              onChange={e => setDocQuery(e.target.value)}
              placeholder={`Search ${lang.name} docs (e.g. map, pointers, JOIN, async)…`}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={docBusy}>
              <Search size={15} /> {docBusy ? 'Searching…' : 'Search'}
            </button>
          </form>

          {docResults.length === 0 ? (
            <div className="list-group settings-group" style={{ margin: 0 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Searches live open documentation from <strong>Stack Overflow</strong> and <strong>Wikipedia CS</strong> right inside Notes by Bai.
              </div>
            </div>
          ) : (
            <div className="list-group" style={{ margin: 0 }}>
              {docResults.map((item, idx) => (
                <div key={`${item.url}-${idx}`} className="list-item list-item-static" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <div className="flex justify-between items-center w-full gap-6">
                    <strong style={{ fontSize: 14.5 }}>{item.title}</strong>
                    <span className="provider-badge">{item.source}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {item.summary}
                  </div>
                  <div className="flex gap-8">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                    >
                      <ExternalLink size={13} /> Open Source
                    </a>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        handleSaveToNotes(
                          `${item.title} (${lang.name} Docs)`,
                          `## ${item.title}\n\n${item.summary}\n\nSource: [${item.source}](${item.url})`
                        )
                      }
                    >
                      <FilePlus2 size={13} /> Save to Notes
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: OFFLINE ALGORITHM & DATA STRUCTURE VISUALIZER */}
      {tab === 'visual' && (
        <div className="coding-panel">
          <AlgoVisualizer />
        </div>
      )}
    </div>
  );
}
