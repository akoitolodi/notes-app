/**
 * CoursesDashboardScreen — Canvas-Style Course Dashboard & Offline Course Workspace.
 *
 * - Visual colored Course Cards Grid mirroring Canvas LMS (with 1-Tap Auto-Discover from synced Canvas feeds)
 * - Inside each Course: Overview | Announcements | Modules & Files | Assignments | Course AI Tutor
 * - Upload .pdf / .pptx / .docx, Paste Canvas Module Pages (HTML -> Markdown), or Batch Multi-Screenshot OCR
 * - Course AI Tutor uses offline BM25 chunk retrieval grounded strictly in THIS course's uploaded files & modules
 *   (with Exam-Week selective module filtering, Flashcard/Quiz pack generator & Bond-Paper Exam builder!)
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { syncDeadlineNotifications, markAnnouncementRead } from '../lib/notifications';
import { compressImage } from './ImageManager';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

function courseMatchesTag(itemCourseStr, course) {
  const target = String(itemCourseStr || '').trim().toLowerCase();
  if (!target || !course) return false;
  const keys = [course.icsCourseTag, course.name, course.code]
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
}) {
  const { confirm, toast } = useDialog();

  const [courses, setCourses] = useState([]);
  const [plannerItems, setPlannerItems] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [folders, setFolders] = useState([]);

  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [courseTab, setCourseTab] = useState('overview'); // overview | announcements | modules | assignments | ai

  // Add Course Form
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cInstructor, setCInstructor] = useState('');
  const [cRssUrl, setCRssUrl] = useState('');
  const [cFolderId, setCFolderId] = useState('');
  const [cColor, setCColor] = useState(COURSE_PALETTE[0]);

  // Add Module / Material Drawer inside a Course
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState('file'); // file | paste | ocr
  const [modName, setModName] = useState('Module 1');
  const [matTitle, setMatTitle] = useState('');
  const [matFile, setMatFile] = useState(null);
  const [pasteMd, setPasteMd] = useState('');
  const [ocrFiles, setOcrFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

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

  // Reset per-course transient UI when switching courses
  useEffect(() => {
    setSelectedMatIds([]);
    setChatMsgs([]);
    setChatInput('');
    setUploadOpen(false);
    setPreviewMaterial(null);
  }, [selectedCourseId]);

  const courseStatsMap = useMemo(() => {
    const map = new Map();
    for (const c of courses) {
      const cAnns = plannerItems.filter(it => it.type === 'announcement' && courseMatchesTag(it.course, c));
      const cTasks = plannerItems.filter(it => it.type !== 'announcement' && !it.done && courseMatchesTag(it.course, c));
      const cMats = materials.filter(m => m.courseId === c.id);
      const cClasses = schedule.filter(s => courseMatchesTag(s.subject, c));
      map.set(c.id, {
        announcements: cAnns,
        pendingAssignments: cTasks,
        materials: cMats,
        classes: cClasses,
      });
    }
    return map;
  }, [courses, plannerItems, materials, schedule]);

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

  // Create a Course manually
  const handleCreateCourse = async e => {
    e?.preventDefault?.();
    const name = cName.trim() || cCode.trim();
    if (!name) {
      toast('Enter a course name or code', { type: 'error' });
      return;
    }
    let linkedFolderId = cFolderId ? Number(cFolderId) : null;
    if (!linkedFolderId) {
      const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        linkedFolderId = existing.id;
      } else {
        linkedFolderId = await createFolder(cCode.trim() || name.slice(0, 28), { mode: 'study', locked: false });
      }
    }

    const cleanRss = cRssUrl.trim();
    if (cleanRss && /^https:\/\//i.test(cleanRss)) {
      const cur = getCanvasSettings();
      const existingUrls = cur.rssUrls ? cur.rssUrls.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
      if (!existingUrls.includes(cleanRss)) {
        saveCanvasSettings({ rssUrls: [...existingUrls, cleanRss].join('\n') });
      }
    }

    const id = await db.courses.add({
      code: cCode.trim() || name.slice(0, 16),
      name,
      icsCourseTag: cCode.trim() || name,
      instructor: cInstructor.trim(),
      color: cColor,
      folderId: linkedFolderId,
      rssUrl: cleanRss,
      createdAt: Date.now(),
    });
    setCCode('');
    setCName('');
    setCInstructor('');
    setCRssUrl('');
    setCFolderId('');
    setAddCourseOpen(false);
    await refreshAll();
    onChanged?.();
    setSelectedCourseId(id);
    setCourseTab('overview');
    toast(`Created course "${name}"`, { type: 'success' });
  };

  const handleDeleteCourse = async course => {
    const ok = await confirm({
      title: `Remove "${course.name}"?`,
      message: 'Removes this course card and its uploaded module library. Your regular Subject Folder notes stay untouched.',
      confirmLabel: 'Remove course',
      destructive: true,
    });
    if (!ok) return;
    await db.materialChunks.where('courseId').equals(course.id).delete().catch(() => {});
    await db.courseMaterials.where('courseId').equals(course.id).delete().catch(() => {});
    await db.courses.delete(course.id);
    setSelectedCourseId(null);
    await refreshAll();
    toast('Course removed');
  };

  // Upload Module File (.pdf/.pptx/.docx/.md/.txt) OR Paste Canvas Page OR Batch Multi-Screenshot OCR
  const handleRichPaste = e => {
    const html = e.clipboardData?.getData('text/html');
    const plain = e.clipboardData?.getData('text/plain');
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

  const handleSaveMaterial = async e => {
    e?.preventDefault?.();
    if (!selectedCourse || uploadBusy) return;

    setUploadBusy(true);
    setUploadStatus('Extracting content…');
    try {
      let title = matTitle.trim();
      let extractedText = '';
      let kind = 'page';
      let fileName = '';
      let pageCount = 1;

      if (uploadKind === 'file') {
        if (!matFile) throw new Error('Choose a .pdf, .pptx, .docx, .md, or .txt file first.');
        const res = await extractDocument(matFile, {
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
        title = title || res.title;
        extractedText = res.rawMarkdown;
        kind = res.kind;
        fileName = matFile.name;
        pageCount = res.pageCount;
      } else if (uploadKind === 'paste') {
        extractedText = htmlToCleanMarkdown(pasteMd, pasteMd);
        if (!extractedText) throw new Error('Paste the Canvas Module page text first.');
        title = title || extractedText.split('\n')[0].replace(/^#+\s*/, '').slice(0, 64) || 'Canvas Module Page';
        kind = 'page';
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
        extractedText = parts.join('\n\n');
        title = title || `Scanned Slides (${ocrFiles.length} images)`;
        kind = 'ocr';
        pageCount = ocrFiles.length;
      }

      await saveCourseMaterialWithChunks({
        courseId: selectedCourse.id,
        moduleName: modName.trim() || 'Module 1',
        title,
        kind,
        fileName,
        extractedText,
        pageCount,
      });
      await logStudyActivity('notes', 1);

      setMatTitle('');
      setMatFile(null);
      setPasteMd('');
      setOcrFiles([]);
      setUploadOpen(false);
      await refreshAll();
      toast(`Indexed "${title}" — now searchable by Course AI!`, { type: 'success' });
    } catch (err) {
      toast(`Upload failed: ${err.message}`, { type: 'error', duration: 4000 });
    } finally {
      setUploadBusy(false);
      setUploadStatus('');
    }
  };

  // Save any Course Material or Canvas Item into the Course's linked Subject Folder as a Note
  const openAsNote = async ({ title, body, flashcards = [], quiz = [] }) => {
    const targetFolder =
      folders.find(f => f.id === selectedCourse?.folderId) ||
      folders.find(f => f.name === 'General') ||
      folders[0];
    const created = await createNote(
      targetFolder?.id ?? null,
      title,
      body,
      selectedCourse?.name || targetFolder?.name || 'General'
    );
    if (flashcards.length || quiz.length) {
      await db.notes.update(created.id, { flashcards, quiz });
    }
    const fresh = await db.notes.get(created.id);
    onChanged?.();
    onOpenNote?.(fresh, targetFolder || { id: '__all__', name: 'All Notes' });
  };

  // Course AI Chat Submit
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

  // Generate Study Guide OR Flashcards/Quiz Pack from selected course modules
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

  // Launch Bond-Paper Exam Builder from selected course modules!
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
        name: selectedCourse.name,
        code: selectedCourse.code,
        notesText: text,
      },
    });
  };

  const toggleSelectMat = id => {
    setSelectedMatIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const stats = useMemo(
    () =>
      (selectedCourse && courseStatsMap.get(selectedCourse.id)) || {
        announcements: [],
        pendingAssignments: [],
        materials: [],
        classes: [],
      },
    [selectedCourse, courseStatsMap]
  );

  const allCourseAssignments = useMemo(
    () =>
      selectedCourse
        ? plannerItems.filter(it => it.type !== 'announcement' && courseMatchesTag(it.course, selectedCourse))
        : [],
    [plannerItems, selectedCourse]
  );

  // Group uploaded materials by moduleName (must run before any early return!)
  const groupedModules = useMemo(() => {
    const map = new Map();
    for (const m of stats.materials) {
      const k = m.moduleName || 'Module 1';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return [...map.entries()];
  }, [stats.materials]);

  // =========================================================================
  // VIEW 1: CANVAS-STYLE COURSES DASHBOARD GRID
  // =========================================================================
  if (!selectedCourse) {
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
            onClick={() => setAddCourseOpen(v => !v)}
          >
            <Plus size={20} />
          </button>
        </header>

        <div className="large-title">Course Dashboard</div>

        <div className="quick-action-row" style={{ marginBottom: 10 }}>
          <button type="button" className="quick-action-btn" onClick={handleAutoDiscover}>
            <Wand2 size={15} />
            <span>Auto-Discover from Canvas</span>
          </button>
          <button type="button" className="quick-action-btn" onClick={() => setAddCourseOpen(v => !v)}>
            <Plus size={15} />
            <span>Add Course</span>
          </button>
        </div>

        {/* Add Course Form */}
        {addCourseOpen && (
          <form className="list-group settings-group" onSubmit={handleCreateCourse} style={{ marginBottom: 12 }}>
            <div className="settings-label">New Canvas-Style Course Card</div>
            <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.4fr', gap: 8 }}>
              <input
                className="input-field"
                placeholder="Code (e.g. IPT 101A)"
                value={cCode}
                onChange={e => setCCode(e.target.value)}
                autoFocus
              />
              <input
                className="input-field"
                placeholder="Full Course Title"
                value={cName}
                onChange={e => setCName(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <input
                className="input-field"
                placeholder="Instructor (optional)"
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
            <input
              className="input-field mt-8"
              placeholder="Optional Course Announcements RSS URL (.atom)"
              value={cRssUrl}
              onChange={e => setCRssUrl(e.target.value)}
            />
            <div className="flex items-center gap-8 mt-10">
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
              <button type="submit" className="btn btn-primary btn-sm">
                <Plus size={14} /> Create Course
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddCourseOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {courses.length === 0 ? (
          <div className="list-group settings-group" style={{ textAlign: 'center', padding: '26px 16px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No Course Cards Yet</div>
            <p className="settings-help" style={{ maxWidth: 360, margin: '0 auto 14px' }}>
              Tap <strong>Auto-Discover from Canvas</strong> to build cards automatically from your synced Canvas
              Calendar &amp; Announcements, or tap <strong>Add Course</strong> to create one manually and upload your
              PDFs, PPTXs &amp; DOCXs!
            </p>
            <div className="flex justify-center gap-8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddCourseOpen(true)}>
                <Plus size={14} /> Add Your First Course
              </button>
              {onOpenPlanner && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenPlanner}>
                  Open Canvas Sync
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="courses-grid">
            {courses.map(c => {
              const st = courseStatsMap.get(c.id) || {
                announcements: [],
                pendingAssignments: [],
                materials: [],
                classes: [],
              };
              return (
                <div
                  key={c.id}
                  className="course-card"
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
                    {st.pendingAssignments.length > 0 && (
                      <span className="course-due-pill">{st.pendingAssignments.length} due</span>
                    )}
                  </div>
                  <div className="course-card-body">
                    <div className="course-card-title">{c.name}</div>
                    {c.instructor && <div className="course-card-inst">{c.instructor}</div>}
                    <div className="course-card-stats">
                      <span>{st.materials.length} files</span>
                      <span>·</span>
                      <span>{st.announcements.length} posts</span>
                      <span>·</span>
                      <span>{st.pendingAssignments.length} tasks</span>
                    </div>
                  </div>
                  <div className="course-card-footer">
                    <button
                      type="button"
                      className="course-foot-btn"
                      title="Announcements"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCourseId(c.id);
                        setCourseTab('announcements');
                      }}
                    >
                      <Megaphone size={14} />
                    </button>
                    <button
                      type="button"
                      className="course-foot-btn"
                      title="Modules & Files"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCourseId(c.id);
                        setCourseTab('modules');
                      }}
                    >
                      <Layers size={14} />
                    </button>
                    <button
                      type="button"
                      className="course-foot-btn"
                      title="Assignments"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCourseId(c.id);
                        setCourseTab('assignments');
                      }}
                    >
                      <CheckSquare size={14} />
                    </button>
                    <button
                      type="button"
                      className="course-foot-btn"
                      title="Course AI Tutor"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCourseId(c.id);
                        setCourseTab('ai');
                      }}
                    >
                      <Sparkles size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: INSIDE A SINGLE CANVAS-STYLE COURSE WORKSPACE
  // =========================================================================
  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={() => setSelectedCourseId(null)}
        >
          <ChevronLeft size={20} /> Courses
        </button>
        <span className="navbar-title">{selectedCourse.code || selectedCourse.name}</span>
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
      </header>

      {/* Colored Canvas-Style Course Header Strip */}
      <div className="course-hero-banner" style={{ background: selectedCourse.color || '#0a84ff' }}>
        <div className="course-code-pill">{selectedCourse.code}</div>
        <div className="course-hero-title">{selectedCourse.name}</div>
        {selectedCourse.instructor && <div className="course-hero-inst">{selectedCourse.instructor}</div>}
      </div>

      {/* 5 Canvas-Style Workspace Tabs */}
      <div className="hub-tabs" role="tablist" style={{ marginTop: 10 }}>
        {[
          ['overview', 'Home', BookOpen],
          ['modules', `Modules (${stats.materials.length})`, Layers],
          ['announcements', `Posts (${stats.announcements.length})`, Megaphone],
          ['assignments', `Tasks (${stats.pendingAssignments.length})`, CheckSquare],
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

      {/* ---- TAB 1: OVERVIEW ---- */}
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
              <span>Upload Module / File</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => setCourseTab('ai')}
            >
              <Sparkles size={15} />
              <span>Ask Course AI</span>
            </button>
          </div>

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
                style={{ color: '#ff453a' }}
                onClick={() => handleDeleteCourse(selectedCourse)}
              >
                <Trash2 size={14} /> Remove Course
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

          {/* Latest Announcement Preview */}
          {stats.announcements.length > 0 && (
            <>
              <div className="section-heading">Latest Announcement</div>
              <div className="list-group settings-group">
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{stats.announcements[0].title}</div>
                <div className="settings-help" style={{ margin: '2px 0 6px' }}>
                  {stats.announcements[0].author ? `${stats.announcements[0].author} · ` : ''}
                  {stats.announcements[0].dateKey}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <MarkdownContent text={stats.announcements[0].description || ''} />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- TAB 2: MODULES & FILES (Manual Upload + Exam-Week Selector) ---- */}
      {courseTab === 'modules' && (
        <div style={{ paddingBottom: 20 }}>
          <div style={{ padding: '4px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="settings-help" style={{ margin: 0 }}>
              {selectedMatIds.length > 0
                ? `${selectedMatIds.length} file${selectedMatIds.length === 1 ? '' : 's'} selected for AI / Exam`
                : 'Upload PDFs, PPTXs, DOCXs or paste Canvas pages — AI indexes them offline!'}
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

          {/* Inline Upload / Paste / Multi-OCR Drawer */}
          {uploadOpen && (
            <form className="list-group settings-group" onSubmit={handleSaveMaterial} style={{ marginBottom: 12 }}>
              <div className="settings-label">Add Module Material to {selectedCourse.code}</div>

              <div className="view-switcher" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className={`view-switch-btn${uploadKind === 'file' ? ' active' : ''}`}
                  onClick={() => setUploadKind('file')}
                >
                  <FileUp size={13} style={{ marginRight: 4 }} /> File
                </button>
                <button
                  type="button"
                  className={`view-switch-btn${uploadKind === 'paste' ? ' active' : ''}`}
                  onClick={() => setUploadKind('paste')}
                >
                  <ClipboardPaste size={13} style={{ marginRight: 4 }} /> Paste Page
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
                    className={`import-dropzone${matFile ? ' has-file' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="import-dropzone-icon">
                      {matFile ? <FileText size={20} /> : <FileUp size={20} />}
                    </span>
                    <div className="import-dropzone-title">
                      {matFile ? matFile.name : 'Pick .pdf, .pptx, .docx, .md, or .txt'}
                    </div>
                    <div className="import-dropzone-sub">
                      Extracted &amp; chunk-indexed 100% offline for Course AI
                    </div>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.pptx,.docx,.md,.markdown,.txt"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) setMatFile(f);
                    }}
                  />
                </>
              )}

              {uploadKind === 'paste' && (
                <textarea
                  className="input-field"
                  rows={4}
                  placeholder="Copy any Canvas Module page (Select All → Copy) and paste here — headings, tables & links convert cleanly to Markdown!"
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

          {/* Collapsible Modules List */}
          {groupedModules.length === 0 ? (
            <div className="list-group settings-group" style={{ textAlign: 'center', padding: '22px 16px' }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>No Modules or Files Uploaded Yet</div>
              <p className="settings-help" style={{ margin: '0 auto 12px', maxWidth: 340 }}>
                Upload your teacher&apos;s PDFs, PowerPoint slides, Word docs, or copy-pasted Canvas Module pages here
                so Course AI can quiz, explain, and build exams strictly from this course!
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
                <Plus size={14} /> Upload First Module File
              </button>
            </div>
          ) : (
            groupedModules.map(([mName, list]) => {
              const isCollapsed = Boolean(collapsedMods[mName]);
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
                      {list.length} item{list.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  {!isCollapsed &&
                    list.map(mat => {
                      const checked = selectedMatIds.includes(mat.id);
                      return (
                        <div key={mat.id} className="list-item list-item-static">
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ padding: 2 }}
                            aria-label={`Select ${mat.title} for AI study`}
                            onClick={() => toggleSelectMat(mat.id)}
                          >
                            {checked ? <CheckSquare size={18} color="var(--accent-ink)" /> : <Square size={18} />}
                          </button>
                          <div className="list-item-body">
                            <div className="list-item-title">
                              <span>{mat.title}</span>
                              <span className="mode-badge mode-code" style={{ textTransform: 'uppercase' }}>
                                {mat.kind}
                              </span>
                            </div>
                            <div className="list-item-subtitle">
                              {mat.pageCount ? `${mat.pageCount} pg/slides · ` : ''}
                              {Math.max(1, Math.round((mat.extractedText || '').length / 1000))}k chars · AI-ready
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <button
                              type="button"
                              className="row-action-chip"
                              title="Read extracted text"
                              onClick={() => setPreviewMaterial(mat)}
                            >
                              <Eye size={12} /> Read
                            </button>
                            <button
                              type="button"
                              className="row-icon-btn"
                              aria-label="Delete material"
                              onClick={async () => {
                                await deleteCourseMaterial(mat.id);
                                setSelectedMatIds(prev => prev.filter(x => x !== mat.id));
                                await refreshAll();
                                toast('Removed module material');
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}

          {/* Inline Material Reader Modal */}
          {previewMaterial && (
            <div className="sheet-backdrop" onClick={() => setPreviewMaterial(null)}>
              <div className="sheet-panel" onClick={e => e.stopPropagation()}>
                <div className="sheet-header">
                  <span className="sheet-title">{previewMaterial.title}</span>
                  <button type="button" className="icon-btn" onClick={() => setPreviewMaterial(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="flex gap-8" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const m = previewMaterial;
                      setPreviewMaterial(null);
                      openAsNote({ title: m.title, body: m.extractedText });
                    }}
                  >
                    <FilePlus2 size={13} /> Save as Editable Note
                  </button>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, maxHeight: '55vh', overflowY: 'auto' }}>
                  <MarkdownContent text={previewMaterial.extractedText || ''} />
                </div>
              </div>
            </div>
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

      {/* ---- TAB 4: ASSIGNMENTS ---- */}
      {courseTab === 'assignments' && (
        <div style={{ paddingBottom: 20 }}>
          <div className="list-group">
            {allCourseAssignments.length === 0 ? (
              <div className="list-item list-item-static">
                <span className="list-item-subtitle">
                  No assignments synced for {selectedCourse.code} yet. Sync your Canvas Calendar (`.ics`) in School
                  Planner!
                </span>
              </div>
            ) : (
              allCourseAssignments.map(it => (
                <div key={it.id} className="list-item list-item-static" style={{ alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ padding: 2, marginTop: 2 }}
                    onClick={async () => {
                      await db.plannerItems.update(it.id, { done: !it.done, updatedAt: Date.now() });
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
                      style={{ textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? 0.6 : 1 }}
                    >
                      <span>{it.title}</span>
                      {it.type === 'exam' && <span className="mode-badge mode-vault">Exam</span>}
                    </div>
                    <div className="list-item-subtitle">
                      Due {it.dateKey}
                      {it.timeLabel ? ` · ${it.timeLabel}` : ''}
                    </div>
                    <div className="flex gap-6 mt-8">
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
              ))
            )}
          </div>
        </div>
      )}

      {/* ---- TAB 5: COURSE AI TUTOR (Grounded Strictly in Uploaded Files & Modules!) ---- */}
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
              <strong>{selectedCourse.name}</strong> modules &amp; files with exact slide/page citations!
            </p>

            {/* Quick 1-Tap Course Study Pack Buttons */}
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

          {/* Chat Thread */}
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
