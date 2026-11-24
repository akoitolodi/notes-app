/**
 * CoursesDashboardScreen — Complete Canvas-Style Course Dashboard & Offline Course Workspace (v1.9.0):
 * - Colored Course Cards Grid + Semester GWA Summary + Nicknames / Edit / Archive + Auto-Discover
 * - 6 Tabs per Course: Home (Course Links + Attendance Guard + Study Progress) | Modules (Multi-File Batch
 *   Upload + Google Docs/Slides Link Import + Studied Checkmarks) | Posts | Tasks (Workflow Status + Score)
 *   | Grades (Syllabus Weights + Canvas What-If Simulator + Pre-Submit AI Rubric Checker) | Course AI
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  ChevronLeft,
  Plus,
  Sparkles,
  Megaphone,
  FolderOpen,
  CheckSquare,
  Square,
  FileUp,
  FileText,
  ClipboardPaste,
  Images,
  Trash2,
  Send,
  GraduationCap,
  BookOpen,
  ExternalLink,
  FilePlus2,
  ChevronDown,
  ChevronRight,
  Wand2,
  Layers,
  Eye,
  X,
  Link2,
  CheckCircle2,
  Archive,
  Pencil,
  Award,
  Download,
  Clock,
  MapPin,
  User,
} from 'lucide-react';
import {
  db,
  COURSE_PALETTE,
  createNote,
  createFolder,
  saveCourseMaterialWithChunks,
  deleteCourseMaterial,
  discoverCoursesFromPlanner,
  logStudyActivity,
} from '../store/db';
import { extractDocument } from '../lib/docImporter';
import { htmlToCleanMarkdown } from '../lib/htmlToMarkdown';
import { ocrImage } from '../lib/aiFeatures';
import { buildCanvasNoteContent, getCanvasSettings, saveCanvasSettings } from '../lib/canvasSync';
import {
  askCourseAiStream,
  generateCourseStudyPack,
  buildCourseExamSourceText,
} from '../lib/courseAi';
import {
  WORKFLOW_STATUSES,
  DEFAULT_COURSE_WEIGHTS,
  extractCourseLinks,
  getPublicGoogleExportUrl,
  importPublicGoogleLink,
  computeCourseGrade,
  computeSemesterGwa,
} from '../lib/courseExtras';
import {
  SCHEDULE_DAYS,
  formatTimeRange12h,
  groupDaysLabel,
  meetingsToScheduleRows,
  scheduleRowsToMeetings,
} from '../lib/scheduleView';
import { syncDeadlineNotifications, markAnnouncementRead } from '../lib/notifications';
import { compressImage } from './ImageManager';
import CourseGradesTab from './course/CourseGradesTab';
import CourseAttendanceCard from './course/CourseAttendanceCard';
import CourseScheduleView from './course/CourseScheduleView';
const DocumentViewerModal = lazy(() => import('./DocumentViewerModal'));
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

function courseMatchesTag(itemCourseStr, course) {
  const target = String(itemCourseStr || '').trim().toLowerCase();
  if (!target || !course) return false;
  const keys = [course.icsCourseTag, course.name, course.code, course.nickname]
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  return keys.some(k => target === k || target.includes(k) || k.includes(target));
}

export default function CoursesDashboardScreen({
  onBack,
  onOpenNote,
  onOpenFolder,
  onOpenExamPaper,
  onOpenPlanner,
  onChanged,
  onRegisterBack = null,
}) {
  const { confirm, toast } = useDialog();

  const [courses, setCourses] = useState([]);
  const [plannerItems, setPlannerItems] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [folders, setFolders] = useState([]);

  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [dashSection, setDashSection] = useState('courses'); // courses | schedule
  const [gwaMode, setGwaMode] = useState('gwa'); // gwa | gpa
  const [courseTab, setCourseTab] = useState('overview'); // overview | modules | announcements | assignments | grades | ai
  const [showArchived, setShowArchived] = useState(false);

  // Add / Edit Course Modal Form (+ Class Meetings & Units)
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cNickname, setCNickname] = useState('');
  const [cInstructor, setCInstructor] = useState('');
  const [cUnits, setCUnits] = useState('3');
  const [cRssUrl, setCRssUrl] = useState('');
  const [cFolderId, setCFolderId] = useState('');
  const [cColor, setCColor] = useState(COURSE_PALETTE[0]);
  const [cMeetings, setCMeetings] = useState([]);

  // Add Module / Material Drawer inside a Course
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState('file'); // file | paste | ocr
  const [modName, setModName] = useState('Module 1');
  const [matTitle, setMatTitle] = useState('');
  const [matFiles, setMatFiles] = useState([]);
  const [pasteMd, setPasteMd] = useState('');
  const [ocrFiles, setOcrFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [importingLinkUrl, setImportingLinkUrl] = useState('');

  // Module collapsible + Exam-Week selection state
  const [collapsedMods, setCollapsedMods] = useState({});
  const [selectedMatIds, setSelectedMatIds] = useState([]);
  const [previewMaterial, setPreviewMaterial] = useState(null);

  // Course AI Chat & Study Pack state
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [packBusy, setPackBusy] = useState('');

  const fileInputRef = useRef(null);
  const ocrInputRef = useRef(null);
  const abortRef = useRef(null);

  const refreshAll = useCallback(async () => {
    const [cs, pi, mats, sched, flds] = await Promise.all([
      db.courses.toArray().catch(() => []),
      db.plannerItems.toArray().catch(() => []),
      db.courseMaterials.toArray().catch(() => []),
      db.classSchedule.toArray().catch(() => []),
      db.folders.toArray().catch(() => []),
    ]);
    cs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    pi.sort((a, b) => String(a.dateKey || '').localeCompare(String(b.dateKey || '')));
    mats.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const safeFolders = flds.filter(f => !f.locked && !f.isSystemVault && f.mode !== 'vault');
    setCourses(cs);
    setPlannerItems(pi);
    setMaterials(mats);
    setSchedule(sched);
    setFolders(safeFolders);
  }, []);

  useEffect(() => {
    refreshAll();
    return () => abortRef.current?.abort();
  }, [refreshAll]);

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  useEffect(() => {
    setSelectedMatIds([]);
    setChatMsgs([]);
    setChatInput('');
    setUploadOpen(false);
    setPreviewMaterial(null);
  }, [selectedCourseId]);

  useEffect(() => {
    if (!onRegisterBack) return undefined;
    onRegisterBack(() => {
      if (previewMaterial) {
        setPreviewMaterial(null);
        return true;
      }
      return false;
    });
    return () => onRegisterBack(null);
  }, [onRegisterBack, previewMaterial]);

  const courseStatsMap = useMemo(() => {
    const map = new Map();
    for (const c of courses) {
      const cAnns = plannerItems.filter(it => it.type === 'announcement' && courseMatchesTag(it.course, c));
      const cAllTasks = plannerItems.filter(it => it.type !== 'announcement' && courseMatchesTag(it.course, c));
      const cTasks = cAllTasks.filter(it => !it.done);
      const cMats = materials.filter(m => m.courseId === c.id);
      const studiedCount = cMats.filter(m => m.studied).length;
      const cClasses = schedule.filter(
        s => s.courseId === c.id || (!s.courseId && courseMatchesTag(s.subject, c))
      );

      // Compute course live grade standing for dashboard badge & semester GWA rollup
      const gradeEntries = [
        ...(Array.isArray(c.gradeEntries) ? c.gradeEntries : []),
        ...cAllTasks
          .filter(t => t.scoreEarned !== undefined && t.scoreEarned !== '')
          .map(t => ({
            id: `task:${t.id}`,
            categoryId: t.gradeCategoryId || (c.weights?.[0]?.id ?? DEFAULT_COURSE_WEIGHTS[0].id),
            earned: t.scoreEarned,
            possible: t.scorePossible || 100,
          })),
      ];
      const gradeInfo = computeCourseGrade({
        weights: c.weights || DEFAULT_COURSE_WEIGHTS,
        entries: gradeEntries,
      });

      map.set(c.id, {
        announcements: cAnns,
        allAssignments: cAllTasks,
        pendingAssignments: cTasks,
        materials: cMats,
        studiedCount,
        classes: cClasses,
        gradeInfo,
      });
    }
    return map;
  }, [courses, plannerItems, materials, schedule]);

  // All derived hooks MUST live above any early `if (!selectedCourse)` return!
  const stats = useMemo(
    () =>
      (selectedCourse && courseStatsMap.get(selectedCourse.id)) || {
        announcements: [],
        allAssignments: [],
        pendingAssignments: [],
        materials: [],
        studiedCount: 0,
        classes: [],
        gradeInfo: { standing: null, phGwa: null, usGpa: null },
      },
    [selectedCourse, courseStatsMap]
  );

  const groupedModules = useMemo(() => {
    const map = new Map();
    for (const m of stats.materials) {
      const k = m.moduleName || 'Module 1';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return [...map.entries()];
  }, [stats.materials]);

  const courseLinks = useMemo(
    () => extractCourseLinks(stats.announcements),
    [stats.announcements]
  );

  const activeCourses = useMemo(() => courses.filter(c => !c.archived), [courses]);
  const archivedCourses = useMemo(() => courses.filter(c => Boolean(c.archived)), [courses]);

  const semesterGwa = useMemo(() => {
    const standings = activeCourses.map(c => ({
      units: c.units || 3,
      standing: courseStatsMap.get(c.id)?.gradeInfo?.standing ?? null,
    }));
    return computeSemesterGwa(standings);
  }, [activeCourses, courseStatsMap]);

  const totalDueTasks = useMemo(
    () =>
      activeCourses.reduce(
        (sum, c) => sum + (courseStatsMap.get(c.id)?.pendingAssignments?.length || 0),
        0
      ),
    [activeCourses, courseStatsMap]
  );

  // Auto-discover Canvas courses from synced .ics / .atom feeds + timetable
  const handleAutoDiscover = async () => {
    const added = await discoverCoursesFromPlanner();
    await refreshAll();
    if (added > 0) {
      toast(`Auto-created ${added} course card${added === 1 ? '' : 's'} from your Canvas & Timetable!`, {
        type: 'success',
      });
    } else {
      toast('All synced Canvas & Timetable courses are already on your dashboard (or sync Canvas first).');
    }
  };

  const openEditCourse = (course, { ensureMeetingSlot = false } = {}) => {
    setEditingCourse(course);
    setCCode(course.code || '');
    setCName(course.name || '');
    setCNickname(course.nickname || '');
    setCInstructor(course.instructor || '');
    setCUnits(String(course.units || 3));
    setCRssUrl(course.rssUrl || '');
    setCFolderId(course.folderId ? String(course.folderId) : '');
    setCColor(course.color || COURSE_PALETTE[0]);
    const existingRows = courseStatsMap.get(course.id)?.classes || [];
    const grouped = scheduleRowsToMeetings(existingRows);
    setCMeetings(
      grouped.length > 0
        ? grouped
        : ensureMeetingSlot
          ? [{ days: [1, 3, 5], startTime: '09:00', endTime: '10:30', room: '', kind: 'LEC' }]
          : []
    );
    setAddCourseOpen(true);
  };

  const openNewCourseModal = ({ withMeetingSlot = false } = {}) => {
    setEditingCourse(null);
    setCCode('');
    setCName('');
    setCNickname('');
    setCInstructor('');
    setCUnits('3');
    setCRssUrl('');
    setCFolderId('');
    setCColor(COURSE_PALETTE[courses.length % COURSE_PALETTE.length]);
    setCMeetings(
      withMeetingSlot
        ? [{ days: [1, 3, 5], startTime: '09:00', endTime: '10:30', room: '', kind: 'LEC' }]
        : []
    );
    setAddCourseOpen(true);
  };

  const resetCourseForm = () => {
    setEditingCourse(null);
    setCCode('');
    setCName('');
    setCNickname('');
    setCInstructor('');
    setCUnits('3');
    setCRssUrl('');
    setCFolderId('');
    setCColor(COURSE_PALETTE[courses.length % COURSE_PALETTE.length]);
    setCMeetings([]);
    setAddCourseOpen(false);
  };

  const addMeetingSlot = () => {
    setCMeetings(prev => [
      ...prev,
      {
        days: prev.length === 0 ? [1, 3, 5] : [2, 4],
        startTime: prev.length === 0 ? '09:00' : '13:30',
        endTime: prev.length === 0 ? '10:30' : '15:00',
        room: '',
        kind: prev.length === 0 ? 'LEC' : 'LAB',
      },
    ]);
  };

  const toggleMeetingDay = (idx, dayIdx) => {
    setCMeetings(prev =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        const has = m.days.includes(dayIdx);
        return {
          ...m,
          days: has ? m.days.filter(d => d !== dayIdx) : [...m.days, dayIdx],
        };
      })
    );
  };

  const updateMeetingField = (idx, field, val) => {
    setCMeetings(prev => prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m)));
  };

  const removeMeetingSlot = idx => {
    setCMeetings(prev => prev.filter((_, i) => i !== idx));
  };

  // Create or Update Course (+ sync Class Schedule meetings)
  const handleSaveCourse = async e => {
    e?.preventDefault?.();
    const name = cName.trim() || cCode.trim();
    if (!name) {
      toast('Enter a course name or code', { type: 'error' });
      return;
    }

    const parsedUnits = Math.max(0.5, Math.min(12, Number(cUnits) || 3));
    const cleanRss = cRssUrl.trim();
    if (cleanRss && /^https:\/\//i.test(cleanRss)) {
      const cur = getCanvasSettings();
      const existingUrls = cur.rssUrls ? cur.rssUrls.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
      if (!existingUrls.includes(cleanRss)) {
        saveCanvasSettings({ rssUrls: [...existingUrls, cleanRss].join('\n') });
      }
    }

    let savedCourseObj;
    let oldLinkedIds = [];
    const isEditing = Boolean(editingCourse);

    if (editingCourse) {
      oldLinkedIds = (courseStatsMap.get(editingCourse.id)?.classes || []).map(r => r.id).filter(Boolean);
      const updatedFields = {
        code: cCode.trim() || name.slice(0, 16),
        name,
        nickname: cNickname.trim(),
        instructor: cInstructor.trim(),
        units: parsedUnits,
        color: cColor,
        folderId: cFolderId ? Number(cFolderId) : editingCourse.folderId ?? null,
        rssUrl: cleanRss,
      };
      await db.courses.update(editingCourse.id, updatedFields);
      savedCourseObj = { ...editingCourse, ...updatedFields };
    } else {
      let linkedFolderId = cFolderId ? Number(cFolderId) : null;
      if (!linkedFolderId) {
        const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          linkedFolderId = existing.id;
        } else {
          linkedFolderId = await createFolder(cNickname.trim() || cCode.trim() || name.slice(0, 28), {
            mode: 'study',
            locked: false,
          });
        }
      }

      const newRecord = {
        code: cCode.trim() || name.slice(0, 16),
        name,
        nickname: cNickname.trim(),
        icsCourseTag: cCode.trim() || name,
        instructor: cInstructor.trim(),
        color: cColor,
        folderId: linkedFolderId,
        rssUrl: cleanRss,
        units: parsedUnits,
        archived: false,
        createdAt: Date.now(),
      };
      const id = await db.courses.add(newRecord);
      savedCourseObj = { id, ...newRecord };
    }

    // Sync Class Schedule meetings into `db.classSchedule`
    const existingByCourseId = schedule
      .filter(s => s.courseId === savedCourseObj.id)
      .map(s => s.id)
      .filter(Boolean);
    const idsToDelete = [...new Set([...oldLinkedIds, ...existingByCourseId])];
    if (idsToDelete.length > 0) {
      await Promise.all(idsToDelete.map(id => db.classSchedule.delete(id).catch(() => {})));
    }
    const newScheduleRows = meetingsToScheduleRows(savedCourseObj, cMeetings);
    if (newScheduleRows.length > 0) {
      await Promise.all(newScheduleRows.map(row => db.classSchedule.add(row)));
    }

    resetCourseForm();
    await refreshAll();
    onChanged?.();
    if (!isEditing) {
      setSelectedCourseId(savedCourseObj.id);
      setCourseTab('overview');
    }
    toast(
      isEditing
        ? `Updated "${savedCourseObj.nickname || savedCourseObj.name}"`
        : `Created course "${savedCourseObj.nickname || savedCourseObj.name}"`,
      { type: 'success' }
    );
  };

  const handleToggleArchive = async course => {
    const nextArchived = !course.archived;
    await db.courses.update(course.id, { archived: nextArchived });
    if (nextArchived && selectedCourseId === course.id) {
      setSelectedCourseId(null);
    }
    await refreshAll();
    toast(nextArchived ? `Archived "${course.nickname || course.name}"` : `Restored "${course.nickname || course.name}"`);
  };

  const handleDeleteCourse = async course => {
    const ok = await confirm({
      title: `Remove "${course.nickname || course.name}"?`,
      message: 'Removes this course card, its course schedules, and its uploaded module library. Your regular Subject Folder notes stay untouched.',
      confirmLabel: 'Remove course',
      destructive: true,
    });
    if (!ok) return;
    await Promise.all(
      schedule
        .filter(s => s.courseId === course.id)
        .map(s => db.classSchedule.delete(s.id).catch(() => {}))
    );
    const courseMats = await db.courseMaterials.where('courseId').equals(course.id).toArray().catch(() => []);
    await Promise.all(
      courseMats.map(m => db.attachments.delete(m.attachmentId || `mat-${m.id}`).catch(() => {}))
    );
    await db.materialChunks.where('courseId').equals(course.id).delete().catch(() => {});
    await db.courseMaterials.where('courseId').equals(course.id).delete().catch(() => {});
    await db.courses.delete(course.id);
    setSelectedCourseId(null);
    await refreshAll();
    toast('Course removed');
  };

  // Rich Paste handler for Canvas Module Page
  const handleRichPaste = e => {
    const html = e.clipboardData?.getData('text/html');
    const plain = e.clipboardData?.getData('text/plain');
    if (plain && getPublicGoogleExportUrl(plain.trim())) return;
    if (html && /<[a-z]/i.test(html)) {
      e.preventDefault();
      const cleaned = htmlToCleanMarkdown(html, plain);
      setPasteMd(prev => (prev ? `${prev}\n\n${cleaned}` : cleaned));
      if (!matTitle.trim()) {
        const firstH = /^#+\s+(.+)$/m.exec(cleaned) || /^(.{4,80})$/m.exec(cleaned);
        if (firstH) setMatTitle(firstH[1].replace(/[*_`]/g, '').trim().slice(0, 72));
      }
      toast('Converted Canvas HTML into clean Markdown!', { type: 'success' });
    }
  };

  // Multi-File Batch Upload OR Paste Page / Google Docs Link OR Batch Multi-Screenshot OCR
  const handleSaveMaterial = async e => {
    e?.preventDefault?.();
    if (!selectedCourse || uploadBusy) return;

    setUploadBusy(true);
    setUploadStatus('Extracting content…');
    try {
      let savedCount = 0;

      if (uploadKind === 'file') {
        if (matFiles.length === 0) throw new Error('Choose 1 or more .pdf, .pptx, .docx, .md, or .txt files first.');
        for (let i = 0; i < matFiles.length; i++) {
          const f = matFiles[i];
          setUploadStatus(
            matFiles.length > 1
              ? `Reading file ${i + 1}/${matFiles.length}: ${f.name}…`
              : `Reading ${f.name}…`
          );
          const res = await extractDocument(f, {
            onProgress: p => {
              setUploadStatus(
                p.phase === 'slides'
                  ? `Reading slide ${p.current}/${p.total}…`
                  : p.phase === 'docx'
                    ? 'Reading Word document…'
                    : `Reading page ${p.current}/${p.total}…`
              );
            },
          });
          await saveCourseMaterialWithChunks({
            courseId: selectedCourse.id,
            moduleName: modName.trim() || 'Module 1',
            title: (matFiles.length === 1 && matTitle.trim()) || res.title,
            kind: res.kind,
            fileName: f.name,
            extractedText: res.rawMarkdown,
            pageCount: res.pageCount,
            fileBlob: f,
            mime: f.type || '',
          });
          savedCount += 1;
        }
      } else if (uploadKind === 'paste') {
        const trimmed = pasteMd.trim();
        if (!trimmed) throw new Error('Paste a Canvas Module page or public Google Docs/Slides link first.');
        const googleInfo = getPublicGoogleExportUrl(trimmed);
        if (googleInfo) {
          setUploadStatus(`Importing ${googleInfo.kind}…`);
          const gRes = await importPublicGoogleLink(trimmed);
          await saveCourseMaterialWithChunks({
            courseId: selectedCourse.id,
            moduleName: modName.trim() || 'Module 1',
            title: matTitle.trim() || gRes.title,
            kind: gRes.kind,
            extractedText: gRes.extractedText,
            pageCount: gRes.pageCount,
            sourceUrl: trimmed,
          });
          savedCount = 1;
        } else {
          const extractedText = htmlToCleanMarkdown(pasteMd, pasteMd);
          const title =
            matTitle.trim() ||
            extractedText.split('\n')[0].replace(/^#+\s*/, '').slice(0, 64) ||
            'Canvas Module Page';
          await saveCourseMaterialWithChunks({
            courseId: selectedCourse.id,
            moduleName: modName.trim() || 'Module 1',
            title,
            kind: 'page',
            extractedText,
            pageCount: 1,
          });
          savedCount = 1;
        }
      } else if (uploadKind === 'ocr') {
        if (ocrFiles.length === 0) throw new Error('Select at least 1 slide/handout screenshot.');
        const parts = [];
        for (let i = 0; i < ocrFiles.length; i++) {
          setUploadStatus(`Running OCR on image ${i + 1}/${ocrFiles.length}…`);
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Could not read image'));
            r.readAsDataURL(ocrFiles[i]);
          });
          const compressed = await compressImage(dataUrl);
          const txt = await ocrImage(compressed);
          if (txt?.trim()) parts.push(`## Slide / Page ${i + 1}\n${txt.trim()}`);
        }
        if (parts.length === 0) throw new Error('Could not extract text from those screenshots.');
        await saveCourseMaterialWithChunks({
          courseId: selectedCourse.id,
          moduleName: modName.trim() || 'Module 1',
          title: matTitle.trim() || `Scanned Slides (${ocrFiles.length} images)`,
          kind: 'ocr',
          extractedText: parts.join('\n\n'),
          pageCount: ocrFiles.length,
        });
        savedCount = 1;
      }

      await logStudyActivity('notes', 1);
      setMatTitle('');
      setMatFiles([]);
      setPasteMd('');
      setOcrFiles([]);
      setUploadOpen(false);
      await refreshAll();
      toast(`Indexed ${savedCount} item${savedCount === 1 ? '' : 's'} — now searchable by Course AI!`, {
        type: 'success',
      });
    } catch (err) {
      toast(`Upload failed: ${err.message}`, { type: 'error', duration: 4200 });
    } finally {
      setUploadBusy(false);
      setUploadStatus('');
    }
  };

  // 1-Tap Import from Auto-Pinned Course Links (Google Docs / Slides)
  const handleImportPinnedLink = async link => {
    if (!selectedCourse || importingLinkUrl) return;
    setImportingLinkUrl(link.url);
    try {
      const gRes = await importPublicGoogleLink(link.url);
      await saveCourseMaterialWithChunks({
        courseId: selectedCourse.id,
        moduleName: 'Shared Links',
        title: link.label || gRes.title,
        kind: gRes.kind,
        extractedText: gRes.extractedText,
        pageCount: gRes.pageCount,
        sourceUrl: link.url,
      });
      await logStudyActivity('notes', 1);
      await refreshAll();
      toast(`Imported "${link.label || gRes.title}" into Modules!`, { type: 'success' });
      setCourseTab('modules');
    } catch (err) {
      toast(err.message, { type: 'error', duration: 4500 });
    } finally {
      setImportingLinkUrl('');
    }
  };

  const openAsNote = async ({ title, body, flashcards = [], quiz = [] }) => {
    const targetFolder =
      folders.find(f => f.id === selectedCourse?.folderId) ||
      folders.find(f => f.name === 'General') ||
      folders[0];
    const created = await createNote(
      targetFolder?.id ?? null,
      title,
      body,
      selectedCourse?.nickname || selectedCourse?.name || targetFolder?.name || 'General'
    );
    if (flashcards.length || quiz.length) {
      await db.notes.update(created.id, { flashcards, quiz });
    }
    const fresh = await db.notes.get(created.id);
    onChanged?.();
    onOpenNote?.(fresh, targetFolder || { id: '__all__', name: 'All Notes' });
  };

  const handleAskCourseAi = async e => {
    e?.preventDefault?.();
    const q = chatInput.trim();
    if (!q || aiBusy || !selectedCourse) return;

    const history = chatMsgs.map(m => ({ role: m.role, content: m.content }));
    setChatMsgs(prev => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '', sources: [] }]);
    setChatInput('');
    setAiBusy(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { answer, sources } = await askCourseAiStream({
        course: selectedCourse,
        question: q,
        history,
        selectedMaterialIds: selectedMatIds.length > 0 ? selectedMatIds : null,
        signal: ctrl.signal,
        onToken: partial => {
          setChatMsgs(prev => {
            const copy = prev.slice();
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: partial };
            return copy;
          });
        },
      });
      setChatMsgs(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: 'assistant', content: answer, sources };
        return copy;
      });
      logStudyActivity('reviews', 1).catch(() => {});
    } catch (err) {
      if (!err?.isCancelled) {
        setChatMsgs(prev => prev.slice(0, -1));
        toast(`Course AI failed: ${err.message}`, { type: 'error', duration: 4000 });
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleGeneratePack = async kind => {
    if (!selectedCourse || packBusy) return;
    setPackBusy(kind);
    try {
      const pack = await generateCourseStudyPack({
        course: selectedCourse,
        selectedMaterialIds: selectedMatIds.length > 0 ? selectedMatIds : null,
        kind,
      });
      await openAsNote(pack);
      toast(
        kind === 'flashcards'
          ? `Created "${pack.title}" with ${pack.flashcards.length} flashcards & ${pack.quiz.length} quiz items!`
          : `Created "${pack.title}"!`,
        { type: 'success' }
      );
    } catch (err) {
      toast(`Could not generate: ${err.message}`, { type: 'error', duration: 4000 });
    } finally {
      setPackBusy('');
    }
  };

  const handleBuildCourseExam = async () => {
    if (!selectedCourse || !onOpenExamPaper) return;
    const text = await buildCourseExamSourceText(selectedCourse, {
      selectedMaterialIds: selectedMatIds.length > 0 ? selectedMatIds : null,
    });
    if (!text.trim()) {
      toast('Upload at least one module/file first to build a Course Exam!', { type: 'error' });
      return;
    }
    onOpenExamPaper({
      sourceCourse: {
        id: selectedCourse.id,
        name: selectedCourse.nickname || selectedCourse.name,
        code: selectedCourse.code,
        notesText: text,
      },
    });
  };

  const toggleSelectMat = id => {
    setSelectedMatIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleMaterialStudied = async mat => {
    const next = !mat.studied;
    await db.courseMaterials.update(mat.id, { studied: next });
    if (next) logStudyActivity('reviews', 1).catch(() => {});
    await refreshAll();
  };

  // Shared Add / Edit Course Modal Sheet (with Units + Class Schedule Meetings)
  const renderCourseFormModal = () => {
    if (!addCourseOpen) return null;
    return (
      <div
        className="export-overlay"
        onClick={resetCourseForm}
        role="dialog"
        aria-modal="true"
        aria-label={editingCourse ? `Edit Course ${editingCourse.code}` : 'New Course'}
      >
        <div
          className="export-sheet"
          onClick={e => e.stopPropagation()}
        >
          <form onSubmit={handleSaveCourse}>
            <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
              <div className="settings-label" style={{ margin: 0 }}>
                {editingCourse ? `Edit Course: ${editingCourse.code}` : 'New Course Card'}
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close modal"
                onClick={resetCourseForm}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr 0.6fr', gap: 8 }}>
              <input
                className="input-field"
                placeholder="Code (e.g. IPT 101)"
                value={cCode}
                onChange={e => setCCode(e.target.value)}
                autoFocus
              />
              <input
                className="input-field"
                placeholder="Short Name (opt.)"
                value={cNickname}
                onChange={e => setCNickname(e.target.value)}
              />
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="12"
                className="input-field"
                placeholder="Units"
                title="Course Units"
                value={cUnits}
                onChange={e => setCUnits(e.target.value)}
                aria-label="Units"
              />
            </div>

            <input
              className="input-field mt-8"
              placeholder="Full Course Title (matches Canvas name)"
              value={cName}
              onChange={e => setCName(e.target.value)}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <input
                className="input-field"
                placeholder="Teacher / Instructor"
                value={cInstructor}
                onChange={e => setCInstructor(e.target.value)}
              />
              <select
                className="input-field"
                value={cFolderId}
                onChange={e => setCFolderId(e.target.value)}
                aria-label="Linked notes folder"
              >
                <option value="">Auto-create notes folder</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>
                    Link folder: {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Class Meetings (Days · Time · Room · LEC/LAB) */}
            <div className="course-meetings-box">
              <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
                <span className="settings-label" style={{ margin: 0 }}>
                  Class Schedule &amp; Rooms
                </span>
                <button
                  type="button"
                  className="row-action-chip active-chip"
                  onClick={addMeetingSlot}
                >
                  <Plus size={11} /> Add Meeting
                </button>
              </div>
              {cMeetings.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  No days/times assigned yet. Tap <strong>+ Add Meeting</strong> to add lecture or lab slots.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cMeetings.map((m, mIdx) => (
                    <div key={mIdx} className="meeting-slot-card">
                      <div className="flex items-center justify-between gap-6">
                        <div className="meeting-day-chips">
                          {SCHEDULE_DAYS.map(d => {
                            const active = m.days.includes(d.idx);
                            return (
                              <button
                                key={d.idx}
                                type="button"
                                className={`meeting-day-chip${active ? ' active' : ''}`}
                                onClick={() => toggleMeetingDay(mIdx, d.idx)}
                              >
                                {d.code}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="row-icon-btn"
                          aria-label="Remove meeting slot"
                          onClick={() => removeMeetingSlot(mIdx)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '76px 1fr 1fr',
                          gap: 6,
                          marginTop: 7,
                        }}
                      >
                        <select
                          className="input-field"
                          value={m.kind}
                          onChange={e => updateMeetingField(mIdx, 'kind', e.target.value)}
                          aria-label="Class type"
                        >
                          <option value="LEC">LEC</option>
                          <option value="LAB">LAB</option>
                        </select>
                        <input
                          type="time"
                          className="input-field"
                          value={m.startTime}
                          onChange={e => updateMeetingField(mIdx, 'startTime', e.target.value)}
                          aria-label="Start time"
                        />
                        <input
                          type="time"
                          className="input-field"
                          value={m.endTime}
                          onChange={e => updateMeetingField(mIdx, 'endTime', e.target.value)}
                          aria-label="End time"
                        />
                      </div>

                      <input
                        className="input-field mt-6"
                        placeholder="Room (e.g. 207-B, Lab 503C, G3)"
                        value={m.room}
                        onChange={e => updateMeetingField(mIdx, 'room', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <input
              className="input-field mt-8"
              placeholder="Optional Course Announcements RSS URL (.atom)"
              value={cRssUrl}
              onChange={e => setCRssUrl(e.target.value)}
            />

            <div className="flex items-center gap-8 mt-10" style={{ flexWrap: 'wrap' }}>
              {COURSE_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  className={`accent-swatch${cColor === hex ? ' active' : ''}`}
                  style={{ background: hex, width: 24, height: 24 }}
                  aria-label={`Banner color ${hex}`}
                  onClick={() => setCColor(hex)}
                />
              ))}
            </div>

            <div className="flex gap-8 mt-12">
              <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                {editingCourse ? 'Save Changes' : <><Plus size={14} /> Create Course</>}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetCourseForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // =========================================================================
  // VIEW 1: CLEAN COURSE DASHBOARD + VISUAL TIMETABLE SECTION
  // =========================================================================
  if (!selectedCourse) {
    const visibleCourses = showArchived ? archivedCourses : activeCourses;
    return (
      <div className="screen list-pad-bottom">
        <header className="navbar">
          <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
            <ChevronLeft size={20} /> Folders
          </button>
          <span className="navbar-title">Courses</span>
          <button
            type="button"
            className="navbar-btn"
            aria-label="New course"
            onClick={() => openNewCourseModal({ withMeetingSlot: dashSection === 'schedule' })}
          >
            <Plus size={20} />
          </button>
        </header>

        <div
          className="large-title"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}
        >
          <span>Course Dashboard</span>
          {archivedCourses.length > 0 && dashSection === 'courses' && (
            <button
              type="button"
              className={`row-action-chip${showArchived ? ' active-chip' : ''}`}
              onClick={() => setShowArchived(v => !v)}
            >
              <Archive size={12} /> {showArchived ? 'Active' : `Archived (${archivedCourses.length})`}
            </button>
          )}
        </div>

        {/* Section Switcher: Courses vs Weekly Schedule */}
        <div className="view-switcher" role="tablist" aria-label="Course dashboard sections">
          <button
            type="button"
            role="tab"
            aria-selected={dashSection === 'courses'}
            className={`view-switch-btn${dashSection === 'courses' ? ' active' : ''}`}
            onClick={() => setDashSection('courses')}
          >
            Courses ({activeCourses.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashSection === 'schedule'}
            className={`view-switch-btn${dashSection === 'schedule' ? ' active' : ''}`}
            onClick={() => setDashSection('schedule')}
          >
            Schedule ({schedule.length})
          </button>
        </div>

        {dashSection === 'schedule' ? (
          <div style={{ padding: '10px var(--gutter) 20px' }}>
            <CourseScheduleView
              courses={activeCourses}
              scheduleRows={schedule}
              onOpenCourse={c => {
                setSelectedCourseId(c.id);
                setCourseTab('overview');
              }}
              onEditCourse={c => openEditCourse(c, { ensureMeetingSlot: true })}
              onAddCourseSchedule={() => {
                if (activeCourses.length > 0) {
                  const firstMissing = activeCourses.find(
                    c => (courseStatsMap.get(c.id)?.classes || []).length === 0
                  );
                  openEditCourse(firstMissing || activeCourses[0], { ensureMeetingSlot: true });
                } else {
                  openNewCourseModal({ withMeetingSlot: true });
                }
              }}
            />
          </div>
        ) : (
          <>
            {/* Compact 3-Tile Summary Strip */}
            {!showArchived && (
              <div className="course-summary-strip">
                <div className="course-summary-tile">
                  <div className="pattern-mini-label">Subjects</div>
                  <div className="course-summary-val">{activeCourses.length}</div>
                  <div className="course-summary-sub">Active load</div>
                </div>
                <div className="course-summary-tile">
                  <div className="pattern-mini-label">Tasks Due</div>
                  <div className="course-summary-val">{totalDueTasks}</div>
                  <div className="course-summary-sub">Pending items</div>
                </div>
                <button
                  type="button"
                  className="course-summary-tile is-tappable"
                  onClick={() => setGwaMode(m => (m === 'gwa' ? 'gpa' : 'gwa'))}
                  title="Tap to toggle PH GWA / US GPA"
                >
                  <div className="pattern-mini-label">
                    {gwaMode === 'gwa' ? 'PH GWA' : 'US GPA'}
                  </div>
                  <div className="course-summary-val">
                    {semesterGwa
                      ? gwaMode === 'gwa'
                        ? semesterGwa.phGwa.toFixed(2)
                        : semesterGwa.usGpa.toFixed(2)
                      : '—'}
                  </div>
                  <div className="course-summary-sub">
                    {semesterGwa ? `${semesterGwa.avgPercent}% avg · tap` : 'No grades yet'}
                  </div>
                </button>
              </div>
            )}

            {/* Utility Chip Strip */}
            <div className="course-utility-chips">
              <button type="button" className="row-action-chip" onClick={handleAutoDiscover}>
                <Wand2 size={12} /> Auto-Discover Canvas
              </button>
              <button
                type="button"
                className="row-action-chip"
                onClick={() => setDashSection('schedule')}
              >
                <Clock size={12} /> View Timetable &amp; Rooms
              </button>
            </div>

            {visibleCourses.length === 0 ? (
              <div className="list-group settings-group" style={{ textAlign: 'center', padding: '26px 16px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                  {showArchived ? 'No Archived Courses' : 'No Course Cards Yet'}
                </div>
                <p className="settings-help" style={{ maxWidth: 360, margin: '0 auto 14px' }}>
                  {showArchived
                    ? 'Finished semester courses you archive will live cleanly here.'
                    : 'Tap + at the top right to add a subject with its schedule, room, and teacher, or tap Auto-Discover Canvas.'}
                </p>
                {!showArchived && (
                  <div className="flex justify-center gap-8" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => openNewCourseModal({ withMeetingSlot: true })}
                    >
                      <Plus size={14} /> Add Your First Course
                    </button>
                    {onOpenPlanner && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenPlanner}>
                        Open Canvas Sync
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="courses-grid">
                {visibleCourses.map((c, idx) => {
                  const st = courseStatsMap.get(c.id) || {
                    announcements: [],
                    pendingAssignments: [],
                    materials: [],
                    studiedCount: 0,
                    classes: [],
                    gradeInfo: { standing: null },
                  };
                  const displayName = c.nickname || c.name;
                  const groupedMeetings = scheduleRowsToMeetings(st.classes);
                  const firstMeeting = groupedMeetings[0];
                  const schedLine = firstMeeting
                    ? `${groupDaysLabel(firstMeeting.days)} ${formatTimeRange12h(
                        firstMeeting.startTime,
                        firstMeeting.endTime
                      )}`
                    : '';
                  const roomLine = firstMeeting?.room || '';
                  const studiedPctCard =
                    st.materials.length > 0
                      ? Math.round((st.studiedCount / st.materials.length) * 100)
                      : 0;

                  return (
                    <div
                      key={c.id}
                      className="course-card"
                      style={{ '--stagger-idx': idx }}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedCourseId(c.id);
                        setCourseTab('overview');
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedCourseId(c.id);
                          setCourseTab('overview');
                        }
                      }}
                    >
                      <div className="course-card-banner" style={{ background: c.color || '#0a84ff' }}>
                        <span className="course-code-pill">{c.code || 'COURSE'}</span>
                        <div className="flex items-center gap-4">
                          {st.gradeInfo?.standing !== null && (
                            <span className="course-code-pill">{st.gradeInfo.standing}%</span>
                          )}
                          {st.pendingAssignments.length > 0 && (
                            <span className="course-due-pill">{st.pendingAssignments.length} due</span>
                          )}
                          <button
                            type="button"
                            className="course-banner-edit-btn"
                            aria-label={`Edit ${displayName}`}
                            title="Edit course, teacher & schedule"
                            onClick={e => {
                              e.stopPropagation();
                              openEditCourse(c);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      </div>

                      <div className="course-card-body">
                        <div className="course-card-title">{displayName}</div>
                        <div className="course-card-inst">
                          <User size={11} style={{ flexShrink: 0 }} />
                          <span>{c.instructor || 'Add instructor'}</span>
                        </div>
                        <div className="course-card-sched">
                          <Clock size={11} style={{ flexShrink: 0 }} />
                          <span>{schedLine || 'Tap ✎ to set days & room'}</span>
                        </div>
                        {roomLine && (
                          <div className="course-card-inst" style={{ marginTop: 3 }}>
                            <MapPin size={11} style={{ flexShrink: 0 }} />
                            <span>{roomLine}</span>
                          </div>
                        )}

                        {st.materials.length > 0 ? (
                          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                            <div className="flex items-center justify-between" style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                              <span>{st.studiedCount}/{st.materials.length} studied</span>
                              <span>{studiedPctCard}%</span>
                            </div>
                            <div className="progress-bar-track" style={{ height: 5, margin: 0 }}>
                              <div className="progress-bar-fill" style={{ width: `${Math.max(4, studiedPctCard)}%` }} />
                            </div>
                          </div>
                        ) : (
                          <div className="course-card-stats" style={{ marginTop: 'auto', paddingTop: 8 }}>
                            <span>{c.units || 3} units</span>
                            <span>·</span>
                            <span>{st.pendingAssignments.length} tasks</span>
                          </div>
                        )}
                      </div>

                      <div className="course-card-footer">
                        <button
                          type="button"
                          className="course-foot-btn"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCourseId(c.id);
                            setCourseTab('modules');
                          }}
                        >
                          <Layers size={13} />
                          <span>Modules</span>
                        </button>
                        <button
                          type="button"
                          className="course-foot-btn"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCourseId(c.id);
                            setCourseTab('assignments');
                          }}
                        >
                          <CheckSquare size={13} />
                          <span>Tasks</span>
                        </button>
                        <button
                          type="button"
                          className="course-foot-btn"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCourseId(c.id);
                            setCourseTab('ai');
                          }}
                        >
                          <Sparkles size={13} />
                          <span>AI</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {renderCourseFormModal()}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: INSIDE A SINGLE CANVAS-STYLE COURSE WORKSPACE
  // =========================================================================
  const displayTitle = selectedCourse.nickname || selectedCourse.name;
  const studiedPct =
    stats.materials.length > 0 ? Math.round((stats.studiedCount / stats.materials.length) * 100) : 0;
  const selectedCourseMeetings = scheduleRowsToMeetings(stats.classes);

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={() => {
            setAddCourseOpen(false);
            setSelectedCourseId(null);
          }}
        >
          <ChevronLeft size={20} /> Courses
        </button>
        <span className="navbar-title">{selectedCourse.code || displayTitle}</span>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="navbar-btn"
            aria-label="Edit course"
            title="Edit schedule, teacher, color or RSS"
            onClick={() => openEditCourse(selectedCourse)}
          >
            <Pencil size={17} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            aria-label="Upload file or module"
            title="Add module / file"
            onClick={() => {
              setCourseTab('modules');
              setUploadOpen(true);
            }}
          >
            <Plus size={20} />
          </button>
        </div>
      </header>

      {/* Colored Canvas-Style Course Header Strip */}
      <div className="course-hero-banner" style={{ background: selectedCourse.color || '#0a84ff' }}>
        <div className="flex items-center justify-between gap-8">
          <div className="course-code-pill">
            {selectedCourse.code} · {selectedCourse.units || 3}u
          </div>
          {stats.gradeInfo?.standing !== null && (
            <div className="course-code-pill">
              {stats.gradeInfo.standing}% · GWA {stats.gradeInfo.phGwa.toFixed(2)}
            </div>
          )}
        </div>
        <div className="course-hero-title">{displayTitle}</div>
        {selectedCourse.nickname && selectedCourse.nickname !== selectedCourse.name && (
          <div className="course-hero-inst" style={{ opacity: 0.8 }}>{selectedCourse.name}</div>
        )}
        {selectedCourse.instructor && <div className="course-hero-inst">{selectedCourse.instructor}</div>}
        {selectedCourseMeetings.length > 0 && (
          <div className="course-hero-sched">
            {selectedCourseMeetings.map((m, idx) => (
              <span key={idx} className="course-hero-sched-pill">
                <Clock size={11} /> {groupDaysLabel(m.days)}{' '}
                {formatTimeRange12h(m.startTime, m.endTime)}
                {m.room ? ` · ${m.room}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {renderCourseFormModal()}

      {/* 6 Canvas-Style Workspace Tabs */}
      <div className="hub-tabs" role="tablist" style={{ marginTop: 10 }}>
        {[
          ['overview', 'Home', BookOpen],
          ['modules', `Modules (${stats.materials.length})`, Layers],
          ['announcements', `Posts (${stats.announcements.length})`, Megaphone],
          ['assignments', `Tasks (${stats.pendingAssignments.length})`, CheckSquare],
          ['grades', 'Grades', Award],
          ['ai', 'Course AI', Sparkles],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={courseTab === id}
            className={`hub-tab-btn${courseTab === id ? ' active' : ''}`}
            onClick={() => setCourseTab(id)}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ---- TAB 1: HOME OVERVIEW ---- */}
      {courseTab === 'overview' && (
        <div style={{ paddingBottom: 20 }}>
          <div className="quick-action-row" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => {
                setCourseTab('modules');
                setUploadOpen(true);
              }}
            >
              <FileUp size={15} />
              <span>Upload Module / Files</span>
            </button>
            <button type="button" className="quick-action-btn" onClick={() => setCourseTab('ai')}>
              <Sparkles size={15} />
              <span>Ask Course AI</span>
            </button>
          </div>

          {/* Module Mastery Progress Card */}
          {stats.materials.length > 0 && (
            <div className="list-group settings-group">
              <div className="flex items-center justify-between gap-8">
                <span className="settings-label" style={{ margin: 0 }}>
                  Module Study Progress
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ok)' }}>
                  {stats.studiedCount} / {stats.materials.length} studied ({studiedPct}%)
                </span>
              </div>
              <div className="progress-bar-track" style={{ margin: '8px 0 0' }}>
                <div className="progress-bar-fill" style={{ width: `${Math.max(4, studiedPct)}%` }} />
              </div>
            </div>
          )}

          {/* Auto-Pinned Course Links (Google Chat, Drive, Docs, Slides, Meet/Zoom from Announcements!) */}
          {courseLinks.length > 0 && (
            <div className="list-group settings-group">
              <div className="settings-label flex items-center gap-6">
                <Link2 size={14} /> Pinned Course Links ({courseLinks.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {courseLinks.map((lk, idx) => (
                  <div
                    key={`${lk.url}-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: 'var(--fill)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lk.label}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {lk.kind}
                        {lk.dateKey ? ` · ${lk.dateKey}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-6" style={{ flexShrink: 0 }}>
                      {lk.importable && (
                        <button
                          type="button"
                          className="row-action-chip active-chip"
                          disabled={importingLinkUrl === lk.url}
                          onClick={() => handleImportPinnedLink(lk)}
                        >
                          <Download size={12} /> {importingLinkUrl === lk.url ? 'Importing…' : 'Import'}
                        </button>
                      )}
                      <a
                        href={lk.url}
                        target="_blank"
                        rel="noreferrer"
                        className="row-action-chip"
                        style={{ textDecoration: 'none' }}
                      >
                        <ExternalLink size={12} /> Open
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Customizable PH College Attendance / Absence Guard */}
          <CourseAttendanceCard course={selectedCourse} onUpdated={refreshAll} />

          {/* Course Actions */}
          <div className="list-group settings-group">
            <div className="settings-label">Course Quick Actions</div>
            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleBuildCourseExam}>
                <GraduationCap size={14} /> Build Exam from Modules
              </button>
              {selectedCourse.folderId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const f = folders.find(x => x.id === selectedCourse.folderId);
                    if (f) onOpenFolder?.(f);
                  }}
                >
                  <FolderOpen size={14} /> Open Notes Folder
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleToggleArchive(selectedCourse)}
              >
                <Archive size={14} /> {selectedCourse.archived ? 'Restore Course' : 'Archive Semester'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: '#ff453a' }}
                onClick={() => handleDeleteCourse(selectedCourse)}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>

          {/* Upcoming Deadline Preview */}
          <div className="section-heading">Next Due in {selectedCourse.code}</div>
          <div className="list-group">
            {stats.pendingAssignments.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">No pending Canvas tasks matched to this course yet.</span>
              </div>
            ) : (
              stats.pendingAssignments.slice(0, 3).map(it => (
                <div key={it.id} className="list-item list-item-static">
                  <div className="list-item-body">
                    <div className="list-item-title">{it.title}</div>
                    <div className="list-item-subtitle">
                      Due {it.dateKey}
                      {it.timeLabel ? ` · ${it.timeLabel}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="row-action-chip"
                    onClick={() => openAsNote({ title: it.title, body: buildCanvasNoteContent(it) })}
                  >
                    <FilePlus2 size={12} /> Start Note
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---- TAB 2: MODULES & FILES (Multi-File Batch + Google Link + Studied Checkmarks) ---- */}
      {courseTab === 'modules' && (
        <div style={{ paddingBottom: 20 }}>
          <div style={{ padding: '4px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="settings-help" style={{ margin: 0 }}>
              {selectedMatIds.length > 0
                ? `${selectedMatIds.length} file${selectedMatIds.length === 1 ? '' : 's'} selected for AI / Exam`
                : `${stats.studiedCount}/${stats.materials.length} studied · Multi-file PDF/PPTX/DOCX supported`}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ flexShrink: 0 }}
              onClick={() => setUploadOpen(v => !v)}
            >
              <Plus size={14} /> Add Material
            </button>
          </div>

          {selectedMatIds.length > 0 && (
            <div className="flex gap-8" style={{ padding: '0 16px 10px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCourseTab('ai')}>
                <Sparkles size={13} /> Study {selectedMatIds.length} Selected with AI
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleBuildCourseExam}>
                <GraduationCap size={13} /> Build Exam on Selected
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedMatIds([])}>
                Clear Selection
              </button>
            </div>
          )}

          {uploadOpen && (
            <form className="list-group settings-group" onSubmit={handleSaveMaterial} style={{ marginBottom: 12 }}>
              <div className="settings-label">Add Module Materials to {selectedCourse.code}</div>

              <div className="view-switcher" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className={`view-switch-btn${uploadKind === 'file' ? ' active' : ''}`}
                  onClick={() => setUploadKind('file')}
                >
                  <FileUp size={13} style={{ marginRight: 4 }} /> Files
                </button>
                <button
                  type="button"
                  className={`view-switch-btn${uploadKind === 'paste' ? ' active' : ''}`}
                  onClick={() => setUploadKind('paste')}
                >
                  <ClipboardPaste size={13} style={{ marginRight: 4 }} /> Page / Link
                </button>
                <button
                  type="button"
                  className={`view-switch-btn${uploadKind === 'ocr' ? ' active' : ''}`}
                  onClick={() => setUploadKind('ocr')}
                >
                  <Images size={13} style={{ marginRight: 4 }} /> Multi-OCR
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 8, marginBottom: 8 }}>
                <input
                  className="input-field"
                  placeholder="Module (e.g. Module 1: Prelim)"
                  value={modName}
                  onChange={e => setModName(e.target.value)}
                />
                <input
                  className="input-field"
                  placeholder="Title (auto-filled from file)"
                  value={matTitle}
                  onChange={e => setMatTitle(e.target.value)}
                />
              </div>

              {uploadKind === 'file' && (
                <>
                  <button
                    type="button"
                    className={`import-dropzone${matFiles.length > 0 ? ' has-file' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="import-dropzone-icon">
                      {matFiles.length > 0 ? <FileText size={20} /> : <FileUp size={20} />}
                    </span>
                    <div className="import-dropzone-title">
                      {matFiles.length === 1
                        ? matFiles[0].name
                        : matFiles.length > 1
                          ? `${matFiles.length} files selected`
                          : 'Pick 1 or multiple .pdf, .pptx, .docx, .md, .txt'}
                    </div>
                    <div className="import-dropzone-sub">
                      Extracted &amp; chunk-indexed 100% offline for Course AI
                    </div>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.pptx,.docx,.md,.markdown,.txt"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const list = Array.from(e.target.files || []).slice(0, 12);
                      if (list.length) setMatFiles(list);
                    }}
                  />
                </>
              )}

              {uploadKind === 'paste' && (
                <textarea
                  className="input-field"
                  rows={4}
                  placeholder="Paste a copied Canvas Module page OR paste a public Google Docs / Google Slides link (docs.google.com/...)!"
                  value={pasteMd}
                  onPaste={handleRichPaste}
                  onChange={e => setPasteMd(e.target.value)}
                />
              )}

              {uploadKind === 'ocr' && (
                <>
                  <button
                    type="button"
                    className={`import-dropzone${ocrFiles.length ? ' has-file' : ''}`}
                    onClick={() => ocrInputRef.current?.click()}
                  >
                    <span className="import-dropzone-icon">
                      <Images size={20} />
                    </span>
                    <div className="import-dropzone-title">
                      {ocrFiles.length ? `${ocrFiles.length} screenshots ready` : 'Select up to 10 slide screenshots'}
                    </div>
                    <div className="import-dropzone-sub">Extracts text via Vision AI and indexes into this module</div>
                  </button>
                  <input
                    ref={ocrInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => setOcrFiles(Array.from(e.target.files || []).slice(0, 10))}
                  />
                </>
              )}

              {uploadBusy && (
                <div className="scan-indicator" style={{ padding: '8px 0 0' }}>
                  <span className="spinner" /> {uploadStatus || 'Saving…'}
                </div>
              )}

              <div className="flex gap-8 mt-10">
                <button type="submit" className="btn btn-primary btn-sm" disabled={uploadBusy}>
                  <FileUp size={14} /> {uploadBusy ? 'Indexing…' : 'Save & Index for AI'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploadOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {groupedModules.length === 0 ? (
            <div className="list-group settings-group" style={{ textAlign: 'center', padding: '22px 16px' }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>No Modules or Files Uploaded Yet</div>
              <p className="settings-help" style={{ margin: '0 auto 12px', maxWidth: 340 }}>
                Upload multiple PDFs, PowerPoint slides, Word docs, or public Google Docs/Slides links — or tap Share /
                Open With → Notes by Bai straight from your phone!
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
                <Plus size={14} /> Upload First Module File
              </button>
            </div>
          ) : (
            groupedModules.map(([mName, list]) => {
              const isCollapsed = Boolean(collapsedMods[mName]);
              const modStudied = list.filter(x => x.studied).length;
              return (
                <div key={mName} className="list-group" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="list-item module-group-header"
                    onClick={() => setCollapsedMods(prev => ({ ...prev, [mName]: !prev[mName] }))}
                  >
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    <span style={{ fontWeight: 700, flex: 1, textAlign: 'left', marginLeft: 6 }}>{mName}</span>
                    <span className="settings-help" style={{ margin: 0 }}>
                      {modStudied}/{list.length} studied
                    </span>
                  </button>
                  {!isCollapsed &&
                    list.map(mat => {
                      const checked = selectedMatIds.includes(mat.id);
                      return (
                        <div key={mat.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ marginTop: 1 }}
                            aria-label={`Select ${mat.title} for AI study`}
                            onClick={() => toggleSelectMat(mat.id)}
                          >
                            {checked ? <CheckSquare size={18} color="var(--accent-ink)" /> : <Square size={18} />}
                          </button>
                          <div className="list-item-body">
                            <div
                              className="list-item-title"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setPreviewMaterial(mat)}
                            >
                              <span>{mat.title}</span>
                              <span className="mode-badge mode-code" style={{ textTransform: 'uppercase' }}>
                                {mat.kind}
                              </span>
                            </div>
                            <div className="list-item-subtitle">
                              {mat.pageCount ? `${mat.pageCount} pg/slides · ` : ''}
                              {Math.max(1, Math.round((mat.extractedText || '').length / 1000))}k chars · AI-ready
                            </div>
                            <div className="flex items-center gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className={`row-action-chip${mat.studied ? ' active-chip' : ''}`}
                                onClick={() => toggleMaterialStudied(mat)}
                              >
                                <CheckCircle2 size={12} /> {mat.studied ? 'Studied' : 'Mark Studied'}
                              </button>
                              <button
                                type="button"
                                className="row-action-chip"
                                onClick={() => setPreviewMaterial(mat)}
                              >
                                <Eye size={12} /> View
                              </button>
                              <button
                                type="button"
                                className="row-action-chip"
                                aria-label="Delete material"
                                onClick={async () => {
                                  await deleteCourseMaterial(mat.id);
                                  setSelectedMatIds(prev => prev.filter(x => x !== mat.id));
                                  await refreshAll();
                                  toast('Removed module material');
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}

          {previewMaterial && (
            <Suspense fallback={null}>
              <DocumentViewerModal
                doc={{
                  title: previewMaterial.title,
                  fileName: previewMaterial.fileName || `${previewMaterial.title}.${previewMaterial.kind || 'md'}`,
                  kind: previewMaterial.kind || undefined,
                  mime: previewMaterial.mime || '',
                  attachmentId: previewMaterial.attachmentId || null,
                  extractedText: previewMaterial.extractedText || '',
                  pageCount: previewMaterial.pageCount || 0,
                  size: previewMaterial.fileSize || 0,
                }}
                onClose={() => setPreviewMaterial(null)}
                onSaveAsNote={() => {
                  const m = previewMaterial;
                  setPreviewMaterial(null);
                  openAsNote({ title: m.title, body: m.extractedText });
                }}
              />
            </Suspense>
          )}
        </div>
      )}

      {/* ---- TAB 3: ANNOUNCEMENTS ---- */}
      {courseTab === 'announcements' && (
        <div style={{ paddingBottom: 20 }}>
          <div className="list-group">
            {stats.announcements.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No Canvas announcements matched to this course yet. Paste this course&apos;s <code>.atom</code> RSS
                  URL in School Planner → To-Dos &amp; Canvas!
                </span>
              </div>
            ) : (
              stats.announcements.map(ann => (
                <div key={ann.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                  <span className="list-item-icon">
                    <Megaphone size={16} />
                  </span>
                  <div className="list-item-body">
                    <div className="list-item-title">{ann.title}</div>
                    <div className="list-item-subtitle">
                      {ann.author ? `${ann.author} · ` : ''}
                      {ann.dateKey}
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
                        onClick={() => {
                          markAnnouncementRead(ann);
                          openAsNote({ title: ann.title, body: buildCanvasNoteContent(ann) });
                        }}
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
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---- TAB 4: ASSIGNMENTS (Workflow Status + Inline Score!) ---- */}
      {courseTab === 'assignments' && (
        <div style={{ paddingBottom: 20 }}>
          <div className="list-group">
            {stats.allAssignments.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No assignments synced for {selectedCourse.code} yet. Sync your Canvas Calendar (`.ics`) in School
                  Planner!
                </span>
              </div>
            ) : (
              stats.allAssignments.map(it => {
                const wfStatus = it.workflowStatus || (it.done ? 'submitted' : 'not_started');
                return (
                  <div key={it.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ marginTop: 1 }}
                      onClick={async () => {
                        const nextDone = !it.done;
                        await db.plannerItems.update(it.id, {
                          done: nextDone,
                          workflowStatus: nextDone ? 'submitted' : 'in_progress',
                          updatedAt: Date.now(),
                        });
                        syncDeadlineNotifications().catch(() => {});
                        await refreshAll();
                        onChanged?.();
                      }}
                    >
                      {it.done ? <CheckSquare size={18} color="var(--accent-ink)" /> : <Square size={18} />}
                    </button>
                    <div className="list-item-body">
                      <div
                        className="list-item-title"
                        style={{ textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? 0.65 : 1 }}
                      >
                        <span>{it.title}</span>
                        {it.type === 'exam' && <span className="mode-badge mode-vault">Exam</span>}
                      </div>
                      <div className="list-item-subtitle">
                        Due {it.dateKey}
                        {it.timeLabel ? ` · ${it.timeLabel}` : ''}
                        {it.scoreEarned !== undefined && it.scoreEarned !== ''
                          ? ` · Score: ${it.scoreEarned}/${it.scorePossible || 100}`
                          : ''}
                      </div>

                      {/* Workflow Status Selector + Quick Score Input */}
                      <div className="flex items-center gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                        <select
                          className="input-field"
                          style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                          aria-label={`Status for ${it.title}`}
                          value={wfStatus}
                          onChange={async e => {
                            const nextWf = e.target.value;
                            const nextDone = nextWf === 'submitted' || nextWf === 'graded';
                            await db.plannerItems.update(it.id, {
                              workflowStatus: nextWf,
                              done: nextDone,
                              updatedAt: Date.now(),
                            });
                            syncDeadlineNotifications().catch(() => {});
                            await refreshAll();
                            onChanged?.();
                          }}
                        >
                          {WORKFLOW_STATUSES.map(ws => (
                            <option key={ws.id} value={ws.id}>
                              {ws.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="row-action-chip"
                          onClick={() => openAsNote({ title: it.title, body: buildCanvasNoteContent(it) })}
                        >
                          <FilePlus2 size={12} /> Start Note
                        </button>
                        {it.url && (
                          <a
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            className="row-action-chip"
                            style={{ textDecoration: 'none' }}
                          >
                            <ExternalLink size={12} /> Canvas
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ---- TAB 5: GRADES + CANVAS WHAT-IF SIMULATOR + RUBRIC CHECKER ---- */}
      {courseTab === 'grades' && (
        <CourseGradesTab
          course={selectedCourse}
          assignments={stats.allAssignments}
          onUpdated={refreshAll}
        />
      )}

      {/* ---- TAB 6: COURSE AI TUTOR ---- */}
      {courseTab === 'ai' && (
        <div style={{ padding: '0 var(--gutter) 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="list-group settings-group" style={{ margin: 0 }}>
            <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
              <span className="settings-label flex items-center gap-6" style={{ margin: 0 }}>
                <Sparkles size={14} /> {selectedCourse.code} Course AI Tutor
              </span>
              <span className="mode-badge mode-study">
                {selectedMatIds.length > 0
                  ? `${selectedMatIds.length} selected`
                  : `${stats.materials.length} files + notes`}
              </span>
            </div>
            <p className="settings-help" style={{ marginTop: 0 }}>
              Answers, study guides, flashcards, and practice exams are grounded directly in your uploaded{' '}
              <strong>{displayTitle}</strong> modules &amp; files with exact slide/page citations!
            </p>

            <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(packBusy) || stats.materials.length === 0}
                onClick={() => handleGeneratePack('summary')}
              >
                <BookOpen size={13} /> {packBusy === 'summary' ? 'Summarizing…' : 'Study Guide'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(packBusy) || stats.materials.length === 0}
                onClick={() => handleGeneratePack('flashcards')}
              >
                <Sparkles size={13} /> {packBusy === 'flashcards' ? 'Building Deck…' : 'Flashcards & Quiz'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={stats.materials.length === 0}
                onClick={handleBuildCourseExam}
              >
                <GraduationCap size={13} /> Practice Exam
              </button>
            </div>
          </div>

          <div className="feynman-chat-box">
            {chatMsgs.length === 0 ? (
              <div className="list-group settings-group" style={{ margin: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Try asking:
                  <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                    <li>&ldquo;Explain the key concepts from Module 1 in simple terms&rdquo;</li>
                    <li>&ldquo;Quiz me with 3 tough exam questions based on our slides&rdquo;</li>
                    <li>&ldquo;Compare the main formulas/terms uploaded in this course&rdquo;</li>
                  </ul>
                </div>
              </div>
            ) : (
              chatMsgs.map((m, idx) => (
                <div key={idx} className={`feynman-msg ${m.role === 'user' ? 'is-user' : 'is-ai'}`}>
                  <div className="feynman-msg-head">
                    {m.role === 'user' ? 'You' : `${selectedCourse.code} AI Tutor`}
                  </div>
                  <div className="feynman-msg-body">
                    {m.content ? (
                      <MarkdownContent text={m.content} />
                    ) : (
                      <span className="scan-indicator" style={{ padding: 0 }}>
                        <span className="spinner" style={{ width: 13, height: 13 }} /> Searching course modules…
                      </span>
                    )}
                  </div>
                  {Array.isArray(m.sources) && m.sources.length > 0 && (
                    <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                      {m.sources.slice(0, 4).map((s, si) => (
                        <span key={si} className="row-action-chip" style={{ fontSize: 11 }}>
                          📄 {s.citation.slice(0, 42)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAskCourseAi} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              className="ai-input"
              style={{ marginTop: 0, flex: 1, minHeight: 50 }}
              placeholder={`Ask about ${selectedCourse.code} modules & uploaded files…`}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAskCourseAi();
                }
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={aiBusy || !chatInput.trim()}
              aria-label="Ask Course AI"
              style={{ height: 50, padding: '0 14px' }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
