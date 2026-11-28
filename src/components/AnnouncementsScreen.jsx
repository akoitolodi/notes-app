/**
 * AnnouncementsScreen — Dedicated Announcements Command Panel for Canvas RSS/Atom
 * feeds and pasted class/Messenger announcements.
 *
 * Features:
 * - Unread / All / Pinned filter tabs + per-course filter chips + live search
 * - Pin critical announcements (Google Chat links, exam rules, room changes)
 * - Auto-detected deadlines inside announcement text -> 1-tap "+ Add to Calendar"
 * - 1-tap "Save to Notes", "Mark Read / Unread", "Sync Feeds", "+ Paste Post", and RSS Setup
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  Megaphone,
  RefreshCw,
  Pin,
  PinOff,
  Check,
  CheckCheck,
  Search,
  X,
  Plus,
  Rss,
  CalendarPlus,
  FilePlus2,
  ExternalLink,
  Trash2,
  User,
  Clock,
  Reply,
  Send,
  Sparkles,
  Copy,
  Link2,
  UserCheck,
  Download,
} from 'lucide-react';
import { db, createNote, togglePinPlannerItem, localDateKey } from '../store/db';
import {
  getCanvasSettings,
  saveCanvasSettings,
  syncCanvasFeeds,
  autoSyncCanvasIfStale,
  parsePastedAnnouncement,
  buildCanvasNoteContent,
  detectDateInText,
  postCanvasAnnouncementReply,
} from '../lib/canvasSync';
import {
  matchAnnouncementToCourse,
  extractQuickLinks,
  parseCanvasDiscussionUrl,
  getAnnouncementReplyMeta,
  markAnnouncementReplied,
} from '../lib/announcementSchedule';
import { extractImportableFileLinks } from '../lib/courseExtras';
import { aiText } from '../lib/aiCore';
import {
  isAnnouncementRead,
  markAnnouncementRead,
  markAnnouncementUnread,
  markAllAnnouncementsRead,
  syncDeadlineNotifications,
} from '../lib/notifications';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

function formatShortDate(dateKey) {
  if (!dateKey) return '';
  const parts = String(dateKey).split('-').map(Number);
  if (parts.length !== 3) return dateKey;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(dt.getTime())) return dateKey;
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatRelativeSync(ts) {
  if (!ts) return 'Not synced yet';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Synced just now';
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Synced ${diffHr}h ago`;
  return `Synced ${Math.floor(diffHr / 24)}d ago`;
}

/** Auto-convert bare https:// URLs (not already inside Markdown links) into clickable links. */
function linkifyBareUrls(text) {
  const s = String(text || '');
  return s.replace(/(?<!\]\()(?<!\()(?<!["'])\b(https?:\/\/[^\s<>"')]+)/gi, url => {
    const clean = url.replace(/[.,;!?]+$/, '');
    const trailing = url.slice(clean.length);
    const label = clean.replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 48);
    return `[${label}](${clean})${trailing}`;
  });
}

const QUICK_REPLIES = [
  'Noted po, thank you!',
  'Good day Sir/Ma’am, noted po. Thank you!',
  'Thank you for the update!',
];

export default function AnnouncementsScreen({ onBack, onOpenNote, onChanged }) {
  const { confirm, toast } = useDialog();

  const [announcements, setAnnouncements] = useState([]);
  const [coursesList, setCoursesList] = useState([]);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [readVersion, setReadVersion] = useState(0);
  const [replyVersion, setReplyVersion] = useState(0);
  const [tab, setTab] = useState('all'); // all | unread | pinned
  const [courseFilter, setCourseFilter] = useState('__all__');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState({});
  const [linkingItemId, setLinkingItemId] = useState(null);
  const [importingFileUrl, setImportingFileUrl] = useState('');

  const [replyTarget, setReplyTarget] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyAiBusy, setReplyAiBusy] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [rssOpen, setRssOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const [canvasCfg, setCanvasCfg] = useState(() => getCanvasSettings());
  const [rssDraft, setRssDraft] = useState(() => getCanvasSettings().rssUrls || '');

  const [pasteCourse, setPasteCourse] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteAddDate, setPasteAddDate] = useState(true);

  const loadAnnouncements = useCallback(async () => {
    try {
      const [all, crs, sched] = await Promise.all([
        db.plannerItems.where('type').equals('announcement').toArray(),
        db.courses.toArray().catch(() => []),
        db.classSchedule.toArray().catch(() => []),
      ]);
      all.sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return (b.dueAt || b.createdAt || 0) - (a.dueAt || a.createdAt || 0);
      });
      setAnnouncements(all);
      setCoursesList(crs.filter(c => !c.archived));
      setScheduleRows(sched);
    } catch {
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
    autoSyncCanvasIfStale()
      .then(res => {
        if (res?.ran && (res.added > 0 || res.updated > 0)) {
          setCanvasCfg(getCanvasSettings());
          loadAnnouncements();
          onChanged?.();
        }
      })
      .catch(() => {});
  }, [loadAnnouncements, onChanged]);

  // Derived read/unread status + silently matched course timetable + quick links + reply metadata
  const enriched = useMemo(() => {
    void readVersion;
    void replyVersion;
    const now = new Date();
    return announcements.map(item => {
      const read = isAnnouncementRead(item);
      const detectedDate =
        item.detectedDateKey || detectDateInText(`${item.title || ''}\n${item.description || ''}`) || '';
      const scheduleMatch = matchAnnouncementToCourse(item, coursesList, scheduleRows, now);
      const quickLinks = extractQuickLinks(item.description);
      const importableLinks = extractImportableFileLinks(item);
      const replyMeta = getAnnouncementReplyMeta(item);
      return {
        ...item,
        _read: read,
        _detectedDate: detectedDate,
        _scheduleMatch: scheduleMatch,
        _quickLinks: quickLinks,
        _importableLinks: importableLinks,
        _replyMeta: replyMeta,
      };
    });
  }, [announcements, coursesList, scheduleRows, readVersion, replyVersion]);

  const courses = useMemo(() => {
    const set = new Set();
    for (const a of enriched) {
      if (a.course) set.add(a.course);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [enriched]);

  const unreadCount = useMemo(() => enriched.filter(a => !a._read).length, [enriched]);
  const pinnedCount = useMemo(() => enriched.filter(a => a.pinned).length, [enriched]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enriched.filter(item => {
      if (tab === 'unread' && item._read) return false;
      if (tab === 'pinned' && !item.pinned) return false;
      if (courseFilter !== '__all__' && item.course !== courseFilter) return false;
      if (q) {
        const hay = `${item.title || ''} ${item.course || ''} ${item.author || ''} ${item.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, tab, courseFilter, searchQuery]);

  const pastePreview = useMemo(() => {
    if (!pasteText.trim()) return null;
    return parsePastedAnnouncement(pasteText, pasteCourse || 'Class');
  }, [pasteText, pasteCourse]);

  const handleSyncNow = async (overrideRss = null) => {
    const cfg = getCanvasSettings();
    const rssToUse = overrideRss !== null ? overrideRss : cfg.rssUrls;
    if (!rssToUse && !cfg.icsUrl && !(cfg.host && cfg.token)) {
      setRssOpen(true);
      toast('Paste at least one Canvas Course Announcements RSS/Atom link first');
      return;
    }
    setSyncing(true);
    try {
      const res = await syncCanvasFeeds({
        icsUrl: cfg.icsUrl,
        rssUrls: rssToUse,
        host: cfg.host,
        token: cfg.token,
      });
      setCanvasCfg(getCanvasSettings());
      await loadAnnouncements();
      onChanged?.();
      toast(
        res.added > 0
          ? `Synced — ${res.added} new post${res.added === 1 ? '' : 's'} added!`
          : 'Announcements are up to date',
        { type: 'success' }
      );
    } catch (err) {
      toast(`Sync failed: ${err?.message || 'Check your connection or RSS link'}`, { type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveRss = async () => {
    const cleaned = rssDraft.trim();
    saveCanvasSettings({ rssUrls: cleaned });
    setCanvasCfg(getCanvasSettings());
    setRssOpen(false);
    if (cleaned) {
      await handleSyncNow(cleaned);
    } else {
      toast('RSS feed URLs cleared');
    }
  };

  const handleSavePasted = async () => {
    if (!pasteText.trim()) {
      toast('Paste an announcement first');
      return;
    }
    const parsed = parsePastedAnnouncement(pasteText, pasteCourse || 'Class');
    const now = Date.now();
    await db.plannerItems.add({
      externalUid: `manual-ann:${now}`,
      title: parsed.title,
      course: parsed.course,
      author: 'Pasted Note',
      type: 'announcement',
      source: 'manual',
      dateKey: parsed.dateKey,
      detectedDateKey: parsed.detectedDateKey || '',
      timeLabel: formatShortDate(parsed.dateKey),
      dueAt: now,
      description: parsed.description,
      url: '',
      pinned: false,
      done: false,
      createdAt: now,
      updatedAt: now,
    });

    if (pasteAddDate && parsed.detectedDateKey) {
      await db.plannerItems.add({
        title: parsed.title,
        course: parsed.course,
        type: /\b(exam|quiz|midterm|final|test)\b/i.test(parsed.title) ? 'exam' : 'assignment',
        source: 'manual',
        dateKey: parsed.detectedDateKey,
        timeLabel: 'From announcement',
        dueAt: new Date(`${parsed.detectedDateKey}T23:59:00`).getTime(),
        description: parsed.description.slice(0, 600),
        done: false,
        priority: 'high',
        createdAt: now,
        updatedAt: now,
      });
      syncDeadlineNotifications().catch(() => {});
    }

    setPasteText('');
    setPasteCourse('');
    setPasteOpen(false);
    await loadAnnouncements();
    onChanged?.();
    toast(
      pasteAddDate && parsed.detectedDateKey
        ? `Announcement saved & added ${formatShortDate(parsed.detectedDateKey)} to Calendar!`
        : 'Announcement saved!',
      { type: 'success' }
    );
  };

  const handleTogglePin = async item => {
    const nextPinned = await togglePinPlannerItem(item.id);
    await loadAnnouncements();
    onChanged?.();
    toast(nextPinned ? 'Announcement pinned to top' : 'Unpinned');
  };

  const handleToggleRead = item => {
    if (item._read) {
      markAnnouncementUnread(item);
    } else {
      markAnnouncementRead(item);
    }
    setReadVersion(v => v + 1);
    onChanged?.();
  };

  const handleMarkAllRead = () => {
    markAllAnnouncementsRead(announcements);
    setReadVersion(v => v + 1);
    onChanged?.();
    toast('All announcements marked as read', { type: 'success' });
  };

  const handleAddDateToCalendar = async item => {
    const dateKey = item._detectedDate || localDateKey();
    const isExam = /\b(exam|quiz|midterm|final|test|practical)\b/i.test(`${item.title} ${item.description}`);
    await db.plannerItems.add({
      title: item.title,
      course: item.course || 'Canvas',
      type: isExam ? 'exam' : 'assignment',
      source: 'manual',
      dateKey,
      timeLabel: 'From announcement',
      dueAt: new Date(`${dateKey}T23:59:00`).getTime(),
      description: String(item.description || '').slice(0, 800),
      done: false,
      priority: isExam ? 'high' : 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    syncDeadlineNotifications().catch(() => {});
    onChanged?.();
    toast(`Added "${item.title.slice(0, 32)}" (${formatShortDate(dateKey)}) to Calendar!`, {
      type: 'success',
    });
  };

  const handleSaveAsNote = async item => {
    const folders = await db.folders.toArray();
    const courseLower = String(item.course || '').toLowerCase();
    const matchedFolder =
      folders.find(
        f => !f.locked && !f.isSystemVault && courseLower && f.name.toLowerCase().includes(courseLower)
      ) ||
      folders.find(f => !f.locked && !f.isSystemVault && f.name === 'General') ||
      folders.find(f => !f.locked && !f.isSystemVault);

    const body = buildCanvasNoteContent(item);
    const created = await createNote(
      matchedFolder?.id,
      item.title || 'Class Announcement',
      body,
      item.course || matchedFolder?.name || 'General'
    );
    markAnnouncementRead(item);
    setReadVersion(v => v + 1);
    onChanged?.();
    toast(`Saved to ${matchedFolder?.name || 'Notes'}`, { type: 'success' });
    if (onOpenNote) onOpenNote(created, matchedFolder);
  };

  const handleDeletePost = async item => {
    const ok = await confirm({
      title: 'Remove announcement?',
      message: `Remove "${item.title}" from your Announcements panel?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await db.plannerItems.delete(item.id);
    await loadAnnouncements();
    onChanged?.();
    toast('Announcement removed');
  };

  const handleSaveTeacher = async (course, teacherName) => {
    if (!course?.id || !teacherName) return;
    await db.courses.update(course.id, { instructor: teacherName });
    await loadAnnouncements();
    onChanged?.();
    toast(`Saved ${teacherName} as ${course.code || course.name} teacher`, { type: 'success' });
  };

  const handleLinkCourse = async (item, courseId) => {
    const course = coursesList.find(c => c.id === Number(courseId));
    if (!course || !item?.course) return;
    // Remove this announcement alias from any previous course to enforce 1-to-1 ownership
    const otherUpdates = coursesList
      .filter(c => c.id !== course.id && Array.isArray(c.canvasAliases) && c.canvasAliases.includes(item.course))
      .map(c =>
        db.courses.update(c.id, {
          canvasAliases: c.canvasAliases.filter(a => a !== item.course),
        })
      );
    if (otherUpdates.length > 0) await Promise.all(otherUpdates);

    const prevAliases = Array.isArray(course.canvasAliases) ? course.canvasAliases : [];
    const nextAliases = prevAliases.includes(item.course)
      ? prevAliases
      : [...prevAliases, item.course];
    await db.courses.update(course.id, {
      canvasAliases: nextAliases,
      ...(course.icsCourseTag ? {} : { icsCourseTag: item.course }),
    });
    setLinkingItemId(null);
    await loadAnnouncements();
    onChanged?.();
    toast(`Linked "${item.course}" to ${course.code || course.name}`, { type: 'success' });
  };

  const openReplySheet = item => {
    setReplyTarget(item);
    setReplyText('');
    setReplyBusy(false);
    setReplyAiBusy(false);
  };

  const handleDraftReplyWithAi = async () => {
    if (!replyTarget || replyAiBusy) return;
    setReplyAiBusy(true);
    try {
      const prompt = [
        'Write a short, polite college student reply to this teacher announcement (1-3 concise sentences, natural Filipino-college polite English or light "po", no subject line or signature placeholder unless natural).',
        `Course: ${replyTarget.course || 'Class'}`,
        replyTarget.author ? `Teacher: ${replyTarget.author}` : '',
        `Title: ${replyTarget.title}`,
        `Announcement: ${String(replyTarget.description || '').slice(0, 700)}`,
      ]
        .filter(Boolean)
        .join('\n');
      const draft = await aiText({ user: prompt, maxTokens: 160 });
      if (draft?.trim()) setReplyText(draft.trim());
    } catch (err) {
      toast(err?.message || 'AI draft failed', { type: 'error' });
    } finally {
      setReplyAiBusy(false);
    }
  };

  const finishReplySuccess = (item, message, toastMsg) => {
    markAnnouncementReplied(item, message);
    markAnnouncementRead(item);
    setReplyVersion(v => v + 1);
    setReadVersion(v => v + 1);
    setReplyTarget(null);
    setReplyText('');
    onChanged?.();
    toast(toastMsg, { type: 'success' });
  };

  const handleSendApiReply = async () => {
    if (!replyTarget || !replyText.trim() || replyBusy) return;
    setReplyBusy(true);
    try {
      const cfg = getCanvasSettings();
      await postCanvasAnnouncementReply({
        url: replyTarget.url,
        message: replyText.trim(),
        host: cfg.host,
        token: cfg.token,
      });
      finishReplySuccess(replyTarget, replyText.trim(), 'Reply posted to Canvas!');
    } catch (err) {
      toast(`${err?.message || 'Canvas API reply failed'} — use "Copy & Open in Canvas"`, {
        type: 'error',
      });
    } finally {
      setReplyBusy(false);
    }
  };

  const handleCopyAndOpenCanvas = async () => {
    if (!replyTarget || !replyText.trim()) return;
    try {
      await navigator.clipboard?.writeText?.(replyText.trim());
    } catch {
      // clipboard unavailable
    }
    const targetUrl = replyTarget.url;
    finishReplySuccess(
      replyTarget,
      replyText.trim(),
      targetUrl ? 'Reply copied! Paste & send in Canvas' : 'Reply copied & marked Replied ✓'
    );
    if (targetUrl) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleImportAnnouncementFile = async (link, item) => {
    if (!link?.url || importingFileUrl) return;
    const targetCourse = item?._scheduleMatch?.course || coursesList[0] || null;
    if (!targetCourse) {
      toast('Create a course card first in Courses to import this file.', { type: 'info' });
      return;
    }
    setImportingFileUrl(link.url);
    try {
      const { importExternalLinkToCourse } = await import('../lib/canvasFiles');
      await importExternalLinkToCourse({
        url: link.url,
        title: link.label || item.title,
        targetCourse,
        moduleName: 'Shared Links',
      });
      onChanged?.();
      toast(`Imported "${link.label}" into ${targetCourse.nickname || targetCourse.code}!`, {
        type: 'success',
      });
    } catch (err) {
      toast(err?.message || 'Could not import link', { type: 'error', duration: 4200 });
    } finally {
      setImportingFileUrl('');
    }
  };

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">Announcements</span>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className={`navbar-btn${rssOpen ? ' navbar-btn-active' : ''}`}
            aria-label="Manage Canvas RSS Feeds"
            title="Canvas RSS / Atom Feed Links"
            onClick={() => {
              setRssDraft(getCanvasSettings().rssUrls || '');
              setRssOpen(o => !o);
              setPasteOpen(false);
            }}
          >
            <Rss size={18} />
          </button>
          <button
            type="button"
            className={`navbar-btn${pasteOpen ? ' navbar-btn-active' : ''}`}
            aria-label="Paste announcement"
            title="Quick-Paste Announcement"
            onClick={() => {
              setPasteOpen(o => !o);
              setRssOpen(false);
            }}
          >
            <Plus size={19} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            disabled={syncing}
            aria-label="Sync announcements"
            title="Sync Canvas Feeds Now"
            onClick={() => handleSyncNow()}
          >
            <RefreshCw size={17} className={syncing ? 'spin-icon' : ''} />
          </button>
        </div>
      </header>

      <div className="screen-body" style={{ padding: '8px 14px 28px' }}>
        {/* Status Header Bar */}
        <div className="ann-hero-bar">
          <div className="flex items-center gap-8" style={{ minWidth: 0 }}>
            <span className="ann-hero-icon">
              <Megaphone size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                {unreadCount > 0
                  ? `${unreadCount} Unread Announcement${unreadCount === 1 ? '' : 's'}`
                  : announcements.length > 0
                    ? 'All caught up!'
                    : 'No announcements yet'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {announcements.length} total · {pinnedCount} pinned · {formatRelativeSync(canvasCfg.lastSync)}
              </div>
            </div>
          </div>
          {unreadCount > 0 && (
            <button type="button" className="row-action-chip active-chip" onClick={handleMarkAllRead}>
              <CheckCheck size={13} /> Read All
            </button>
          )}
        </div>

        {/* RSS Feed Quick-Config Drawer */}
        {rssOpen && (
          <div className="ann-drawer-card">
            <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Rss size={15} style={{ color: 'var(--accent)' }} /> Canvas Announcements RSS / Atom Feeds
              </div>
              <button type="button" className="icon-btn" onClick={() => setRssOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.45 }}>
              In Canvas, open a course → <strong>Announcements</strong> → tap <strong>RSS Feed</strong> and copy the <code>.atom</code> URL. Paste one link per line to sync all your subjects automatically!
            </div>
            <textarea
              className="settings-input"
              rows={3}
              placeholder="https://yourschool.instructure.com/feeds/announcements/enrollment_xxx.atom"
              value={rssDraft}
              onChange={e => setRssDraft(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            />
            <div className="flex gap-8 mt-8">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={syncing}
                onClick={handleSaveRss}
              >
                <RefreshCw size={13} /> {syncing ? 'Syncing…' : 'Save & Sync Feeds'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRssOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Quick-Paste Announcement Drawer */}
        {pasteOpen && (
          <div className="ann-drawer-card">
            <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={15} style={{ color: 'var(--accent)' }} /> Quick-Paste Class / GC Announcement
              </div>
              <button type="button" className="icon-btn" onClick={() => setPasteOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <input
              type="text"
              className="settings-input"
              placeholder="Course or subject (e.g. IPT 101, CS 201)"
              value={pasteCourse}
              onChange={e => setPasteCourse(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <textarea
              className="settings-input"
              rows={4}
              placeholder="Paste announcement from Canvas, Messenger, or Google Chat… Dates like 'Quiz on Friday' or 'Dec 5' are detected automatically!"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              style={{ width: '100%' }}
            />
            {pastePreview?.detectedDateKey && (
              <label
                className="flex items-center gap-6 mt-8"
                style={{ fontSize: 12.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                <input
                  type="checkbox"
                  checked={pasteAddDate}
                  onChange={e => setPasteAddDate(e.target.checked)}
                />
                Detected date ({formatShortDate(pastePreview.detectedDateKey)}) — also add to Calendar
              </label>
            )}
            <div className="flex gap-8 mt-8">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePasted}>
                Save Announcement
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter Tabs + Search */}
        <div className="ann-filter-row">
          {[
            ['all', `All (${announcements.length})`],
            ['unread', `Unread (${unreadCount})`],
            ['pinned', `Pinned (${pinnedCount})`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`mode-pick-chip${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Dynamic Per-Course Filter Chips */}
        {courses.length > 1 && (
          <div className="ann-course-chips">
            <button
              type="button"
              className={`row-action-chip${courseFilter === '__all__' ? ' active-chip' : ''}`}
              onClick={() => setCourseFilter('__all__')}
            >
              All Subjects
            </button>
            {courses.map(c => (
              <button
                key={c}
                type="button"
                className={`row-action-chip${courseFilter === c ? ' active-chip' : ''}`}
                onClick={() => setCourseFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Search Input */}
        {announcements.length > 0 && (
          <div className="search-input-wrap" style={{ marginBottom: 12 }}>
            <span className="search-icon">
              <Search size={15} />
            </span>
            <input
              className="search-input"
              placeholder="Search announcements, teachers, links…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* Empty State */}
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '28px 16px' }}>
            <div className="empty-icon">
              <Megaphone size={28} />
            </div>
            <div className="empty-title">
              {announcements.length === 0
                ? 'Connect Your Class Announcements'
                : tab === 'unread'
                  ? 'Zero unread announcements!'
                  : tab === 'pinned'
                    ? 'No pinned announcements yet'
                    : 'No matching announcements'}
            </div>
            <div className="empty-text" style={{ maxWidth: 320 }}>
              {announcements.length === 0
                ? 'Paste your Canvas Course Announcements RSS/Atom links (or paste posts from Messenger/GC) so important class updates stay front and center.'
                : tab === 'pinned'
                  ? 'Tap Pin on any announcement (like Google Chat invites, syllabus rules, or exam schedules) to keep it at the top.'
                  : 'Try switching tabs or clearing your filter.'}
            </div>
            {announcements.length === 0 && (
              <div className="flex gap-8 mt-12" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setRssOpen(true)}>
                  <Rss size={14} /> Add Canvas RSS Feed
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasteOpen(true)}>
                  <Plus size={14} /> Paste Announcement
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="ann-list">
            {filtered.map(item => {
              const desc = String(item.description || '').trim();
              const isLong = desc.length > 340;
              const isExpanded = Boolean(expandedIds[item.id]);
              const shownDesc = isLong && !isExpanded ? `${desc.slice(0, 320).trim()}…` : desc;

              return (
                <article
                  key={item.id}
                  className={`ann-card${!item._read ? ' is-unread' : ''}${item.pinned ? ' is-pinned' : ''}`}
                >
                  <div className="ann-card-top">
                    <div className="flex items-center gap-6" style={{ flexWrap: 'wrap', minWidth: 0 }}>
                      {!item._read && <span className="ann-unread-dot" aria-label="Unread" />}
                      <span className="mode-badge mode-study">{item.course || 'Canvas'}</span>
                      {item.pinned && (
                        <span className="ann-pin-badge">
                          <Pin size={10} /> Pinned
                        </span>
                      )}
                      {item._replyMeta && (
                        <span className="ann-replied-badge">
                          <Check size={10} /> Replied
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {item.timeLabel || formatShortDate(item.dateKey)}
                    </span>
                  </div>

                  {/* Secretly matched course class time & room */}
                  {linkingItemId === item.id && coursesList.length > 0 ? (
                    <div className="flex items-center gap-6" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                      <select
                        className="settings-input"
                        style={{ fontSize: 12, padding: '4px 8px', width: 'auto', minWidth: 160 }}
                        defaultValue={item._scheduleMatch?.course?.id || ''}
                        onChange={e => {
                          if (e.target.value) handleLinkCourse(item, e.target.value);
                        }}
                      >
                        <option value="">Choose subject for time…</option>
                        {coursesList.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.code || c.name}
                            {c.section ? ` (Sec ${c.section})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="row-action-chip"
                        onClick={() => setLinkingItemId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : item._scheduleMatch ? (
                    <div className="ann-schedule-pill">
                      <Clock size={12} style={{ flexShrink: 0 }} />
                      <span className="ann-schedule-text">{item._scheduleMatch.summaryText}</span>
                      {item._scheduleMatch.nextMeetingLabel && (
                        <span className="ann-next-badge">
                          Next: {item._scheduleMatch.nextMeetingLabel}
                        </span>
                      )}
                      {coursesList.length > 1 && item.course && (
                        <button
                          type="button"
                          className="row-action-chip"
                          style={{ padding: '1px 6px', fontSize: 10.5 }}
                          onClick={() => setLinkingItemId(item.id)}
                          title="Change matched course"
                        >
                          Change
                        </button>
                      )}
                    </div>
                  ) : (
                    coursesList.length > 0 &&
                    item.course && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className="row-action-chip"
                          style={{ fontSize: 11 }}
                          onClick={() => setLinkingItemId(item.id)}
                        >
                          <Link2 size={11} /> Link class schedule
                        </button>
                      </div>
                    )
                  )}

                  <h3 className="ann-card-title">{item.title}</h3>

                  {item.author && (
                    <div className="ann-card-author">
                      <User size={12} /> {item.author}
                      {item._scheduleMatch?.canSaveTeacher && (
                        <button
                          type="button"
                          className="ann-save-teacher-chip"
                          onClick={() =>
                            handleSaveTeacher(item._scheduleMatch.course, item.author)
                          }
                        >
                          <UserCheck size={11} /> Save as{' '}
                          {item._scheduleMatch.course.code || 'course'} teacher
                        </button>
                      )}
                    </div>
                  )}

                  {shownDesc && (
                    <div className="ann-card-body">
                      <MarkdownContent text={linkifyBareUrls(shownDesc)} />
                      {isLong && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 0', fontSize: 12, marginTop: 4 }}
                          onClick={() =>
                            setExpandedIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                          }
                        >
                          {isExpanded ? 'Show less' : 'Read full announcement'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Quick-open Meeting / Chat / Drive pills + 1-Tap Importable Files */}
                  {(item._quickLinks?.length > 0 || item._importableLinks?.length > 0) && (
                    <div className="ann-quick-links">
                      {item._quickLinks?.map(ql => (
                        <a
                          key={ql.url}
                          href={ql.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`ann-quick-link-pill kind-${ql.kind}`}
                        >
                          <ExternalLink size={11} /> Open {ql.label}
                        </a>
                      ))}
                      {item._importableLinks?.map(fl => (
                        <button
                          key={`imp-${fl.url}`}
                          type="button"
                          className="row-action-chip active-chip"
                          disabled={importingFileUrl === fl.url}
                          onClick={() => handleImportAnnouncementFile(fl, item)}
                        >
                          <Download size={11} />{' '}
                          {importingFileUrl === fl.url ? 'Importing…' : `Import ${fl.kind}`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Auto-detected deadline pill */}
                  {item._detectedDate && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="row-action-chip active-chip"
                        onClick={() => handleAddDateToCalendar(item)}
                      >
                        <CalendarPlus size={12} /> Add {formatShortDate(item._detectedDate)} to Calendar
                      </button>
                    </div>
                  )}

                  <div className="ann-card-actions">
                    <button
                      type="button"
                      className={`row-action-chip${item._replyMeta ? ' active-chip' : ''}`}
                      onClick={() => openReplySheet(item)}
                    >
                      <Reply size={12} /> {item._replyMeta ? 'Reply again' : 'Reply'}
                    </button>
                    <button
                      type="button"
                      className={`row-action-chip${item.pinned ? ' active-chip' : ''}`}
                      onClick={() => handleTogglePin(item)}
                    >
                      {item.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      {item.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => handleToggleRead(item)}
                    >
                      <Check size={12} /> {item._read ? 'Unread' : 'Mark Read'}
                    </button>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => handleSaveAsNote(item)}
                    >
                      <FilePlus2 size={12} /> Save Note
                    </button>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="row-action-chip"
                        style={{ textDecoration: 'none' }}
                      >
                        <ExternalLink size={12} /> Canvas
                      </a>
                    )}
                    <button
                      type="button"
                      className="row-action-chip"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => handleDeletePost(item)}
                      aria-label="Remove announcement"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Hybrid Announcement Reply Composer Sheet */}
      {replyTarget &&
        (() => {
          const discussionInfo = parseCanvasDiscussionUrl(replyTarget.url);
          const hasDirectApi = Boolean(canvasCfg.token && discussionInfo);
          const modal = (
            <div className="export-overlay" onClick={() => !replyBusy && setReplyTarget(null)}>
              <div
                className="export-sheet reply-sheet-card"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Reply to announcement"
              >
                <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                  <div className="export-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Reply size={16} style={{ color: 'var(--accent)' }} /> Reply to Announcement
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => !replyBusy && setReplyTarget(null)}
                    aria-label="Close reply composer"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {replyTarget.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 8 }}>
                  {replyTarget.course}
                  {replyTarget._scheduleMatch ? ` · ${replyTarget._scheduleMatch.summaryText}` : ''}
                </div>

                {!hasDirectApi && (
                  <div className="reply-rss-note">
                    Canvas RSS feeds are read-only — write or draft below, then tap{' '}
                    <strong>Copy &amp; Open in Canvas</strong> to paste &amp; send straight in the thread.
                  </div>
                )}

                <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  {QUICK_REPLIES.map(qr => (
                    <button
                      key={qr}
                      type="button"
                      className="row-action-chip"
                      onClick={() => setReplyText(qr)}
                    >
                      {qr}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="row-action-chip active-chip"
                    disabled={replyAiBusy}
                    onClick={handleDraftReplyWithAi}
                  >
                    <Sparkles size={11} /> {replyAiBusy ? 'Drafting…' : 'Draft with AI'}
                  </button>
                </div>

                <textarea
                  className="ai-input"
                  rows={4}
                  placeholder="Write your reply to the teacher…"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  disabled={replyBusy}
                  style={{ marginTop: 0, width: '100%' }}
                />

                <div className="flex gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: '0 0 auto' }}
                    disabled={replyBusy}
                    onClick={() => setReplyTarget(null)}
                  >
                    Cancel
                  </button>
                  {hasDirectApi ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!replyText.trim() || replyBusy}
                        onClick={handleCopyAndOpenCanvas}
                      >
                        <Copy size={14} /> Copy &amp; Open
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary flex-1"
                        disabled={!replyText.trim() || replyBusy}
                        onClick={handleSendApiReply}
                      >
                        <Send size={15} /> {replyBusy ? 'Posting…' : 'Send to Canvas'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary flex-1"
                      disabled={!replyText.trim() || replyBusy}
                      onClick={handleCopyAndOpenCanvas}
                    >
                      <Copy size={15} /> Copy &amp; Open in Canvas
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
          return typeof document !== 'undefined' && document.body
            ? createPortal(modal, document.body)
            : modal;
        })()}
    </div>
  );
}
