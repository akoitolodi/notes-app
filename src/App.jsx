/**
 * Root App — navigation, Android hardware Back button & browser history sync,
 * safe empty-note cleanup (preserving photo/drawing notes), and responsive
 * 2-pane split layout on tablets/desktops (>= 900px).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { FileText } from 'lucide-react';
import FoldersScreen from './components/FoldersScreen';
import NotesListScreen from './components/NotesListScreen';
import NoteEditor from './components/NoteEditor';
import StudyScreen from './components/StudyScreen';
import ExamSummaryScreen from './components/ExamSummaryScreen';
import TrashScreen from './components/TrashScreen';
import SettingsScreen from './components/SettingsScreen';
import { db, ensureSeeded, purgeOldTrash, noteHasContent } from './store/db';
import { applySettings } from './theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState('folders'); // folders | list | editor | study | exam | trash | settings
  const [folder, setFolder] = useState(null);
  const [note, setNote] = useState(null);
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
    updatedPatch => {
      bumpSidebar();
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

  // Seed default folders & purge 30-day-old trash on boot
  useEffect(() => {
    applySettings();
    Promise.all([ensureSeeded(), purgeOldTrash()]).finally(() => setReady(true));
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
    async (targetNote, folderArg = null) => {
      if (folderArg) {
        setFolder(folderArg);
      } else if (!folder && targetNote?.folderId) {
        const f = await db.folders.get(targetNote.folderId);
        setFolder(f || { id: '__all__', name: 'All Notes' });
      }
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
    if (screen === 'study') {
      await handleBackFromStudy();
      return true;
    }
    if (screen === 'editor') {
      await handleBackFromEditor();
      return true;
    }
    if (screen === 'list' || screen === 'exam' || screen === 'trash' || screen === 'settings') {
      handleBackToFolders();
      return true;
    }
    return false;
  }, [screen, handleBackFromStudy, handleBackFromEditor, handleBackToFolders]);

  const logicalBackRef = useRef(handleLogicalBack);
  useEffect(() => {
    logicalBackRef.current = handleLogicalBack;
  }, [handleLogicalBack]);

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
        <NoteEditor
          key={note.id}
          note={note}
          folderName={folder?.name || ''}
          onOpenNote={handleOpenNote}
          onNoteMoved={handleNoteMoved}
          onNoteDeleted={handleNoteDeleted}
          onNoteChanged={handleNoteChanged}
          onRegisterBack={registerOverlayBack}
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
      );
    }
    if (screen === 'study' && note) {
      return <StudyScreen note={note} onBack={handleBackFromStudy} />;
    }
    if (screen === 'exam' && folder) {
      return <ExamSummaryScreen folder={folder} onBack={handleBackToFolders} />;
    }
    if (screen === 'trash') {
      return <TrashScreen onBack={handleBackToFolders} onChanged={bumpSidebar} />;
    }
    if (screen === 'settings') {
      return <SettingsScreen onBack={handleBackToFolders} onDataImported={bumpSidebar} />;
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
            <NotesListScreen
              folder={folder}
              activeNoteId={note?.id || null}
              refreshKey={sidebarTick}
              onOpenNote={handleOpenNote}
              onBack={handleBackToFolders}
            />
          ) : (
            <FoldersScreen
              refreshKey={sidebarTick}
              onOpenFolder={handleOpenFolder}
              onOpenExam={handleOpenExam}
              onOpenNote={handleOpenNote}
              onOpenTrash={handleOpenTrash}
              onOpenSettings={handleOpenSettings}
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
    </div>
  );
}
