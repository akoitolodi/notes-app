/**
 * StudentHubScreen — Unified School Command Center:
 * 1. Calendar (Month grid + Exam Countdown + Daily Agenda + Quick Add)
 * 2. To-Dos & Canvas LMS (Primary .ics Calendar Feed + RSS/Quick-Paste Announcements + 1-Tap Start Note)
 * 3. Weekly Class Timetable (Mon–Sat schedule + Today's Classes + Open Subject Folder)
 * 4. Grades & Heatmap (PH GWA / US GPA Target Final Calculator + 16-Week Study Activity Heatmap)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Flame,
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
  getActivityHeatmap,
  logStudyActivity,
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
import { evaluateQuizScore, summarizeQuizHistory } from '../lib/gradeCalc';
import { syncDeadlineNotifications } from '../lib/notifications';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

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

const QUIZ_PASS_KEY = 'aicn:quizPassPct';
const QUIZ_BASE_KEY = 'aicn:quizGradeBase';
const QUIZ_HISTORY_KEY = 'aicn:quizHistory:v1';

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

function getHeatmapLevel(count) {
  if (!count || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export default function StudentHubScreen({
  onBack,
  onOpenNote,
  onOpenFolder,
  onOpenExamPaper,
  onChanged,
}) {
  const { toast } = useDialog();
  const [tab, setTab] = useState('calendar'); // calendar | todos | timetable | grades

  // Data from Dexie
  const [items, setItems] = useState([]);
  const [classes, setClasses] = useState([]);
  const [folders, setFolders] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [selectedHeatCell, setSelectedHeatCell] = useState(null);

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

  // Timetable state
  const todayDow = new Date().getDay();
  const [selectedDay, setSelectedDay] = useState(todayDow >= 1 && todayDow <= 6 ? todayDow : 1);
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [clsSubject, setClsSubject] = useState('');
  const [clsDay, setClsDay] = useState(todayDow >= 1 && todayDow <= 6 ? todayDow : 1);
  const [clsStart, setClsStart] = useState('08:30');
  const [clsEnd, setClsEnd] = useState('10:00');
  const [clsRoom, setClsRoom] = useState('');
  const [clsInstructor, setClsInstructor] = useState('');
  const [clsColor, setClsColor] = useState(CLASS_COLORS[0]);

  // Quiz & Exam Pass Calculator state (persisted locally)
  const [coursesList, setCoursesList] = useState([]);
  const [quizScore, setQuizScore] = useState('');
  const [quizTotal, setQuizTotal] = useState('50');
  const [quizPassPct, setQuizPassPct] = useState(() => {
    try {
      const n = Number(localStorage.getItem(QUIZ_PASS_KEY));
      return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 75;
    } catch {
      return 75;
    }
  });
  const [quizBase, setQuizBase] = useState(() => {
    try {
      const b = Number(localStorage.getItem(QUIZ_BASE_KEY));
      return b === 50 || b === 60 ? b : 0;
    } catch {
      return 0;
    }
  });
  const [quizLabel, setQuizLabel] = useState('');
  const [quizCourse, setQuizCourse] = useState('');
  const [quizHistory, setQuizHistory] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(QUIZ_PASS_KEY, String(quizPassPct));
    } catch {
      // ignore
    }
  }, [quizPassPct]);

  useEffect(() => {
    try {
      localStorage.setItem(QUIZ_BASE_KEY, String(quizBase));
    } catch {
      // ignore
    }
  }, [quizBase]);

  useEffect(() => {
    try {
      localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(quizHistory.slice(0, 60)));
    } catch {
      // ignore
    }
  }, [quizHistory]);

  const refreshData = useCallback(async () => {
    const [allItems, allClasses, allFolders, allCourses, heat] = await Promise.all([
      db.plannerItems.toArray().catch(() => []),
      db.classSchedule.toArray().catch(() => []),
      db.folders.toArray().catch(() => []),
      db.courses.toArray().catch(() => []),
      getActivityHeatmap(112),
    ]);
    allItems.sort((a, b) => String(a.dateKey || '').localeCompare(String(b.dateKey || '')) || (a.dueAt || 0) - (b.dueAt || 0));
    allClasses.sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
    // Never leak hidden/locked vault folders into School Planner suggestions
    const safeFolders = allFolders.filter(f => !f.locked && !f.isSystemVault && f.mode !== 'vault');
    setItems(allItems);
    setClasses(allClasses);
    setFolders(safeFolders);
    setCoursesList(allCourses.filter(c => !c.archived));
    setHeatmap(heat);
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
            toast(
              `Canvas auto-synced: ${res.added} new item${res.added === 1 ? '' : 's'}!`,
              { type: 'success' }
            );
          }
        }
      })
      .catch(() => {});
  }, [refreshData, onChanged, toast]);

  // Match a course name to an existing non-vault Subject Folder (or fallback to General)
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

  // 1-Tap "Start Note" from any Canvas assignment / announcement / planner item
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

  // Add personal event / exam / to-do
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

  // Sync Canvas feeds (.ics + optional RSS + optional Access Token)
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

  // Quick-paste Canvas announcement parser
  const handleAnalyzePaste = () => {
    if (!pasteText.trim()) {
      toast('Paste a Canvas announcement first', { type: 'error' });
      return;
    }
    const parsed = parsePastedAnnouncement(pasteText, pasteCourse || 'Canvas');
    setPastedPreview(parsed);
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

    if (createNoteToo) {
      await handleStartNoteFromItem(annItem);
    } else {
      toast(
        addDeadline && savedPreview.detectedDateKey
          ? `Saved announcement & added deadline (${savedPreview.detectedDateKey}) to Calendar!`
          : 'Announcement saved to Canvas feed',
        { type: 'success' }
      );
    }
  };

  // Timetable handlers
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
    setSelectedDay(Number(clsDay));
    toast('Class added to timetable', { type: 'success' });
    refreshData();
  };

  const handleDeleteClass = async id => {
    await db.classSchedule.delete(id);
    toast('Removed class');
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

  // Next upcoming exam for Countdown banner
  const nextExam = useMemo(() => {
    const upcoming = items
      .filter(it => it.type === 'exam' && !it.done && it.dateKey >= todayKey)
      .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    return upcoming[0] || null;
  }, [items, todayKey]);

  const selectedDayItems = itemsByDate.get(selectedDate) || [];
  const selectedDayDow = useMemo(() => {
    const p = selectedDate.split('-').map(Number);
    return p.length === 3 ? new Date(p[0], p[1] - 1, p[2]).getDay() : todayDow;
  }, [selectedDate, todayDow]);
  const selectedDayClasses = classesByDow.get(selectedDayDow) || [];

  const taskItems = useMemo(
    () => items.filter(it => it.type !== 'announcement'),
    [items]
  );
  const pendingTasks = useMemo(() => taskItems.filter(it => !it.done), [taskItems]);
  const doneTasks = useMemo(() => taskItems.filter(it => it.done), [taskItems]);
  const announcements = useMemo(
    () => items.filter(it => it.type === 'announcement').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [items]
  );

  // Quiz & Exam Pass calculation + history summary
  const quizEval = useMemo(
    () =>
      evaluateQuizScore({
        score: quizScore,
        total: quizTotal,
        passingPercent: quizPassPct,
        base: quizBase,
      }),
    [quizScore, quizTotal, quizPassPct, quizBase]
  );
  const quizSummary = useMemo(
    () => summarizeQuizHistory(quizHistory, quizPassPct),
    [quizHistory, quizPassPct]
  );

  const handleSaveQuizRecord = () => {
    if (!quizEval.hasScore || quizEval.total <= 0) {
      toast('Enter both your score and total items first', { type: 'error' });
      return;
    }
    const entry = {
      id: `q-${Date.now()}`,
      label: quizLabel.trim() || `Quiz #${quizHistory.length + 1}`,
      course: quizCourse.trim(),
      score: quizEval.score,
      total: quizEval.total,
      base: quizBase,
      passingPercent: quizEval.passingPercent,
      rawPercent: quizEval.rawPercent,
      transmutedPercent: quizEval.transmutedPercent,
      passed: Boolean(quizEval.passed),
      at: Date.now(),
    };
    setQuizHistory(prev => [entry, ...prev].slice(0, 60));
    setQuizLabel('');
    toast(
      `${entry.label}: ${entry.transmutedPercent}% — ${entry.passed ? 'PASSED ✓' : 'FAILED ✕'}`,
      { type: entry.passed ? 'success' : 'info' }
    );
  };

  // Activity heatmap summary
  const heatSummary = useMemo(() => {
    let totalActions = 0;
    let activeDays = 0;
    let streak = 0;
    for (const c of heatmap) {
      if (c.count > 0) {
        totalActions += c.count;
        activeDays += 1;
      }
    }
    for (let i = heatmap.length - 1; i >= 0; i--) {
      if (heatmap[i].count > 0) streak += 1;
      else if (i < heatmap.length - 1) break;
    }
    return { totalActions, activeDays, streak };
  }, [heatmap]);

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
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to folders"
        >
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">School Planner</span>
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

      <div className="large-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
        <span>School Planner</span>
        {pendingTasks.length > 0 && (
          <span className="mode-badge mode-study" style={{ fontSize: 12 }}>
            {pendingTasks.length} due
          </span>
        )}
      </div>

      {/* Top 4-Tab Bar */}
      <div className="hub-tabs" role="tablist">
        {[
          ['calendar', 'Calendar', CalendarIcon],
          ['todos', 'To-Dos & Canvas', CheckSquare],
          ['timetable', 'Timetable', Clock],
          ['grades', 'Scores & Map', GraduationCap],
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
            placeholder="Title (e.g. Calculus Problem Set 4, Midterm Exam)"
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

      {/* ============ TAB 1: CALENDAR ============ */}
      {tab === 'calendar' && (
        <div style={{ paddingBottom: 20 }}>
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
                    if (f && onOpenExamPaper) {
                      onOpenExamPaper({ sourceFolder: f });
                    } else if (f && onOpenFolder) {
                      onOpenFolder(f);
                    }
                  }}
                >
                  <GraduationCap size={13} /> Practice Exam
                </button>
              </div>
            </div>
          )}

          {/* Month Calendar Card */}
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
                const hasExam = dayItems.some(x => x.type === 'exam' && !x.done);
                const hasCanvas = dayItems.some(x => x.source === 'canvas' && x.type !== 'exam' && !x.done);
                const hasTodo = dayItems.some(x => x.source !== 'canvas' && x.type !== 'exam' && !x.done);
                const hasClass = (classesByDow.get(cell.dow) || []).length > 0;
                const isToday = cell.dateKey === todayKey;
                const isSel = cell.dateKey === selectedDate;
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`cal-cell${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}`}
                    onClick={() => setSelectedDate(cell.dateKey)}
                  >
                    <span className="cal-day-num">{cell.day}</span>
                    <span className="cal-dots">
                      {hasExam && <span className="cal-dot cal-dot-exam" />}
                      {hasCanvas && <span className="cal-dot cal-dot-canvas" />}
                      {hasTodo && <span className="cal-dot cal-dot-todo" />}
                      {hasClass && <span className="cal-dot cal-dot-class" />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="cal-legend">
              <span><i className="cal-dot cal-dot-exam" /> Exam</span>
              <span><i className="cal-dot cal-dot-canvas" /> Canvas</span>
              <span><i className="cal-dot cal-dot-todo" /> To-Do</span>
              <span><i className="cal-dot cal-dot-class" /> Class</span>
            </div>
          </div>

          {/* Selected Day Agenda */}
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
              <Plus size={12} /> Add
            </button>
          </div>

          {selectedDayClasses.length > 0 && (
            <div className="list-group">
              {selectedDayClasses.map(c => (
                <div key={c.id} className="list-item list-item-static">
                  <span className="timetable-bar" style={{ background: c.color || '#0a84ff' }} />
                  <div className="list-item-body">
                    <div className="list-item-title">{c.subject}</div>
                    <div className="list-item-subtitle">
                      {c.startTime}–{c.endTime}
                      {c.room ? ` · ${c.room}` : ''}
                      {c.instructor ? ` · ${c.instructor}` : ''}
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
              ))}
            </div>
          )}

          <div className="list-group" style={{ marginTop: 8 }}>
            {selectedDayItems.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No tasks or deadlines on {selectedDate}. Tap "+ Add" or sync Canvas in To-Dos &amp; Canvas.
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
                      <button
                        type="button"
                        className="row-action-chip"
                        onClick={() => handleStartNoteFromItem(item)}
                      >
                        <FilePlus2 size={12} /> Start Note
                      </button>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="row-action-chip"
                          style={{ textDecoration: 'none' }}
                        >
                          <ExternalLink size={12} /> Canvas
                        </a>
                      )}
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

      {/* ============ TAB 2: TO-DOS & CANVAS LMS ============ */}
      {tab === 'todos' && (
        <div style={{ paddingBottom: 20 }}>
          {/* Canvas LMS Integration Card */}
          <div className="list-group settings-group" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="settings-label" style={{ marginBottom: 0 }}>
                Canvas LMS Sync (No Admin Token Needed!)
              </div>
              {lastSync > 0 && (
                <span className="settings-help" style={{ margin: 0 }}>
                  Synced {new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </div>
            <p className="settings-help" style={{ marginTop: 6 }}>
              <strong>1. Calendar Feed (.ics)</strong> — In Canvas, open <strong>Calendar → Calendar Feed</strong> and
              copy your link (covers all your courses automatically).
            </p>
            <input
              className="input-field"
              placeholder="https://yourschool.instructure.com/feeds/calendars/user_xxxx.ics"
              value={icsUrl}
              onChange={e => setIcsUrl(e.target.value)}
            />

            <p className="settings-help" style={{ marginTop: 10 }}>
              <strong>2. Course Announcements Feeds (.atom / RSS)</strong> — Open each Canvas Course →{' '}
              <strong>Announcements → RSS Feed</strong> and paste its URL below (one URL per line).
            </p>
            <textarea
              className="input-field"
              rows={2}
              placeholder="https://yourschool.instructure.com/feeds/announcements/enrollment_xxx.atom"
              value={rssUrls}
              onChange={e => setRssUrls(e.target.value)}
            />

            <label className="ios-switch-row mt-10">
              <span className="ios-switch-label" style={{ fontSize: 13 }}>
                Auto-sync when app opens (every 15 min)
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
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={syncing}
                onClick={handleSyncCanvas}
              >
                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing Canvas…' : 'Sync Canvas Now'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAdvancedCanvas(v => !v)}
              >
                {showAdvancedCanvas ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Optional Access Token
              </button>
            </div>

            {showAdvancedCanvas && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--sep)' }}>
                <div className="settings-label">Optional Canvas Access Token (if school allows it)</div>
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

          {/* Pending To-Do Checklist */}
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
                    toast(`Marked ${count} past/submitted task${count === 1 ? '' : 's'} as Done!`, { type: 'success' });
                  }}
                >
                  ✓ Clear Past ({pendingTasks.filter(t => t.dateKey && t.dateKey < todayKey).length})
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
          {pendingTasks.some(t => t.source === 'canvas') && (
            <div className="settings-help" style={{ padding: '0 var(--gutter) 6px', margin: 0 }}>
              Tip: Canvas <code>.ics</code> feeds don&apos;t include submission/grade status — tap the checkbox on
              anything you already submitted and we&apos;ll remember it across future syncs!
            </div>
          )}
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
                        {item.timeLabel ? ` · ${item.timeLabel}` : ''}
                        {overdue ? ' · Overdue' : dLeft === 0 ? ' · Due Today' : dLeft === 1 ? ' · Tomorrow' : ''}
                      </div>
                      {item.description && (
                        <div className="list-item-subtitle" style={{ marginTop: 4, whiteSpace: 'normal' }}>
                          {item.description.slice(0, 140)}
                          {item.description.length > 140 ? '…' : ''}
                        </div>
                      )}
                      <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="row-action-chip"
                          onClick={() => handleStartNoteFromItem(item)}
                        >
                          <FilePlus2 size={12} /> Start Note
                        </button>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="row-action-chip"
                            style={{ textDecoration: 'none' }}
                          >
                            <ExternalLink size={12} /> Open Canvas
                          </a>
                        )}
                        <button
                          type="button"
                          className="row-action-chip"
                          onClick={() => handleDeleteItem(item.id)}
                          aria-label="Delete task"
                        >
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
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Reopen task"
                        onClick={() => handleToggleDone(item)}
                      >
                        <CheckSquare size={18} color="var(--accent-ink)" />
                      </button>
                      <div className="list-item-body">
                        <div className="list-item-title" style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                          {item.title}
                        </div>
                        <div className="list-item-subtitle">
                          {item.course} · {item.dateKey}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="row-icon-btn"
                        aria-label="Delete completed task"
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick-Paste Canvas Announcement Importer */}
          <div className="section-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={13} /> Canvas Announcements (Quick-Paste &amp; RSS)
          </div>
          <div className="list-group settings-group">
            <p className="settings-help" style={{ marginTop: 0 }}>
              Copy any announcement from Canvas and paste it below — we automatically detect due dates so you can add
              them straight to your Calendar or Notes!
            </p>
            <input
              className="input-field"
              placeholder="Course name (e.g. CS 201, Physics 101)"
              value={pasteCourse}
              onChange={e => setPasteCourse(e.target.value)}
            />
            <textarea
              className="input-field mt-8"
              rows={3}
              placeholder="Paste Canvas announcement text here (e.g. Midterm Lab Report moved to November 28, 2026...)"
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
                  Course: <strong>{pastedPreview.course}</strong>
                  {pastedPreview.detectedDateKey ? (
                    <> · Detected date: <strong>{pastedPreview.detectedDateKey}</strong></>
                  ) : (
                    ' · No specific due date detected'
                  )}
                </div>
                <div className="flex gap-6 mt-10" style={{ flexWrap: 'wrap' }}>
                  {pastedPreview.detectedDateKey && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSavePastedAnnouncement({ addDeadline: true })}
                    >
                      + Save &amp; Add Deadline ({pastedPreview.detectedDateKey})
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleSavePastedAnnouncement({ addDeadline: false })}
                  >
                    Save Announcement
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      handleSavePastedAnnouncement({
                        addDeadline: Boolean(pastedPreview.detectedDateKey),
                        createNoteToo: true,
                      })
                    }
                  >
                    <FilePlus2 size={13} /> Save &amp; Open Note
                  </button>
                </div>
              </div>
            )}
          </div>

          {announcements.length > 0 && (
            <div className="list-group" style={{ marginTop: 10 }}>
              {announcements.map(ann => (
                <div key={ann.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                  <span className="list-item-icon">
                    <Megaphone size={16} />
                  </span>
                  <div className="list-item-body">
                    <div className="list-item-title">{ann.title}</div>
                    <div className="list-item-subtitle">
                      {ann.course}
                      {ann.author ? ` · ${ann.author}` : ''} · {ann.dateKey}
                    </div>
                    {ann.description && (
                      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                        <MarkdownContent text={ann.description} />
                      </div>
                    )}
                    <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="row-action-chip"
                        onClick={() => handleStartNoteFromItem(ann)}
                      >
                        <FilePlus2 size={12} /> Save to Notes
                      </button>
                      {ann.url && (
                        <a
                          href={ann.url}
                          target="_blank"
                          rel="noreferrer"
                          className="row-action-chip"
                          style={{ textDecoration: 'none' }}
                        >
                          <ExternalLink size={12} /> Open Canvas
                        </a>
                      )}
                      <button
                        type="button"
                        className="row-action-chip"
                        onClick={() => handleDeleteItem(ann.id)}
                        aria-label="Delete announcement"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ TAB 3: WEEKLY CLASS TIMETABLE ============ */}
      {tab === 'timetable' && (
        <div style={{ paddingBottom: 20 }}>
          <div className="day-pill-row">
            {TIMETABLE_DAYS.map(d => (
              <button
                key={d.idx}
                type="button"
                className={`day-pill${selectedDay === d.idx ? ' active' : ''}${todayDow === d.idx ? ' is-today' : ''}`}
                onClick={() => setSelectedDay(d.idx)}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="settings-help" style={{ margin: 0 }}>
              {TIMETABLE_DAYS.find(d => d.idx === selectedDay)?.label} Classes ({(classesByDow.get(selectedDay) || []).length})
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setClsDay(selectedDay);
                setClassFormOpen(v => !v);
              }}
            >
              <Plus size={14} /> Add Class
            </button>
          </div>

          {classFormOpen && (
            <form className="list-group settings-group" onSubmit={handleAddClass}>
              <div className="settings-label">Add Class Schedule</div>
              <input
                className="input-field"
                placeholder="Subject (e.g. Data Structures, Organic Chemistry)"
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
                <input
                  type="time"
                  className="input-field"
                  value={clsStart}
                  onChange={e => setClsStart(e.target.value)}
                  aria-label="Start time"
                />
                <input
                  type="time"
                  className="input-field"
                  value={clsEnd}
                  onChange={e => setClsEnd(e.target.value)}
                  aria-label="End time"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <input
                  className="input-field"
                  placeholder="Room (e.g. Room 304 / Lab B)"
                  value={clsRoom}
                  onChange={e => setClsRoom(e.target.value)}
                />
                <input
                  className="input-field"
                  placeholder="Instructor (optional)"
                  value={clsInstructor}
                  onChange={e => setClsInstructor(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-8 mt-10">
                {CLASS_COLORS.map(hex => (
                  <button
                    key={hex}
                    type="button"
                    className={`accent-swatch${clsColor === hex ? ' active' : ''}`}
                    style={{ background: hex, width: 24, height: 24 }}
                    aria-label={`Color ${hex}`}
                    onClick={() => setClsColor(hex)}
                  />
                ))}
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

          <div className="list-group">
            {(classesByDow.get(selectedDay) || []).length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No classes scheduled on {TIMETABLE_DAYS.find(d => d.idx === selectedDay)?.label}. Tap "+ Add Class" to
                  build your timetable.
                </span>
              </div>
            ) : (
              (classesByDow.get(selectedDay) || []).map(c => (
                <div key={c.id} className="list-item list-item-static">
                  <span className="timetable-bar" style={{ background: c.color || '#0a84ff' }} />
                  <div className="list-item-body">
                    <div className="list-item-title">{c.subject}</div>
                    <div className="list-item-subtitle">
                      {c.startTime} – {c.endTime}
                      {c.room ? ` · ${c.room}` : ''}
                      {c.instructor ? ` · ${c.instructor}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => {
                        const f = findMatchingFolder(c.subject);
                        if (f) onOpenFolder?.(f);
                      }}
                    >
                      <BookOpen size={12} /> Notes
                    </button>
                    <button
                      type="button"
                      className="row-icon-btn"
                      aria-label="Delete class"
                      onClick={() => handleDeleteClass(c.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ============ TAB 4: GRADES (GWA/GPA) & STUDY HEATMAP ============ */}
      {tab === 'grades' && (
        <div style={{ paddingBottom: 20 }}>
          {/* 16-Week Study Activity Heatmap */}
          <div className="list-group settings-group" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="settings-label" style={{ marginBottom: 0 }}>
                16-Week Study Activity Heatmap
              </div>
              <span className="streak-pill">
                <Flame size={13} /> {heatSummary.streak}d streak
              </span>
            </div>
            <p className="settings-help" style={{ marginTop: 4 }}>
              {heatSummary.totalActions} study actions across {heatSummary.activeDays} active days (notes, reviews,
              coding &amp; exams).
            </p>

            <div className="heatmap-wrap">
              <div className="heatmap-grid" role="grid" aria-label="16-week study activity heatmap">
                {heatmap.map(cell => (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`heatmap-cell lvl-${getHeatmapLevel(cell.count)}${selectedHeatCell?.dateKey === cell.dateKey ? ' selected' : ''}`}
                    title={`${cell.dateKey}: ${cell.count} actions`}
                    onClick={() => setSelectedHeatCell(cell)}
                  />
                ))}
              </div>
            </div>

            {selectedHeatCell && (
              <div className="settings-help" style={{ marginTop: 8 }}>
                <strong>{selectedHeatCell.dateKey}</strong>: {selectedHeatCell.count} total · {selectedHeatCell.notes}{' '}
                notes · {selectedHeatCell.reviews} reviews · {selectedHeatCell.coding} coding · {selectedHeatCell.exams}{' '}
                exams
              </div>
            )}
          </div>

          {/* Quiz & Exam Pass Calculator */}
          <div className="list-group settings-group">
            <div className="settings-label">Quiz &amp; Exam Pass Calculator</div>
            <p className="settings-help" style={{ marginTop: 0 }}>
              Check immediately if your quiz or exam passed — or leave Your Score blank to see the minimum score needed before taking the test.
            </p>

            {/* Score / Total Inputs */}
            <div className="quiz-inputs-grid">
              <div>
                <label className="pattern-mini-label" htmlFor="quiz-score-input">
                  Your Score (opt.)
                </label>
                <input
                  id="quiz-score-input"
                  type="number"
                  min="0"
                  step="0.5"
                  className="input-field"
                  placeholder="e.g. 36"
                  value={quizScore}
                  onChange={e => setQuizScore(e.target.value)}
                />
              </div>
              <div className="quiz-slash-sep">/</div>
              <div>
                <label className="pattern-mini-label" htmlFor="quiz-total-input">
                  Total Items
                </label>
                <input
                  id="quiz-total-input"
                  type="number"
                  min="1"
                  step="1"
                  className="input-field"
                  placeholder="e.g. 50"
                  value={quizTotal}
                  onChange={e => setQuizTotal(e.target.value)}
                />
              </div>
            </div>

            {/* Customizable Passing % Chips */}
            <div style={{ marginTop: 12 }}>
              <div className="pattern-mini-label" style={{ marginBottom: 6 }}>
                Passing Percentage ({quizPassPct}%)
              </div>
              <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
                {[50, 60, 70, 75, 80].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    className={`row-action-chip${Number(quizPassPct) === pct ? ' active-chip' : ''}`}
                    onClick={() => setQuizPassPct(pct)}
                  >
                    {pct}%
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="input-field"
                  style={{ width: 68, padding: '4px 7px', fontSize: 12, textAlign: 'center' }}
                  aria-label="Custom passing percentage"
                  value={quizPassPct}
                  onChange={e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setQuizPassPct(Math.max(1, Math.min(100, n)));
                  }}
                />
              </div>
            </div>

            {/* Grading Base Toggle */}
            <div style={{ marginTop: 12 }}>
              <div className="pattern-mini-label" style={{ marginBottom: 6 }}>
                Grading System
              </div>
              <div className="view-switcher view-switcher-inline" style={{ margin: 0 }}>
                {[
                  [0, 'Raw (Zero-Based)'],
                  [50, 'Base-50'],
                  [60, 'Base-60'],
                ].map(([b, lbl]) => (
                  <button
                    key={b}
                    type="button"
                    className={`view-switch-btn${quizBase === b ? ' active' : ''}`}
                    onClick={() => setQuizBase(b)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Verdict Card */}
            {quizEval.total > 0 && (
              <div
                className={`quiz-verdict-card${
                  quizEval.passed === true
                    ? ' is-pass'
                    : quizEval.passed === false
                      ? ' is-fail'
                      : ''
                }`}
              >
                {quizEval.hasScore ? (
                  <>
                    <div className="flex items-center justify-between gap-8">
                      <div>
                        <div className="quiz-verdict-pct">{quizEval.transmutedPercent}%</div>
                        {quizBase > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            Raw score: {quizEval.rawPercent}% ({quizEval.score}/{quizEval.total})
                          </div>
                        )}
                      </div>
                      <span className={`quiz-verdict-pill ${quizEval.passed ? 'is-pass' : 'is-fail'}`}>
                        {quizEval.passed ? 'PASSED ✓' : 'FAILED ✕'}
                      </span>
                    </div>

                    <div className="quiz-meter-track">
                      <div
                        className={`quiz-meter-fill ${quizEval.passed ? 'is-pass' : 'is-fail'}`}
                        style={{ width: `${Math.min(100, Math.max(2, quizEval.transmutedPercent))}%` }}
                      />
                      <span
                        className="quiz-meter-threshold"
                        style={{ left: `${Math.min(99, Math.max(1, quizEval.passingPercent))}%` }}
                        title={`Passing mark: ${quizEval.passingPercent}%`}
                      />
                    </div>

                    <div className="quiz-verdict-meta">
                      <span>
                        Min to pass: <strong>{quizEval.minScore} / {quizEval.total}</strong>
                      </span>
                      <span>
                        {quizEval.pointsMargin >= 0
                          ? `+${quizEval.pointsMargin} pts above passing`
                          : `${Math.abs(quizEval.pointsMargin)} pts short of passing`}
                      </span>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="pattern-mini-label">Before the Quiz / Exam</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>
                      Need at least <strong>{quizEval.minScore} / {quizEval.total}</strong> to pass ({quizEval.passingPercent}%)
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                      Max allowed mistakes: <strong>{quizEval.maxMistakes}</strong> ({quizEval.rawPercentRequired}% raw)
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quick Save to Personal Quiz Log */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, marginTop: 10 }}>
              <select
                className="input-field"
                value={quizCourse}
                onChange={e => setQuizCourse(e.target.value)}
                aria-label="Course for quiz log"
                style={{ fontSize: 12 }}
              >
                <option value="">General / Subject</option>
                {coursesList.map(c => (
                  <option key={c.id} value={c.code || c.name}>
                    {c.code || c.name}
                  </option>
                ))}
              </select>
              <input
                className="input-field"
                placeholder="Label (Quiz 1, Midterm)"
                value={quizLabel}
                onChange={e => setQuizLabel(e.target.value)}
                style={{ fontSize: 12 }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!quizEval.hasScore || quizEval.total <= 0}
                onClick={handleSaveQuizRecord}
              >
                <Plus size={14} /> Save
              </button>
            </div>

            {/* Saved Quiz History */}
            {quizHistory.length > 0 && (
              <div className="quiz-history-box">
                <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                  <span className="settings-label" style={{ margin: 0 }}>
                    Saved Scores ({quizSummary.passedCount}/{quizSummary.count} passed)
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-ink)' }}>
                    Avg: {quizSummary.avgPercent}% · Need next: {Math.min(100, quizSummary.neededNextPercent)}%
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {quizHistory.slice(0, 12).map(q => (
                    <div key={q.id} className="quiz-history-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {q.course ? `${q.course} · ` : ''}{q.label}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {q.score}/{q.total} · {q.transmutedPercent}% (pass {q.passingPercent}%{q.base ? `, Base-${q.base}` : ''})
                        </div>
                      </div>
                      <span className={`quiz-verdict-pill ${q.passed ? 'is-pass' : 'is-fail'}`} style={{ fontSize: 10.5, padding: '2px 7px' }}>
                        {q.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <button
                        type="button"
                        className="row-icon-btn"
                        aria-label={`Delete ${q.label}`}
                        onClick={() => setQuizHistory(prev => prev.filter(item => item.id !== q.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
