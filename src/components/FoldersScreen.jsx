/**
 * Folders screen — iOS Notes style with Smart Views (All Notes, Pinned, Tags),
 * subject folders, quick New Note FAB, debounced global search with match
 * highlighting, and Recently Deleted at the bottom.
 */
import { useState, useEffect, useCallback, useRef, useDeferredValue, lazy, Suspense } from 'react';
import {
  Search,
  Settings,
  FolderPlus,
  Folder,
  FileText,
  Pin,
  Trash2,
  GraduationCap,
  ChevronRight,
  MoreHorizontal,
  X,
  SquarePen,
  Hash,
  FileUp,
  LayoutTemplate,
  Flame,
  Brain,
  Lock,
  Unlock,
  KeyRound,
  Shield,
  EyeOff,
  BookOpen,
  Bell,
  Megaphone,
  RefreshCw,
  Palette,
  Clock,
  ExternalLink,
  Compass,
  Mic,
  Sparkles,
  CalendarDays,
  FileDown,
} from 'lucide-react';
import {
  db,
  getHomeSummary,
  getActiveGecSchedule,
  localDateKey,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolder,
  searchNotes,
  createNote,
} from '../store/db';
import { getReviewStats } from '../lib/spacedRepetition';
import { NOTE_MODE_LIST, getModeMeta } from '../lib/noteModes';
import { getDirectConfig } from '../lib/aiConfig';
import {
  isVaultUnlocked,
  getVaultSessionMode,
  hasVaultPin,
  getDecoyConfig,
  updateDecoyTriggerDigit,
  disableDecoyVault,
  lockVault,
  subscribeVault,
} from '../lib/vault';
import {
  getInAppAlertSummary,
  getNotificationSettings,
  isAnnouncementRead,
  markAllAnnouncementsRead,
  snoozeInAppBanner,
} from '../lib/notifications';
import { SETUP_BANNER_DISMISSED_KEY } from '../lib/onboarding';
import {
  resolveScheduleEntries,
  filterScheduleEntries,
  getScheduleFilterMode,
  formatTimeRange12h,
} from '../lib/scheduleView';
import {
  matchAnnouncementToCourse,
  extractQuickLinks,
  getNextUpcomingClassAcrossWeek,
} from '../lib/announcementSchedule';
import { useDialog } from './ui/DialogProvider';

const TemplatePickerSheet = lazy(() => import('./TemplatePickerSheet'));
const ImportSheet = lazy(() => import('./ImportSheet'));
const PinLockSheet = lazy(() => import('./PinLockSheet'));
const LectureRecorderSheet = lazy(() => import('./LectureRecorderSheet'));

const HOME_CACHE_KEY = 'aicn:homeCache:v1';
const EMPTY_SUMMARY = {
  folders: [],
  vaultFolders: [],
  hiddenVaultCount: 0,
  totalNotes: 0,
  pinnedCount: 0,
  trashCount: 0,
  dueCardsCount: 0,
  totalCardsCount: 0,
  hasLockedFolders: false,
  tags: [],
  recentNotes: [],
};

