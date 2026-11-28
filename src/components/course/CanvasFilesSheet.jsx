/**
 * CanvasFilesSheet — Hybrid Canvas Course Files Sync & Selective 1-Tap Import Modal.
 * Follows Tactile Study Desk design tokens: Newsreader display heading, monospace metadata,
 * hairline rows, zero password collection (uses official school Canvas page session).
 */
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  RefreshCw,
  Download,
  CheckCircle2,
  LogIn,
  LogOut,
  FileText,
  Sparkles,
  Check,
  AlertCircle,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import { db, COURSE_PALETTE, createFolder } from '../../store/db';
import {
  isNativeCanvasAvailable,
  hasNativeCanvasSession,
  openNativeCanvasLogin,
  clearNativeCanvasSession,
  inferCanvasHost,
  normalizeCanvasHost,
  getCanvasFilesSnapshot,
  syncCanvasFilesCatalog,
  importCanvasFileToCourse,
  markCanvasFilesSeen,
  linkCanvasCourseIdInCatalog,
  formatFileSize,
  CANVAS_FILES_UPDATED_EVENT,
} from '../../lib/canvasFiles';
import { getCanvasSettings, saveCanvasSettings } from '../../lib/canvasSync';
import { useDialog } from '../ui/DialogProvider';

function formatRelativeTime(ts) {
  if (!ts) return 'Never checked';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Checked just now';
  if (diffMin < 60) return `Checked ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Checked ${diffHr}h ago`;
  return `Checked ${Math.floor(diffHr / 24)}d ago`;
}

function getFileExtBadge(fileName = '') {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(fileName || '').trim());
  return m ? m[1].toUpperCase() : 'FILE';
}

