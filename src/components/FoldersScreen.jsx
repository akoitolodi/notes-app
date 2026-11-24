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
  Wrench,
  KeyRound,
  Shield,
  EyeOff,
  Code2,
  Calendar,
  BookOpen,
  Bell,
  Megaphone,
  RefreshCw,
  Palette,
} from 'lucide-react';
import {
  db,
  getHomeSummary,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolder,
  searchNotes,
  createNote,
} from '../store/db';
import { getReviewStats } from '../lib/spacedRepetition';
import { NOTE_MODE_LIST, getModeMeta } from '../lib/noteModes';
import { isDevToolkitEnabled, isLearnCodingEnabled } from '../lib/aiConfig';
import {
  isVaultUnlocked,
  hasVaultPin,
  lockVault,
  subscribeVault,
} from '../lib/vault';
import {
  getInAppAlertSummary,
  isAnnouncementRead,
  markAllAnnouncementsRead,
  snoozeInAppBanner,
} from '../lib/notifications';
import { useDialog } from './ui/DialogProvider';

const TemplatePickerSheet = lazy(() => import('./TemplatePickerSheet'));
const ImportSheet = lazy(() => import('./ImportSheet'));
const PinLockSheet = lazy(() => import('./PinLockSheet'));

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
};

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
  onOpenToolkit,
  onOpenCoding,
  onOpenTrash,
  onOpenSettings,
  onOpenThemes,
}) {
  const { confirm, prompt, toast } = useDialog();
  const [initialCache] = useState(() => readHomeCache());
  const [summary, setSummary] = useState(() =>
    initialCache?.summary ? { ...EMPTY_SUMMARY, ...initialCache.summary, vaultFolders: [] } : EMPTY_SUMMARY
  );
  const [reviewStats, setReviewStats] = useState(() => getReviewStats());
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isVaultUnlocked());
  const [pinRequest, setPinRequest] = useState(null); // { mode: 'unlock'|'setup', onDone }
  const [showToolkit, setShowToolkit] = useState(() => isDevToolkitEnabled());
  const [showCoding, setShowCoding] = useState(() => isLearnCodingEnabled());
  const [plannerDueCount, setPlannerDueCount] = useState(() => Number(initialCache?.plannerDueCount || 0));
  const [courseCount, setCourseCount] = useState(() => Number(initialCache?.courseCount || 0));
  const [annPreview, setAnnPreview] = useState(() =>
    initialCache?.annPreview || { total: 0, unread: 0, pinned: 0, latest: [] }
  );
  const [syncingAnn, setSyncingAnn] = useState(false);
  const [alertSummary, setAlertSummary] = useState(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState([]);
  const [folderMap, setFolderMap] = useState({});
  const [menuFolder, setMenuFolder] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
      const [homeSum, pItems, crs] = await Promise.all([
        getHomeSummary(),
        db.plannerItems.toArray().catch(() => []),
        db.courses.toArray().catch(() => []),
      ]);
      const alerts = await getInAppAlertSummary(pItems);
      const nextDueCount = pItems.filter(it => !it.done && it.type !== 'announcement').length;
      const nextCourseCount = crs.length;

      const anns = pItems
        .filter(it => it.type === 'announcement')
        .map(it => ({ ...it, _read: isAnnouncementRead(it) }))
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
      setShowToolkit(isDevToolkitEnabled());
      setShowCoding(isLearnCodingEnabled());
      setVaultUnlocked(isVaultUnlocked());
      setPlannerDueCount(nextDueCount);
      setCourseCount(nextCourseCount);
      setAlertSummary(alerts);
      setAnnPreview(nextAnnPreview);

      writeHomeCache({
        summary: { ...homeSum, vaultFolders: [] },
        plannerDueCount: nextDueCount,
        courseCount: nextCourseCount,
        annPreview: nextAnnPreview,
      });
    } catch {
      const homeSum = await getHomeSummary().catch(() => EMPTY_SUMMARY);
      setSummary(homeSum);
      setReviewStats(getReviewStats());
      setShowToolkit(isDevToolkitEnabled());
      setShowCoding(isLearnCodingEnabled());
      setVaultUnlocked(isVaultUnlocked());
      setPlannerDueCount(0);
      setCourseCount(0);
      setAlertSummary(null);
      setAnnPreview({ total: 0, unread: 0, pinned: 0, latest: [] });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    return subscribeVault(unlocked => {
      setVaultUnlocked(unlocked);
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
    totalCardsCount = 0,
    tags,
  } = summary;

  return (
    <div className="screen list-pad-bottom">
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
          <button className="navbar-btn navbar-glass-btn" aria-label="New folder" onClick={handleNewFolder}>
            <FolderPlus size={18} />
          </button>
        </div>
      </header>

      <div
        className="home-hero-header"
        onContextMenu={e => {
          e.preventDefault();
          handleToggleHiddenVault();
        }}
        title="Tap the lock icon in the top bar (or right-click/long-press here) to open Hidden Vault"
      >
        <div className="home-hero-eyebrow">{getStudioGreeting()}</div>
        <div className="home-hero-row">
          <h1 className="home-hero-title">Folders</h1>
          <span className="home-hero-sub">
            {totalNotes} {totalNotes === 1 ? 'note' : 'notes'} · {folders.length}{' '}
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

      {/* Persistent In-App Reminder Banner for Overdue / Due Today / Unread Canvas Announcements */}
      {alertSummary && alertSummary.totalUrgent > 0 && !alertSummary.snoozed && (
        <div className="sticky-alert-banner" role="alert">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <Bell size={17} style={{ color: '#ff375f', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>
                {[
                  alertSummary.overdue.length > 0 ? `${alertSummary.overdue.length} overdue` : '',
                  alertSummary.dueToday.length > 0 ? `${alertSummary.dueToday.length} due today` : '',
                  alertSummary.unreadAnnouncements.length > 0
                    ? `${alertSummary.unreadAnnouncements.length} new announcement${alertSummary.unreadAnnouncements.length === 1 ? '' : 's'}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {(alertSummary.overdue[0] || alertSummary.dueToday[0] || alertSummary.unreadAnnouncements[0])?.title}
              </div>
              <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                {(alertSummary.overdue.length > 0 || alertSummary.dueToday.length > 0) && (
                  <button type="button" className="row-action-chip active-chip" onClick={onOpenPlanner}>
                    View Tasks
                  </button>
                )}
                {alertSummary.unreadAnnouncements.length > 0 && onOpenAnnouncements && (
                  <button
                    type="button"
                    className="row-action-chip active-chip"
                    onClick={onOpenAnnouncements}
                  >
                    Open Announcements
                  </button>
                )}
                {alertSummary.overdue.length > 0 && (
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={async () => {
                      const { markPastTasksDone } = await import('../lib/canvasSync');
                      const n = await markPastTasksDone();
                      refresh();
                      toast(`Marked ${n} past/submitted item${n === 1 ? '' : 's'} as Done!`, { type: 'success' });
                    }}
                  >
                    ✓ Mark Overdue Done
                  </button>
                )}
                {alertSummary.unreadAnnouncements.length > 0 && (
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={() => {
                      markAllAnnouncementsRead(alertSummary.unreadAnnouncements);
                      refresh();
                    }}
                  >
                    Mark Posts Read
                  </button>
                )}
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => {
                    snoozeInAppBanner(60);
                    refresh();
                    toast('Reminder snoozed for 1 hour');
                  }}
                >
                  Snooze 1h
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compact 3-Chip Quick Stat Bento Strip */}
      <div className="home-stat-strip" role="region" aria-label="Quick Collections">
        <button
          type="button"
          className="home-stat-card"
          onClick={() => onOpenFolder({ id: '__all__', name: 'All Notes', isSmart: true })}
        >
          <div className="home-stat-top">
            <span className="home-stat-icon tone-indigo">
              <FileText size={15} />
            </span>
            <span className="home-stat-val">{totalNotes}</span>
          </div>
          <div className="home-stat-label">All Notes</div>
        </button>

        <button
          type="button"
          className="home-stat-card"
          onClick={() => onOpenFolder({ id: '__pinned__', name: 'Pinned', isSmart: true })}
        >
          <div className="home-stat-top">
            <span className="home-stat-icon tone-amber">
              <Pin size={15} />
            </span>
            <span className="home-stat-val">{pinnedCount}</span>
          </div>
          <div className="home-stat-label">Pinned</div>
        </button>

        <button
          type="button"
          className={`home-stat-card${dueCardsCount > 0 ? ' has-due' : ''}`}
          onClick={onOpenReview}
        >
          <div className="home-stat-top">
            <span className="home-stat-icon tone-violet">
              <Brain size={15} />
            </span>
            {reviewStats.streak > 0 ? (
              <span className="streak-pill" style={{ padding: '2px 6px', fontSize: 10.5 }}>
                <Flame size={10} /> {reviewStats.streak}d
              </span>
            ) : (
              <span className="home-stat-val">{dueCardsCount > 0 ? dueCardsCount : totalCardsCount}</span>
            )}
          </div>
          <div className="home-stat-label">
            {dueCardsCount > 0 ? `${dueCardsCount} Due Review` : 'Daily Review'}
          </div>
        </button>
      </div>

      {/* Dedicated Live Announcements Command Card */}
      {onOpenAnnouncements && (
        <section className={`home-ann-panel${annPreview.unread > 0 ? ' has-unread' : ''}`}>
          <div className="home-ann-header">
            <button
              type="button"
              className="home-ann-title-btn"
              onClick={onOpenAnnouncements}
            >
              <span className="home-ann-icon">
                <Megaphone size={17} />
              </span>
              <span className="home-ann-title">Announcements</span>
              {annPreview.unread > 0 ? (
                <span className="home-ann-badge is-new">{annPreview.unread} new</span>
              ) : annPreview.total > 0 ? (
                <span className="home-ann-badge">{annPreview.total}</span>
              ) : null}
            </button>
            <div className="flex items-center gap-6">
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
                className="row-action-chip"
                onClick={onOpenAnnouncements}
              >
                Open <ChevronRight size={13} />
              </button>
            </div>
          </div>

          {annPreview.latest.length === 0 ? (
            <button
              type="button"
              className="home-ann-empty"
              onClick={onOpenAnnouncements}
            >
              <span>Connect Canvas Course RSS feeds or paste class announcements so you never miss teacher updates.</span>
              <ChevronRight size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
            </button>
          ) : (
            <div className="home-ann-items">
              {annPreview.latest.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="home-ann-item"
                  onClick={onOpenAnnouncements}
                >
                  <div className="home-ann-item-top">
                    {!item._read && <span className="ann-unread-dot" />}
                    {item.pinned && <Pin size={11} style={{ color: '#ff9f0a', flexShrink: 0 }} />}
                    <span className="home-ann-course">{item.course || 'Canvas'}</span>
                    <span className="home-ann-date">{item.timeLabel || item.dateKey}</span>
                  </div>
                  <div className="home-ann-item-title">{item.title}</div>
                  {item.author && (
                    <div className="home-ann-item-sub">by {item.author}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Quick Creation & Import Row */}
      <div className="quick-action-row">
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => setImportOpen(true)}
        >
          <span className="quick-action-icon tone-indigo">
            <FileUp size={15} />
          </span>
          <span>Import PDF / Doc</span>
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => setTemplatesOpen(true)}
        >
          <span className="quick-action-icon tone-amber">
            <LayoutTemplate size={15} />
          </span>
          <span>Templates</span>
        </button>
      </div>

      {/* 2x2 Bento Workspace Hub Grid */}
      <div className="home-bento-grid" role="region" aria-label="Student Workspace Hubs">
        <button type="button" className="bento-tile bento-indigo" onClick={onOpenCourses}>
          <div className="bento-tile-top">
            <span className="bento-tile-icon">
              <BookOpen size={18} />
            </span>
            {courseCount > 0 && <span className="bento-tile-pill">{courseCount}</span>}
          </div>
          <div className="bento-tile-title">Courses</div>
          <div className="bento-tile-sub">Modules &amp; Course AI</div>
        </button>

        <button type="button" className="bento-tile bento-rose" onClick={onOpenPlanner}>
          <div className="bento-tile-top">
            <span className="bento-tile-icon">
              <Calendar size={18} />
            </span>
            {plannerDueCount > 0 && (
              <span className="bento-tile-pill is-alert">{plannerDueCount} due</span>
            )}
          </div>
          <div className="bento-tile-title">Planner &amp; Canvas</div>
          <div className="bento-tile-sub">Calendar, sync &amp; GWA</div>
        </button>

        {showCoding && (
          <button type="button" className="bento-tile bento-emerald" onClick={onOpenCoding}>
            <div className="bento-tile-top">
              <span className="bento-tile-icon">
                <Code2 size={18} />
              </span>
              <span className="bento-tile-pill">18 Langs</span>
            </div>
            <div className="bento-tile-title">Learn Coding</div>
            <div className="bento-tile-sub">Guides, runner &amp; algo</div>
          </button>
        )}

        {showToolkit && (
          <button type="button" className="bento-tile bento-violet" onClick={onOpenToolkit}>
            <div className="bento-tile-top">
              <span className="bento-tile-icon">
                <Wrench size={18} />
              </span>
              <span className="bento-tile-pill">Offline</span>
            </div>
            <div className="bento-tile-title">IT Toolkit</div>
            <div className="bento-tile-sub">Grapher, bugs &amp; tools</div>
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

      {/* Subject Folders */}
      <div className="section-heading">Subjects</div>
      <div className="list-group folder-cards-group">
        {folders.length === 0 ? (
          <div className="list-item list-item-static">
            <span className="list-item-subtitle">No folders yet — tap the + icon to add one.</span>
          </div>
        ) : (
          folders.map(folder => (
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
              <span className={`list-item-icon folder-icon-badge ${getFolderBadgeClass(folder, vaultUnlocked)}`}>
                {folder.locked && !vaultUnlocked ? <Lock size={15} /> : <Folder size={16} />}
              </span>
              <div className="list-item-body">
                <div className="list-item-title">
                  <span>{folder.name}</span>
                  {folder.mode && folder.mode !== 'study' && (
                    <span className={`mode-badge mode-${folder.mode}`}>
                      {getModeMeta(folder.mode).badge}
                    </span>
                  )}
                </div>
                <div className="list-item-subtitle">
                  {folder.locked && !vaultUnlocked
                    ? 'Private · PIN locked'
                    : `${folder.noteCount} note${folder.noteCount === 1 ? '' : 's'}`}
                </div>
              </div>
              <div className="list-item-meta">
                {folder.noteCount > 0 && !(folder.locked && !vaultUnlocked) && folder.mode !== 'journal' && (
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={e => {
                      e.stopPropagation();
                      onOpenExam?.(folder);
                    }}
                    title="Exam summary & paper builder"
                  >
                    <GraduationCap size={14} /> Exam
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
                  <MoreHorizontal size={17} />
                </button>
                <ChevronRight size={17} className="list-item-chevron" />
              </div>
            </div>
          ))
        )}
      </div>

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