function formatShortAge(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function readHomeCache() {
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeHomeCache(payload) {
  try {
    localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

function readCachedNewCanvasFileCount() {
  try {
    const catalog = JSON.parse(localStorage.getItem('aicn:canvasFilesCatalog:v1') || 'null');
    const files = Array.isArray(catalog?.files) ? catalog.files : [];
    if (files.length === 0) return 0;
    const seen = new Set(JSON.parse(localStorage.getItem('aicn:canvasFilesSeenIds:v1') || '[]'));
    const imported = JSON.parse(localStorage.getItem('aicn:canvasFilesImportedMap:v1') || '{}') || {};
    let count = 0;
    for (const f of files) {
      if (f?.canvasFileId && !imported[f.canvasFileId] && !seen.has(f.canvasFileId)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function getStudioGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFolderBadgeClass(folder, vaultUnlocked) {
  if (folder.locked && !vaultUnlocked) return 'tone-slate';
  if (folder.isSystemVault || folder.locked) return 'tone-slate';
  const mode = folder.mode || 'study';
  if (mode === 'code') return 'tone-emerald';
  if (mode === 'journal') return 'tone-rose';
  if (mode === 'explore') return 'tone-violet';
  return 'tone-indigo';
}

function highlightMatch(text, query) {
  const s = String(text || '');
  const q = String(query || '').trim();
  if (!q) return s;
  const idx = s.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return s;
  return (
    <>
      {s.slice(0, idx)}
      <mark className="search-highlight">{s.slice(idx, idx + q.length)}</mark>
      {s.slice(idx + q.length)}
    </>
  );
}

export default function FoldersScreen({
  refreshKey = 0,
  onOpenFolder,
  onOpenExam,
  onOpenNote,
  onOpenReview,
  onOpenCourses,
  onOpenAnnouncements,
  onOpenPlanner,
  onOpenSyllabus,
  onOpenTrash,
  onOpenSettings,
  onOpenThemes,
  onOpenSetupWizard = null,
  onOpenFeatureGuide = null,
}) {
  const { confirm, prompt, toast } = useDialog();
  const [initialCache] = useState(() => readHomeCache());
  const [summary, setSummary] = useState(() =>
    initialCache?.summary ? { ...EMPTY_SUMMARY, ...initialCache.summary, vaultFolders: [] } : EMPTY_SUMMARY
  );
  const [reviewStats, setReviewStats] = useState(() => getReviewStats());
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isVaultUnlocked());
  const [vaultMode, setVaultMode] = useState(() => getVaultSessionMode());
  const [pinRequest, setPinRequest] = useState(null); // { mode: 'unlock'|'setup', onDone }
  const [decoyMenuOpen, setDecoyMenuOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [courseCount, setCourseCount] = useState(() => Number(initialCache?.courseCount || 0));
  const [annPreview, setAnnPreview] = useState(() =>
    initialCache?.annPreview || { total: 0, unread: 0, pinned: 0, latest: [] }
  );
  const [upNextClass, setUpNextClass] = useState(() => initialCache?.upNextClass || null);
  const [todaySchedule, setTodaySchedule] = useState(() => initialCache?.todaySchedule || []);
  const [gecBanner, setGecBanner] = useState(() => initialCache?.gecBanner || null);
  const [syncingAnn, setSyncingAnn] = useState(false);
  const [alertSummary, setAlertSummary] = useState(null);
  const [newCanvasFilesCount, setNewCanvasFilesCount] = useState(() => readCachedNewCanvasFileCount());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState([]);
  const [folderMap, setFolderMap] = useState({});
  const [menuFolder, setMenuFolder] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [setupBannerDismissed, setSetupBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(SETUP_BANNER_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [notifLeadMin, setNotifLeadMin] = useState(
    () => getNotificationSettings().classReminderLeadMin || 10
  );

  const pressTimer = useRef(null);
  const longPressedRef = useRef(false);

  const cancelLongPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startLongPress = folder => {
    cancelLongPress();
    longPressedRef.current = false;
    pressTimer.current = setTimeout(() => {
      longPressedRef.current = true;
      setMenuFolder(folder);
    }, 500);
  };

  useEffect(() => () => cancelLongPress(), []);

  const refresh = useCallback(async () => {
    try {
      const [homeSum, pItems, crs, schedRows, activeGec] = await Promise.all([
        getHomeSummary(),
        db.plannerItems.toArray().catch(() => []),
        db.courses.toArray().catch(() => []),
        db.classSchedule.toArray().catch(() => []),
        getActiveGecSchedule(),
      ]);
      const alerts = await getInAppAlertSummary(pItems);
      const nextDueCount = pItems.filter(it => !it.done && it.type !== 'announcement').length;
      const nextCourseCount = crs.length;

      const resolvedEntries = filterScheduleEntries(
        resolveScheduleEntries(crs, schedRows),
        getScheduleFilterMode()
      );
      const nowObj = new Date();
      const todayDow = nowObj.getDay();
      const todayKey = localDateKey(nowObj);
      const gecMod = activeGec ? await import('../lib/gecSchedule').catch(() => null) : null;
      const nextGecBanner = gecMod ? gecMod.getGecPeriodSummaryForDate(todayKey, activeGec) : null;

      const nowMins = nowObj.getHours() * 60 + nowObj.getMinutes();
      const todayClassesRaw = resolvedEntries
        .filter(e => e.dayOfWeek === todayDow)
        .sort((a, b) => a.startMin - b.startMin);
      const nextTodaySchedule = todayClassesRaw.slice(0, 4).map(e => {
        const mod = gecMod ? gecMod.resolveGecModalityForDate(e, todayKey, activeGec) : null;
        return {
          id: e.id || `${e.code}-${e.startMin}`,
          code: e.code,
          title: e.courseName || e.title || e.code,
          kind: e.kind,
          room: e.room || '',
          color: e.color || '#0a84ff',
          timeRange: formatTimeRange12h(e.startTime, e.endTime),
          isLive: nowMins >= e.startMin && nowMins <= e.endMin,
          gecMod: mod,
        };
      });

      const nextRaw = getNextUpcomingClassAcrossWeek(resolvedEntries);
      const nextUpSummary = nextRaw
        ? {
            status: nextRaw.status,
            dayLabel: nextRaw.dayLabel,
            minutesLeft: nextRaw.minutesLeft,
            minutesUntil: nextRaw.minutesUntil,
            code: nextRaw.entry.code,
            kind: nextRaw.entry.kind,
            room: nextRaw.entry.room,
            timeRange: formatTimeRange12h(nextRaw.entry.startTime, nextRaw.entry.endTime),
            courseId: nextRaw.entry.courseId,
            folderId: nextRaw.entry.course?.folderId || null,
          }
        : null;

      const anns = pItems
        .filter(it => it.type === 'announcement')
        .map(it => {
          const sm = matchAnnouncementToCourse(it, crs, schedRows);
          const ql = extractQuickLinks(it.description)[0] || null;
          return {
            ...it,
            _read: isAnnouncementRead(it),
            _scheduleCompact: sm?.compactText || '',
            _quickLink: ql,
          };
        })
        .sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
          if (a._read !== b._read) return a._read ? 1 : -1;
          return (b.dueAt || b.createdAt || 0) - (a.dueAt || a.createdAt || 0);
        });
      const nextAnnPreview = {
        total: anns.length,
        unread: anns.filter(a => !a._read).length,
        pinned: anns.filter(a => a.pinned).length,
        latest: anns.slice(0, 2),
      };

      setSummary(homeSum);
      setReviewStats(getReviewStats());
      setNotifLeadMin(getNotificationSettings().classReminderLeadMin || 10);
      setVaultUnlocked(isVaultUnlocked());
      setVaultMode(getVaultSessionMode());
      setCourseCount(nextCourseCount);
      setAlertSummary(alerts);
      setNewCanvasFilesCount(readCachedNewCanvasFileCount());
      setAnnPreview(nextAnnPreview);
      setUpNextClass(nextUpSummary);
      setTodaySchedule(nextTodaySchedule);
      setGecBanner(nextGecBanner);

      writeHomeCache({
        summary: { ...homeSum, vaultFolders: [] },
        courseCount: nextCourseCount,
        annPreview: nextAnnPreview,
        upNextClass: nextUpSummary,
        todaySchedule: nextTodaySchedule,
        gecBanner: nextGecBanner,
      });
    } catch {
      const homeSum = await getHomeSummary().catch(() => EMPTY_SUMMARY);
      setSummary(homeSum);
      setReviewStats(getReviewStats());
      setNotifLeadMin(getNotificationSettings().classReminderLeadMin || 10);
      setVaultUnlocked(isVaultUnlocked());
      setCourseCount(0);
      setAlertSummary(null);
      setAnnPreview({ total: 0, unread: 0, pinned: 0, latest: [] });
      setUpNextClass(null);
      setTodaySchedule([]);
      setGecBanner(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const onFilesUpdated = () => setNewCanvasFilesCount(readCachedNewCanvasFileCount());
    window.addEventListener('bai-canvas-files-updated', onFilesUpdated);
    return () => window.removeEventListener('bai-canvas-files-updated', onFilesUpdated);
  }, []);

  useEffect(() => {
    return subscribeVault((unlocked, mode) => {
      setVaultUnlocked(unlocked);
      setVaultMode(mode || getVaultSessionMode());
      if (!unlocked) setDecoyMenuOpen(false);
      getHomeSummary().then(setSummary).catch(() => {});
    });
  }, []);

  // Debounced global search across all folders (title, body, AI explanations & terms)
  useEffect(() => {
    let live = true;
    const q = deferredQuery.trim();
    if (!searching || !q) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      searchNotes(q, null, 'edited').then(async r => {
        if (!live) return;
        const fm = {};
        (await db.folders.toArray()).forEach(f => {
          fm[f.id] = f.name;
        });
        setFolderMap(fm);
        setResults(r);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [deferredQuery, searching]);

  const toggleSearch = () => {
    setSearching(prev => {
      if (prev) {
        setQuery('');
        setResults([]);
      }
      return !prev;
    });
  };

  const handleNewFolder = async () => {
    const name = await prompt({
      title: 'New folder',
      placeholder: 'e.g. Biology, Calculus, History',
      confirmLabel: 'Create',
    });
    if (!name) return;
    await createFolder(name);
    toast(`Created "${name}"`);
    refresh();
  };

  const handleRename = async folder => {
    setMenuFolder(null);
    const name = await prompt({
      title: 'Rename folder',
      defaultValue: folder.name,
      placeholder: 'Folder name',
      confirmLabel: 'Rename',
    });
    if (name && name !== folder.name) {
      await renameFolder(folder.id, name);
      toast(`Renamed to "${name}"`);
      refresh();
    }
  };

  const handleDelete = async folder => {
    setMenuFolder(null);
    if (folder.isSystemVault) {
      toast('Passwords & Keys is a permanent Zero-AI vault and cannot be deleted');
      return;
    }

    const executeDelete = async () => {
      const ok = await confirm({
        title: `Delete "${folder.name}"?`,
        message:
          folder.noteCount > 0
            ? `Its ${folder.noteCount} note${folder.noteCount === 1 ? '' : 's'} will be moved to Recently Deleted for 30 days.`
            : 'This empty folder will be removed.',
        confirmLabel: 'Delete folder',
        destructive: true,
      });
      if (!ok) return;
      await deleteFolder(folder.id);
      toast(
        folder.noteCount > 0
          ? `Folder deleted — notes moved to Trash`
          : 'Folder deleted'
      );
      refresh();
    };

    if (folder.locked && hasVaultPin()) {
      setPinRequest({
        mode: 'verify',
        title: `Confirm PIN to Delete "${folder.name}"`,
        onDone: executeDelete,
      });
      return;
    }

    await executeDelete();
  };

  const handleQuickNewNote = async () => {
    const defaultFolder =
      summary.folders.find(f => f.name === 'General') || summary.folders[0];
    const created = await createNote(defaultFolder?.id);
    onOpenNote(created, defaultFolder || { id: '__all__', name: 'All Notes' }, { startInEdit: true });
  };

  const handleToggleHiddenVault = () => {
    if (vaultUnlocked) {
      lockVault();
      toast('Hidden Vault locked & concealed');
      return;
    }
    setPinRequest({
      mode: hasVaultPin() ? 'unlock' : 'setup',
      title: hasVaultPin() ? 'Unlock Hidden Vault' : 'Create Hidden Vault PIN',
      onDone: () => {
        refresh();
        toast('Hidden Vault revealed');
      },
    });
  };

  const handlePickTemplate = async templateId => {
    setTemplatesOpen(false);
    const { instantiateTemplate } = await import('../lib/templates');
    const createFromTpl = async targetFolder => {
      const { title, body } = instantiateTemplate(templateId);
      const created = await createNote(
        targetFolder?.id,
        title,
        body,
        targetFolder?.name || 'General'
      );
      onOpenNote(created, targetFolder || { id: '__all__', name: 'All Notes' }, { startInEdit: true });
    };

    if (templateId === 'password_entry') {
      const openInSystemVault = async () => {
        const fresh = await getHomeSummary();
        setSummary(fresh);
        const sysVault = (fresh.vaultFolders || []).find(f => f.isSystemVault);
        await createFromTpl(sysVault || fresh.folders[0]);
      };
      if (!isVaultUnlocked()) {
        setPinRequest({
          mode: hasVaultPin() ? 'unlock' : 'setup',
          title: hasVaultPin() ? 'Unlock Passwords & Keys' : 'Set Vault PIN for Passwords & Keys',
          onDone: openInSystemVault,
        });
        return;
      }
      await openInSystemVault();
      return;
    }

    const defaultFolder =
      summary.folders.find(f => f.name === 'General') || summary.folders[0];
    await createFromTpl(defaultFolder);
  };

  const handleFolderClick = folder => {
    if (folder.locked && !isVaultUnlocked()) {
      setPinRequest({
        mode: hasVaultPin() ? 'unlock' : 'setup',
        title: `Unlock "${folder.name}"`,
        onDone: () => {
          refresh();
          onOpenFolder(folder);
        },
      });
      return;
    }
    onOpenFolder(folder);
  };

  const handleSetFolderMode = async (folder, nextMode) => {
    setMenuFolder(null);
    if (folder.isSystemVault) return;
    await updateFolder(folder.id, { mode: nextMode });
    toast(`"${folder.name}" set to ${getModeMeta(nextMode).label} mode`);
    refresh();
  };

  const handleToggleFolderLock = async folder => {
    setMenuFolder(null);
    if (folder.isSystemVault) {
      toast('Passwords & Keys is permanently protected in your Hidden Vault');
      return;
    }
    if (folder.locked) {
      const doUnlock = async () => {
        await updateFolder(folder.id, { locked: false });
        toast(`Removed PIN lock — "${folder.name}" moved back to Subjects`);
        refresh();
      };
      if (hasVaultPin()) {
        setPinRequest({
          mode: 'verify',
          title: `Confirm PIN to Remove Lock on "${folder.name}"`,
          onDone: doUnlock,
        });
      } else {
        await doUnlock();
      }
      return;
    }

    const doLock = async () => {
      await updateFolder(folder.id, { locked: true });
      toast(
        isVaultUnlocked()
          ? `"${folder.name}" moved to Hidden Vault`
          : `"${folder.name}" locked & moved to Hidden Vault (tap Lock icon in top bar to open)`,
        { type: 'success' }
      );
      refresh();
    };
    if (!hasVaultPin()) {
      setPinRequest({
        mode: 'setup',
        title: `Create PIN to Lock "${folder.name}"`,
        onDone: doLock,
      });
    } else {
      await doLock();
    }
  };

  const {
    folders,
    vaultFolders = [],
    totalNotes,
    pinnedCount,
    trashCount,
    dueCardsCount = 0,
    tags,
    recentNotes = [],
  } = summary;

  const urgentHeadline =
    alertSummary && alertSummary.totalUrgent > 0 && !alertSummary.snoozed
      ? [
          alertSummary.overdue.length > 0 ? `${alertSummary.overdue.length} overdue` : '',
          alertSummary.dueToday.length > 0 ? `${alertSummary.dueToday.length} due today` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

  return (
    <div className="screen list-pad-bottom-nav">
      <header className="navbar navbar-home">
        <span className="home-brand-eyebrow">Notes by Bai</span>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className={`navbar-btn navbar-glass-btn${vaultUnlocked ? ' navbar-btn-active' : ''}`}
            aria-label={vaultUnlocked ? 'Hide & lock Hidden Vault' : 'Unlock Hidden Vault'}
            title={vaultUnlocked ? 'Hide & lock Hidden Vault' : 'Unlock Hidden Vault (Passwords & Keys)'}
            onClick={handleToggleHiddenVault}
          >
            {vaultUnlocked ? <Unlock size={17} /> : <Lock size={17} />}
          </button>
          <button
            className={`navbar-btn navbar-glass-btn${searching ? ' navbar-btn-active' : ''}`}
            aria-label="Search all notes"
            onClick={toggleSearch}
          >
            <Search size={18} />
          </button>
          {onOpenThemes && (
            <button
              className="navbar-btn navbar-glass-btn"
              aria-label="Themes & Palettes"
              title="Themes & Palettes Studio"
              onClick={onOpenThemes}
            >
              <Palette size={18} />
            </button>
          )}
          <button className="navbar-btn navbar-glass-btn" aria-label="Settings" onClick={onOpenSettings}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div
        className="home-hero-header home-hero-editorial"
        onContextMenu={e => {
          e.preventDefault();
          handleToggleHiddenVault();
        }}
        title="Tap the lock icon in the top bar (or right-click/long-press here) to open Hidden Vault"
      >
        <div className="home-hero-eyebrow">{getStudioGreeting()}</div>
        <div className="home-hero-row">
          <h1 className="home-hero-title">Notes</h1>
          <span className="home-hero-sub">
            {totalNotes} {totalNotes === 1 ? 'note' : 'notes'}, {folders.length}{' '}
            {folders.length === 1 ? 'subject' : 'subjects'}
          </span>
        </div>
      </div>

      {searching && (
        <div className="search-bar">
          <div className="search-input-wrap">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              className="search-input"
              autoFocus
              placeholder="Search titles, text & AI explanations"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={toggleSearch}>
            Cancel
          </button>
        </div>
      )}

      {searching && query.trim() && (
        <div className="list-group">
          {results.length === 0 ? (
            <div className="list-item list-item-static">
              <span className="list-item-subtitle">No matching notes found.</span>
            </div>
          ) : (
            results.map(n => (
              <button
                key={n.id}
                type="button"
                className="list-item"
                onClick={() =>
                  onOpenNote(
                    n,
                    folderMap[n.folderId]
                      ? { id: n.folderId, name: folderMap[n.folderId] }
                      : { id: '__all__', name: 'All Notes' }
                  )
                }
              >
                <div className="list-item-body">
                  <div className="list-item-title">
                    {highlightMatch(n.title || 'New Note', query)}
                  </div>
                  <div className="list-item-subtitle">
                    {highlightMatch(
                      (n.body || '')
                        .replace(/^\s*#{1,6}\s+/gm, '')
                        .replace(/^\s*-\s*\[[ xX]\]\s*/gm, '')
                        .replace(/\*\*([^*]+)\*\*/g, '$1')
                        .replace(/`([^`]+)`/g, '$1')
                        .replace(/\n+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 70) || 'No additional text',
                      query
                    )}
                  </div>
                </div>
                <span className="list-item-meta">
                  {folderMap[n.folderId] || 'Note'}
                  <ChevronRight size={16} className="list-item-chevron" />
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 1. Compact 1-Line Smart Context Strip (Live/Next Class, Due Review, New Prof Files, or Urgent Task) */}
      {(upNextClass || dueCardsCount > 0 || urgentHeadline || newCanvasFilesCount > 0) && (
        <div className="home-context-row">
          {urgentHeadline && (
            <button
              type="button"
              className="home-context-pill is-urgent"
              onClick={onOpenPlanner}
            >
              <Bell size={13} />
              <span>{urgentHeadline}</span>
            </button>
          )}
          {newCanvasFilesCount > 0 && onOpenCourses && (
            <button
              type="button"
              className="home-context-pill is-files"
              onClick={() => onOpenCourses({ openCanvasFiles: true })}
            >
              <FileDown size={13} />
              <span>
                {newCanvasFilesCount} new prof {newCanvasFilesCount === 1 ? 'file' : 'files'}
              </span>
            </button>
          )}
          {upNextClass && (
            <button
              type="button"
              className={`home-context-pill${upNextClass.status === 'now' ? ' is-live' : ''}`}
              onClick={() => onOpenPlanner?.('timetable')}
            >
              <Clock size={13} />
              <span>
                {upNextClass.status === 'now'
                  ? `LIVE · ${upNextClass.code} (${upNextClass.minutesLeft}m left)`
                  : upNextClass.status === 'today' && upNextClass.minutesUntil <= notifLeadMin
                    ? `In ${upNextClass.minutesUntil}m · ${upNextClass.code}`
                    : `${upNextClass.dayLabel} · ${upNextClass.code} ${upNextClass.timeRange}`}
              </span>
            </button>
          )}
          {dueCardsCount > 0 && (
            <button
              type="button"
              className="home-context-pill is-review"
              onClick={onOpenReview}
            >
              <Brain size={13} />
              <span>
                {dueCardsCount} due review{reviewStats.streak > 0 ? ` · ${reviewStats.streak}d` : ''}
              </span>
              {reviewStats.streak > 0 && <Flame size={12} />}
            </button>
          )}
        </div>
      )}

      {/* 2. Unified Campus Today Card (Announcements + Today's Schedule — 100% parity) */}
      {(onOpenAnnouncements || onOpenPlanner) && (
        <div className={`campus-today-card${annPreview.unread > 0 ? ' has-unread' : ''}`}>
          {onOpenAnnouncements && (
            <section className="campus-today-section" aria-label="Class Announcements Spotlight">
              <div className="home-ann-header">
                <button
                  type="button"
                  className="home-ann-title-btn"
                  onClick={onOpenAnnouncements}
                >
                  <span className="home-ann-icon home-ann-icon-spot">
                    <Megaphone size={16} />
                  </span>
                  <span className="home-ann-title">Announcements</span>
                  {annPreview.unread > 0 ? (
                    <span className="home-ann-badge is-new">{annPreview.unread} unread</span>
                  ) : annPreview.total > 0 ? (
                    <span className="home-ann-badge">{annPreview.total}</span>
                  ) : null}
                  {newCanvasFilesCount > 0 && onOpenCourses && (
                    <span
                      className="home-ann-badge is-new"
                      style={{ cursor: 'pointer' }}
                      onClick={e => {
                        e.stopPropagation();
                        onOpenCourses({ openCanvasFiles: true });
                      }}
                    >
                      {newCanvasFilesCount} {newCanvasFilesCount === 1 ? 'file' : 'files'}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-6">
                  {annPreview.unread > 0 && alertSummary?.unreadAnnouncements?.length > 0 && (
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => {
                        markAllAnnouncementsRead(alertSummary.unreadAnnouncements);
                        refresh();
                      }}
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Sync announcements"
                    title="Sync Canvas announcements"
                    disabled={syncingAnn}
                    onClick={async () => {
                      setSyncingAnn(true);
                      try {
                        const { autoSyncCanvasIfStale } = await import('../lib/canvasSync');
                        const res = await autoSyncCanvasIfStale({ force: true });
                        await refresh();
                        if (res?.reason === 'unconfigured') {
                          onOpenAnnouncements();
                        } else if (res?.error) {
                          toast(res.error, { type: 'error' });
                        } else {
                          toast(
                            res?.added > 0
                              ? `Synced — ${res.added} new post${res.added === 1 ? '' : 's'}`
                              : 'Announcements up to date'
                          );
                        }
                      } finally {
                        setSyncingAnn(false);
                      }
                    }}
                  >
                    <RefreshCw size={14} className={syncingAnn ? 'spin-icon' : ''} />
                  </button>
                  <button
                    type="button"
                    className="row-action-chip active-chip"
                    onClick={onOpenAnnouncements}
                  >
                    View All <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {annPreview.latest.length === 0 ? (
                <button
                  type="button"
                  className="home-ann-empty"
                  onClick={onOpenAnnouncements}
                >
                  <span>Connect Canvas RSS feeds or paste teacher announcements so updates appear right here.</span>
                  <ChevronRight size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
                </button>
              ) : (
                <div className="home-ann-items">
                  {annPreview.latest.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`home-ann-item${!item._read ? ' is-unread' : ''}`}
                      onClick={onOpenAnnouncements}
                    >
                      <div className="home-ann-item-top">
                        {!item._read && <span className="ann-unread-dot" />}
                        {item.pinned && <Pin size={11} style={{ color: 'var(--mistake)', flexShrink: 0 }} />}
                        <span className="home-ann-course">{item.course || 'Canvas'}</span>
                        <span className="home-ann-date">{item.timeLabel || item.dateKey}</span>
                      </div>
                      <div className="home-ann-item-title">{item.title}</div>
                      {item._scheduleCompact && (
                        <div className="home-ann-sched">
                          <Clock size={11} style={{ flexShrink: 0 }} />
                          <span>{item._scheduleCompact}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-6" style={{ flexWrap: 'wrap' }}>
                        {item.author && (
                          <div className="home-ann-item-sub">by {item.author}</div>
                        )}
                        {item._quickLink && (
                          <a
                            href={item._quickLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="home-ann-link-chip"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink size={10} /> {item._quickLink.label}
                          </a>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {onOpenAnnouncements && onOpenPlanner && <div className="campus-today-divider" />}

          {onOpenPlanner && (
            <section className="campus-today-section" aria-label="Today's Class Schedule Spotlight">
              <div className="home-ann-header">
                <button
                  type="button"
                  className="home-ann-title-btn"
                  onClick={() => onOpenPlanner('timetable')}
                >
                  <span className="home-ann-icon home-sched-icon">
                    <CalendarDays size={16} />
                  </span>
                  <span className="home-ann-title">Today&apos;s Schedule</span>
                  {gecBanner && (
                    <span className={gecBanner.kind === 'special' ? 'gec-badge-special' : 'home-ann-badge'}>
                      {gecBanner.text}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={() => onOpenPlanner('calendar')}
                  >
                    School Cal
                  </button>
                  <button
                    type="button"
                    className="row-action-chip active-chip"
                    onClick={() => onOpenPlanner('timetable')}
                  >
                    Timetable <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {todaySchedule.length > 0 ? (
                <div className="home-sched-items">
                  {todaySchedule.map(cls => (
                    <button
                      key={cls.id}
                      type="button"
                      className={`home-sched-row${cls.isLive ? ' is-live' : ''}`}
                      style={{ borderLeftColor: cls.color }}
                      onClick={() => onOpenPlanner('timetable')}
                    >
                      <div className="home-sched-row-top">
                        <span className="home-sched-code">{cls.code}</span>
                        {cls.isLive && <span className="home-sched-live-dot">LIVE</span>}
                        {cls.gecMod?.mode === 'f2f' && (
                          <span className="gec-badge-f2f">F2F{cls.room ? ` · ${cls.room}` : ''}</span>
                        )}
                        {cls.gecMod?.mode === 'virtual' && (
                          <span className="gec-badge-virtual">VIRTUAL</span>
                        )}
                        {cls.gecMod?.mode === 'special' && (
                          <span className="gec-badge-special">{cls.gecMod.label}</span>
                        )}
                        {!cls.gecMod && cls.room && (
                          <span className="home-sched-room">{cls.room}</span>
                        )}
                      </div>
                      <div className="home-sched-time">{cls.timeRange} · {cls.kind}</div>
                    </button>
                  ))}
                </div>
              ) : upNextClass ? (
                <button
                  type="button"
                  className="home-ann-empty"
                  onClick={() => onOpenPlanner('timetable')}
                >
                  <span>
                    No classes today · Next: <strong>{upNextClass.code}</strong> ({upNextClass.dayLabel} {upNextClass.timeRange}
                    {upNextClass.room ? ` · ${upNextClass.room}` : ''})
                  </span>
                  <ChevronRight size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
                </button>
              ) : (
                <button
                  type="button"
                  className="home-ann-empty"
                  onClick={() => onOpenPlanner('timetable')}
                >
                  <span>Import your Study Load PDF &amp; GEC F2F/Virtual sheet so today&apos;s classes appear right here.</span>
                  <ChevronRight size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
                </button>
              )}
            </section>
          )}
        </div>
      )}

      {/* Compact Setup & Tour Nudge for New Unconfigured Users */}
      {!setupBannerDismissed &&
        courseCount === 0 &&
        !getDirectConfig().key?.trim() &&
        (onOpenSetupWizard || onOpenFeatureGuide) && (
          <div className="home-setup-nudge">
            <div className="flex items-center gap-8" style={{ flex: 1, minWidth: 0 }}>
              <span className="home-stat-icon tone-indigo" style={{ flexShrink: 0 }}>
                <Compass size={15} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Quick Setup &amp; Tour
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Import schedule, connect free AI, or explore tools
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className="row-action-chip active-chip"
                onClick={() => (onOpenSetupWizard ? onOpenSetupWizard() : onOpenFeatureGuide?.())}
              >
                Start
              </button>
              <button
                type="button"
                className="row-icon-btn"
                aria-label="Dismiss setup banner"
                onClick={() => {
                  setSetupBannerDismissed(true);
                  try {
                    localStorage.setItem(SETUP_BANNER_DISMISSED_KEY, 'true');
                  } catch {
                    // ignore
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

      {/* 3. Recent & Pinned Notes Carousel */}
      <div className="home-section-row">
        <div className="section-heading" style={{ padding: 0 }}>Recent &amp; Pinned</div>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="row-action-chip"
            onClick={() => onOpenFolder({ id: '__all__', name: 'All Notes', isSmart: true })}
          >
            <FileText size={11} /> All ({totalNotes})
          </button>
          {pinnedCount > 0 && (
            <button
              type="button"
              className="row-action-chip"
              onClick={() => onOpenFolder({ id: '__pinned__', name: 'Pinned', isSmart: true })}
            >
              <Pin size={11} /> {pinnedCount}
            </button>
          )}
        </div>
      </div>

      {recentNotes.length > 0 && (
        <div className="recent-notes-strip" role="region" aria-label="Recent and pinned notes">
          {recentNotes.map(rn => (
            <button
              key={rn.id}
              type="button"
              className={`recent-note-card${rn.pinned ? ' is-pinned' : ''}`}
              onClick={async () => {
                const full = await db.notes.get(rn.id);
                if (!full) return;
                const targetF = folders.find(f => f.id === full.folderId) || {
                  id: '__all__',
                  name: rn.folderName || 'All Notes',
                };
                onOpenNote(full, targetF);
              }}
            >
              <div className="recent-note-top">
                <span className="recent-note-folder">{rn.folderName}</span>
                {rn.pinned && <Pin size={11} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} />}
              </div>
              <div className="recent-note-title">{rn.title}</div>
              <div className="recent-note-preview">{rn.preview}</div>
              <div className="recent-note-foot">{formatShortAge(rn.updatedAt)}</div>
            </button>
          ))}
        </div>
      )}

      {/* 4. Compact Quick Capture Row */}
      <div className="quick-action-row home-capture-strip">
        <button
          type="button"
          className="quick-action-chip"
          onClick={() => setImportOpen(true)}
        >
          <span className="quick-action-icon tone-indigo">
            <FileUp size={14} />
          </span>
          <span>Import PDF/Doc</span>
        </button>
        <button
          type="button"
          className="quick-action-chip"
          onClick={() => setTemplatesOpen(true)}
        >
          <span className="quick-action-icon tone-amber">
            <LayoutTemplate size={14} />
          </span>
          <span>Templates</span>
        </button>
        <button
          type="button"
          className="quick-action-chip"
          onClick={() => setRecorderOpen(true)}
        >
          <span className="quick-action-icon tone-rose">
            <Mic size={14} />
          </span>
          <span>Record</span>
        </button>
        {onOpenSyllabus && (
          <button
            type="button"
            className="quick-action-chip"
            onClick={onOpenSyllabus}
          >
            <span className="quick-action-icon tone-emerald">
              <Sparkles size={14} />
            </span>
            <span>Syllabus AI</span>
          </button>
        )}
      </div>

      {/* Hidden Vault Section — completely invisible when locked, revealed only when unlocked */}
      {vaultUnlocked && vaultFolders.length > 0 && (
        <>
          <div
            className="section-heading"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingRight: 16,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Shield size={13} /> Hidden Vault
            </span>
            <div className="flex items-center gap-6">
              {vaultMode === 'real' && (
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => setDecoyMenuOpen(true)}
                  title="Manage Stealth Decoy Vault"
                >
                  Decoy
                </button>
              )}
              <button
                type="button"
                className="row-action-chip"
                onClick={() => {
                  lockVault();
                  toast('Hidden Vault locked & concealed');
                }}
                title="Lock and hide vault folders now"
              >
                <EyeOff size={12} /> Hide &amp; Lock
              </button>
            </div>
          </div>
          <div className="list-group">
            {vaultFolders.map(folder => (
              <div
                key={folder.id}
                className="list-item"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (longPressedRef.current) {
                    longPressedRef.current = false;
                    return;
                  }
                  handleFolderClick(folder);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFolderClick(folder);
                  }
                }}
                onTouchStart={() => startLongPress(folder)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onContextMenu={e => {
                  e.preventDefault();
                  setMenuFolder(folder);
                }}
              >
                <span className="list-item-icon">
                  {folder.isSystemVault ? <KeyRound size={17} /> : <Lock size={16} />}
                </span>
                <div className="list-item-body">
                  <div className="list-item-title">
                    <span>{folder.name}</span>
                    {folder.isSystemVault ? (
                      <span className="mode-badge mode-vault">Zero-AI</span>
                    ) : (
                      <>
                        {folder.mode && folder.mode !== 'study' && (
                          <span className={`mode-badge mode-${folder.mode}`}>
                            {getModeMeta(folder.mode).badge}
                          </span>
                        )}
                        <span className="mode-badge mode-vault">Hidden</span>
                      </>
                    )}
                  </div>
                  <div className="list-item-subtitle">
                    {folder.isSystemVault
                      ? `${folder.noteCount} record${folder.noteCount === 1 ? '' : 's'} · 100% local · Zero AI access`
                      : `${folder.noteCount} note${folder.noteCount === 1 ? '' : 's'} · Concealed when locked`}
                  </div>
                </div>
                <div className="list-item-meta">
                  <button
                    type="button"
                    className="row-icon-btn"
                    aria-label={`More actions for ${folder.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      setMenuFolder(folder);
                    }}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  <ChevronRight size={17} className="list-item-chevron" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 5. 2-Column Subject Folders Grid */}
      <div className="home-section-row">
        <div className="section-heading" style={{ padding: 0 }}>Subjects</div>
        <button
          type="button"
          className="row-action-chip"
          onClick={handleNewFolder}
        >
          <FolderPlus size={12} /> New Folder
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="list-group">
          <div className="list-item list-item-static">
            <span className="list-item-subtitle">No folders yet — tap New Folder to add one.</span>
          </div>
        </div>
      ) : (
        <div className="folder-grid-2col">
          {folders.map(folder => (
            <div
              key={folder.id}
              className="folder-grid-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (longPressedRef.current) {
                  longPressedRef.current = false;
                  return;
                }
                handleFolderClick(folder);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleFolderClick(folder);
                }
              }}
              onTouchStart={() => startLongPress(folder)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onContextMenu={e => {
                e.preventDefault();
                setMenuFolder(folder);
              }}
            >
              <div className="folder-grid-top">
                <span className={`list-item-icon folder-icon-badge ${getFolderBadgeClass(folder, vaultUnlocked)}`}>
                  {folder.locked && !vaultUnlocked ? <Lock size={15} /> : <Folder size={16} />}
                </span>
                <div className="flex items-center gap-4">
                  {folder.noteCount > 0 && !(folder.locked && !vaultUnlocked) && folder.mode !== 'journal' && (
                    <button
                      type="button"
                      className="row-icon-btn"
                      aria-label={`Exam summary for ${folder.name}`}
                      title="Exam summary & paper builder"
                      onClick={e => {
                        e.stopPropagation();
                        onOpenExam?.(folder);
                      }}
                    >
                      <GraduationCap size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="row-icon-btn"
                    aria-label={`More actions for ${folder.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      setMenuFolder(folder);
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>

              <div className="folder-grid-name">{folder.name}</div>
              <div className="folder-grid-meta">
                <span>
                  {folder.locked && !vaultUnlocked
                    ? 'PIN locked'
                    : `${folder.noteCount} note${folder.noteCount === 1 ? '' : 's'}`}
                </span>
                {folder.mode && folder.mode !== 'study' && (
                  <span className={`mode-badge mode-${folder.mode}`}>
                    {getModeMeta(folder.mode).badge}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <>
          <div className="section-heading">Tags</div>
          <div className="tag-bar">
            {tags.slice(0, 14).map(t => (
              <button
                key={t.name}
                type="button"
                className="tag-pill"
                onClick={() =>
                  onOpenFolder({ id: `__tag:${t.name}`, name: `#${t.name}`, isSmart: true })
                }
              >
                <Hash size={12} />
                {t.name}
                <span style={{ opacity: 0.65 }}>{t.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Recently Deleted — positioned at bottom like iOS Notes */}
      <div className="list-group" style={{ marginTop: 12 }}>
        <button type="button" className="list-item" onClick={onOpenTrash}>
          <span className="list-item-icon danger">
            <Trash2 size={17} />
          </span>
          <div className="list-item-body">
            <div className="list-item-title">Recently Deleted</div>
            <div className="list-item-subtitle">Kept for 30 days</div>
          </div>
          <span className="list-item-meta">
            {trashCount > 0 && <span>{trashCount}</span>}
            <ChevronRight size={17} className="list-item-chevron" />
          </span>
        </button>
      </div>

      {/* Folder action sheet */}
      {menuFolder && (
        <div className="export-overlay" onClick={() => setMenuFolder(null)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">{menuFolder.name}</div>

            {menuFolder.isSystemVault ? (
              <>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-hover)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    marginBottom: 12,
                    lineHeight: 1.45,
                  }}
                >
                  <strong>🔒 Permanent Zero-AI Vault Folder</strong>
                  <div style={{ marginTop: 4 }}>
                    Records inside <strong>Passwords &amp; Keys</strong> are stored 100% locally on your device. No AI model, cloud API, search query, or background study feature can ever read or touch this folder.
                  </div>
                </div>
                <button
                  type="button"
                  className="export-btn"
                  onClick={() => {
                    setMenuFolder(null);
                    lockVault();
                    toast('Hidden Vault locked & concealed');
                  }}
                >
                  <EyeOff size={18} /> Hide &amp; Lock Vault Now
                </button>
              </>
            ) : (
              <>
                <div className="settings-label" style={{ marginBottom: 6 }}>Folder Mode</div>
                <div className="mode-picker-row" style={{ marginBottom: 12 }}>
                  {NOTE_MODE_LIST.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className={`mode-pick-chip${(menuFolder.mode || 'study') === m.id ? ' active' : ''}`}
                      onClick={() => handleSetFolderMode(menuFolder, m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="export-btn"
                  onClick={() => handleToggleFolderLock(menuFolder)}
                >
                  {menuFolder.locked ? <Unlock size={18} /> : <Lock size={18} />}
                  {menuFolder.locked
                    ? 'Remove PIN lock (requires PIN)'
                    : 'Move to Hidden Vault (PIN Lock)'}
                </button>

                {menuFolder.noteCount > 0 && menuFolder.mode !== 'journal' && (
                  <button
                    type="button"
                    className="export-btn"
                    onClick={() => {
                      const f = menuFolder;
                      setMenuFolder(null);
                      onOpenExam?.(f);
                    }}
                  >
                    <GraduationCap size={18} /> Exam Summary &amp; Paper
                  </button>
                )}
                <button
                  type="button"
                  className="export-btn"
                  onClick={() => handleRename(menuFolder)}
                >
                  <Folder size={18} /> Rename folder
                </button>
                <button
                  type="button"
                  className="export-btn danger"
                  onClick={() => handleDelete(menuFolder)}
                >
                  <Trash2 size={18} /> Delete folder
                </button>
              </>
            )}
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setMenuFolder(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {templatesOpen && (
        <Suspense fallback={null}>
          <TemplatePickerSheet
            onPick={handlePickTemplate}
            onClose={() => setTemplatesOpen(false)}
          />
        </Suspense>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <ImportSheet
            onImported={(created, targetFolder) => {
              setImportOpen(false);
              refresh();
              onOpenNote(created, targetFolder);
            }}
            onImportedSchedule={() => {
              setImportOpen(false);
              refresh();
              onOpenCourses?.({ section: 'schedule' });
            }}
            onClose={() => setImportOpen(false)}
          />
        </Suspense>
      )}

      {pinRequest && (
        <Suspense fallback={null}>
          <PinLockSheet
            mode={pinRequest.mode}
            title={pinRequest.title}
            onSuccess={() => {
              const done = pinRequest.onDone;
              setPinRequest(null);
              done?.();
            }}
            onClose={() => setPinRequest(null)}
          />
        </Suspense>
      )}

      {recorderOpen && (
        <Suspense fallback={null}>
          <LectureRecorderSheet
            onSaved={(created, targetFolder) => {
              setRecorderOpen(false);
              refresh();
              onOpenNote(created, targetFolder || { id: '__all__', name: 'All Notes' });
            }}
            onClose={() => setRecorderOpen(false)}
          />
        </Suspense>
      )}

      {/* Real-Vault-Only Stealth Decoy Controls Modal */}
      {decoyMenuOpen && vaultMode === 'real' && (
        <div className="export-overlay" onClick={() => setDecoyMenuOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Stealth Decoy Vault Controls">
            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <div className="export-title" style={{ margin: 0 }}>Stealth Decoy Vault Controls</div>
              <button type="button" className="icon-btn" onClick={() => setDecoyMenuOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="settings-help" style={{ marginTop: 0 }}>
              {getDecoyConfig().enabled
                ? `Stealth Decoy is ACTIVE. Hold digit "${getDecoyConfig().triggerDigit}" on the PIN pad then enter any 4–6 digits to open your Dummy Vault.`
                : 'Stealth Decoy is currently OFF. You can enable it here or via Settings.'}
            </p>
            <div className="settings-label mt-10">Long-Press Trigger Digit</div>
            <div className="flex gap-6 mt-6" style={{ flexWrap: 'wrap' }}>
              {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button
                  key={d}
                  type="button"
                  className={`row-action-chip${getDecoyConfig().enabled && getDecoyConfig().triggerDigit === d ? ' active-chip' : ''}`}
                  onClick={() => {
                    updateDecoyTriggerDigit(d);
                    refresh();
                    toast(`Stealth trigger digit set to "${d}"`, { type: 'success' });
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
            {(summary.decoyVaultFolders || []).length > 0 && (
              <button
                type="button"
                className="export-btn mt-12"
                onClick={() => {
                  const df = summary.decoyVaultFolders[0];
                  setDecoyMenuOpen(false);
                  onOpenFolder(df);
                }}
              >
                <Folder size={17} /> Edit Dummy Vault Notes
              </button>
            )}
            {getDecoyConfig().enabled && (
              <button
                type="button"
                className="export-btn danger"
                onClick={() => {
                  disableDecoyVault();
                  setDecoyMenuOpen(false);
                  refresh();
                  toast('Stealth Decoy Vault turned OFF (option restored in Settings)');
                }}
              >
                Turn Off Stealth Decoy Vault
              </button>
            )}
            <button type="button" className="export-btn cancel" onClick={() => setDecoyMenuOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Quick New Note Pill FAB */}
      <button
        type="button"
        className="fab fab-pill"
        onClick={handleQuickNewNote}
        aria-label="New note"
        title="New note"
      >
        <SquarePen size={18} />
        <span>New Note</span>
      </button>
    </div>
  );
}
