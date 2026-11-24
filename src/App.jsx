/**
 * Root App — navigation, Android hardware Back button & browser history sync,
 * safe empty-note cleanup (preserving photo/drawing notes), and responsive
 * 2-pane split layout on tablets/desktops (>= 900px).
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { FileText } from 'lucide-react';
import FoldersScreen from './components/FoldersScreen';
import { db, ensureSeeded, purgeOldTrash, noteHasContent } from './store/db';
import { autoSyncCanvasIfStale } from './lib/canvasSync';
import { syncDeadlineNotifications } from './lib/notifications';
import { lockVault, subscribeVault } from './lib/vault';
import { REDUCE_MOTION_KEY, applySettings } from './theme';

const NotesListScreen = lazy(() => import('./components/NotesListScreen'));
const NoteEditor = lazy(() => import('./components/NoteEditor'));
const StudyScreen = lazy(() => import('./components/StudyScreen'));
const ReviewDashboardScreen = lazy(() => import('./components/ReviewDashboardScreen'));
const ExamSummaryScreen = lazy(() => import('./components/ExamSummaryScreen'));
const ExamPaperScreen = lazy(() => import('./components/ExamPaperScreen'));
const TrashScreen = lazy(() => import('./components/TrashScreen'));
const SettingsScreen = lazy(() => import('./components/SettingsScreen'));
const ImportSheet = lazy(() => import('./components/ImportSheet'));
const DevToolkitScreen = lazy(() => import('./components/DevToolkitScreen'));
const LearnCodingScreen = lazy(() => import('./components/LearnCodingScreen'));
const StudentHubScreen = lazy(() => import('./components/StudentHubScreen'));
const CoursesDashboardScreen = lazy(() => import('./components/CoursesDashboardScreen'));
const AnnouncementsScreen = lazy(() => import('./components/AnnouncementsScreen'));
const ThemeStudioScreen = lazy(() => import('./components/ThemeStudioScreen'));

function ScreenLoading({ label = 'Loading…' }) {
  return (
    <div className="screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="scan-indicator">
        <span className="spinner" /> {label}
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [splashPhase, setSplashPhase] = useState(() => {
    try {
      const reduced = localStorage.getItem(REDUCE_MOTION_KEY) === 'true';
      const alreadySplashed = sessionStorage.getItem('aicn:splashed') === '1';
      return reduced || alreadySplashed ? 'gone' : 'visible';
    } catch {
      return 'gone';
    }
  });
  const [screen, setScreen] = useState('folders'); // folders | list | editor | study | exam | trash | settings
  const [folder, setFolder] = useState(null);
  const [note, setNote] = useState(null);
  const [noteInitialMode, setNoteInitialMode] = useState(null);
  const [examPaperTarget, setExamPaperTarget] = useState(null); // { sourceNote?, sourceFolder?, sourceCourse?, returnScreen }
  const [themesReturnTo, setThemesReturnTo] = useState('folders');
  const [sharedImport, setSharedImport] = useState(null); // { file?, text?, title? } from Android Share Target
  const [sidebarTick, setSidebarTick] = useState(0);
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 900 : false
  );

  // Back-button interceptor ref (e.g., open modals, chat sheet, slide-up panel)
  const overlayBackRef = useRef(null);
  const registerOverlayBack = useCallback(fn => {
    overlayBackRef.current = fn;
  }, []);

  const bumpSidebar = useCallback(() => setSidebarTick(t => t + 1), []);

  const handleNoteChanged = useCallback(
    (updatedPatch, opts = {}) => {
      if (opts?.metadataChanged !== false) bumpSidebar();
      if (updatedPatch && typeof updatedPatch === 'object') {
        setNote(prev => (prev ? { ...prev, ...updatedPatch } : prev));
      }
    },
    [bumpSidebar]
  );

  // Track wide viewport for tablet/desktop 2-pane split view
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = e => setIsWide(e.matches);
    setIsWide(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  // Seed default folders & purge 30-day-old trash on boot, then quietly auto-sync Canvas if configured
  useEffect(() => {
    applySettings();
    Promise.all([ensureSeeded(), purgeOldTrash()]).finally(() => {
      setReady(true);
      syncDeadlineNotifications().catch(() => {});
      autoSyncCanvasIfStale()
        .then(res => {
          if (res?.ran && (res.added > 0 || res.updated > 0)) bumpSidebar();
        })
        .catch(() => {});
    });
  }, [bumpSidebar]);

  // Brief purposeful launch splash (<= 0.8s total, never blocks interaction once leaving)
  useEffect(() => {
    if (!ready || splashPhase !== 'visible') return;
    try {
      sessionStorage.setItem('aicn:splashed', '1');
    } catch {
      // ignore
    }
    const tLeave = setTimeout(() => setSplashPhase('leaving'), 420);
    const tGone = setTimeout(() => setSplashPhase('gone'), 760);
    return () => {
      clearTimeout(tLeave);
      clearTimeout(tGone);
    };
  }, [ready, splashPhase]);

  // Idle-prefetch list & editor chunks once Home is interactive so tapping a note feels instant
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return undefined;
    const warm = () => {
      import('./components/NotesListScreen').catch(() => {});
      import('./components/NoteEditor').catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2200 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 900);
    return () => clearTimeout(t);
  }, [ready]);

  // Android "Share to Notes by Bai" Intent Receiver (PDF, PPTX, DOCX, image, or text/link)
  useEffect(() => {
    const consumeSharePayload = detail => {
      if (!detail || typeof detail !== 'object') return;
      try {
        if (detail.base64 && detail.fileName) {
          const bin = atob(detail.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], detail.fileName, {
            type: detail.mimeType || 'application/octet-stream',
          });
          setSharedImport({ file, title: detail.title || '' });
        } else if (detail.text) {
          setSharedImport({ text: detail.text, title: detail.title || 'Shared from Canvas' });
        }
      } catch {
        // ignore malformed payload
      }
      if (typeof window !== 'undefined') window.__BAI_SHARED_PAYLOAD__ = null;
    };

    if (typeof window !== 'undefined' && window.__BAI_SHARED_PAYLOAD__) {
      consumeSharePayload(window.__BAI_SHARED_PAYLOAD__);
    }
    const onShare = e => consumeSharePayload(e?.detail);
    window.addEventListener('bai-share', onShare);
    return () => window.removeEventListener('bai-share', onShare);
  }, []);

  const pushHistoryEntry = useCallback(nextScreen => {
    try {
      if (typeof window !== 'undefined' && window.history?.pushState) {
        window.history.pushState({ screen: nextScreen }, '');
      }
    } catch {
      // ignore sandboxed history errors
    }
  }, []);

  const handleOpenFolder = useCallback(
    f => {
      setFolder(f);
      setScreen('list');
      pushHistoryEntry('list');
    },
    [pushHistoryEntry]
  );

  const handleOpenNote = useCallback(
    async (targetNote, folderArg = null, opts = null) => {
      if (folderArg) {
        setFolder(folderArg);
      } else if (!folder && targetNote?.folderId) {
        const f = await db.folders.get(targetNote.folderId);
        setFolder(f || { id: '__all__', name: 'All Notes' });
      }
      setNoteInitialMode(opts?.startInEdit ? 'edit' : null);
      setNote(targetNote);
      setScreen('editor');
      pushHistoryEntry('editor');
    },
    [folder, pushHistoryEntry]
  );

  const cleanupEmptyNoteIfNeeded = useCallback(async currentNote => {
    if (!currentNote?.id) return;
    const fresh = await db.notes.get(currentNote.id);
    // Only remove genuinely empty abandoned notes (never delete notes with photos or drawings!)
    if (fresh && !noteHasContent(fresh)) {
      await db.notes.delete(currentNote.id);
      bumpSidebar();
    }
  }, [bumpSidebar]);

  const handleBackToFolders = useCallback(() => {
    setScreen('folders');
    setFolder(null);
    setNote(null);
    bumpSidebar();
  }, [bumpSidebar]);

  const handleBackFromEditor = useCallback(async () => {
    await cleanupEmptyNoteIfNeeded(note);
    bumpSidebar();
    if (folder) {
      setScreen('list');
      setNote(null);
    } else {
      setScreen('folders');
      setNote(null);
    }
  }, [note, folder, cleanupEmptyNoteIfNeeded, bumpSidebar]);

  const handleBackFromStudy = useCallback(async () => {
    if (note) {
      const fresh = await db.notes.get(note.id);
      if (fresh) {
        setNote(fresh);
        setScreen('editor');
        return;
      }
    }
    setScreen(folder ? 'list' : 'folders');
    setNote(null);
  }, [note, folder]);

  const handleOpenExam = useCallback(
    f => {
      setFolder(f);
      setScreen('exam');
      pushHistoryEntry('exam');
    },
    [pushHistoryEntry]
  );

  const handleOpenTrash = useCallback(() => {
    setScreen('trash');
    pushHistoryEntry('trash');
  }, [pushHistoryEntry]);

  const handleOpenSettings = useCallback(() => {
    setScreen('settings');
    pushHistoryEntry('settings');
  }, [pushHistoryEntry]);

  const handleOpenThemes = useCallback(
    (returnTo = 'folders') => {
      setThemesReturnTo(returnTo);
      setScreen('themes');
      pushHistoryEntry('themes');
    },
    [pushHistoryEntry]
  );

  const handleOpenReview = useCallback(() => {
    setScreen('review');
    pushHistoryEntry('review');
  }, [pushHistoryEntry]);

  const handleOpenToolkit = useCallback(() => {
    setScreen('toolkit');
    pushHistoryEntry('toolkit');
  }, [pushHistoryEntry]);

  const handleOpenCoding = useCallback(() => {
    setScreen('coding');
    pushHistoryEntry('coding');
  }, [pushHistoryEntry]);

  const handleOpenPlanner = useCallback(() => {
    setScreen('planner');
    pushHistoryEntry('planner');
  }, [pushHistoryEntry]);

  const handleOpenCourses = useCallback(() => {
    setScreen('courses');
    pushHistoryEntry('courses');
  }, [pushHistoryEntry]);

  const handleOpenAnnouncements = useCallback(() => {
    setScreen('announcements');
    pushHistoryEntry('announcements');
  }, [pushHistoryEntry]);

  const handleOpenExamPaper = useCallback(
    ({ sourceNote = null, sourceFolder = null, sourceCourse = null }) => {
      setExamPaperTarget({
        sourceNote,
        sourceFolder,
        sourceCourse,
        returnScreen: screen,
      });
      setScreen('exam-paper');
      pushHistoryEntry('exam-paper');
    },
    [screen, pushHistoryEntry]
  );

  const handleBackFromExamPaper = useCallback(() => {
    const prev = examPaperTarget?.returnScreen;
    setExamPaperTarget(null);
    if (prev === 'study' && note) setScreen('study');
    else if (prev === 'editor' && note) setScreen('editor');
    else if (prev === 'exam' && folder) setScreen('exam');
    else if (prev === 'courses') setScreen('courses');
    else handleBackToFolders();
  }, [examPaperTarget, note, folder, handleBackToFolders]);

  const handleNoteMoved = useCallback(
    newFolder => {
      if (newFolder) setFolder(newFolder);
      setNote(prev => (prev ? { ...prev, folderId: newFolder.id } : prev));
      bumpSidebar();
    },
    [bumpSidebar]
  );

  const handleNoteDeleted = useCallback(() => {
    setNote(null);
    setScreen(folder ? 'list' : 'folders');
    bumpSidebar();
  }, [folder, bumpSidebar]);

  // Unified logical "Go Back" handler for Android hardware back button & browser popstate
  const handleLogicalBack = useCallback(async () => {
    // 1. Let active overlay (ChatSheet, SlideUpPanel, DrawMode, ImageViewer) consume back first
    if (overlayBackRef.current && overlayBackRef.current() === true) {
      return true;
    }
    if (screen === 'exam-paper') {
      handleBackFromExamPaper();
      return true;
    }
    if (screen === 'study') {
      await handleBackFromStudy();
      return true;
    }
    if (screen === 'editor') {
      await handleBackFromEditor();
      return true;
    }
    if (screen === 'themes') {
      if (themesReturnTo === 'settings') {
        setScreen('settings');
      } else {
        handleBackToFolders();
      }
      return true;
    }
    if (
      screen === 'list' ||
      screen === 'exam' ||
      screen === 'review' ||
      screen === 'toolkit' ||
      screen === 'coding' ||
      screen === 'planner' ||
      screen === 'courses' ||
      screen === 'announcements' ||
      screen === 'trash' ||
      screen === 'settings'
    ) {
      handleBackToFolders();
      return true;
    }
    return false;
  }, [screen, handleBackFromExamPaper, handleBackFromStudy, handleBackFromEditor, handleBackToFolders]);

  const logicalBackRef = useRef(handleLogicalBack);
  useEffect(() => {
    logicalBackRef.current = handleLogicalBack;
  }, [handleLogicalBack]);

  // Auto-lock private vault when switching apps / backgrounding tab, and auto-sync Canvas on foreground resume
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lockVault();
      } else if (document.visibilityState === 'visible') {
        autoSyncCanvasIfStale()
          .then(res => {
            if (res?.ran && (res.added > 0 || res.updated > 0)) bumpSidebar();
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    let capStateListener = null;
    if (Capacitor.isNativePlatform?.()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          lockVault();
        } else {
          autoSyncCanvasIfStale()
            .then(res => {
              if (res?.ran && (res.added > 0 || res.updated > 0)) bumpSidebar();
            })
            .catch(() => {});
        }
      })
        .then(h => {
          capStateListener = h;
        })
        .catch(() => {});
    }
    const unsub = subscribeVault(unlocked => {
      if (!unlocked) {
        setFolder(cur => {
          if (cur?.locked) {
            setNote(null);
            setScreen('folders');
            return null;
          }
          return cur;
        });
        bumpSidebar();
      }
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      capStateListener?.remove?.();
      unsub();
    };
  }, [bumpSidebar]);

  // Android Capacitor hardware back button
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    let listener = null;
    CapApp.addListener('backButton', async () => {
      const handled = await logicalBackRef.current();
      if (!handled) {
        CapApp.exitApp();
      }
    })
      .then(handle => {
        listener = handle;
      })
      .catch(() => {});
    return () => {
      listener?.remove?.();
    };
  }, []);

  // Web browser Back button integration
  useEffect(() => {
    if (typeof window === 'undefined' || Capacitor.isNativePlatform?.()) return;
    const onPopState = () => {
      logicalBackRef.current();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (!ready) {
    return (
      <div className="app-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="scan-indicator">
          <span className="spinner" /> Loading your notes…
        </div>
      </div>
    );
  }

  // Render active main workspace panel
  const renderMainPanel = () => {
    if (screen === 'editor' && note) {
      return (
        <Suspense fallback={<ScreenLoading label="Opening Note…" />}>
          <NoteEditor
            key={note.id}
            note={note}
            initialMode={noteInitialMode}
            folderName={folder?.name || ''}
            folderMode={folder?.mode || 'study'}
            onOpenNote={handleOpenNote}
            onNoteMoved={handleNoteMoved}
            onNoteDeleted={handleNoteDeleted}
            onNoteChanged={handleNoteChanged}
            onRegisterBack={registerOverlayBack}
            onOpenExamPaper={srcNote => handleOpenExamPaper({ sourceNote: srcNote })}
            onOpenStudy={async () => {
              const fresh = await db.notes.get(note.id);
              if (fresh) {
                setNote(fresh);
                setScreen('study');
                pushHistoryEntry('study');
              }
            }}
            onBackToList={handleBackFromEditor}
          />
        </Suspense>
      );
    }
    if (screen === 'study' && note) {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Study Mode…" />}>
          <StudyScreen
            note={note}
            onBack={handleBackFromStudy}
            onOpenExamPaper={handleOpenExamPaper}
          />
        </Suspense>
      );
    }
    if (screen === 'exam-paper' && examPaperTarget) {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Exam Builder…" />}>
          <ExamPaperScreen
            sourceNote={examPaperTarget.sourceNote}
            sourceFolder={examPaperTarget.sourceFolder}
            sourceCourse={examPaperTarget.sourceCourse}
            onBack={handleBackFromExamPaper}
          />
        </Suspense>
      );
    }
    if (screen === 'review') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Daily Review…" />}>
          <ReviewDashboardScreen
            onBack={handleBackToFolders}
            onOpenNote={handleOpenNote}
            onChanged={bumpSidebar}
          />
        </Suspense>
      );
    }
    if (screen === 'toolkit') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading IT Toolkit…" />}>
          <DevToolkitScreen onBack={handleBackToFolders} onOpenNote={handleOpenNote} />
        </Suspense>
      );
    }
    if (screen === 'coding') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Learn Coding Studio…" />}>
          <LearnCodingScreen onBack={handleBackToFolders} onOpenNote={handleOpenNote} />
        </Suspense>
      );
    }
    if (screen === 'planner') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading School Planner…" />}>
          <StudentHubScreen
            onBack={handleBackToFolders}
            onOpenNote={handleOpenNote}
            onOpenFolder={handleOpenFolder}
            onOpenExamPaper={handleOpenExamPaper}
            onChanged={bumpSidebar}
          />
        </Suspense>
      );
    }
    if (screen === 'courses') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Course Dashboard…" />}>
          <CoursesDashboardScreen
            onBack={handleBackToFolders}
            onOpenNote={handleOpenNote}
            onOpenFolder={handleOpenFolder}
            onOpenExamPaper={handleOpenExamPaper}
            onOpenPlanner={handleOpenPlanner}
            onChanged={bumpSidebar}
          />
        </Suspense>
      );
    }
    if (screen === 'announcements') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Announcements…" />}>
          <AnnouncementsScreen
            onBack={handleBackToFolders}
            onOpenNote={handleOpenNote}
            onChanged={bumpSidebar}
          />
        </Suspense>
      );
    }
    if (screen === 'exam' && folder) {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Exam Summary…" />}>
          <ExamSummaryScreen
            folder={folder}
            onBack={handleBackToFolders}
            onOpenExamPaper={handleOpenExamPaper}
          />
        </Suspense>
      );
    }
    if (screen === 'trash') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Trash…" />}>
          <TrashScreen onBack={handleBackToFolders} onChanged={bumpSidebar} />
        </Suspense>
      );
    }
    if (screen === 'settings') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Settings…" />}>
          <SettingsScreen
            onBack={handleBackToFolders}
            onDataImported={bumpSidebar}
            onOpenThemes={() => handleOpenThemes('settings')}
          />
        </Suspense>
      );
    }
    if (screen === 'themes') {
      return (
        <Suspense fallback={<ScreenLoading label="Loading Themes…" />}>
          <ThemeStudioScreen
            onBack={() =>
              themesReturnTo === 'settings' ? setScreen('settings') : handleBackToFolders()
            }
          />
        </Suspense>
      );
    }
    return null;
  };

  const showingSidebarList = Boolean(folder && screen !== 'folders');
  const mainContent = renderMainPanel();
  const showingMainOnMobile = Boolean(mainContent);

  // Unified stable shell — resizing across 900px never unmounts NoteEditor or loses state!
  return (
    <div className="app-root">
      <div className={`split-shell${isWide ? ' is-wide' : ''}`}>
        <aside className={`split-sidebar${!isWide && showingMainOnMobile ? ' pane-hidden' : ''}`}>
          {showingSidebarList ? (
            <Suspense fallback={<ScreenLoading label="Loading Notes…" />}>
              <NotesListScreen
                folder={folder}
                activeNoteId={note?.id || null}
                refreshKey={sidebarTick}
                onOpenNote={handleOpenNote}
                onBack={handleBackToFolders}
              />
            </Suspense>
          ) : (
            <FoldersScreen
              refreshKey={sidebarTick}
              onOpenFolder={handleOpenFolder}
              onOpenExam={handleOpenExam}
              onOpenNote={handleOpenNote}
              onOpenReview={handleOpenReview}
              onOpenCourses={handleOpenCourses}
              onOpenAnnouncements={handleOpenAnnouncements}
              onOpenPlanner={handleOpenPlanner}
              onOpenToolkit={handleOpenToolkit}
              onOpenCoding={handleOpenCoding}
              onOpenTrash={handleOpenTrash}
              onOpenSettings={handleOpenSettings}
              onOpenThemes={() => handleOpenThemes('folders')}
            />
          )}
        </aside>
        <main className={`split-main${!isWide && !showingMainOnMobile ? ' pane-hidden' : ''}`}>
          {mainContent || (
            <div className="empty-state">
              <div className="empty-icon">
                <FileText size={28} />
              </div>
              <div className="empty-title">Select a note or start a new one</div>
              <div className="empty-text">
                Choose a folder on the left, open a note to study with AI explanations, or create a fresh note.
              </div>
            </div>
          )}
        </main>
      </div>
      {sharedImport && (
        <Suspense fallback={null}>
          <ImportSheet
            initialFile={sharedImport.file || null}
            initialPastedText={sharedImport.text || ''}
            initialTitle={sharedImport.title || ''}
            onImported={(createdNote, targetFolder) => {
              setSharedImport(null);
              bumpSidebar();
              handleOpenNote(createdNote, targetFolder);
            }}
            onImportedToCourse={() => {
              setSharedImport(null);
              bumpSidebar();
              handleOpenCourses();
            }}
            onClose={() => setSharedImport(null)}
          />
        </Suspense>
      )}
      {splashPhase !== 'gone' && (
        <div
          className={`app-splash-overlay${splashPhase === 'leaving' ? ' is-leaving' : ''}`}
          aria-hidden="true"
        >
          <div className="app-splash-card">
            <div className="app-splash-logo">
              <img src="./icons/icon-192.png" alt="" width={46} height={46} />
            </div>
            <div className="app-splash-title">Notes by Bai</div>
            <div className="app-splash-sub">Study workspace</div>
            <div className="app-splash-bar">
              <span />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