export default function CanvasFilesSheet({
  courses = [],
  initialCourseId = null,
  onImported = null,
  onCoursesChanged = null,
  onClose,
}) {
  const { toast } = useDialog();
  const nativeCapable = isNativeCanvasAvailable();

  const [snap, setSnap] = useState(() => getCanvasFilesSnapshot());
  const [hostDraft, setHostDraft] = useState(
    () => getCanvasFilesSnapshot().host || inferCanvasHost() || ''
  );
  const [filterTab, setFilterTab] = useState(() =>
    getCanvasFilesSnapshot().newCount > 0 ? 'new' : 'all'
  ); // new | all | imported
  const [courseFilterId, setCourseFilterId] = useState(() =>
    initialCourseId != null ? String(initialCourseId) : '__all__'
  );

  const [syncing, setSyncing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [batchImporting, setBatchImporting] = useState(false);
  const [importingId, setImportingId] = useState('');
  const [importProgressText, setImportProgressText] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const onUpdate = () => setSnap(getCanvasFilesSnapshot());
    window.addEventListener(CANVAS_FILES_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CANVAS_FILES_UPDATED_EVENT, onUpdate);
  }, []);

  const activeHost = useMemo(
    () => normalizeCanvasHost(hostDraft) || snap.host || inferCanvasHost(),
    [hostDraft, snap.host]
  );
  const hasToken = Boolean(getCanvasSettings().token);
  const hasNativeSess = activeHost ? hasNativeCanvasSession(activeHost) : false;
  const isConnected = !sessionExpired && (hasNativeSess || hasToken);

  const activeCourses = useMemo(
    () => (Array.isArray(courses) ? courses.filter(c => c && !c.archived) : []),
    [courses]
  );

  // Course filter options combining catalog canvas courses + local names
  const courseFilterChips = useMemo(() => {
    const map = new Map();
    for (const f of snap.files) {
      const k = f.localCourseId != null ? String(f.localCourseId) : `canvas:${f.canvasCourseId}`;
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          label: f.courseCode || f.courseName || 'Course',
          count: 0,
        });
      }
      map.get(k).count += 1;
    }
    return [...map.values()];
  }, [snap.files]);

  const filteredFiles = useMemo(() => {
    return snap.files.filter(f => {
      if (filterTab === 'new' && !f.isNew) return false;
      if (filterTab === 'imported' && !f.isImported) return false;
      if (courseFilterId !== '__all__') {
        const key = f.localCourseId != null ? String(f.localCourseId) : `canvas:${f.canvasCourseId}`;
        if (key !== courseFilterId && String(f.canvasCourseId) !== courseFilterId) return false;
      }
      return true;
    });
  }, [snap.files, filterTab, courseFilterId]);

  const pendingVisibleNew = useMemo(
    () => filteredFiles.filter(f => !f.isImported && f.localCourseId != null),
    [filteredFiles]
  );

  const handleSync = async (overrideHost = '') => {
    const targetHost = normalizeCanvasHost(overrideHost) || activeHost;
    if (!targetHost) {
      setErrorMsg('Enter your school Canvas URL (e.g. hnu.instructure.com).');
      return;
    }
    setErrorMsg('');
    setSyncing(true);
    try {
      saveCanvasSettings({ host: targetHost.replace(/^https?:\/\//i, '') });
      const res = await syncCanvasFilesCatalog({ host: targetHost, courses: activeCourses, notify: false });
      if (res.sessionExpired) {
        setSessionExpired(true);
        setErrorMsg('Canvas session expired — sign in again to check course files.');
        return;
      }
      setSessionExpired(false);
      setSnap(getCanvasFilesSnapshot());
      toast(
        res.newlyDetected.length > 0
          ? `Found ${res.newlyDetected.length} new prof file${res.newlyDetected.length === 1 ? '' : 's'}!`
          : `Checked ${res.courses.length} courses — files up to date`,
        { type: res.newlyDetected.length > 0 ? 'success' : 'info' }
      );
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to check Canvas files');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenLogin = async () => {
    const targetHost = normalizeCanvasHost(hostDraft);
    if (!targetHost) {
      setErrorMsg('Enter your school Canvas URL first (e.g. school.instructure.com).');
      return;
    }
    setErrorMsg('');
    setLoggingIn(true);
    try {
      saveCanvasSettings({ host: targetHost.replace(/^https?:\/\//i, '') });
      const res = await openNativeCanvasLogin(targetHost);
      if (res?.ok) {
        setSessionExpired(false);
        toast(
          res.userName ? `Signed in as ${res.userName}` : 'Signed in to Canvas!',
          { type: 'success' }
        );
        await handleSync(res.host || targetHost);
      } else if (!res?.cancelled) {
        setErrorMsg(res?.error || 'Sign-in did not complete.');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Could not open Canvas login.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSignOut = () => {
    clearNativeCanvasSession(activeHost);
    setSessionExpired(false);
    setSnap(getCanvasFilesSnapshot());
    toast('Canvas file session cleared on this device');
  };

  const handleCreateLinkedCourse = async canvasCourseId => {
    const meta = snap.courses.find(c => String(c.id) === String(canvasCourseId));
    if (!meta) return;
    const label = meta.code || meta.name || 'Canvas Course';
    const folderId = await createFolder(label.slice(0, 28), { mode: 'study', locked: false });
    const newRecord = {
      code: (meta.code || label).slice(0, 18),
      name: meta.name || label,
      icsCourseTag: meta.name || label,
      canvasCourseId: String(canvasCourseId),
      instructor: '',
      color: COURSE_PALETTE[activeCourses.length % COURSE_PALETTE.length],
      folderId,
      units: 3,
      archived: false,
      createdAt: Date.now(),
    };
    const id = await db.courses.add(newRecord);
    const created = { id, ...newRecord };
    await linkCanvasCourseIdInCatalog(canvasCourseId, created);
    setSnap(getCanvasFilesSnapshot());
    onCoursesChanged?.();
    toast(`Created "${created.code}" & linked Canvas files!`, { type: 'success' });
  };

  const handleImportSingle = async fileRec => {
    if (importingId || batchImporting) return;
    const target = activeCourses.find(c => c.id === fileRec.localCourseId);
    if (!target) {
      toast('Link or create a course card for this subject first.', { type: 'error' });
      return;
    }
    setImportingId(fileRec.canvasFileId);
    setImportProgressText('Downloading…');
    try {
      await importCanvasFileToCourse(fileRec, target, {
        onProgress: p => {
          setImportProgressText(
            p.phase === 'slides'
              ? `Slide ${p.current}/${p.total}…`
              : p.phase === 'docx'
                ? 'Reading doc…'
                : `Page ${p.current}/${p.total}…`
          );
        },
      });
      setSnap(getCanvasFilesSnapshot());
      onImported?.(target);
      toast(`Indexed "${fileRec.displayName}" into ${target.nickname || target.code}!`, {
        type: 'success',
      });
    } catch (err) {
      toast(`Import failed: ${err?.message || 'Unknown error'}`, { type: 'error', duration: 4200 });
    } finally {
      setImportingId('');
      setImportProgressText('');
    }
  };

  const handleImportAllPending = async () => {
    if (batchImporting || pendingVisibleNew.length === 0) return;
    setBatchImporting(true);
    let done = 0;
    try {
      for (const f of pendingVisibleNew.slice(0, 15)) {
        const target = activeCourses.find(c => c.id === f.localCourseId);
        if (!target) continue;
        setImportingId(f.canvasFileId);
        setImportProgressText(`${done + 1}/${pendingVisibleNew.length}`);
        await importCanvasFileToCourse(f, target).catch(() => null);
        done += 1;
      }
      setSnap(getCanvasFilesSnapshot());
      onImported?.();
      toast(`Imported & indexed ${done} Canvas file${done === 1 ? '' : 's'}!`, {
        type: 'success',
      });
    } finally {
      setBatchImporting(false);
      setImportingId('');
      setImportProgressText('');
    }
  };

  const modal = (
    <div className="export-overlay" onClick={syncing || batchImporting ? undefined : onClose}>
      <div
        className="export-sheet canvas-files-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Canvas Course Files"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
          <div>
            <h2 className="canvas-sheet-title">Canvas Course Files</h2>
            <div className="settings-help" style={{ margin: '2px 0 0' }}>
              Detect prof slides &amp; handouts even with API tokens disabled
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close Canvas Files"
            disabled={syncing || batchImporting}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Auth / Connection Strip */}
        {!isConnected ? (
          <div className="canvas-files-auth-card">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              School Canvas Domain
            </div>
            <input
              type="text"
              className="ai-input"
              style={{ marginTop: 0 }}
              placeholder="e.g. hnu.instructure.com"
              value={hostDraft}
              onChange={e => setHostDraft(e.target.value)}
              disabled={loggingIn || syncing}
            />
            {nativeCapable ? (
              <>
                <p className="settings-help" style={{ margin: '8px 0 10px' }}>
                  Signs in directly on your school&apos;s official Canvas page inside this app. Notes by Bai never reads or saves your password.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                  disabled={loggingIn || syncing || !hostDraft.trim()}
                  onClick={handleOpenLogin}
                >
                  <LogIn size={14} /> {loggingIn ? 'Waiting for Sign-In…' : 'Sign in to Canvas'}
                </button>
              </>
            ) : (
              <div className="canvas-web-note">
                <Smartphone size={16} style={{ flexShrink: 0, color: 'var(--accent-ink)' }} />
                <span>
                  Direct Canvas session sign-in runs inside the <strong>Notes by Bai Android APK</strong> (bypasses browser CORS cleanly). On Web/Desktop, use batch File Upload, Paste Google Docs/Slides links, or configure a token in School Planner if allowed by your school.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="canvas-files-status-bar">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="flex items-center gap-6">
                <span className="canvas-live-dot" />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeHost.replace(/^https?:\/\//i, '')}
                </span>
              </div>
              <div className="canvas-file-meta" style={{ marginTop: 2 }}>
                {snap.userName ? `${snap.userName} · ` : ''}
                {formatRelativeTime(snap.updatedAt)}
              </div>
            </div>
            <div className="flex items-center gap-6" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className="row-action-chip active-chip"
                disabled={syncing || batchImporting}
                onClick={() => handleSync()}
              >
                <RefreshCw size={12} className={syncing ? 'spin-icon' : ''} />
                {syncing ? 'Checking…' : 'Check Now'}
              </button>
              {hasNativeSess && (
                <button
                  type="button"
                  className="row-icon-btn"
                  aria-label="Sign out of Canvas"
                  title="Sign out"
                  onClick={handleSignOut}
                >
                  <LogOut size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="inline-mistake" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 12.5 }}>{errorMsg}</span>
          </div>
        )}

        {/* Filter Tabs & Course Chips */}
        {snap.files.length > 0 && (
          <>
            <div className="view-switcher" style={{ marginTop: 12, marginBottom: 8 }}>
              <button
                type="button"
                className={`view-switch-btn${filterTab === 'new' ? ' active' : ''}`}
                onClick={() => setFilterTab('new')}
              >
                New ({snap.newCount})
              </button>
              <button
                type="button"
                className={`view-switch-btn${filterTab === 'all' ? ' active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({snap.files.length})
              </button>
              <button
                type="button"
                className={`view-switch-btn${filterTab === 'imported' ? ' active' : ''}`}
                onClick={() => setFilterTab('imported')}
              >
                Imported ({snap.files.length - snap.unimportedFiles.length})
              </button>
            </div>

            {courseFilterChips.length > 1 && (
              <div className="ann-course-chips" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={`row-action-chip${courseFilterId === '__all__' ? ' active-chip' : ''}`}
                  onClick={() => setCourseFilterId('__all__')}
                >
                  All Courses
                </button>
                {courseFilterChips.map(ch => (
                  <button
                    key={ch.key}
                    type="button"
                    className={`row-action-chip${courseFilterId === ch.key ? ' active-chip' : ''}`}
                    onClick={() => setCourseFilterId(ch.key)}
                  >
                    {ch.label} ({ch.count})
                  </button>
                ))}
              </div>
            )}

            {(pendingVisibleNew.length > 1 || snap.newCount > 0) && (
              <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                {pendingVisibleNew.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={batchImporting || Boolean(importingId)}
                    onClick={handleImportAllPending}
                  >
                    <Download size={13} />
                    {batchImporting
                      ? `Importing (${importProgressText})…`
                      : `Import All Shown (${Math.min(15, pendingVisibleNew.length)})`}
                  </button>
                ) : (
                  <span />
                )}
                {snap.newCount > 0 && (
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={() => markCanvasFilesSeen()}
                  >
                    <Check size={12} /> Mark All Seen
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Detected Files List */}
        <div className="canvas-files-list">
          {snap.files.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              <FileText size={24} style={{ opacity: 0.45, marginBottom: 6 }} />
              <div>
                {isConnected
                  ? 'Tap "Check Now" to scan your active Canvas courses for module slides & handouts.'
                  : 'Once signed in, newly uploaded professor PDFs, slides & handouts appear right here.'}
              </div>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              {filterTab === 'new'
                ? 'All caught up — no unread professor files in this view.'
                : 'No matching Canvas files in this filter.'}
            </div>
          ) : (
            filteredFiles.map(f => {
              const busyThis = importingId === f.canvasFileId;
              const isLinked = f.localCourseId != null;
              return (
                <div key={f.canvasFileId} className="canvas-file-row">
                  <span className="canvas-file-badge">{getFileExtBadge(f.fileName)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center gap-6">
                      {f.isNew && <span className="canvas-new-dot" aria-label="New file" />}
                      <span className="canvas-file-title">{f.displayName}</span>
                    </div>
                    <div className="canvas-file-meta">
                      {f.courseCode} · {f.moduleName}
                      {f.size > 0 ? ` · ${formatFileSize(f.size)}` : ''}
                    </div>
                    {!isLinked && (
                      <div className="flex items-center gap-6 mt-6" style={{ flexWrap: 'wrap' }}>
                        {activeCourses.length > 0 && (
                          <select
                            className="input-field"
                            style={{ width: 'auto', padding: '3px 7px', fontSize: 11.5 }}
                            defaultValue=""
                            aria-label={`Link ${f.courseCode} to local course`}
                            onChange={async e => {
                              const picked = activeCourses.find(c => String(c.id) === e.target.value);
                              if (picked) {
                                await linkCanvasCourseIdInCatalog(f.canvasCourseId, picked);
                                setSnap(getCanvasFilesSnapshot());
                                onCoursesChanged?.();
                              }
                            }}
                          >
                            <option value="">Link to subject…</option>
                            {activeCourses.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.code || c.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className="row-action-chip active-chip"
                          onClick={() => handleCreateLinkedCourse(f.canvasCourseId)}
                        >
                          <Sparkles size={11} /> + Add Course Card
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-6" style={{ flexShrink: 0 }}>
                    {f.isImported ? (
                      <span className="row-action-chip is-done-chip">
                        <CheckCircle2 size={12} /> Imported
                      </span>
                    ) : isLinked ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={Boolean(importingId)}
                        onClick={() => handleImportSingle(f)}
                      >
                        {busyThis ? (
                          importProgressText || 'Importing…'
                        ) : (
                          <>
                            <Download size={12} /> Import
                          </>
                        )}
                      </button>
                    ) : null}
                    {f.htmlUrl && (
                      <a
                        href={f.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="row-icon-btn"
                        aria-label="Open in Canvas"
                        title="Open in Canvas"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
