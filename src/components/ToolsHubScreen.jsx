/**
 * ToolsHubScreen — Unified Tools tab combining Learn Coding, Dev & IT Toolkit,
 * Subject Studio, Focus Timer, Lecture Recorder, and Theme Studio.
 */
import { useState, lazy, Suspense } from 'react';
import {
  Code2,
  Wrench,
  Timer,
  Mic,
  GraduationCap,
  Palette,
  Settings,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { isDevToolkitEnabled, isLearnCodingEnabled } from '../lib/aiConfig';

const FocusPomodoroSheet = lazy(() => import('./FocusPomodoroSheet'));
const LectureRecorderSheet = lazy(() => import('./LectureRecorderSheet'));

export default function ToolsHubScreen({
  onOpenCoding,
  onOpenToolkit,
  onOpenSubjects,
  onOpenSyllabus,
  onOpenThemes,
  onOpenSettings,
  onOpenNote,
  onChanged,
}) {
  const [focusOpen, setFocusOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const showCoding = isLearnCodingEnabled();
  const showToolkit = isDevToolkitEnabled();

  return (
    <div className="screen list-pad-bottom-nav">
      <header className="navbar navbar-home">
        <span className="home-brand-eyebrow">Tools &amp; Labs</span>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="navbar-btn navbar-glass-btn"
            aria-label="Themes & Palettes"
            onClick={onOpenThemes}
          >
            <Palette size={18} />
          </button>
          <button
            type="button"
            className="navbar-btn navbar-glass-btn"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="home-hero-header" style={{ paddingBottom: 10 }}>
        <div className="home-hero-eyebrow">Practice &amp; Utilities</div>
        <div className="home-hero-row">
          <h1 className="home-hero-title">Tools</h1>
          <span className="home-hero-sub">Offline labs &amp; study utilities</span>
        </div>
      </div>

      <div className="tools-labs-list">
        {showCoding && (
          <button type="button" className="tools-lab-row" onClick={onOpenCoding}>
            <div className="tools-hub-icon">
              <Code2 size={18} />
            </div>
            <div className="tools-hub-body">
              <div className="tools-hub-title">Learn Coding Studio</div>
              <div className="tools-hub-sub">18 languages, live runner &amp; algorithm visualizer</div>
            </div>
            <ChevronRight size={17} className="tools-hub-chevron" />
          </button>
        )}

        {showToolkit && (
          <button type="button" className="tools-lab-row" onClick={onOpenToolkit}>
            <div className="tools-hub-icon">
              <Wrench size={18} />
            </div>
            <div className="tools-hub-body">
              <div className="tools-hub-title">Dev &amp; IT Toolkit</div>
              <div className="tools-hub-sub">Algebra/Logic, Net Lab, Grapher, Subnet, Regex, Bug Log</div>
            </div>
            <ChevronRight size={17} className="tools-hub-chevron" />
          </button>
        )}

        <button type="button" className="tools-lab-row" onClick={onOpenSyllabus}>
          <div className="tools-hub-icon">
            <Sparkles size={18} />
          </div>
          <div className="tools-hub-body">
            <div className="tools-hub-title">AI Syllabus Studio</div>
            <div className="tools-hub-sub">Analyze any semester syllabus &amp; launch practical labs</div>
          </div>
          <ChevronRight size={17} className="tools-hub-chevron" />
        </button>

        <button type="button" className="tools-lab-row" onClick={onOpenSubjects}>
          <div className="tools-hub-icon">
            <GraduationCap size={18} />
          </div>
          <div className="tools-hub-body">
            <div className="tools-hub-title">Subject Studio</div>
            <div className="tools-hub-sub">MS 102 Quant Lab &amp; open-source subject tracks</div>
          </div>
          <ChevronRight size={17} className="tools-hub-chevron" />
        </button>
      </div>

      <div className="section-heading">Session Capture</div>
      <div className="tools-capture-grid">
        <button type="button" className="tools-capture-card" onClick={() => setRecorderOpen(true)}>
          <div className="tools-hub-icon">
            <Mic size={18} />
          </div>
          <div className="tools-hub-body">
            <div className="tools-hub-title">Record Lecture</div>
            <div className="tools-hub-sub">Audio to clean AI notes</div>
          </div>
        </button>

        <button type="button" className="tools-capture-card" onClick={() => setFocusOpen(true)}>
          <div className="tools-hub-icon">
            <Timer size={18} />
          </div>
          <div className="tools-hub-body">
            <div className="tools-hub-title">Focus Pomodoro</div>
            <div className="tools-hub-sub">Timed study sessions</div>
          </div>
        </button>
      </div>

      <div className="settings-tip" style={{ margin: '6px var(--gutter) 18px' }}>
        Want a minimal notes-only workspace? Toggle Learn Coding or Dev Toolkit anytime in Settings → Optional Add-ons.
      </div>

      {focusOpen && (
        <Suspense fallback={null}>
          <FocusPomodoroSheet onClose={() => setFocusOpen(false)} />
        </Suspense>
      )}

      {recorderOpen && (
        <Suspense fallback={null}>
          <LectureRecorderSheet
            onSaved={(created, targetFolder) => {
              setRecorderOpen(false);
              onChanged?.();
              onOpenNote?.(created, targetFolder || { id: '__all__', name: 'All Notes' });
            }}
            onClose={() => setRecorderOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
