/**
 * StudentHubScreen — Unified School WHEN Command Center (v2.6.0):
 * 1. Timetable (Visual 30-Min Grid & Day View via CourseScheduleView + Study Load PDF + GEC F2F/Virtual Matrix)
 * 2. School Calendar (Multi-term Official Academic Calendar Maker, Mid-Sem Revision Diff, Exam Countdown, Month Grid)
 * 3. Tasks & Canvas (To-Dos, Canvas LMS .ics/.atom Sync, Quick-Paste Announcements)
 */
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckSquare,
  Square,
  Clock,
  GraduationCap,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  FilePlus2,
  Megaphone,
  Sparkles,
  BookOpen,
  ChevronDown,
  ChevronUp,
  FolderOpen,
} from 'lucide-react';
import {
  db,
  localDateKey,
  createNote,
  logStudyActivity,
  getActiveSchoolCalendar,
  getActiveGecSchedule,
} from '../store/db';
import {
  getCanvasSettings,
  saveCanvasSettings,
  syncCanvasFeeds,
  autoSyncCanvasIfStale,
  markPastTasksDone,
  parsePastedAnnouncement,
  buildCanvasNoteContent,
} from '../lib/canvasSync';
import { syncDeadlineNotifications } from '../lib/notifications';
import {
  SCHOOL_CALENDAR_TERMS,
  filterCalendarEventsForDisplay,
  getCalendarEventsForDate,
  getUpcomingCalendarHighlights,
  saveAndSyncSchoolCalendar,
} from '../lib/schoolCalendar';
import {
  resolveGecModalityForDate,
  getGecPeriodSummaryForDate,
} from '../lib/gecSchedule';
import CourseScheduleView from './course/CourseScheduleView';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

const SchedulePdfImportSheet = lazy(() => import('./course/SchedulePdfImportSheet'));
const SchoolCalendarImportSheet = lazy(() => import('./planner/SchoolCalendarImportSheet'));
const GecScheduleImportSheet = lazy(() => import('./planner/GecScheduleImportSheet'));

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIMETABLE_DAYS = [
  { idx: 1, label: 'Mon' },
  { idx: 2, label: 'Tue' },
  { idx: 3, label: 'Wed' },
  { idx: 4, label: 'Thu' },
  { idx: 5, label: 'Fri' },
  { idx: 6, label: 'Sat' },
];
const CLASS_COLORS = ['#0a84ff', '#28b44c', '#ff9f0a', '#af52de', '#ff375f', '#30b0c7'];

function formatMonthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function daysUntilDateKey(dateKey) {
  if (!dateKey) return null;
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  return Math.round((target - today) / 86400000);
}

