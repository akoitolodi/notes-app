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
} from 'lucide-react';
import {
  db,
  getHomeSummary,
  createFolder,
  deleteFolder,
  renameFolder,
  searchNotes,
  createNote,
} from '../store/db';
import { instantiateTemplate } from '../lib/templates';
import { getReviewStats } from '../lib/spacedRepetition';
import TemplatePickerSheet from './TemplatePickerSheet';
import ImportSheet from './ImportSheet';
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
    tags: [],
  });
  const [reviewStats, setReviewStats] = useState(() => getReviewStats());
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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

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

  const { folders, totalNotes, pinnedCount, trashCount, dueCardsCount = 0, totalCardsCount = 0, tags } = summary;

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <span className="navbar-title" style={{ opacity: 0 }}>Folders</span>
        <div className="flex items-center gap-6">
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
                      (n.body || 'No additional text').replace(/\n/g, ' ').slice(0, 70),
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
                onOpenFolder(folder);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenFolder(folder);
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
                <Folder size={17} />
              </span>
              <div className="list-item-body">
                <div className="list-item-title">{folder.name}</div>
                <div className="list-item-subtitle">
                  {folder.noteCount} note{folder.noteCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="list-item-meta">
                {folder.noteCount > 0 && (
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={e => {
                      e.stopPropagation();
                      onOpenExam?.(folder);
                    }}
                    title="Exam summary"
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
            {menuFolder.noteCount > 0 && (
              <button
                type="button"
                className="export-btn"
                onClick={() => {
                  const f = menuFolder;
                  setMenuFolder(null);
                  onOpenExam?.(f);
                }}
              >
                <GraduationCap size={18} /> Exam Summary
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
