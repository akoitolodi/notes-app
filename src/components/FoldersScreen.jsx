/**
 * Folders screen — iOS Notes style with Smart Views (All Notes, Pinned, Tags),
 * subject folders, quick New Note FAB, debounced global search with match
 * highlighting, and Recently Deleted at the bottom.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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
import { instantiateTemplate } from '../lib/templates';
import { getReviewStats } from '../lib/spacedRepetition';
import { NOTE_MODE_LIST, getModeMeta } from '../lib/noteModes';
import { isDevToolkitEnabled } from '../lib/aiConfig';
import {
  isVaultUnlocked,
  hasVaultPin,
  lockVault,
  subscribeVault,
} from '../lib/vault';
import TemplatePickerSheet from './TemplatePickerSheet';
import ImportSheet from './ImportSheet';
import PinLockSheet from './PinLockSheet';
import { useDialog } from './ui/DialogProvider';

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
  onOpenToolkit,
  onOpenTrash,
  onOpenSettings,
}) {
  const { confirm, prompt, toast } = useDialog();
  const [summary, setSummary] = useState({
    folders: [],
    totalNotes: 0,
    pinnedCount: 0,
    trashCount: 0,
    dueCardsCount: 0,
    totalCardsCount: 0,
    hasLockedFolders: false,
    tags: [],
  });
  const [reviewStats, setReviewStats] = useState(() => getReviewStats());
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isVaultUnlocked());
  const [pinRequest, setPinRequest] = useState(null); // { mode: 'unlock'|'setup', onDone }
  const [showToolkit, setShowToolkit] = useState(() => isDevToolkitEnabled());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
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
    setSummary(await getHomeSummary());
    setReviewStats(getReviewStats());
    setShowToolkit(isDevToolkitEnabled());
    setVaultUnlocked(isVaultUnlocked());
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
    if (!searching || !query.trim()) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      searchNotes(query, null, 'edited').then(async r => {
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
  }, [query, searching]);

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

  const handleQuickNewNote = async () => {
    const defaultFolder =
      summary.folders.find(f => f.name === 'General') || summary.folders[0];
    const created = await createNote(defaultFolder?.id);
    onOpenNote(created, defaultFolder || { id: '__all__', name: 'All Notes' }, { startInEdit: true });
  };

  const handlePickTemplate = async templateId => {
    setTemplatesOpen(false);
    const defaultFolder =
      summary.folders.find(f => f.name === 'General') || summary.folders[0];
    const { title, body } = instantiateTemplate(templateId);
    const created = await createNote(
      defaultFolder?.id,
      title,
      body,
      defaultFolder?.name || 'General'
    );
    onOpenNote(created, defaultFolder || { id: '__all__', name: 'All Notes' }, { startInEdit: true });
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
    await updateFolder(folder.id, { mode: nextMode });
    toast(`"${folder.name}" set to ${getModeMeta(nextMode).label} mode`);
    refresh();
  };

  const handleToggleFolderLock = async folder => {
    setMenuFolder(null);
    if (folder.locked) {
      const doUnlock = async () => {
        await updateFolder(folder.id, { locked: false });
        toast(`Removed PIN lock from "${folder.name}"`);
        refresh();
      };
      if (!isVaultUnlocked() && hasVaultPin()) {
        setPinRequest({
          mode: 'unlock',
          title: `Unlock "${folder.name}"`,
          onDone: doUnlock,
        });
      } else {
        await doUnlock();
      }
      return;
    }

    const doLock = async () => {
      await updateFolder(folder.id, { locked: true });
      lockVault();
      toast(`"${folder.name}" locked & hidden from All Notes & Search`, { type: 'success' });
      refresh();
    };
    if (!hasVaultPin()) {
      setPinRequest({
        mode: 'setup',
        title: `Lock "${folder.name}"`,
        onDone: doLock,
      });
    } else {
      await doLock();
    }
  };

  const { folders, totalNotes, pinnedCount, trashCount, dueCardsCount = 0, totalCardsCount = 0, hasLockedFolders = false, tags } = summary;

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <span className="navbar-title" style={{ opacity: 0 }}>Folders</span>
        <div className="flex items-center gap-6">
          {hasLockedFolders && vaultUnlocked && (
            <button
              type="button"
              className="navbar-btn"
              aria-label="Lock private vault"
              title="Lock private vault now"
              onClick={() => {
                lockVault();
                toast('Private vault locked');
              }}
            >
              <Lock size={18} />
            </button>
          )}
          <button
            className={`navbar-btn${searching ? ' navbar-btn-active' : ''}`}
            aria-label="Search all notes"
            onClick={toggleSearch}
          >
            <Search size={19} />
          </button>
          <button className="navbar-btn" aria-label="Settings" onClick={onOpenSettings}>
            <Settings size={19} />
          </button>
          <button className="navbar-btn" aria-label="New folder" onClick={handleNewFolder}>
            <FolderPlus size={20} />
          </button>
        </div>
      </header>

      <div className="large-title">Folders</div>

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

      {/* Daily Spaced Repetition Review Card */}
      <button
        type="button"
        className={`review-banner${dueCardsCount > 0 ? ' has-due' : ''}`}
        onClick={onOpenReview}
      >
        <span className="review-banner-icon">
          <Brain size={20} />
        </span>
        <div className="review-banner-body">
          <div className="review-banner-title">Daily Review</div>
          <div className="review-banner-sub">
            {totalCardsCount === 0
              ? 'Spaced repetition · Tap Explain on a note'
              : dueCardsCount > 0
                ? `${dueCardsCount} card${dueCardsCount === 1 ? '' : 's'} due across your subjects`
                : `All caught up · ${totalCardsCount} card${totalCardsCount === 1 ? '' : 's'} scheduled`}
          </div>
        </div>
        <div className="review-banner-right">
          {reviewStats.streak > 0 && (
            <span className="streak-pill">
              <Flame size={13} /> {reviewStats.streak}d
            </span>
          )}
          <ChevronRight size={17} className="list-item-chevron" />
        </div>
      </button>

      {/* Smart Collections */}
      <div className="list-group">
        <button
          type="button"
          className="list-item"
          onClick={() => onOpenFolder({ id: '__all__', name: 'All Notes', isSmart: true })}
        >
          <span className="list-item-icon">
            <FileText size={17} />
          </span>
          <div className="list-item-body">
            <div className="list-item-title">All Notes</div>
          </div>
          <span className="list-item-meta">
            <span>{totalNotes}</span>
            <ChevronRight size={17} className="list-item-chevron" />
          </span>
        </button>

        {pinnedCount > 0 && (
          <button
            type="button"
            className="list-item"
            onClick={() => onOpenFolder({ id: '__pinned__', name: 'Pinned', isSmart: true })}
          >
            <span className="list-item-icon">
              <Pin size={17} />
            </span>
            <div className="list-item-body">
              <div className="list-item-title">Pinned</div>
            </div>
            <span className="list-item-meta">
              <span>{pinnedCount}</span>
              <ChevronRight size={17} className="list-item-chevron" />
            </span>
          </button>
        )}
      </div>

      {/* Quick Creation & Import Row */}
      <div className="quick-action-row">
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => setImportOpen(true)}
        >
          <FileUp size={16} />
          <span>Import PDF / Slides</span>
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => setTemplatesOpen(true)}
        >
          <LayoutTemplate size={16} />
          <span>Templates</span>
        </button>
      </div>

      {/* Optional Dev & IT Toolkit Add-on (toggleable in Settings) */}
      {showToolkit && (
        <div className="list-group" style={{ marginTop: 8, marginBottom: 8 }}>
          <button type="button" className="list-item" onClick={onOpenToolkit}>
            <span className="list-item-icon">
              <Wrench size={17} />
            </span>
            <div className="list-item-body">
              <div className="list-item-title">Dev &amp; IT Toolkit</div>
              <div className="list-item-subtitle">
                Offline IT tools &amp; cheat sheets
              </div>
            </div>
            <ChevronRight size={17} className="list-item-chevron" />
          </button>
        </div>
      )}

      {/* Subject Folders */}
      <div className="section-heading">Subjects</div>
      <div className="list-group">
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
              <span className="list-item-icon">
                {folder.locked && !vaultUnlocked ? <Lock size={16} /> : <Folder size={17} />}
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
              {menuFolder.locked ? 'Remove PIN lock' : 'Lock folder with PIN (Private)'}
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
        <TemplatePickerSheet
          onPick={handlePickTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {importOpen && (
        <ImportSheet
          onImported={(created, targetFolder) => {
            setImportOpen(false);
            refresh();
            onOpenNote(created, targetFolder);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {pinRequest && (
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
      )}

      {/* Quick New Note FAB */}
      <button
        type="button"
        className="fab"
        onClick={handleQuickNewNote}
        aria-label="New note"
        title="New note"
      >
        <SquarePen size={22} />
      </button>
    </div>
  );
}