export default function StudentHubScreen({
  initialTab = 'timetable',
  onBack,
  onOpenNote,
  onOpenFolder,
  onOpenExamPaper,
  onOpenCourses,
  onOpenAnnouncements,
  onChanged,
}) {
  const { toast } = useDialog();
  const [tab, setTab] = useState(() =>
    ['timetable', 'calendar', 'tasks'].includes(initialTab) ? initialTab : 'timetable'
  );

  useEffect(() => {
    if (initialTab && ['timetable', 'calendar', 'tasks'].includes(initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  // Data from Dexie
  const [items, setItems] = useState([]);
  const [classes, setClasses] = useState([]);
  const [folders, setFolders] = useState([]);
  const [coursesList, setCoursesList] = useState([]);
  const [schoolCalendar, setSchoolCalendar] = useState(null);
  const [gecSchedule, setGecSchedule] = useState(null);

  // Lazy sheets
  const [schedulePdfOpen, setSchedulePdfOpen] = useState(false);
  const [calendarImportOpen, setCalendarImportOpen] = useState(false);
  const [gecImportOpen, setGecImportOpen] = useState(false);

  // Calendar state
  const todayKey = localDateKey();
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(todayKey);

  // Quick Add event / to-do form
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCourse, setNewCourse] = useState('');
  const [newType, setNewType] = useState('todo'); // todo | assignment | exam
  const [newDate, setNewDate] = useState(todayKey);
  const [newTime, setNewTime] = useState('');

  // Quick manual class modal on Timetable
  const todayDow = new Date().getDay();
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [clsSubject, setClsSubject] = useState('');
  const [clsDay, setClsDay] = useState(todayDow >= 1 && todayDow <= 6 ? todayDow : 1);
  const [clsStart, setClsStart] = useState('08:30');
  const [clsEnd, setClsEnd] = useState('10:00');
  const [clsRoom, setClsRoom] = useState('');
  const [clsInstructor, setClsInstructor] = useState('');
  const [clsColor, setClsColor] = useState(CLASS_COLORS[0]);

  // Canvas LMS sync state
  const initCanvas = useMemo(() => getCanvasSettings(), []);
  const [icsUrl, setIcsUrl] = useState(initCanvas.icsUrl);
  const [rssUrls, setRssUrls] = useState(initCanvas.rssUrls);
  const [canvasHost, setCanvasHost] = useState(initCanvas.host);
  const [canvasToken, setCanvasToken] = useState(initCanvas.token);
  const [lastSync, setLastSync] = useState(initCanvas.lastSync);
  const [autoSync, setAutoSync] = useState(initCanvas.autoSync !== false);
  const [syncing, setSyncing] = useState(false);
  const [showAdvancedCanvas, setShowAdvancedCanvas] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // Quick-Paste Announcement importer
  const [pasteCourse, setPasteCourse] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pastedPreview, setPastedPreview] = useState(null);

  const refreshData = useCallback(async () => {
    const [allItems, allClasses, allFolders, allCourses, activeCal, activeGec] = await Promise.all([
      db.plannerItems.toArray().catch(() => []),
      db.classSchedule.toArray().catch(() => []),
      db.folders.toArray().catch(() => []),
      db.courses.toArray().catch(() => []),
      getActiveSchoolCalendar(),
      getActiveGecSchedule(),
    ]);
    allItems.sort(
      (a, b) => String(a.dateKey || '').localeCompare(String(b.dateKey || '')) || (a.dueAt || 0) - (b.dueAt || 0)
    );
    allClasses.sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || String(a.startTime || '').localeCompare(String(b.startTime || ''))
    );
    const safeFolders = allFolders.filter(f => !f.locked && !f.isSystemVault && f.mode !== 'vault');
    setItems(allItems);
    setClasses(allClasses);
    setFolders(safeFolders);
    setCoursesList(allCourses.filter(c => !c.archived));
    setSchoolCalendar(activeCal);
    setGecSchedule(activeGec);
  }, []);

  useEffect(() => {
    refreshData();
    autoSyncCanvasIfStale()
      .then(res => {
        if (res?.ran) {
          setLastSync(res.syncedAt);
          refreshData();
          onChanged?.();
          if (res.added > 0) {
            toast(`Canvas auto-synced: ${res.added} new item${res.added === 1 ? '' : 's'}!`, { type: 'success' });
          }
        }
      })
      .catch(() => {});
  }, [refreshData, onChanged, toast]);

  const findMatchingFolder = useCallback(
    courseName => {
      const norm = String(courseName || '').trim().toLowerCase();
      if (norm) {
        const exact = folders.find(f => f.name.toLowerCase() === norm);
        if (exact) return exact;
        const partial = folders.find(
          f => norm.includes(f.name.toLowerCase()) || f.name.toLowerCase().includes(norm)
        );
        if (partial) return partial;
      }
      return folders.find(f => f.name === 'General') || folders[0] || null;
    },
    [folders]
  );

  const handleStartNoteFromItem = async item => {
    const targetFolder = findMatchingFolder(item.course);
    const body = buildCanvasNoteContent(item);
    const created = await createNote(
      targetFolder?.id,
      item.title || 'Canvas Task',
      body,
      item.course || targetFolder?.name || 'General'
    );
    await logStudyActivity('notes', 1);
    toast(`Created note in "${targetFolder?.name || 'All Notes'}"`, { type: 'success' });
    onChanged?.();
    onOpenNote?.(created, targetFolder || { id: '__all__', name: 'All Notes' }, { startInEdit: true });
  };

  const handleAddItem = async e => {
    e?.preventDefault?.();
    const title = newTitle.trim();
    if (!title) {
      toast('Enter a title first', { type: 'error' });
      return;
    }
    const dateKey = newDate || selectedDate || todayKey;
    await db.plannerItems.add({
      title,
      course: newCourse.trim() || 'School',
      type: newType,
      source: 'local',
      dateKey,
      timeLabel: newTime.trim() || (newType === 'exam' ? 'Exam' : ''),
      dueAt: new Date(`${dateKey}T23:59:00`).getTime(),
      description: '',
      url: '',
      done: false,
      priority: newType === 'exam' ? 'high' : 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewTitle('');
    setNewCourse('');
    setNewTime('');
    setAddOpen(false);
    toast(`Added "${title}" to ${dateKey}`, { type: 'success' });
    syncDeadlineNotifications().catch(() => {});
    onChanged?.();
    refreshData();
  };

  const handleToggleDone = async item => {
    const nextDone = !item.done;
    await db.plannerItems.update(item.id, { done: nextDone, updatedAt: Date.now() });
    if (nextDone) await logStudyActivity('notes', 1);
    syncDeadlineNotifications().catch(() => {});
    onChanged?.();
    refreshData();
  };

  const handleDeleteItem = async id => {
    await db.plannerItems.delete(id);
    toast('Removed item');
    syncDeadlineNotifications().catch(() => {});
    onChanged?.();
    refreshData();
  };

  // Switch active semester on Official School Calendar
  const handleSwitchCalendarTerm = async nextTerm => {
    if (!schoolCalendar || schoolCalendar.activeTerm === nextTerm) return;
    const saved = await saveAndSyncSchoolCalendar({
      ...schoolCalendar,
      activeTerm: nextTerm,
    });
    setSchoolCalendar(saved);
    onChanged?.();
    refreshData();
  };

  // Sync Canvas feeds
  const handleSyncCanvas = async () => {
    if (syncing) return;
    const cleanIcs = icsUrl.trim();
    const cleanRss = rssUrls.trim();
    const cleanHost = canvasHost.trim();
    const cleanToken = canvasToken.trim();
    saveCanvasSettings({
      icsUrl: cleanIcs,
      rssUrls: cleanRss,
      host: cleanHost,
      token: cleanToken,
    });
    if (!cleanIcs && !cleanRss && !(cleanHost && cleanToken)) {
      toast('Paste a Canvas Calendar (.ics) or Announcements (.atom) URL first', { type: 'error' });
      return;
    }
    setSyncing(true);
    try {
      const res = await syncCanvasFeeds({
        icsUrl: cleanIcs,
        rssUrls: cleanRss,
        host: cleanHost,
        token: cleanToken,
      });
      setLastSync(res.syncedAt);
      await refreshData();
      onChanged?.();
      toast(
        res.total > 0
          ? `Canvas synced! ${res.added} new, ${res.updated} updated`
          : 'Connected to Canvas — no upcoming events in feed yet',
        { type: 'success', duration: 3500 }
      );
    } catch (err) {
      toast(`Canvas sync failed: ${err.message}`, { type: 'error', duration: 4200 });
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyzePaste = () => {
    if (!pasteText.trim()) {
      toast('Paste a Canvas announcement first', { type: 'error' });
      return;
    }
    setPastedPreview(parsePastedAnnouncement(pasteText, pasteCourse || 'Canvas'));
  };

  const handleSavePastedAnnouncement = async ({ addDeadline = false, createNoteToo = false } = {}) => {
    if (!pastedPreview) return;
    const annItem = {
      title: pastedPreview.title,
      course: pastedPreview.course,
      type: 'announcement',
      source: 'canvas',
      dateKey: pastedPreview.dateKey,
      timeLabel: 'Announcement',
      dueAt: Date.now(),
      description: pastedPreview.description,
      url: '',
      done: false,
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.plannerItems.add(annItem);

    if (addDeadline && pastedPreview.detectedDateKey) {
      await db.plannerItems.add({
        title: pastedPreview.title,
        course: pastedPreview.course,
        type: /\b(exam|quiz|midterm|final)\b/i.test(pastedPreview.title + ' ' + pastedPreview.description)
          ? 'exam'
          : 'assignment',
        source: 'canvas',
        dateKey: pastedPreview.detectedDateKey,
        timeLabel: 'From announcement',
        dueAt: new Date(`${pastedPreview.detectedDateKey}T23:59:00`).getTime(),
        description: pastedPreview.description,
        url: '',
        done: false,
        priority: 'high',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const savedPreview = pastedPreview;
    setPasteText('');
    setPastedPreview(null);
    await refreshData();
    onChanged?.();

    if (createNoteToo) {
      await handleStartNoteFromItem(annItem);
    } else {
      toast(
        addDeadline && savedPreview.detectedDateKey
          ? `Saved announcement & added deadline (${savedPreview.detectedDateKey}) to Calendar!`
          : 'Announcement saved',
        { type: 'success' }
      );
    }
  };

  const handleAddClass = async e => {
    e?.preventDefault?.();
    if (!clsSubject.trim()) {
      toast('Enter a subject name', { type: 'error' });
      return;
    }
    await db.classSchedule.add({
      subject: clsSubject.trim(),
      dayOfWeek: Number(clsDay),
      startTime: clsStart || '08:00',
      endTime: clsEnd || '09:30',
      room: clsRoom.trim(),
      instructor: clsInstructor.trim(),
      color: clsColor,
      createdAt: Date.now(),
    });
    setClsSubject('');
    setClsRoom('');
    setClsInstructor('');
    setClassFormOpen(false);
    toast('Class added to timetable', { type: 'success' });
    onChanged?.();
    refreshData();
  };

  const handleDeleteScheduleSlot = async slot => {
    if (!slot?.id) return;
    await db.classSchedule.delete(slot.id);
    toast('Removed class slot');
    onChanged?.();
    refreshData();
  };

  const handleCleanupSchedule = async () => {
    const all = await db.classSchedule.toArray();
    const seen = new Set();
    let deleted = 0;
    for (const row of all) {
      const sig = `${String(row.subject || '').trim().toLowerCase()}|${row.dayOfWeek}|${row.startTime}|${row.endTime}`;
      if (seen.has(sig)) {
        await db.classSchedule.delete(row.id);
        deleted += 1;
      } else {
        seen.add(sig);
      }
    }
    toast(deleted > 0 ? `Cleaned ${deleted} duplicate class slot${deleted === 1 ? '' : 's'}` : 'Schedule is clean!');
    onChanged?.();
    refreshData();
  };

  // Calendar Grid cells
  const calendarCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, dateKey: key, dow: new Date(viewYear, viewMonth, d).getDay() });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const itemsByDate = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (it.source === 'school-calendar') continue; // official events rendered cleanly from schoolCalendar spans
      if (!it.dateKey) continue;
      if (!map.has(it.dateKey)) map.set(it.dateKey, []);
      map.get(it.dateKey).push(it);
    }
    return map;
  }, [items]);

  const classesByDow = useMemo(() => {
    const map = new Map();
    for (const c of classes) {
      const k = Number(c.dayOfWeek);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    return map;
  }, [classes]);

  const officialVisibleEvents = useMemo(
    () => filterCalendarEventsForDisplay(schoolCalendar),
    [schoolCalendar]
  );

  const calHighlights = useMemo(
    () => getUpcomingCalendarHighlights(schoolCalendar, todayKey),
    [schoolCalendar, todayKey]
  );

  // Next upcoming exam combining personal/Canvas exams + School Calendar exams
  const nextExam = useMemo(() => {
    const candidates = [];
    for (const it of items) {
      if (it.type === 'exam' && !it.done && it.dateKey >= todayKey) {
        candidates.push({
          title: it.title,
          course: it.course || 'Exam',
          dateKey: it.dateKey,
          timeLabel: it.timeLabel || '',
        });
      }
    }
    if (calHighlights.nextExam) {
      candidates.push({
        title: calHighlights.nextExam.title,
        course: schoolCalendar?.schoolName || 'School Calendar',
        dateKey: calHighlights.nextExam.startDate,
        timeLabel:
          calHighlights.nextExam.endDate !== calHighlights.nextExam.startDate
            ? `Thru ${calHighlights.nextExam.endDate}`
            : '',
      });
    }
    candidates.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    return candidates[0] || null;
  }, [items, calHighlights, schoolCalendar, todayKey]);

  const selectedDayOfficial = useMemo(
    () => getCalendarEventsForDate(schoolCalendar, selectedDate),
    [schoolCalendar, selectedDate]
  );
  const selectedDayGecBanner = useMemo(
    () => getGecPeriodSummaryForDate(selectedDate, gecSchedule),
    [selectedDate, gecSchedule]
  );
  const selectedDayItems = itemsByDate.get(selectedDate) || [];
  const selectedDayDow = useMemo(() => {
    const p = selectedDate.split('-').map(Number);
    return p.length === 3 ? new Date(p[0], p[1] - 1, p[2]).getDay() : todayDow;
  }, [selectedDate, todayDow]);
  const selectedDayClasses = classesByDow.get(selectedDayDow) || [];

  const taskItems = useMemo(() => items.filter(it => it.type !== 'announcement'), [items]);
  const pendingTasks = useMemo(
    () => taskItems.filter(it => !it.done && it.source !== 'school-calendar'),
    [taskItems]
  );
  const doneTasks = useMemo(
    () => taskItems.filter(it => it.done && it.source !== 'school-calendar'),
    [taskItems]
  );
  const announcements = useMemo(
    () => items.filter(it => it.type === 'announcement').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [items]
  );

  const shiftMonth = delta => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button type="button" className="navbar-btn navbar-back" onClick={onBack} aria-label="Back to folders">
          <ChevronLeft size={20} /> Notes
        </button>
        <span className="navbar-title">Planner &amp; Schedule</span>
        <button
          type="button"
          className="navbar-btn"
          aria-label="Add task or exam"
          onClick={() => {
            setNewDate(selectedDate || todayKey);
            setAddOpen(v => !v);
          }}
        >
          <Plus size={20} />
        </button>
      </header>

      <div
        className="large-title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}
      >
        <span>School Planner</span>
        <div className="flex items-center gap-6">
          {pendingTasks.length > 0 && (
            <span className="mode-badge mode-study" style={{ fontSize: 12 }}>
              {pendingTasks.length} due
            </span>
          )}
          {onOpenCourses && (
            <button type="button" className="row-action-chip" onClick={() => onOpenCourses()}>
              <BookOpen size={12} /> Courses
            </button>
          )}
        </div>
      </div>

      {/* Unified 3-Tab Bar: Timetable | School Calendar | Tasks & Canvas */}
      <div className="hub-tabs" role="tablist">
        {[
          ['timetable', 'Timetable', Clock],
          ['calendar', 'School Cal', CalendarIcon],
          ['tasks', 'Tasks & Canvas', CheckSquare],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`hub-tab-btn${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Collapsible Quick Add Event / Exam / To-Do Form */}
      {addOpen && (
        <form className="list-group settings-group" onSubmit={handleAddItem} style={{ marginTop: 10 }}>
          <div className="settings-label">New Schedule Item / To-Do</div>
          <input
            className="input-field"
            placeholder="Title (e.g. Calculus Problem Set 4, Midterm Quiz)"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <input
              className="input-field"
              placeholder="Course / Subject"
              value={newCourse}
              onChange={e => setNewCourse(e.target.value)}
            />
            <select
              className="input-field"
              value={newType}
              onChange={e => setNewType(e.target.value)}
              aria-label="Item type"
            >
              <option value="todo">To-Do Task</option>
              <option value="assignment">Assignment</option>
              <option value="exam">Exam / Quiz</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <input
              type="date"
              className="input-field"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
            />
            <input
              className="input-field"
              placeholder="Time (optional, e.g. 11:59 PM)"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
            />
          </div>
          <div className="flex gap-8 mt-12">
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} /> Save to Calendar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ============ TAB 1: UNIFIED TIMETABLE + GEC F2F/VIRTUAL ============ */}
      {tab === 'timetable' && (
        <div style={{ padding: '10px var(--gutter) 24px' }}>
          <CourseScheduleView
            courses={coursesList}
            scheduleRows={classes}
            gecSchedule={gecSchedule}
            schoolCalendar={schoolCalendar}
            onOpenCourse={() => onOpenCourses?.()}
            onEditCourse={() => onOpenCourses?.()}
            onImportSchedulePdf={() => setSchedulePdfOpen(true)}
            onImportGec={() => setGecImportOpen(true)}
            onDeleteScheduleSlot={handleDeleteScheduleSlot}
            onCleanupSchedule={handleCleanupSchedule}
            onAddCourseSchedule={() => setClassFormOpen(v => !v)}
          />

          {classFormOpen && (
            <form className="list-group settings-group" onSubmit={handleAddClass} style={{ marginTop: 12 }}>
              <div className="settings-label">Quick Add Class Slot</div>
              <input
                className="input-field"
                placeholder="Subject / Code (e.g. GEC-UTS, CS 201)"
                value={clsSubject}
                onChange={e => setClsSubject(e.target.value)}
                autoFocus
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                <select
                  className="input-field"
                  value={clsDay}
                  onChange={e => setClsDay(Number(e.target.value))}
                  aria-label="Day of week"
                >
                  {TIMETABLE_DAYS.map(d => (
                    <option key={d.idx} value={d.idx}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <input type="time" className="input-field" value={clsStart} onChange={e => setClsStart(e.target.value)} aria-label="Start time" />
                <input type="time" className="input-field" value={clsEnd} onChange={e => setClsEnd(e.target.value)} aria-label="End time" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <input className="input-field" placeholder="Room (e.g. 304)" value={clsRoom} onChange={e => setClsRoom(e.target.value)} />
                <input className="input-field" placeholder="Instructor (opt.)" value={clsInstructor} onChange={e => setClsInstructor(e.target.value)} />
              </div>
              <div className="flex gap-8 mt-12">
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Class
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClassFormOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ============ TAB 2: OFFICIAL SCHOOL CALENDAR + MONTH GRID ============ */}
      {tab === 'calendar' && (
        <div style={{ paddingBottom: 24 }}>
          {/* Official School Calendar Hero Card */}
          <div className="school-cal-hero">
            <div className="flex items-start justify-between gap-8" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="exam-countdown-eyebrow">
                  <CalendarIcon size={12} /> OFFICIAL ACADEMIC CALENDAR
                  {schoolCalendar?.version ? ` · v${schoolCalendar.version}` : ''}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                  {schoolCalendar ? schoolCalendar.schoolName : 'No School Calendar Yet'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {schoolCalendar
                    ? `AY ${schoolCalendar.academicYear || ''} · ${officialVisibleEvents.length} dates synced`
                    : 'Upload your school’s calendar photo/PDF once — update anytime mid-semester without losing tasks.'}
                </div>
              </div>
              <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setCalendarImportOpen(true)}
                >
                  {schoolCalendar ? 'Revise / Update' : 'Auto-Make Calendar'}
                </button>
              </div>
            </div>

            {schoolCalendar && (
              <div className="school-cal-term-tabs" role="group" aria-label="Select semester">
                {SCHOOL_CALENDAR_TERMS.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`row-action-chip${schoolCalendar.activeTerm === t.id ? ' active-chip' : ''}`}
                    onClick={() => handleSwitchCalendarTerm(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
                {calHighlights.nextBreak && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                    Next break: <strong>{calHighlights.nextBreak.title}</strong> ({calHighlights.nextBreak.startDate})
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Exam Countdown Banner */}
          {nextExam && (
            <div className="exam-countdown-card">
              <div style={{ flex: 1 }}>
                <div className="exam-countdown-eyebrow">
                  <Sparkles size={13} /> NEXT EXAM COUNTDOWN
                </div>
                <div className="exam-countdown-title">{nextExam.title}</div>
                <div className="exam-countdown-sub">
                  {nextExam.course} · {nextExam.dateKey}
                  {nextExam.timeLabel ? ` · ${nextExam.timeLabel}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="exam-countdown-days">
                  {(() => {
                    const d = daysUntilDateKey(nextExam.dateKey);
                    if (d === 0) return 'TODAY';
                    if (d === 1) return '1 day';
                    return `${d} days`;
                  })()}
                </div>
                <button
                  type="button"
                  className="row-action-chip"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    const f = findMatchingFolder(nextExam.course);
                    if (f && onOpenExamPaper) onOpenExamPaper({ sourceFolder: f });
                    else if (f && onOpenFolder) onOpenFolder(f);
                  }}
                >
                  <GraduationCap size={13} /> Practice Exam
                </button>
              </div>
            </div>
          )}

          {/* Month Calendar Grid */}
          <div className="list-group settings-group" style={{ marginTop: 10 }}>
            <div className="cal-header">
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                <ChevronLeft size={18} />
              </button>
              <div className="cal-month-title">{formatMonthTitle(viewYear, viewMonth)}</div>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => {
                    const now = new Date();
                    setViewYear(now.getFullYear());
                    setViewMonth(now.getMonth());
                    setSelectedDate(todayKey);
                  }}
                >
                  Today
                </button>
                <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="cal-weekdays">
              {DAYS_SHORT.map(d => (
                <div key={d} className="cal-weekday">
                  {d}
                </div>
              ))}
            </div>

            <div className="cal-grid">
              {calendarCells.map((cell, idx) => {
                if (!cell) return <div key={`empty-${idx}`} className="cal-cell cal-cell-empty" />;
                const dayItems = itemsByDate.get(cell.dateKey) || [];
                const dayOfficial = officialVisibleEvents.filter(
                  ev => ev.startDate <= cell.dateKey && cell.dateKey <= (ev.endDate || ev.startDate)
                );
                const hasExam =
                  dayItems.some(x => x.type === 'exam' && !x.done) ||
                  dayOfficial.some(ev => ev.kind === 'exam');
                const hasBreak = dayOfficial.some(ev => ev.kind === 'holiday' || ev.kind === 'no-class');
                const hasSchoolEvent = dayOfficial.some(
                  ev => ev.kind !== 'exam' && ev.kind !== 'holiday' && ev.kind !== 'no-class'
                );
                const hasTask = dayItems.some(x => x.type !== 'exam' && !x.done);
                const isToday = cell.dateKey === todayKey;
                const isSel = cell.dateKey === selectedDate;
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`cal-cell${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}${hasBreak ? ' is-break' : ''}`}
                    onClick={() => setSelectedDate(cell.dateKey)}
                  >
                    <span className="cal-day-num">{cell.day}</span>
                    <span className="cal-dots">
                      {hasExam && <span className="cal-dot cal-dot-exam" />}
                      {hasBreak && <span className="cal-dot cal-dot-break" />}
                      {hasSchoolEvent && <span className="cal-dot cal-dot-canvas" />}
                      {hasTask && <span className="cal-dot cal-dot-todo" />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="cal-legend">
              <span><i className="cal-dot cal-dot-exam" /> Exam</span>
              <span><i className="cal-dot cal-dot-break" /> Holiday / No Class</span>
              <span><i className="cal-dot cal-dot-canvas" /> School Event</span>
              <span><i className="cal-dot cal-dot-todo" /> Task</span>
            </div>
          </div>

          {/* Selected Day Agenda (Official School Events + GEC F2F/Virtual Classes + Tasks) */}
          <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', paddingRight: 16 }}>
            <span>Agenda · {selectedDate === todayKey ? `Today (${selectedDate})` : selectedDate}</span>
            <button
              type="button"
              className="row-action-chip"
              onClick={() => {
                setNewDate(selectedDate);
                setAddOpen(true);
              }}
            >
              <Plus size={12} /> Add Task
            </button>
          </div>

          {selectedDayGecBanner && (
            <div style={{ padding: '0 var(--gutter) 6px' }}>
              <span className={selectedDayGecBanner.kind === 'special' ? 'gec-badge-special' : 'gec-week-summary-pill'}>
                GEC Schedule: {selectedDayGecBanner.text}
              </span>
            </div>
          )}

          {selectedDayOfficial.length > 0 && (
            <div className="list-group" style={{ marginBottom: 8 }}>
              {selectedDayOfficial.map(ev => (
                <div key={ev.eventKey} className="list-item list-item-static">
                  <span
                    className="timetable-bar"
                    style={{
                      background:
                        ev.kind === 'exam'
                          ? '#ff375f'
                          : ev.kind === 'holiday' || ev.kind === 'no-class'
                            ? '#ff9f0a'
                            : '#5856d6',
                    }}
                  />
                  <div className="list-item-body">
                    <div className="list-item-title">{ev.title}</div>
                    <div className="list-item-subtitle">
                      Official Calendar · {ev.startDate}
                      {ev.endDate && ev.endDate !== ev.startDate ? ` to ${ev.endDate}` : ''} · {ev.kind}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedDayClasses.length > 0 && (
            <div className="list-group">
              {selectedDayClasses.map(c => {
                const gecMod = resolveGecModalityForDate(c, selectedDate, gecSchedule);
                return (
                  <div key={c.id} className="list-item list-item-static">
                    <span className="timetable-bar" style={{ background: c.color || '#0a84ff' }} />
                    <div className="list-item-body">
                      <div className="list-item-title">
                        <span>{c.subject}</span>
                        {gecMod?.mode === 'f2f' && <span className="gec-badge-f2f">F2F</span>}
                        {gecMod?.mode === 'virtual' && <span className="gec-badge-virtual">VIRTUAL</span>}
                        {gecMod?.mode === 'special' && <span className="gec-badge-special">{gecMod.label}</span>}
                      </div>
                      <div className="list-item-subtitle">
                        {c.startTime}–{c.endTime}
                        {gecMod?.mode === 'virtual' ? ' · Virtual / Online' : c.room ? ` · ${c.room}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => {
                        const f = findMatchingFolder(c.subject);
                        if (f) onOpenFolder?.(f);
                      }}
                    >
                      <FolderOpen size={12} /> Notes
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="list-group" style={{ marginTop: 8 }}>
            {selectedDayItems.length === 0 && selectedDayOfficial.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No tasks or events on {selectedDate}. Tap &quot;+ Add Task&quot; or import your Official School Calendar above.
                </span>
              </div>
            ) : (
              selectedDayItems.map(item => (
                <div key={item.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ padding: 2, marginTop: 2 }}
                    aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
                    onClick={() => handleToggleDone(item)}
                  >
                    {item.done ? <CheckSquare size={18} color="var(--accent-ink)" /> : <Square size={18} />}
                  </button>
                  <div className="list-item-body">
                    <div
                      className="list-item-title"
                      style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.6 : 1 }}
                    >
                      <span>{item.title}</span>
                      {item.source === 'canvas' && <span className="mode-badge mode-code">Canvas</span>}
                      {item.type === 'exam' && <span className="mode-badge mode-vault">Exam</span>}
                    </div>
                    <div className="list-item-subtitle">
                      {item.course}
                      {item.timeLabel ? ` · ${item.timeLabel}` : ''}
                    </div>
                    <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                      <button type="button" className="row-action-chip" onClick={() => handleStartNoteFromItem(item)}>
                        <FilePlus2 size={12} /> Start Note
                      </button>
                      <button
                        type="button"
                        className="row-action-chip"
                        onClick={() => handleDeleteItem(item.id)}
                        aria-label="Delete item"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ============ TAB 3: TASKS & CANVAS LMS ============ */}
      {tab === 'tasks' && (
        <div style={{ paddingBottom: 24 }}>
          <div className="list-group settings-group" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="settings-label" style={{ marginBottom: 0 }}>
                Canvas LMS Sync
              </div>
              {onOpenAnnouncements && (
                <button type="button" className="row-action-chip active-chip" onClick={onOpenAnnouncements}>
                  <Megaphone size={12} /> Announcements Feed
                </button>
              )}
            </div>
            <p className="settings-help" style={{ marginTop: 6 }}>
              Paste your Canvas <strong>Calendar Feed (.ics)</strong> link to sync assignments &amp; due dates automatically.
            </p>
            <input
              className="input-field"
              placeholder="https://yourschool.instructure.com/feeds/calendars/user_xxxx.ics"
              value={icsUrl}
              onChange={e => setIcsUrl(e.target.value)}
            />
            <textarea
              className="input-field mt-8"
              rows={2}
              placeholder="Course Announcements RSS feeds (.atom, one per line)"
              value={rssUrls}
              onChange={e => setRssUrls(e.target.value)}
            />
            <label className="ios-switch-row mt-10">
              <span className="ios-switch-label" style={{ fontSize: 13 }}>
                Auto-sync when app opens (every 15 min){lastSync > 0 ? ` · Last ${new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
              </span>
              <span className="ios-switch">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={e => {
                    const next = e.target.checked;
                    setAutoSync(next);
                    saveCanvasSettings({ autoSync: next });
                  }}
                />
                <span className="ios-switch-track" />
              </span>
            </label>
            <div className="flex gap-8 mt-10" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={syncing} onClick={handleSyncCanvas}>
                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing Canvas…' : 'Sync Canvas Now'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAdvancedCanvas(v => !v)}>
                {showAdvancedCanvas ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Access Token (Opt.)
              </button>
            </div>
            {showAdvancedCanvas && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--sep)' }}>
                <input
                  className="input-field"
                  placeholder="Canvas Host (e.g. https://school.instructure.com)"
                  value={canvasHost}
                  onChange={e => setCanvasHost(e.target.value)}
                />
                <input
                  className="input-field mt-8"
                  type="password"
                  placeholder="Personal Access Token (optional)"
                  value={canvasToken}
                  onChange={e => setCanvasToken(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Pending Tasks */}
          <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, paddingRight: 16 }}>
            <span>To-Do &amp; Assignments ({pendingTasks.length})</span>
            <div className="flex gap-6">
              {pendingTasks.some(t => t.dateKey && t.dateKey < todayKey) && (
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={async () => {
                    const count = await markPastTasksDone();
                    onChanged?.();
                    await refreshData();
                    toast(`Marked ${count} past task${count === 1 ? '' : 's'} as Done!`, { type: 'success' });
                  }}
                >
                  Clear Past
                </button>
              )}
              <button
                type="button"
                className="row-action-chip"
                onClick={() => {
                  setNewType('todo');
                  setNewDate(todayKey);
                  setAddOpen(true);
                }}
              >
                <Plus size={12} /> Add To-Do
              </button>
            </div>
          </div>

          <div className="list-group">
            {pendingTasks.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">All caught up! Add a To-Do or sync your Canvas feed above.</span>
              </div>
            ) : (
              pendingTasks.map(item => {
                const dLeft = daysUntilDateKey(item.dateKey);
                const overdue = dLeft !== null && dLeft < 0;
                return (
                  <div key={item.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: 2, marginTop: 2 }}
                      aria-label="Complete task"
                      onClick={() => handleToggleDone(item)}
                    >
                      <Square size={18} />
                    </button>
                    <div className="list-item-body">
                      <div className="list-item-title">
                        <span>{item.title}</span>
                        {item.source === 'canvas' && <span className="mode-badge mode-code">Canvas</span>}
                        {item.type === 'exam' && <span className="mode-badge mode-vault">Exam</span>}
                      </div>
                      <div className="list-item-subtitle" style={{ color: overdue ? '#ff453a' : undefined }}>
                        {item.course} · {item.dateKey}
                        {overdue ? ' · Overdue' : dLeft === 0 ? ' · Due Today' : dLeft === 1 ? ' · Tomorrow' : ''}
                      </div>
                      <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                        <button type="button" className="row-action-chip" onClick={() => handleStartNoteFromItem(item)}>
                          <FilePlus2 size={12} /> Start Note
                        </button>
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noreferrer" className="row-action-chip" style={{ textDecoration: 'none' }}>
                            <ExternalLink size={12} /> Canvas
                          </a>
                        )}
                        <button type="button" className="row-action-chip" onClick={() => handleDeleteItem(item.id)} aria-label="Delete task">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {doneTasks.length > 0 && (
            <div style={{ padding: '6px 16px' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDone(v => !v)}>
                {showDone ? 'Hide' : 'Show'} Completed ({doneTasks.length})
              </button>
              {showDone && (
                <div className="list-group" style={{ margin: '8px 0 0' }}>
                  {doneTasks.map(item => (
                    <div key={item.id} className="list-item list-item-static">
                      <button type="button" className="icon-btn" aria-label="Reopen task" onClick={() => handleToggleDone(item)}>
                        <CheckSquare size={18} color="var(--accent-ink)" />
                      </button>
                      <div className="list-item-body">
                        <div className="list-item-title" style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                          {item.title}
                        </div>
                        <div className="list-item-subtitle">{item.course} · {item.dateKey}</div>
                      </div>
                      <button type="button" className="row-icon-btn" aria-label="Delete completed task" onClick={() => handleDeleteItem(item.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick-Paste Announcement */}
          <div className="section-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={13} /> Quick-Paste Announcement
          </div>
          <div className="list-group settings-group">
            <input
              className="input-field"
              placeholder="Course name (e.g. GEC-UTS, CS 201)"
              value={pasteCourse}
              onChange={e => setPasteCourse(e.target.value)}
            />
            <textarea
              className="input-field mt-8"
              rows={2}
              placeholder="Paste teacher post to auto-detect dates..."
              value={pasteText}
              onChange={e => {
                setPasteText(e.target.value);
                setPastedPreview(null);
              }}
            />
            <div className="flex gap-8 mt-8">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAnalyzePaste}>
                Detect Dates &amp; Preview
              </button>
            </div>
            {pastedPreview && (
              <div className="announcement-preview-box">
                <div style={{ fontWeight: 600, fontSize: 14 }}>{pastedPreview.title}</div>
                <div className="settings-help" style={{ marginTop: 4 }}>
                  {pastedPreview.course}
                  {pastedPreview.detectedDateKey ? ` · Date: ${pastedPreview.detectedDateKey}` : ''}
                </div>
                <div className="flex gap-6 mt-10" style={{ flexWrap: 'wrap' }}>
                  {pastedPreview.detectedDateKey && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSavePastedAnnouncement({ addDeadline: true })}
                    >
                      + Save &amp; Add Deadline
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleSavePastedAnnouncement({ addDeadline: false })}
                  >
                    Save Announcement
                  </button>
                </div>
              </div>
            )}
          </div>

          {announcements.length > 0 && (
            <div className="list-group" style={{ marginTop: 10 }}>
              {announcements.slice(0, 6).map(ann => (
                <div key={ann.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                  <span className="list-item-icon"><Megaphone size={16} /></span>
                  <div className="list-item-body">
                    <div className="list-item-title">{ann.title}</div>
                    <div className="list-item-subtitle">{ann.course} · {ann.dateKey}</div>
                    {ann.description && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        <MarkdownContent text={ann.description} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lazy Importer Sheets */}
      {schedulePdfOpen && (
        <Suspense fallback={null}>
          <SchedulePdfImportSheet
            courses={coursesList}
            folders={folders}
            onClose={() => setSchedulePdfOpen(false)}
            onImported={() => {
              onChanged?.();
              refreshData();
            }}
          />
        </Suspense>
      )}
      {calendarImportOpen && (
        <Suspense fallback={null}>
          <SchoolCalendarImportSheet
            existingCalendar={schoolCalendar}
            onClose={() => setCalendarImportOpen(false)}
            onApplied={() => {
              onChanged?.();
              refreshData();
            }}
          />
        </Suspense>
      )}
      {gecImportOpen && (
        <Suspense fallback={null}>
          <GecScheduleImportSheet
            courses={coursesList}
            scheduleRows={classes}
            existingGec={gecSchedule}
            onClose={() => setGecImportOpen(false)}
            onApplied={() => {
              onChanged?.();
              refreshData();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
