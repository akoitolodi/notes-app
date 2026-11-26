/**
 * OnboardingGuideModal — Lazy-loaded New-User Guided Setup Wizard + Standalone Visual Feature Guide.
 * Covers: Visual Feature Tour -> Easy Free AI API Setup -> Class Schedule PDF Import -> Starter Notes -> Ready Checklist.
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sparkles,
  Calendar,
  Megaphone,
  FileText,
  GraduationCap,
  Lock,
  KeyRound,
  ExternalLink,
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  FolderPlus,
  Compass,
  Zap,
} from 'lucide-react';
import {
  PROVIDERS,
  MODE_KEY,
  PROVIDER_KEY,
  BASEURL_KEY,
  MODEL_KEY,
  REASON_KEY,
  setKeyForProvider,
  getKeyForProvider,
} from '../lib/aiConfig';
import { createAbortController } from '../lib/aiCore';
import { THEME_KEY, THEME_PRESET_KEY, getSettings, applySettings } from '../theme';
import {
  markOnboardingDone,
  createStarterContent,
} from '../lib/onboarding';
import { db, createFolder } from '../store/db';
import { useDialog } from './ui/DialogProvider';

const SchedulePdfImportSheet = lazy(() => import('./course/SchedulePdfImportSheet'));

const FEATURE_CARDS = [
  {
    id: 'smart-notes',
    badge: 'Smart Blank Notes',
    title: 'Math, Code & Flashcards While You Type',
    desc: 'Write equations like 2x + 5 = 17, paste JS/Python code, or type Term: Definition lines — Notes by Bai solves and runs them offline, and explains any line on tap.',
    icon: Sparkles,
    tone: '#6366f1',
    tryLabel: 'Create Starter Note',
    tryAction: 'starter-note',
    previewLines: ['2x + 5 = 17   ->   x = 6', 'console.log(38/50) -> 0.76', 'Tap any line -> Explain'],
  },
  {
    id: 'schedule',
    badge: 'PDF Schedule & Timetable',
    title: 'Turn Your COR / Class Schedule PDF into Courses',
    desc: 'Upload your school Class Schedule PDF once to build your weekly 30-min Timetable Grid, Up Next bar, Subject folders, and persistent 10-min class reminders.',
    icon: Calendar,
    tone: '#0ea5e9',
    tryLabel: 'Open Timetable & Courses',
    tryAction: 'schedule',
    previewLines: ['IPT 101A · TTh 4:30-5:30 PM', 'IT 3 · Lab 503C · 8 Courses', 'Next Class in 10m alert'],
  },
  {
    id: 'announcements',
    badge: 'Smart Announcements',
    title: 'Auto-Matched Class Times, Quick Links & Reply',
    desc: 'Connect Canvas RSS feeds or paste announcements — each post secretly links only to its matching course time, highlights Google Meet/Chat pills, and lets you reply.',
    icon: Megaphone,
    tone: '#f59e0b',
    tryLabel: 'Open Announcements',
    tryAction: 'announcements',
    previewLines: ['IPT 101A · Thu 4:30 PM · IT 3', '[Open Google Meet] [Reply]', 'Save Teacher in 1 tap'],
  },
  {
    id: 'viewer',
    badge: 'Modern Document Viewer',
    title: 'Read PDF, DOCX, PPT & PPTX Slides Offline',
    desc: 'Open lecture slides and handouts right inside Notes by Bai with swipe/zoom pages, Day/Sepia/Night themes, or jump out to any external viewer.',
    icon: FileText,
    tone: '#10b981',
    tryLabel: 'Import a Document',
    tryAction: 'home',
    previewLines: ['Slide 4 / 24 · Day / Night', 'Zoom & Pan PDF Pages', '100% Offline Storage'],
  },
  {
    id: 'scores',
    badge: 'Quiz Pass Checker & Study',
    title: 'Know Instantly If You Passed + Practice Exams',
    desc: 'Enter Your Score / Total Items in Scores & Map with custom 50-80% passing thresholds and Raw / Base-50 / Base-60 grading, plus spaced-repetition flashcards.',
    icon: GraduationCap,
    tone: '#a855f7',
    tryLabel: 'Open Quiz Calculator',
    tryAction: 'scores',
    previewLines: ['36 / 50 (Base-50) = 86% PASSED', 'Min to pass: 25 / 50', 'Flip Cards & Practice Exam'],
  },
  {
    id: 'vault',
    badge: 'Zero-AI Hidden Vault',
    title: 'PIN-Locked Folders That AI Never Reads',
    desc: 'Keep Passwords & Keys or private folders hidden behind your PIN. Zero-AI mode completely blocks AI APIs, Cloud Sync, and Smart Detectors on locked folders.',
    icon: Lock,
    tone: '#64748b',
    tryLabel: 'Open Folders Home',
    tryAction: 'home',
    previewLines: ['Passwords & Keys · Locked', 'Zero-AI Isolation Active', 'Auto-locks in background'],
  },
];

const QUICK_AI_CHOICES = [
  'groq',
  'gemini',
  'openrouter',
  'cerebras',
  'deepseek',
  'sambanova',
  'github',
  'mistral',
];

export default function OnboardingGuideModal({
  initialView = 'wizard', // 'wizard' | 'guide'
  onCompleted,
  onNavigate,
  onOpenNote,
  onClose,
}) {
  const { toast } = useDialog();
  const [viewMode, setViewMode] = useState(initialView); // 'wizard' | 'guide'
  const [step, setStep] = useState(0); // 0..4
  const [tourIdx, setTourIdx] = useState(0);
  const [themeVal, setThemeVal] = useState(() => getSettings().theme || 'auto');

  // Step 2: Easy AI API setup
  const [aiProvider, setAiProvider] = useState('groq');
  const [aiKey, setAiKey] = useState(() => getKeyForProvider('groq'));
  const [testingKey, setTestingKey] = useState(false);
  const [aiVerified, setAiVerified] = useState(() => Boolean(getKeyForProvider('groq')));
  const [aiStatusMsg, setAiStatusMsg] = useState('');

  // Step 3: Easy Schedule setup
  const [scheduleImportOpen, setScheduleImportOpen] = useState(false);
  const [importedCoursesCount, setImportedCoursesCount] = useState(0);
  const [quickSubjectName, setQuickSubjectName] = useState('');
  const [addedSubjects, setAddedSubjects] = useState([]);

  // Step 4: Starter notes & folders
  const [wantStarterNote, setWantStarterNote] = useState(true);
  const [selectedExtraFolders, setSelectedExtraFolders] = useState(['Assignments']);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && !scheduleImportOpen) {
        handleSkipOrClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleImportOpen]);

  const handleThemePick = nextTheme => {
    setThemeVal(nextTheme);
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
      localStorage.setItem(THEME_PRESET_KEY, 'default');
    } catch {
      // ignore
    }
    applySettings();
  };

  const handleSelectProvider = pid => {
    setAiProvider(pid);
    const saved = getKeyForProvider(pid);
    setAiKey(saved);
    setAiVerified(Boolean(saved));
    setAiStatusMsg('');
  };

  const persistProviderSelection = (pid, keyVal) => {
    const preset = PROVIDERS[pid] || PROVIDERS.groq;
    try {
      localStorage.setItem(MODE_KEY, 'direct');
      localStorage.setItem(PROVIDER_KEY, pid);
      localStorage.setItem(BASEURL_KEY, preset.baseUrl);
      localStorage.setItem(MODEL_KEY, preset.defaultModel);
      localStorage.setItem(REASON_KEY, preset.reasonModel || preset.defaultModel || '');
    } catch {
      // ignore
    }
    setKeyForProvider(pid, keyVal.trim());
  };

  const handleTestAndSaveKey = async () => {
    const trimmed = aiKey.trim();
    if (!trimmed) {
      toast('Paste an API key first, or tap Use Offline Only', { type: 'error' });
      return;
    }
    const preset = PROVIDERS[aiProvider] || PROVIDERS.groq;
    setTestingKey(true);
    setAiStatusMsg('');
    const ctrl = createAbortController(12000);
    try {
      const res = await fetch(`${preset.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${trimmed}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: preset.defaultModel,
          messages: [{ role: 'user', content: 'Reply OK' }],
          max_tokens: 6,
          temperature: 0,
        }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        persistProviderSelection(aiProvider, trimmed);
        setAiVerified(true);
        setAiStatusMsg(`Connected to ${preset.name} (${preset.defaultModel})!`);
        toast(`${preset.name} connected & saved!`, { type: 'success' });
      } else {
        const body = await res.text().catch(() => '');
        setAiVerified(false);
        setAiStatusMsg(`Error ${res.status}: ${body.slice(0, 80) || 'Invalid or unauthorized key'}`);
      }
    } catch (err) {
      setAiVerified(false);
      setAiStatusMsg(`Connection failed: ${err?.message || 'Network unavailable'}`);
    } finally {
      ctrl.cleanup();
      setTestingKey(false);
    }
  };

  const handleAddQuickSubject = async name => {
    const clean = String(name || '').trim();
    if (!clean || addedSubjects.includes(clean)) return;
    await db.courses.add({
      code: clean.slice(0, 16),
      name: clean,
      nickname: '',
      section: '',
      icsCourseTag: clean,
      instructor: '',
      color: '#6366f1',
      folderId: null,
      rssUrl: '',
      units: 3,
      archived: false,
      createdAt: Date.now(),
    });
    await createFolder(clean.slice(0, 32), { mode: 'study', locked: false }).catch(() => {});
    setAddedSubjects(prev => [...prev, clean]);
    setQuickSubjectName('');
    toast(`Added "${clean}" subject & folder!`, { type: 'success' });
  };

  const handleSkipOrClose = () => {
    markOnboardingDone();
    onClose?.();
  };

  const handleFinishWizard = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      if (aiKey.trim()) {
        persistProviderSelection(aiProvider, aiKey.trim());
      }
      const { welcomeNote, welcomeFolder } = await createStarterContent({
        createWelcomeNote: wantStarterNote,
        extraFolders: selectedExtraFolders,
      });
      markOnboardingDone();
      toast('Welcome to Notes by Bai — you are all set!', { type: 'success' });
      onCompleted?.({ welcomeNote, welcomeFolder });
    } catch {
      markOnboardingDone();
      onCompleted?.({});
    } finally {
      setFinishing(false);
    }
  };

  const handleTryFeature = async card => {
    markOnboardingDone();
    if (card.tryAction === 'starter-note') {
      const { welcomeNote, welcomeFolder } = await createStarterContent({
        createWelcomeNote: true,
        extraFolders: [],
      });
      onClose?.();
      if (welcomeNote && onOpenNote) {
        onOpenNote(welcomeNote, welcomeFolder || { id: '__all__', name: 'All Notes' });
      }
      return;
    }
    onClose?.();
    onNavigate?.(card.tryAction);
  };

  const activeFeature = FEATURE_CARDS[tourIdx] || FEATURE_CARDS[0];
  const ActiveIcon = activeFeature.icon;
  const preset = PROVIDERS[aiProvider] || PROVIDERS.groq;

  const modal = (
    <div className="export-overlay" onClick={handleSkipOrClose}>
      <div
        className="export-sheet onboarding-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={viewMode === 'guide' ? 'Visual Feature Guide' : 'Welcome & Setup Wizard'}
      >
        {/* Top Bar */}
        <div className="flex justify-between items-center gap-8" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-8">
            <span
              className="bento-tile-icon"
              style={{ width: 30, height: 30, background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
            >
              <Compass size={16} />
            </span>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
                {viewMode === 'guide' ? 'Visual Feature Guide' : 'Notes by Bai Setup'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {viewMode === 'guide'
                  ? 'Explore what you can do — tap any card to try it'
                  : `Step ${step + 1} of 5 · Fast offline-first school companion`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              className="row-action-chip"
              onClick={() => setViewMode(m => (m === 'wizard' ? 'guide' : 'wizard'))}
            >
              {viewMode === 'guide' ? 'Setup Wizard' : 'All Features'}
            </button>
            <button type="button" className="icon-btn" onClick={handleSkipOrClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ============ MODE A: STANDALONE VISUAL FEATURE GUIDE ============ */}
        {viewMode === 'guide' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="onboard-guide-list">
              {FEATURE_CARDS.map(card => {
                const Icon = card.icon;
                return (
                  <div key={card.id} className="onboard-guide-card">
                    <div className="flex items-start gap-10">
                      <span
                        className="onboard-card-icon"
                        style={{ background: `${card.tone}22`, color: card.tone }}
                      >
                        <Icon size={18} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="onboard-card-eyebrow">{card.badge}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                          {card.title}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px', lineHeight: 1.45 }}>
                          {card.desc}
                        </p>
                        <div className="onboard-mini-preview">
                          {card.previewLines.map((line, i) => (
                            <span key={i} className="onboard-mini-chip">
                              {line}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="row-action-chip active-chip"
                        onClick={() => handleTryFeature(card)}
                      >
                        <Zap size={11} /> {card.tryLabel}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="btn btn-primary" onClick={handleSkipOrClose}>
              Done Exploring
            </button>
          </div>
        ) : (
          /* ============ MODE B: 5-STEP GUIDED SETUP WIZARD ============ */
          <div>
            {/* Progress Dots */}
            <div className="onboard-dots" role="tablist" aria-label="Setup steps">
              {['Tour', 'AI Key', 'Schedule', 'Notes', 'Ready'].map((lbl, idx) => (
                <button
                  key={lbl}
                  type="button"
                  className={`onboard-dot-pill${step === idx ? ' active' : ''}${idx < step ? ' done' : ''}`}
                  onClick={() => setStep(idx)}
                >
                  {idx < step ? <Check size={10} /> : idx + 1}. {lbl}
                </button>
              ))}
            </div>

            {/* STEP 0: WELCOME + VISUAL FEATURE TOUR + THEME PICKER */}
            {step === 0 && (
              <div className="onboard-step-body">
                <div className="onboard-hero-card">
                  <div className="flex items-center justify-between gap-8">
                    <div className="flex items-center gap-8">
                      <span
                        className="onboard-card-icon"
                        style={{ background: `${activeFeature.tone}22`, color: activeFeature.tone }}
                      >
                        <ActiveIcon size={19} />
                      </span>
                      <div>
                        <div className="onboard-card-eyebrow">{activeFeature.badge}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                          {activeFeature.title}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Previous feature"
                        onClick={() => setTourIdx(i => (i - 1 + FEATURE_CARDS.length) % FEATURE_CARDS.length)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Next feature"
                        onClick={() => setTourIdx(i => (i + 1) % FEATURE_CARDS.length)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '8px 0', lineHeight: 1.48 }}>
                    {activeFeature.desc}
                  </p>
                  <div className="onboard-mini-preview">
                    {activeFeature.previewLines.map((ln, idx) => (
                      <span key={idx} className="onboard-mini-chip">
                        {ln}
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-center gap-6" style={{ marginTop: 10 }}>
                    {FEATURE_CARDS.map((fc, idx) => (
                      <button
                        key={fc.id}
                        type="button"
                        aria-label={fc.badge}
                        className={`onboard-tour-dot${tourIdx === idx ? ' active' : ''}`}
                        onClick={() => setTourIdx(idx)}
                      />
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="settings-label" style={{ marginBottom: 6 }}>
                    Pick Your Look (Studio Fast Mode)
                  </div>
                  <div className="view-switcher view-switcher-inline" style={{ margin: 0 }}>
                    {[
                      ['auto', 'Auto'],
                      ['light', 'Light'],
                      ['dark', 'Dark'],
                      ['oled', 'OLED'],
                    ].map(([id, lbl]) => (
                      <button
                        key={id}
                        type="button"
                        className={`view-switch-btn${themeVal === id ? ' active' : ''}`}
                        onClick={() => handleThemePick(id)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 1: EASY FREE AI API SETUP */}
            {step === 1 && (
              <div className="onboard-step-body">
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  Optional Free AI Study Tutor Setup
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
                  Notes, Math solver, JS runner, PDF/PPTX viewer, and Quizzes already work <strong>100% offline</strong>. Add a free API key below for AI explanations, OCR, and exam builders:
                </p>

                <div className="onboard-ai-cards">
                  {[
                    { id: 'groq', title: 'Groq', sub: 'Fastest · Free Tier (Recommended)' },
                    { id: 'gemini', title: 'Google Gemini', sub: 'Great for OCR & Study Packs · Free' },
                  ].map(card => (
                    <button
                      key={card.id}
                      type="button"
                      className={`onboard-ai-pick${aiProvider === card.id ? ' active' : ''}`}
                      onClick={() => handleSelectProvider(card.id)}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>
                        {card.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {card.sub}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-8" style={{ marginTop: 8 }}>
                  <select
                    className="input-field"
                    style={{ fontSize: 12.5, flex: 1 }}
                    value={aiProvider}
                    aria-label="Other AI provider"
                    onChange={e => handleSelectProvider(e.target.value)}
                  >
                    {QUICK_AI_CHOICES.map(pid => (
                      <option key={pid} value={pid}>
                        {PROVIDERS[pid].name} ({PROVIDERS[pid].badge})
                      </option>
                    ))}
                  </select>
                  {preset.keyUrl && (
                    <a
                      href={preset.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                      style={{ textDecoration: 'none', flexShrink: 0 }}
                    >
                      <ExternalLink size={12} /> Get Free Key
                    </a>
                  )}
                </div>

                <div className="flex gap-8" style={{ marginTop: 8 }}>
                  <input
                    type="password"
                    className="input-field"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder={`Paste your ${preset.name} API key…`}
                    value={aiKey}
                    onChange={e => {
                      setAiKey(e.target.value);
                      setAiVerified(false);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={testingKey || !aiKey.trim()}
                    onClick={handleTestAndSaveKey}
                  >
                    <KeyRound size={13} /> {testingKey ? 'Testing…' : 'Test & Save'}
                  </button>
                </div>

                {aiStatusMsg && (
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 8,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: aiVerified ? 'var(--ok-bg)' : 'var(--fill)',
                      color: aiVerified ? 'var(--ok)' : 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    {aiStatusMsg}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: EASY CLASS SCHEDULE SETUP */}
            {step === 2 && (
              <div className="onboard-step-body">
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  Import Your Class Schedule in Seconds
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
                  Upload your university COR / Class Schedule PDF to build all course cards, your visual timetable, Up Next bar, and subject folders automatically:
                </p>

                <button
                  type="button"
                  className="import-dropzone"
                  onClick={() => setScheduleImportOpen(true)}
                >
                  <span className="import-dropzone-icon">
                    <FileUp size={20} />
                  </span>
                  <div className="import-dropzone-title">
                    {importedCoursesCount > 0
                      ? `Imported ${importedCoursesCount} Courses — Tap to Re-Import`
                      : 'Upload Class Schedule / COR PDF'}
                  </div>
                  <div className="import-dropzone-sub">
                    Reads subjects, teachers, rooms &amp; times 100% offline
                  </div>
                </button>

                <div style={{ marginTop: 12 }}>
                  <div className="settings-help" style={{ margin: '0 0 6px' }}>
                    Or quickly add a subject manually:
                  </div>
                  <div className="flex gap-8">
                    <input
                      className="input-field"
                      style={{ flex: 1, fontSize: 12.5 }}
                      placeholder="e.g. IPT 101A or Calculus"
                      value={quickSubjectName}
                      onChange={e => setQuickSubjectName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddQuickSubject(quickSubjectName);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!quickSubjectName.trim()}
                      onClick={() => handleAddQuickSubject(quickSubjectName)}
                    >
                      + Add
                    </button>
                  </div>
                  {addedSubjects.length > 0 && (
                    <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                      {addedSubjects.map(s => (
                        <span key={s} className="sched-slot-chip">
                          ✓ {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 3: STARTER NOTES & FOLDERS */}
            {step === 3 && (
              <div className="onboard-step-body">
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  Starter Notes &amp; Subject Folders
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
                  Want an interactive starter note to test the live Math solver, runnable JS block, and offline Flashcards right away?
                </p>

                <label className="onboard-check-card">
                  <input
                    type="checkbox"
                    checked={wantStarterNote}
                    onChange={e => setWantStarterNote(e.target.checked)}
                  />
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                      Create &ldquo;Welcome &amp; Interactive Quick-Start&rdquo; Note
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Pre-filled with live equation solver, runnable code &amp; flashcard demo
                    </div>
                  </div>
                </label>

                <div style={{ marginTop: 12 }}>
                  <div className="settings-help" style={{ margin: '0 0 6px' }}>
                    Optional extra folders to create in your workspace:
                  </div>
                  <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
                    {['Assignments', 'Exam Reviewers', 'Lab Activities', 'Personal'].map(fname => {
                      const active = selectedExtraFolders.includes(fname);
                      return (
                        <button
                          key={fname}
                          type="button"
                          className={`row-action-chip${active ? ' active-chip' : ''}`}
                          onClick={() =>
                            setSelectedExtraFolders(prev =>
                              prev.includes(fname) ? prev.filter(x => x !== fname) : [...prev, fname]
                            )
                          }
                        >
                          <FolderPlus size={12} /> {fname}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: ALL SET CHECKLIST */}
            {step === 4 && (
              <div className="onboard-step-body">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
                  Ready Checklist
                </div>
                <div className="onboard-checklist">
                  <div className="onboard-check-row is-ok">
                    <Check size={14} /> <span>Appearance: <strong>{themeVal.toUpperCase()}</strong> (Studio Fast Mode)</span>
                  </div>
                  <div className={`onboard-check-row ${aiKey.trim() ? 'is-ok' : ''}`}>
                    <Check size={14} />{' '}
                    <span>
                      AI Study Layer:{' '}
                      <strong>
                        {aiKey.trim() ? `${preset.name} configured` : '100% Offline Mode (add key anytime)'}
                      </strong>
                    </span>
                  </div>
                  <div className={`onboard-check-row ${importedCoursesCount + addedSubjects.length > 0 ? 'is-ok' : ''}`}>
                    <Check size={14} />{' '}
                    <span>
                      Courses &amp; Schedule:{' '}
                      <strong>
                        {importedCoursesCount > 0
                          ? `${importedCoursesCount} courses imported`
                          : addedSubjects.length > 0
                            ? `${addedSubjects.length} subjects added`
                            : 'Skipped (import PDF anytime under Courses)'}
                      </strong>
                    </span>
                  </div>
                  <div className={`onboard-check-row ${wantStarterNote ? 'is-ok' : ''}`}>
                    <Check size={14} />{' '}
                    <span>
                      Starter Note:{' '}
                      <strong>{wantStarterNote ? 'Interactive Welcome Note ready' : 'Blank start'}</strong>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Wizard Navigation Footer */}
            <div className="flex gap-8" style={{ marginTop: 14 }}>
              {step === 0 ? (
                <button type="button" className="btn btn-secondary flex-1" onClick={handleSkipOrClose}>
                  Skip Setup
                </button>
              ) : (
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setStep(s => Math.max(0, s - 1))}>
                  Back
                </button>
              )}

              {step < 4 ? (
                <button type="button" className="btn btn-primary flex-1" onClick={() => setStep(s => s + 1)}>
                  {step === 1 && !aiKey.trim() ? 'Offline Only -> Next' : 'Next'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  disabled={finishing}
                  onClick={handleFinishWizard}
                >
                  <Check size={15} /> {finishing ? 'Preparing…' : 'Start Using Notes by Bai'}
                </button>
              )}
            </div>
          </div>
        )}

        {scheduleImportOpen && (
          <Suspense fallback={null}>
            <SchedulePdfImportSheet
              onImported={res => {
                setScheduleImportOpen(false);
                setImportedCoursesCount((res?.created || 0) + (res?.updated || 0));
              }}
              onClose={() => setScheduleImportOpen(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
