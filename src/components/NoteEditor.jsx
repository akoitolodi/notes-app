/**
 * NoteEditor — modular orchestrator for Edit Mode, Read Mode, AI explanations,
 * Chat, Annotations (with Undo/Redo/Clear), Images, Export/PDF, and Note actions.
 */
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import {
  ChevronLeft,
  MessageSquare,
  GraduationCap,
  Pencil,
  MoreHorizontal,
  Folder,
  ChevronRight,
  Sparkles,
  RotateCw,
  Link2,
  PenTool,
  Share2,
  Pin,
  PinOff,
  Copy,
  FolderInput,
  Trash2,
  FileDown,
  Printer,
  ClipboardCopy,
  FileText,
  FileSpreadsheet,
  ArrowUpRight,
  Headphones,
  LayoutTemplate,
} from 'lucide-react';
import { scanNote } from '../api/scan';
import { scanLine, explainSnippet } from '../api/scanLine';
import {
  db,
  createNote,
  updateNote,
  moveNote,
  getNote,
  togglePin,
  duplicateNote,
  deleteNote,
  noteHasContent,
  saveImageAttachment,
  deleteImageAttachment,
  resolveImageDataUrl,
  saveFileAttachment,
  deleteFileAttachment,
  diffAndRemapBlocks,
  getHiddenLockedFolderIds,
  getZeroAiFolderIds,
  getNoteIndexLite,
  logStudyActivity,
  saveCustomTemplate,
} from '../store/db';
import StrokeLayer, { renderStrokesToCanvas } from './StrokeLayer';
import ImageStrip, { pickImage, compressImage } from './ImageManager';
import FileAttachmentStrip from './FileAttachmentStrip';
import { detectDocKind } from '../lib/docViewerParser';
import { summarizeNote, ocrImage, findRelatedNotes } from '../lib/aiFeatures';
import { instantiateTemplate } from '../lib/templates';
import { groupNoteLines } from '../lib/codeHighlight';
import { findBacklinks, findNoteByWikiTitle } from '../lib/wikiLinks';
import { NOTE_MODE_LIST, resolveNoteMode, getModeMeta, isZeroAiMode } from '../lib/noteModes';
import SlideUpPanel from './SlideUpPanel';
import {
  NoteLine as NoteLineComponent,
  CodeBlockCard,
  MarkdownTableBlock,
} from './InlineComponents';
import EditModeView from './editor/EditModeView';
import AnnotateBar from './editor/AnnotateBar';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';
import { PDF_STYLES, detectPdfStyle, parseNoteBlocksForPrint } from '../lib/pdfThemes';
import { isDarkTheme, HINT_KEY } from '../theme';

const ChatSheet = lazy(() => import('./ChatSheet'));
const AudioStudySheet = lazy(() => import('./AudioStudySheet'));
const BaiDropSheet = lazy(() => import('./BaiDropSheet'));
const FolderPickerSheet = lazy(() => import('./FolderPickerSheet'));
const DocumentViewerModal = lazy(() => import('./DocumentViewerModal'));

function normalizeDrawings(d) {
  if (Array.isArray(d)) return { refWidth: 0, strokes: d };
  if (d && Array.isArray(d.strokes)) return d;
  return { refWidth: 0, strokes: [] };
}

export default function NoteEditor({
  note,
  initialMode = null,
  folderName,
  folderMode = 'study',
  onOpenStudy,
  onOpenExamPaper,
  onBackToList,
  onOpenNote,
  onNoteMoved,
  onNoteDeleted,
  onNoteChanged,
  onRegisterBack,
}) {
  const { confirm, prompt, toast } = useDialog();

  const [mode, setMode] = useState(() => initialMode || (noteHasContent(note) ? 'read' : 'edit'));
  const [noteModeOverride, setNoteModeOverride] = useState(note?.mode || '');
  const [isSystemVaultFolder, setIsSystemVaultFolder] = useState(folderMode === 'vault');
  const activeNoteMode = isSystemVaultFolder
    ? 'vault'
    : resolveNoteMode({ mode: noteModeOverride }, { mode: folderMode });
  const activeModeMeta = getModeMeta(activeNoteMode);
  const isZeroAi = isZeroAiMode(activeNoteMode);
  const [backlinks, setBacklinks] = useState([]);
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [subject, setSubject] = useState(
    note?.subject && note.subject !== 'General'
      ? note.subject
      : folderName && !['All Notes', 'Pinned'].includes(folderName) && !folderName.startsWith('#')
        ? folderName
        : note?.subject || 'General'
  );
  const [folderId, setFolderId] = useState(note?.folderId);
  const [folderLabel, setFolderLabel] = useState(folderName || '');

  useEffect(() => {
    if (typeof folderId !== 'number') {
      setIsSystemVaultFolder(folderMode === 'vault');
      return undefined;
    }
    let live = true;
    db.folders
      .get(folderId)
      .then(f => {
        if (!live) return;
        setIsSystemVaultFolder(Boolean(f?.isSystemVault || f?.mode === 'vault' || folderMode === 'vault'));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [folderId, folderMode]);
  const [pinned, setPinned] = useState(Boolean(note?.pinned));
  const [blocks, setBlocks] = useState(note?.blocks || []);
  const [flashcards, setFlashcards] = useState(note?.flashcards || []);
  const [quiz, setQuiz] = useState(note?.quiz || []);
  const [chatMsgs, setChatMsgs] = useState(note?.chat || []);
  const [audioOpen, setAudioOpen] = useState(false);
  const [baiDropOpen, setBaiDropOpen] = useState(false);
  const [images, setImages] = useState(note?.images || []);
  const [files, setFiles] = useState(note?.files || []);
  const [viewingDoc, setViewingDoc] = useState(null);
  const [drawings, setDrawings] = useState(() => normalizeDrawings(note?.drawings));

  // Stroke undo/redo history
  const [strokeUndo, setStrokeUndo] = useState([]);
  const [strokeRedo, setStrokeRedo] = useState([]);

  // Save / scan state
  const [saveState, setSaveState] = useState('saved'); // saved | saving | dirty
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const scanAbortRef = useRef(null);

  // Panels & modals
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [busyLine, setBusyLine] = useState(null);
  const [selectionSnippet, setSelectionSnippet] = useState('');
  const noteLinesRef = useRef(null);
  const [dismissed, setDismissed] = useState(() => {
    const map = {};
    (note?.blocks || []).forEach(b => {
      if (b.mistakeIgnored) map[b.id] = true;
    });
    return map;
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pdfStyle, setPdfStyle] = useState('auto');
  const [exporting, setExporting] = useState(false);
  const [printPayload, setPrintPayload] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // AI features state
  const [summary, setSummary] = useState(note?.summary || '');
  const [summarizing, setSummarizing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [related, setRelated] = useState(null);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [relatedBusy, setRelatedBusy] = useState(false);

  // Draw mode state — remembers separate colors & opacities for Ink vs Highlighter
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState('pen');
  const [penColor, setPenColor] = useState(() => (isDarkTheme() ? '#ffffff' : '#14151a'));
  const [hlColor, setHlColor] = useState('#fde047');
  const [penOpacity, setPenOpacity] = useState(1);
  const [hlOpacity, setHlOpacity] = useState(0.4);
  const [size, setSize] = useState('medium');
  const activeDrawColor = tool === 'highlighter' ? hlColor : penColor;
  const activeDrawOpacity = tool === 'highlighter' ? hlOpacity : penOpacity;
  const handleSetDrawColor = c => {
    if (tool === 'highlighter') setHlColor(c);
    else setPenColor(c);
  };
  const handleSetDrawOpacity = a => {
    if (tool === 'highlighter') setHlOpacity(a);
    else setPenOpacity(a);
  };
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const [showHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Text undo/redo stack (tracks { title, body })
  const undoRef = useRef({
    stack: [{ title: note?.title || '', body: note?.body || '' }],
    index: 0,
    timer: null,
  });
  const [undoMeta, setUndoMeta] = useState({ canUndo: false, canRedo: false });
  const textareaRef = useRef(null);
  const savedRef = useRef({
    title: note?.title || '',
    body: note?.body || '',
    subject: note?.subject || 'General',
  });
  const autoSaveTimer = useRef(null);

  const syncUndoMeta = useCallback(() => {
    const h = undoRef.current;
    setUndoMeta({ canUndo: h.index > 0, canRedo: h.index < h.stack.length - 1 });
  }, []);

  const commitHistoryNow = useCallback(
    (nextTitle, nextBody) => {
      const h = undoRef.current;
      if (h.timer) {
        clearTimeout(h.timer);
        h.timer = null;
      }
      const cur = h.stack[h.index];
      if (cur && cur.title === nextTitle && cur.body === nextBody) return;
      h.stack = h.stack.slice(0, h.index + 1).concat({ title: nextTitle, body: nextBody });
      if (h.stack.length > 100) h.stack.shift();
      h.index = h.stack.length - 1;
      syncUndoMeta();
    },
    [syncUndoMeta]
  );

  const scheduleHistory = useCallback(
    (nextTitle, nextBody) => {
      const h = undoRef.current;
      if (h.timer) clearTimeout(h.timer);
      h.timer = setTimeout(() => {
        commitHistoryNow(nextTitle, nextBody);
      }, 350);
    },
    [commitHistoryNow]
  );

  const handleTitleChange = val => {
    setTitle(val);
    setSaveState('dirty');
    scheduleHistory(val, body);
  };

  const handleBodyChange = val => {
    setBody(val);
    setSaveState('dirty');
    scheduleHistory(title, val);
  };

  const handleSubjectChange = val => {
    setSubject(val);
    setSaveState('dirty');
  };

  const handleApplyTemplate = templateId => {
    const tpl = instantiateTemplate(templateId);
    const nextTitle = title.trim() ? title : tpl.title;
    const nextBody = tpl.body;
    setTitle(nextTitle);
    setBody(nextBody);
    setSaveState('dirty');
    commitHistoryNow(nextTitle, nextBody);
  };

  const undo = useCallback(() => {
    // Flush any pending unsaved keystroke first so undo never drops recent work
    commitHistoryNow(title, body);
    const h = undoRef.current;
    if (h.index > 0) {
      h.index -= 1;
      const snap = h.stack[h.index];
      setTitle(snap.title);
      setBody(snap.body);
      setSaveState('dirty');
      syncUndoMeta();
    }
  }, [title, body, commitHistoryNow, syncUndoMeta]);

  const redo = useCallback(() => {
    const h = undoRef.current;
    if (h.index < h.stack.length - 1) {
      h.index += 1;
      const snap = h.stack[h.index];
      setTitle(snap.title);
      setBody(snap.body);
      setSaveState('dirty');
      syncUndoMeta();
    }
  }, [syncUndoMeta]);

  // Debounced auto-save in Edit mode (protects against crashes / tab kills)
  useEffect(() => {
    if (mode !== 'edit') return undefined;
    const dirty =
      title !== savedRef.current.title ||
      body !== savedRef.current.body ||
      subject !== savedRef.current.subject;
    if (!dirty) return undefined;

    setSaveState('dirty');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const extractTagsKey = txt => (String(txt || '').match(/#[A-Za-z0-9_-]+/g) || []).join(',');
        const prevSnap = savedRef.current;
        const metaChanged =
          title !== prevSnap.title ||
          subject !== prevSnap.subject ||
          extractTagsKey(`${title} ${body}`) !== extractTagsKey(`${prevSnap.title} ${prevSnap.body}`);

        // Keep existing explanations remapped onto moved lines during edits
        const { remappedBlocks } = diffAndRemapBlocks(blocksRef.current, prevSnap.body, body);
        await updateNote(note.id, { title, body, subject, blocks: remappedBlocks });
        savedRef.current = { title, body, subject };
        setBlocks(remappedBlocks);
        setSaveState('saved');
        onNoteChanged?.(
          { title, body, subject, blocks: remappedBlocks },
          { metadataChanged: metaChanged }
        );
      } catch {
        setSaveState('dirty');
      }
    }, 700);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [mode, title, body, subject, note.id, onNoteChanged]);

  // Refresh cross-folder [[Wiki-Link]] backlinks only in Read Mode (debounced, lightweight index)
  useEffect(() => {
    if (!title?.trim() || isZeroAi || mode !== 'read') {
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      Promise.all([getNoteIndexLite(), getHiddenLockedFolderIds(), getZeroAiFolderIds()])
        .then(([allNotes, hiddenIds, zeroAiIds]) => {
          if (!live) return;
          const excluded = new Set([...hiddenIds, ...zeroAiIds]);
          setBacklinks(findBacklinks({ id: note.id, title }, allNotes, excluded));
        })
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [note.id, title, mode, isZeroAi]);

  const handleWikiLinkTap = useCallback(
    async targetTitle => {
      const [allNotes, hiddenIds, zeroAiIds] = await Promise.all([
        getNoteIndexLite(),
        getHiddenLockedFolderIds(),
        getZeroAiFolderIds(),
      ]);
      const excluded = new Set([...hiddenIds, ...zeroAiIds]);
      const existing = findNoteByWikiTitle(targetTitle, allNotes, excluded);
      if (existing) {
        const full = await getNote(existing.id);
        onOpenNote?.(full || existing);
        return;
      }
      const ok = await confirm({
        title: `Create "${targetTitle}"?`,
        message: 'No unlocked note with that title exists yet. Create a new linked note now?',
        confirmLabel: 'Create note',
      });
      if (!ok) return;
      const created = await createNote(folderId, targetTitle, '', subject || 'General');
      onNoteChanged?.();
      onOpenNote?.(created, null, { startInEdit: true });
    },
    [confirm, folderId, subject, onNoteChanged, onOpenNote]
  );

  const handleSetNoteMode = async nextMode => {
    setNoteModeOverride(nextMode);
    await updateNote(note.id, { mode: nextMode || null });
    onNoteChanged?.({ mode: nextMode || null });
    toast(
      nextMode
        ? `Note mode: ${getModeMeta(nextMode).label}`
        : `Using folder mode (${getModeMeta(folderMode).label})`
    );
  };

  // Cleanup abort controllers & timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (undoRef.current.timer) clearTimeout(undoRef.current.timer);
      scanAbortRef.current?.abort();
    };
  }, []);

  // Register Back button interception for Android hardware back / browser popstate
  useEffect(() => {
    if (!onRegisterBack) return undefined;
    onRegisterBack(() => {
      if (viewingDoc) {
        setViewingDoc(null);
        return true;
      }
      if (chatOpen) {
        setChatOpen(false);
        return true;
      }
      if (panelOpen) {
        setPanelOpen(false);
        return true;
      }
      if (moreOpen) {
        setMoreOpen(false);
        return true;
      }
      if (exportOpen) {
        setExportOpen(false);
        return true;
      }
      if (moveOpen) {
        setMoveOpen(false);
        return true;
      }
      if (relatedOpen) {
        setRelatedOpen(false);
        return true;
      }
      if (audioOpen) {
        setAudioOpen(false);
        return true;
      }
      if (baiDropOpen) {
        setBaiDropOpen(false);
        return true;
      }
      if (drawMode) {
        setDrawMode(false);
        return true;
      }
      return false;
    });
    return () => onRegisterBack(null);
  }, [onRegisterBack, viewingDoc, chatOpen, panelOpen, moreOpen, exportOpen, moveOpen, relatedOpen, audioOpen, baiDropOpen, drawMode]);

  // Persist current text immediately
  const persistCurrentText = useCallback(async () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const { remappedBlocks } = diffAndRemapBlocks(blocks, savedRef.current.body, body);
    await updateNote(note.id, { title, body, subject, blocks: remappedBlocks, images, drawings });
    savedRef.current = { title, body, subject };
    setBlocks(remappedBlocks);
    setSaveState('saved');
    if (!isZeroAi && (title.trim() || body.trim())) {
      logStudyActivity('notes', 1).catch(() => {});
    }
    onNoteChanged?.({ title, body, subject, blocks: remappedBlocks, images, drawings });
    return remappedBlocks;
  }, [note.id, title, body, subject, blocks, images, drawings, isZeroAi, onNoteChanged]);

  const handleBackFromEdit = useCallback(async () => {
    await persistCurrentText();
    onBackToList?.();
  }, [persistCurrentText, onBackToList]);

  const handleSaveOnly = useCallback(async () => {
    await persistCurrentText();
    setMode('read');
  }, [persistCurrentText]);

  const handleSaveAndExplain = useCallback(async () => {
    if (isZeroAi || (!body.trim() && !title.trim())) {
      await persistCurrentText();
      setMode('read');
      return;
    }

    const { remappedBlocks, linesToScan } = diffAndRemapBlocks(blocks, savedRef.current.body, body);

    if (linesToScan.length === 0 && remappedBlocks.length > 0) {
      await persistCurrentText();
      setMode('read');
      toast('All lines are already explained');
      return;
    }

    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanNote(body, subject, linesToScan, {
        noteMode: activeNoteMode,
        signal: controller.signal,
      });
      const freshBlocks = result.blocks || [];
      const scannedSet = new Set(linesToScan);

      const merged = remappedBlocks
        .filter(b => {
          const m = /^line-(\d+)$/.exec(b.id);
          const n = m ? parseInt(m[1], 10) : -1;
          return !scannedSet.has(n);
        })
        .concat(freshBlocks)
        .sort((a, b) => {
          const na = parseInt((/^line-(\d+)$/.exec(a.id) || [])[1] || 9999, 10);
          const nb = parseInt((/^line-(\d+)$/.exec(b.id) || [])[1] || 9999, 10);
          return na - nb;
        });

      const nextCards = result.flashcards?.length ? result.flashcards : flashcards;
      const nextQuiz = result.quiz?.length ? result.quiz : quiz;

      setBlocks(merged);
      setFlashcards(nextCards);
      setQuiz(nextQuiz);
      savedRef.current = { title, body, subject };
      await updateNote(note.id, {
        title,
        body,
        subject,
        blocks: merged,
        images,
        drawings,
        flashcards: nextCards,
        quiz: nextQuiz,
        lastScanAt: Date.now(),
      });
      setSaveState('saved');
      onNoteChanged?.();
      setMode('read');
    } catch (err) {
      if (err?.isCancelled) {
        toast('AI scan cancelled — note saved');
        await persistCurrentText();
      } else {
        setScanError(err.message);
        try {
          await persistCurrentText();
        } catch {
          // keep error visible
        }
      }
    } finally {
      setIsScanning(false);
    }
  }, [
    body,
    title,
    subject,
    note.id,
    blocks,
    flashcards,
    quiz,
    images,
    drawings,
    persistCurrentText,
    onNoteChanged,
    toast,
  ]);

  // Per-line re-scan (Simpler / Example)
  const handleLineRequest = useCallback(
    async (lineId, request) => {
      const block = blocks.find(b => b.id === lineId);
      if (!block || busyLine) return;
      setBusyLine(lineId);
      try {
        const { explanation } = await scanLine(body, block.text, request);
        const field = request === 'simpler' ? 'simpler' : 'example';
        setBlocks(prev => {
          const updated = prev.map(b =>
            b.id === lineId ? { ...b, [field]: explanation, show: field } : b
          );
          updateNote(note.id, { blocks: updated }).catch(() => {});
          return updated;
        });
      } catch (err) {
        toast(`Re-scan failed: ${err.message}`, { type: 'error' });
      } finally {
        setBusyLine(null);
      }
    },
    [blocks, body, note.id, busyLine, toast]
  );

  /** Tap ANY line in Read Mode: fast compact explanation on demand (skips when selecting partial text). */
  const handleLineTap = useCallback(
    async (block, lineIdx) => {
      if (isZeroAi) return;
      const activeSel =
        typeof window !== 'undefined' ? window.getSelection?.()?.toString().trim() || '' : '';
      if (activeSel.length >= 2) return;

      const lineText = (body.split('\n')[lineIdx] || '').trim();
      if (!lineText || !/[a-zA-Z0-9\u00C0-\uFFFF]/.test(lineText)) return;
      setPanelOpen(true);

      // Open immediately if block has a real explanation
      if (block && !block._failed) {
        setSelectedLineId(block.id);
        return;
      }

      if (busyLine) {
        toast('Finishing current line explanation…');
        return;
      }

      const id = `line-${lineIdx + 1}`;
      const placeholder = { id, text: lineText, explanation: '', terms: [], mistake: null, _failed: false };
      setBlocks(prev => [...prev.filter(b => b.id !== id), placeholder]);
      setSelectedLineId(id);
      setBusyLine(id);

      try {
        const res = await explainSnippet({ note: body, targetText: lineText, subject, isPartial: false });
        const fresh = {
          id,
          text: lineText,
          explanation: res?.explanation || '',
          terms: Array.isArray(res?.terms) ? res.terms : [],
          mistake: null,
          _failed: !res?.explanation,
        };
        if (!fresh._failed) {
          setBlocks(prev => {
            const lineNo = b => parseInt(String(b.id).replace('line-', ''), 10) || 0;
            const updated = [...prev.filter(b => b.id !== id), fresh].sort(
              (a, b) => lineNo(a) - lineNo(b)
            );
            updateNote(note.id, { blocks: updated }).catch(() => {});
            return updated;
          });
        } else {
          setBlocks(prev =>
            prev.map(b =>
              b.id === id
                ? { ...b, explanation: 'No extra explanation needed for this line.', _failed: true }
                : b
            )
          );
        }
      } catch (err) {
        setBlocks(prev =>
          prev.map(b =>
            b.id === id
              ? { ...b, explanation: `Failed: ${err.message}`, _failed: true }
              : b
          )
        );
      } finally {
        setBusyLine(null);
      }
    },
    [body, subject, note.id, busyLine, isZeroAi, toast]
  );

  /** Explain ONLY the user's highlighted text selection inside Read Mode. */
  const handleExplainSelection = useCallback(async () => {
    const snippet = selectionSnippet.trim();
    if (!snippet || isZeroAi || busyLine) return;
    setSelectionSnippet('');
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {
      // ignore
    }
    const id = `sel-${Date.now()}`;
    const placeholder = { id, text: snippet, explanation: '', terms: [], mistake: null, _failed: false };
    setBlocks(prev => [...prev.filter(b => !String(b.id).startsWith('sel-')), placeholder]);
    setSelectedLineId(id);
    setPanelOpen(true);
    setBusyLine(id);

    try {
      const res = await explainSnippet({ note: body, targetText: snippet, subject, isPartial: true });
      const expl = res?.explanation || '';
      setBlocks(prev =>
        prev.map(b =>
          b.id === id
            ? {
                ...b,
                explanation: expl || 'Could not explain selection.',
                terms: Array.isArray(res?.terms) ? res.terms : [],
                _failed: !expl,
              }
            : b
        )
      );
    } catch (err) {
      setBlocks(prev =>
        prev.map(b =>
          b.id === id ? { ...b, explanation: `Failed: ${err.message}`, _failed: true } : b
        )
      );
    } finally {
      setBusyLine(null);
    }
  }, [selectionSnippet, isZeroAi, busyLine, body, subject]);

  // Listen for partial text highlighting inside Read Mode lines
  useEffect(() => {
    if (mode !== 'read' || isZeroAi || drawMode) {
      setSelectionSnippet('');
      return undefined;
    }
    const syncSelection = () => {
      const sel = window.getSelection?.();
      const container = noteLinesRef.current;
      if (!sel || sel.isCollapsed || !container) {
        setSelectionSnippet('');
        return;
      }
      const txt = sel.toString().trim();
      const anchorInNotes = sel.anchorNode && container.contains(sel.anchorNode);
      if (anchorInNotes && txt.length >= 2 && txt.length <= 600) {
        setSelectionSnippet(txt);
      } else {
        setSelectionSnippet('');
      }
    };
    document.addEventListener('selectionchange', syncSelection);
    return () => document.removeEventListener('selectionchange', syncSelection);
  }, [mode, isZeroAi, drawMode]);

  const handleShowOriginal = useCallback(
    async lineId => {
      setBlocks(prev => {
        const updated = prev.map(b => (b.id === lineId ? { ...b, show: 'main' } : b));
        updateNote(note.id, { blocks: updated }).catch(() => {});
        return updated;
      });
    },
    [note.id]
  );

  const dismissMistake = useCallback(
    async lineId => {
      setDismissed(prev => ({ ...prev, [lineId]: true }));
      setBlocks(prev => {
        const updated = prev.map(b => (b.id === lineId ? { ...b, mistakeIgnored: true } : b));
        updateNote(note.id, { blocks: updated }).catch(() => {});
        return updated;
      });
    },
    [note.id]
  );

  // FIXED: updates BOTH block.text AND savedRef.current.body so explanation stays attached!
  const applyCorrection = useCallback(
    async (block, mistake) => {
      if (!mistake?.correction) return;
      const lineMatch = /^line-(\d+)$/.exec(block.id);
      if (!lineMatch) return;
      const lineIndex = parseInt(lineMatch[1], 10) - 1;
      const newLines = body.split('\n');
      if (lineIndex < 0 || lineIndex >= newLines.length) return;
      newLines[lineIndex] = mistake.correction;
      const newBody = newLines.join('\n');

      setBody(newBody);
      savedRef.current = { ...savedRef.current, body: newBody };
      setDismissed(prev => ({ ...prev, [block.id]: true }));

      setBlocks(prev => {
        const updated = prev.map(b =>
          b.id === block.id ? { ...b, text: mistake.correction, mistake: null } : b
        );
        updateNote(note.id, { body: newBody, blocks: updated }).catch(() => {});
        return updated;
      });
      toast('Correction applied', { type: 'success' });
      onNoteChanged?.();
    },
    [body, note.id, onNoteChanged, toast]
  );

  // Streaming TL;DR Summary
  const handleSummarize = useCallback(
    async (force = false) => {
      if (summarizing) return;
      if (summary && !force) return;
      if (!body.trim()) {
        toast('Write some notes first');
        return;
      }
      setSummarizing(true);
      if (force) setSummary('');
      try {
        const s = await summarizeNote({
          note: body,
          subject,
          onToken: partial => setSummary(partial),
        });
        setSummary(s);
        await updateNote(note.id, { summary: s });
      } catch (err) {
        toast(`Summary failed: ${err.message}`, { type: 'error' });
      } finally {
        setSummarizing(false);
      }
    },
    [summarizing, summary, body, subject, note.id, toast]
  );

  // OCR from Camera
  const handleOcrScan = useCallback(async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    try {
      const picked = await pickImage('camera');
      if (!picked?.dataUrl) return;
      toast('Reading text from photo…');
      const dataUrl = picked.alreadyCompressed
        ? picked.dataUrl
        : await compressImage(picked.dataUrl);
      const text = await ocrImage({ imageDataUrl: dataUrl, subject });
      if (text && text.trim()) {
        const newBody = (body ? body + '\n' : '') + text.trim();
        setBody(newBody);
        savedRef.current = { ...savedRef.current, body: newBody };
        await updateNote(note.id, { body: newBody });
        toast('Text added to note', { type: 'success' });
        onNoteChanged?.();
      } else {
        toast('No text found in the photo');
      }
    } catch (err) {
      toast(`OCR failed: ${err.message}`, { type: 'error' });
    } finally {
      setOcrBusy(false);
    }
  }, [ocrBusy, body, subject, note.id, onNoteChanged, toast]);

  const appendTextToNote = useCallback(
    async extraText => {
      const trimmed = String(extraText || '').trim();
      if (!trimmed) return;
      const newBody = (body ? body + '\n\n' : '') + trimmed;
      setBody(newBody);
      savedRef.current = { ...savedRef.current, body: newBody };
      await updateNote(note.id, { body: newBody });
      onNoteChanged?.();
    },
    [body, note.id, onNoteChanged]
  );

  // Related Notes
  const handleRelated = useCallback(async () => {
    if (relatedBusy) return;
    setRelatedOpen(true);
    if (related) return;
    setRelatedBusy(true);
    try {
      const all = await db.notes.where('folderId').equals(folderId).toArray();
      const usable = all.filter(n => n.id !== note.id && !n.trashed && (n.body || '').trim());
      if (usable.length === 0) {
        setRelated([]);
        return;
      }
      const links = await findRelatedNotes({
        currentNote: { title, body },
        otherNotes: usable.map(n => ({ id: n.id, title: n.title, body: n.body })),
      });
      setRelated(links.map(l => ({ ...l.note, reason: l.reason })));
    } catch (err) {
      toast(`Related notes failed: ${err.message}`, { type: 'error' });
      setRelatedOpen(false);
    } finally {
      setRelatedBusy(false);
    }
  }, [related, relatedBusy, folderId, note.id, title, body, toast]);

  // Checklist toggle
  const CHECK_RE = /^(\s*-\s\[)( |x|X)(\]\s*)(.*)$/;
  const toggleChecklist = useCallback(
    async lineIdx => {
      const ls = body.split('\n');
      const m = CHECK_RE.exec(ls[lineIdx]);
      if (!m) return;
      ls[lineIdx] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`;
      const newBody = ls.join('\n');
      setBody(newBody);
      savedRef.current = { ...savedRef.current, body: newBody };
      await updateNote(note.id, { body: newBody });
      onNoteChanged?.();
    },
    [body, note.id, onNoteChanged]
  );

  // Images (Dexie v4 Blob attachments)
  const addImage = useCallback(
    async dataUrl => {
      const entry = await saveImageAttachment(note.id, dataUrl);
      setImages(prev => {
        const next = [...prev, entry];
        updateNote(note.id, { images: next }).catch(() => {});
        return next;
      });
      onNoteChanged?.();
    },
    [note.id, onNoteChanged]
  );

  const removeImage = useCallback(
    async imgId => {
      await deleteImageAttachment(imgId);
      setImages(prev => {
        const next = prev.filter(i => i.id !== imgId);
        updateNote(note.id, { images: next }).catch(() => {});
        return next;
      });
      onNoteChanged?.();
    },
    [note.id, onNoteChanged]
  );

  const addFileAttachment = useCallback(
    async rawFile => {
      if (!rawFile) return;
      const entry = await saveFileAttachment(note.id, rawFile, {
        kind: detectDocKind(rawFile.name, rawFile.type),
        mime: rawFile.type || '',
        name: rawFile.name || 'document',
      });
      setFiles(prev => {
        const next = [...prev, entry];
        updateNote(note.id, { files: next }).catch(() => {});
        return next;
      });
      onNoteChanged?.();
      toast(`Attached "${entry.name}"`, { type: 'success' });
    },
    [note.id, onNoteChanged, toast]
  );

  const removeFileAttachment = useCallback(
    async fileId => {
      await deleteFileAttachment(fileId);
      setFiles(prev => {
        const next = prev.filter(f => f.id !== fileId);
        updateNote(note.id, { files: next }).catch(() => {});
        return next;
      });
      onNoteChanged?.();
    },
    [note.id, onNoteChanged]
  );

  const openDocumentMeta = useCallback(fileMeta => {
    if (!fileMeta) return;
    setViewingDoc({
      title: fileMeta.name || 'Document',
      fileName: fileMeta.name || '',
      kind: fileMeta.kind || detectDocKind(fileMeta.name, fileMeta.mime),
      mime: fileMeta.mime || '',
      attachmentId: fileMeta.id,
      size: fileMeta.size || 0,
      pageCount: fileMeta.pageCount || 0,
    });
  }, []);

  // Drawings with Undo / Redo / Clear All
  const updateDrawings = useCallback(
    async nextDoc => {
      setStrokeUndo(prev => [...prev.slice(-40), drawings]);
      setStrokeRedo([]);
      setDrawings(nextDoc);
      try {
        await updateNote(note.id, { drawings: nextDoc });
        onNoteChanged?.();
      } catch {
        // local state kept
      }
    },
    [drawings, note.id, onNoteChanged]
  );

  const handleStrokeUndo = useCallback(async () => {
    if (strokeUndo.length === 0) return;
    const prevDoc = strokeUndo[strokeUndo.length - 1];
    setStrokeUndo(u => u.slice(0, -1));
    setStrokeRedo(r => [...r, drawings]);
    setDrawings(prevDoc);
    await updateNote(note.id, { drawings: prevDoc });
  }, [strokeUndo, drawings, note.id]);

  const handleStrokeRedo = useCallback(async () => {
    if (strokeRedo.length === 0) return;
    const nextDoc = strokeRedo[strokeRedo.length - 1];
    setStrokeRedo(r => r.slice(0, -1));
    setStrokeUndo(u => [...u, drawings]);
    setDrawings(nextDoc);
    await updateNote(note.id, { drawings: nextDoc });
  }, [strokeRedo, drawings, note.id]);

  const handleStrokeClear = useCallback(async () => {
    if (!drawings.strokes.length) return;
    const ok = await confirm({
      title: 'Clear all drawings?',
      message: 'All annotations on this note will be erased.',
      confirmLabel: 'Clear drawings',
      destructive: true,
    });
    if (!ok) return;
    await updateDrawings({ refWidth: drawings.refWidth || 0, strokes: [] });
  }, [drawings, confirm, updateDrawings]);

  // Note menu actions (Pin, Move, Duplicate, Delete)
  const handleTogglePin = async () => {
    setMoreOpen(false);
    await togglePin(note.id);
    setPinned(p => !p);
    toast(pinned ? 'Note unpinned' : 'Note pinned');
    onNoteChanged?.();
  };

  const handleDuplicate = async () => {
    setMoreOpen(false);
    const dup = await duplicateNote(note.id);
    if (dup) {
      toast('Note duplicated');
      onNoteChanged?.();
      onOpenNote?.(dup);
    }
  };

  const handleSaveAsTemplate = async () => {
    setMoreOpen(false);
    if (isZeroAi) return;
    if (!body.trim()) {
      toast('Add some structure to this note before saving as a template');
      return;
    }
    const tplName = await prompt({
      title: 'Save as Personal Template',
      defaultValue: (title || '').trim() || 'My Layout',
      placeholder: 'e.g. My Lab Notes, Weekly Plan',
      confirmLabel: 'Save Template',
    });
    if (!tplName) return;
    await saveCustomTemplate({
      name: tplName,
      category: 'custom',
      description: `Saved from "${title || 'Note'}"`,
      title: title || '',
      body,
      icon: 'file',
    });
    toast(`Saved "${tplName}" to Templates → Mine!`, { type: 'success' });
  };

  const handleSaveOfflineFlashcards = useCallback(
    async extractedCards => {
      if (!Array.isArray(extractedCards) || extractedCards.length === 0) return;
      const existingQs = new Set((flashcards || []).map(c => String(c.q || '').trim().toLowerCase()));
      const fresh = extractedCards.filter(c => !existingQs.has(String(c.q || '').trim().toLowerCase()));
      if (fresh.length === 0) {
        toast('All those flashcards are already saved on this note!');
        return;
      }
      const nextCards = [...(flashcards || []), ...fresh];
      setFlashcards(nextCards);
      await updateNote(note.id, { flashcards: nextCards });
      onNoteChanged?.();
      toast(`Created ${fresh.length} offline flashcard${fresh.length === 1 ? '' : 's'} — tap Study to review!`, {
        type: 'success',
      });
    },
    [flashcards, note.id, onNoteChanged, toast]
  );

  const handleMove = async f => {
    setMoveOpen(false);
    await moveNote(note.id, f.id);
    setFolderId(f.id);
    setFolderLabel(f.name);
    setRelated(null);
    onNoteMoved?.(f);
    toast(`Moved to ${f.name}`);
  };

  const handleDeleteNote = async () => {
    setMoreOpen(false);
    const ok = await confirm({
      title: `Delete "${title || 'New Note'}"?`,
      message: 'It will stay in Recently Deleted for 30 days.',
      confirmLabel: 'Move to Trash',
      destructive: true,
    });
    if (!ok) return;
    await deleteNote(note.id);
    toast('Moved to Recently Deleted');
    onNoteDeleted?.();
  };

  // Share, Copy, PDF & Print
  const noteText = `${title || 'New Note'}\n\n${body}`;

  const copyToClipboard = async text => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  };

  const handleShareText = async () => {
    setExportOpen(false);
    if (navigator.share) {
      try {
        await navigator.share({ title: title || 'New Note', text: noteText });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    const ok = await copyToClipboard(noteText);
    toast(ok ? 'Copied to clipboard' : 'Sharing not available here');
  };

  const handleCopyText = async () => {
    setExportOpen(false);
    const ok = await copyToClipboard(noteText);
    toast(ok ? 'Copied to clipboard' : 'Copy failed');
  };

  const handleExportPDF = async (withExpl, saveToDocs = false) => {
    setExportOpen(false);
    setExporting(true);
    try {
      const { buildNotePDF, saveNotePDF, savePdfToDocuments } = await import('../lib/pdf');
      const doc = await buildNotePDF({
        title: title || 'New Note',
        body,
        subject,
        noteMode: activeNoteMode,
        pdfStyle,
        blocks,
        images,
        drawings,
        withExplanations: withExpl,
      });
      if (saveToDocs) {
        const res = await savePdfToDocuments(doc, title || 'note');
        toast(`Saved PDF to ${res.savedPath}`, { type: 'success' });
        return;
      }
      const how = await saveNotePDF(doc, title || 'note');
      if (how === 'cancelled') return;
      toast(
        how === 'shared' ? 'PDF ready — pick where to save or send it' : 'PDF downloaded',
        { type: 'success' }
      );
    } catch (err) {
      toast(`PDF failed: ${err.message}`, { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const handlePrintPdf = async withExpl => {
    setExportOpen(false);
    const resolvedStyle =
      pdfStyle === 'auto'
        ? detectPdfStyle({ title, body, noteMode: activeNoteMode })
        : pdfStyle;
    const resolvedImgs = [];
    for (const img of images) {
      const url = await resolveImageDataUrl(img);
      if (url) resolvedImgs.push({ id: img.id, dataUrl: url });
    }
    const drawingPreview = renderStrokesToCanvas(drawings, 620, { dark: false });
    setPrintPayload({
      title: title || 'New Note',
      subject: subject || '',
      style: resolvedStyle,
      body,
      withExpl,
      images: resolvedImgs,
      drawingUrl: drawingPreview?.dataUrl || null,
    });
  };

  useEffect(() => {
    if (!printPayload) return undefined;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        toast('Printing not supported here');
      }
      setPrintPayload(null);
    }, 180);
    return () => clearTimeout(t);
  }, [printPayload, toast]);

  const isNative = Capacitor.isNativePlatform?.();
  const explBlocks = blocks.filter(b => b.explanation || b.simpler || b.example);

  const printPortal =
    printPayload && typeof document !== 'undefined' && document.body
      ? createPortal(
          <div className={`print-root print-theme-${printPayload.style || 'academic'}`}>
            <div className="print-doc-header">
              {printPayload.subject && <div className="print-subject">{printPayload.subject}</div>}
              <h1 className="print-title">{printPayload.title}</h1>
              <div className="print-meta">
                {new Date().toLocaleDateString([], {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
            {printPayload.images.length > 0 && (
              <div className="print-images">
                {printPayload.images.map(img => (
                  <img key={img.id} src={img.dataUrl} alt="Note attachment" />
                ))}
              </div>
            )}
            <div className="print-body">
              {parseNoteBlocksForPrint(printPayload.body).map((blk, i) => {
                if (blk.type === 'hr') return <hr key={i} className="print-hr" />;
                if (blk.type === 'heading') {
                  const Tag = blk.level === 1 ? 'h2' : blk.level === 2 ? 'h3' : 'h4';
                  return (
                    <Tag key={i} className="print-md-heading">
                      {blk.text}
                    </Tag>
                  );
                }
                if (blk.type === 'code') {
                  return (
                    <pre key={i} className="print-code-block">
                      {blk.lang && <span className="print-code-lang">{blk.lang.toUpperCase()}</span>}
                      <code>{blk.code}</code>
                    </pre>
                  );
                }
                if (blk.type === 'quote') {
                  return (
                    <blockquote key={i} className="print-quote">
                      {blk.text}
                    </blockquote>
                  );
                }
                if (blk.type === 'checkbox') {
                  return (
                    <div key={i} className="print-list-line">
                      <span>{blk.checked ? '☑' : '☐'}</span> <span>{blk.text}</span>
                    </div>
                  );
                }
                if (blk.type === 'bullet') {
                  return (
                    <div key={i} className="print-list-line">
                      <span>•</span> <span>{blk.text}</span>
                    </div>
                  );
                }
                if (blk.type === 'ordered') {
                  return (
                    <div key={i} className="print-list-line">
                      <strong>{blk.num}.</strong> <span>{blk.text}</span>
                    </div>
                  );
                }
                return (
                  <p key={i} className="print-line">
                    {blk.text}
                  </p>
                );
              })}
            </div>
            {printPayload.drawingUrl && (
              <div className="print-drawing">
                <img src={printPayload.drawingUrl} alt="Annotations" />
              </div>
            )}
            {printPayload.withExpl && explBlocks.length > 0 && (
              <>
                <h2 className="print-h2">AI Explanations</h2>
                {explBlocks.map(b => (
                  <div key={b.id} className="print-block">
                    <p className="print-line-text">{b.text}</p>
                    <p className="print-expl">
                      {b.show === 'simpler' && b.simpler
                        ? b.simpler
                        : b.show === 'example' && b.example
                          ? b.example
                          : b.explanation}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>,
          document.body
        )
      : null;

  const viewerOverlay = viewingDoc ? (
    <Suspense fallback={null}>
      <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />
    </Suspense>
  ) : null;

  // ---------- Edit Mode ----------
  if (mode === 'edit') {
    return (
      <>
        <EditModeView
          title={title}
          onTitleChange={handleTitleChange}
          subject={subject}
          onSubjectChange={handleSubjectChange}
          body={body}
          onBodyChange={handleBodyChange}
          textareaRef={textareaRef}
          images={images}
          onAddImage={addImage}
          onRemoveImage={removeImage}
          files={files}
          onAddFile={addFileAttachment}
          onRemoveFile={removeFileAttachment}
          onViewFile={openDocumentMeta}
          onAppendText={appendTextToNote}
          onOcrScan={handleOcrScan}
          ocrBusy={ocrBusy}
          isScanning={isScanning}
          onCancelScan={() => scanAbortRef.current?.abort()}
          scanError={scanError}
          saveState={saveState}
          canUndo={undoMeta.canUndo}
          canRedo={undoMeta.canRedo}
          onUndo={undo}
          onRedo={redo}
          onBackToList={handleBackFromEdit}
          onSaveOnly={handleSaveOnly}
          onSaveAndExplain={handleSaveAndExplain}
          onApplyTemplate={handleApplyTemplate}
          onSaveFlashcards={handleSaveOfflineFlashcards}
          onMoveToFolder={handleMove}
          onOpenRelatedNote={async targetId => {
            const target = await getNote(targetId);
            if (target) onOpenNote?.(target);
          }}
          noteMode={activeNoteMode}
          currentNoteId={note.id}
          currentFolderId={folderId}
        />
        {viewerOverlay}
      </>
    );
  }

  // ---------- Read Mode ----------
  const lines = body.split('\n');
  const blockByLine = {};
  blocks.forEach(b => {
    const m = /^line-(\d+)$/.exec(b.id);
    if (!m) return;
    const n = parseInt(m[1], 10) - 1;
    if (n >= 0 && n < lines.length && b.text === lines[n]) blockByLine[n] = b;
  });

  const lineHasExpl = i => {
    const b = blockByLine[i];
    return Boolean(b && !b._failed && (b.explanation || b.simpler || b.example));
  };
  const lineMistake = i => blockByLine[i]?.mistake || null;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="screen screen-paper">
      {/* Sleek decluttered Read header — fits cleanly on 360px phones */}
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBackToList}
          aria-label="Back to notes list"
        >
          <ChevronLeft size={20} /> Notes
        </button>

        <div className="flex items-center gap-6">
          <button
            type="button"
            className={`navbar-btn${drawMode ? ' navbar-btn-active' : ''}`}
            onClick={() => {
              setDrawMode(m => {
                if (!m) setPanelOpen(false);
                return !m;
              });
            }}
            aria-label="Annotate note"
            title="Annotate / Draw"
          >
            <PenTool size={18} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            onClick={() => setMode('edit')}
            aria-label="Edit note"
            title="Edit note"
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            onClick={() => setMoreOpen(true)}
            aria-label="More options"
            title="More actions"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      {scanError && (
        <div className="inline-mistake" style={{ margin: '8px var(--gutter) 0' }}>
          {scanError}
        </div>
      )}

      <div className={`editor${drawMode ? ' draw-padding' : !isZeroAi ? ' read-mode-pad-dock' : ''}`}>
        <div className="note-page-wrap">
          <div className="read-title">{title || 'New Note'}</div>
          <div className="read-meta-row">
            <button
              type="button"
              className="folder-chip"
              onClick={() => setMoveOpen(true)}
              aria-label="Move to folder"
            >
              <Folder size={13} />
              {folderLabel || 'Folder'}
              <ChevronRight size={13} />
            </button>
            <span className="meta-pill">
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
              {subject && subject !== folderLabel ? ` · ${subject}` : ''}
            </span>
            {isZeroAi && (
              <span className="mode-badge mode-vault" title="100% Local · No AI can read or touch this note">
                🔒 Zero-AI Vault
              </span>
            )}
          </div>

          {/* AI Summary card */}
          {!isZeroAi && (summary || summarizing) && (
            <div className="summary-card">
              <div className="summary-head">
                <span className="summary-label">
                  <Sparkles size={13} /> AI Summary
                </span>
                {!summarizing && (
                  <button
                    type="button"
                    className="summary-regen"
                    onClick={() => handleSummarize(true)}
                    aria-label="Regenerate summary"
                    title="Regenerate summary"
                  >
                    <RotateCw size={14} />
                  </button>
                )}
              </div>
              {summarizing && !summary ? (
                <div className="scan-indicator" style={{ padding: '4px 0' }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Summarizing…
                </div>
              ) : (
                <MarkdownContent text={summary} />
              )}
            </div>
          )}

          {!isZeroAi && !summary && !summarizing && body.trim() && (
            <button
              type="button"
              className="summarize-chip"
              onClick={() => handleSummarize(false)}
            >
              <Sparkles size={14} /> Summarize this note
            </button>
          )}

          {/* Images strip (tap to zoom, Explain Photo, or OCR!) */}
          {images.length > 0 && (
            <ImageStrip
              images={images}
              readOnly
              noteContext={body}
              subject={subject}
              onAppendText={appendTextToNote}
              zeroAi={isZeroAi}
            />
          )}

          {files.length > 0 && (
            <FileAttachmentStrip files={files} onOpenFile={openDocumentMeta} />
          )}

          {/* Note Lines (groups fenced code blocks & Markdown tables cleanly while preserving per-line AI explanations) */}
          <div className="note-lines" ref={noteLinesRef}>
            {groupNoteLines(lines).map(seg => {
              if (seg.type === 'code') {
                return (
                  <CodeBlockCard
                    key={`code-${seg.startLine}`}
                    lang={seg.lang}
                    code={seg.code}
                    noteContext={`${title} (${subject})`}
                    zeroAi={isZeroAi}
                  />
                );
              }
              if (seg.type === 'table') {
                return (
                  <MarkdownTableBlock
                    key={`tbl-${seg.startLine}`}
                    headers={seg.headers}
                    rows={seg.rows}
                    onWikiLinkTap={handleWikiLinkTap}
                  />
                );
              }
              return (
                <NoteLineComponent
                  key={seg.index}
                  i={seg.index}
                  lines={lines}
                  blockByLine={blockByLine}
                  lineHasExpl={lineHasExpl}
                  lineMistake={lineMistake}
                  onLineTap={handleLineTap}
                  onToggleChecklist={toggleChecklist}
                  applyCorrection={applyCorrection}
                  dismissMistake={dismissMistake}
                  dismissed={dismissed}
                  showHint={showHint}
                  onWikiLinkTap={handleWikiLinkTap}
                />
              );
            })}
          </div>

          {backlinks.length > 0 && (
            <div className="backlinks-card">
              <div className="settings-label" style={{ marginBottom: 6 }}>
                Linked from ({backlinks.length})
              </div>
              {backlinks.map(bl => (
                <button
                  key={bl.id}
                  type="button"
                  className="backlink-row"
                  onClick={async () => {
                    const target = await getNote(bl.id);
                    if (target) onOpenNote?.(target);
                  }}
                >
                  <div className="flex items-center justify-between gap-6">
                    <span style={{ fontWeight: 650, fontSize: 14 }}>{bl.title}</span>
                    <ArrowUpRight size={14} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} />
                  </div>
                  {bl.snippet && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {bl.snippet}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {(drawMode || drawings.strokes.length > 0) && (
            <StrokeLayer
              drawing={drawings}
              editable={drawMode}
              tool={tool}
              color={activeDrawColor}
              size={size}
              opacity={activeDrawOpacity}
              onChange={updateDrawings}
            />
          )}
        </div>
      </div>

      {selectionSnippet && !panelOpen && !isZeroAi && !drawMode && (
        <button
          type="button"
          className="fab explain-sel-fab"
          onMouseDown={e => e.preventDefault()}
          onClick={handleExplainSelection}
        >
          <Sparkles size={15} /> Explain Selection
        </button>
      )}

      {![isZeroAi, drawMode, panelOpen, chatOpen, audioOpen, moreOpen, exportOpen, selectionSnippet].some(Boolean) && (
        <div className="study-dock-float" role="toolbar" aria-label="Note study tools">
          <button
            type="button"
            className={`study-dock-btn${explBlocks.length > 0 ? ' is-primary' : ''}`}
            disabled={isScanning}
            onClick={() => {
              if (explBlocks.length > 0) {
                setSelectedLineId(explBlocks[0].id);
                setPanelOpen(true);
              } else {
                handleSaveAndExplain();
              }
            }}
            title={explBlocks.length > 0 ? 'View line explanations' : `Explain note (${activeModeMeta.actionLabel})`}
          >
            <Sparkles size={15} />
            <span>{isScanning ? 'Scanning…' : 'Explain'}</span>
          </button>
          <button
            type="button"
            className="study-dock-btn"
            onClick={() => setChatOpen(true)}
            title="Ask AI about this note"
          >
            <MessageSquare size={15} />
            <span>Chat</span>
          </button>
          <button
            type="button"
            className="study-dock-btn"
            onClick={onOpenStudy}
            title="Study mode (Cards, Quiz, Blanks, Practice)"
          >
            <GraduationCap size={16} />
            <span>Study</span>
          </button>
          <button
            type="button"
            className="study-dock-btn"
            onClick={() => setAudioOpen(true)}
            title="Listen to note (Read Aloud / 2-Voice Study Podcast)"
          >
            <Headphones size={15} />
            <span>Audio</span>
          </button>
        </div>
      )}

      {drawMode && (
        <AnnotateBar
          tool={tool}
          onTool={setTool}
          size={size}
          onSize={setSize}
          color={activeDrawColor}
          onColor={handleSetDrawColor}
          opacity={activeDrawOpacity}
          onOpacity={handleSetDrawOpacity}
          canUndo={strokeUndo.length > 0}
          canRedo={strokeRedo.length > 0}
          hasStrokes={drawings.strokes.length > 0}
          onUndo={handleStrokeUndo}
          onRedo={handleStrokeRedo}
          onClear={handleStrokeClear}
          onDone={() => setDrawMode(false)}
        />
      )}

      <SlideUpPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        blocks={blocks}
        selectedLineId={selectedLineId}
        onSelectLine={setSelectedLineId}
        onExplainSimpler={id => handleLineRequest(id, 'simpler')}
        onGiveExample={id => handleLineRequest(id, 'example')}
        onShowOriginal={handleShowOriginal}
        onApplyCorrection={applyCorrection}
        onDismissMistake={dismissMistake}
        dismissed={dismissed}
        busyLineId={busyLine}
      />

      {/* More Actions Sheet */}
      {moreOpen && (
        <div className="export-overlay" onClick={() => setMoreOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">{title || 'Note Options'}</div>

            {isZeroAi ? (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-hover)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  marginBottom: 12,
                  lineHeight: 1.4,
                }}
              >
                <strong>🔒 Zero-AI Vault Record</strong> — Stored 100% locally. All AI models, chat, and background study scanners are disabled for this note.
              </div>
            ) : (
              <>
                <div className="settings-label" style={{ marginBottom: 6 }}>
                  AI Mode ({noteModeOverride ? activeModeMeta.label : `Folder: ${getModeMeta(folderMode).label}`})
                </div>
                <div className="mode-picker-row" style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className={`mode-pick-chip${!noteModeOverride ? ' active' : ''}`}
                    onClick={() => handleSetNoteMode('')}
                  >
                    Auto
                  </button>
                  {NOTE_MODE_LIST.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className={`mode-pick-chip${noteModeOverride === m.id ? ' active' : ''}`}
                      onClick={() => handleSetNoteMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {!isZeroAi && onOpenExamPaper && activeNoteMode !== 'journal' && (
              <button
                type="button"
                className="export-btn"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenExamPaper({ ...note, title, body, subject });
                }}
              >
                <FileSpreadsheet size={18} /> Build Exam Paper (Bond Paper)
              </button>
            )}

            <button
              type="button"
              className="export-btn"
              onClick={() => {
                setMoreOpen(false);
                setExportOpen(true);
              }}
            >
              <Share2 size={18} /> Share & Export PDF
            </button>
            {!isZeroAi && (
              <button
                type="button"
                className="export-btn"
                onClick={() => {
                  setMoreOpen(false);
                  handleSaveAndExplain();
                }}
              >
                <Sparkles size={18} /> Re-scan ({activeModeMeta.actionLabel})
              </button>
            )}
            {!isZeroAi && body.trim() && (
              <button
                type="button"
                className="export-btn"
                disabled={relatedBusy}
                onClick={() => {
                  setMoreOpen(false);
                  handleRelated();
                }}
              >
                <Link2 size={18} /> {relatedBusy ? 'Finding related notes…' : 'Find related notes'}
              </button>
            )}
            <button type="button" className="export-btn" onClick={handleTogglePin}>
              {pinned ? <PinOff size={18} /> : <Pin size={18} />}
              {pinned ? 'Unpin note' : 'Pin note'}
            </button>
            <button
              type="button"
              className="export-btn"
              onClick={() => {
                setMoreOpen(false);
                setMoveOpen(true);
              }}
            >
              <FolderInput size={18} /> Move to folder…
            </button>
            <button type="button" className="export-btn" onClick={handleDuplicate}>
              <Copy size={18} /> Duplicate note
            </button>
            {!isZeroAi && (
              <button type="button" className="export-btn" onClick={handleSaveAsTemplate}>
                <LayoutTemplate size={18} /> Save as Personal Template
              </button>
            )}
            <button type="button" className="export-btn danger" onClick={handleDeleteNote}>
              <Trash2 size={18} /> Delete note
            </button>
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setMoreOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Share & Export Sheet */}
      {exportOpen && (
        <div className="export-overlay" onClick={() => setExportOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Share & Export</div>
            <button type="button" className="export-btn" onClick={handleShareText}>
              <Share2 size={18} /> Share note as text
            </button>
            {!isZeroAi && (
              <button
                type="button"
                className="export-btn"
                onClick={() => {
                  setExportOpen(false);
                  setBaiDropOpen(true);
                }}
              >
                <FileDown size={18} /> BaiDrop Offline Share (.bai / Code)
              </button>
            )}
            <button type="button" className="export-btn" onClick={handleCopyText}>
              <ClipboardCopy size={18} /> Copy note text
            </button>

            <div style={{ margin: '10px 0 8px' }}>
              <div className="settings-label" style={{ marginBottom: 6 }}>
                PDF Design ({pdfStyle === 'auto'
                  ? `Auto: ${PDF_STYLES.find(p => p.id === detectPdfStyle({ title, body, noteMode: activeNoteMode }))?.label || 'Academic'}`
                  : PDF_STYLES.find(p => p.id === pdfStyle)?.label})
              </div>
              <div className="pdf-style-grid" role="radiogroup" aria-label="Choose PDF layout style">
                {PDF_STYLES.map(st => {
                  const pv = st.preview || {};
                  const active = pdfStyle === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`pdf-style-card${active ? ' active' : ''}`}
                      onClick={() => setPdfStyle(st.id)}
                    >
                      <div
                        className={`pdf-thumb${pv.cols === 2 ? ' is-two-col' : ''}${pv.minimal ? ' is-minimal' : ''}`}
                        style={{ background: pv.paper || '#fff' }}
                        aria-hidden="true"
                      >
                        <div className="pdf-thumb-head" style={{ background: pv.header || '#1e3a8a' }} />
                        {pv.cols === 2 ? (
                          <div className="pdf-thumb-cols">
                            <div>
                              <span style={{ background: pv.accent }} />
                              <i /><i />
                            </div>
                            <div>
                              <span style={{ background: pv.accent }} />
                              <i /><i />
                            </div>
                          </div>
                        ) : (
                          <div className="pdf-thumb-lines">
                            <span style={{ width: '78%' }} />
                            <span style={{ width: '56%' }} />
                            <div
                              className="pdf-thumb-box"
                              style={{
                                background: pv.darkCode ? '#111827' : pv.minimal ? 'transparent' : '#e2e8f0',
                                borderColor: pv.minimal ? '#888' : pv.accent,
                              }}
                            />
                            <span style={{ width: '68%' }} />
                          </div>
                        )}
                      </div>
                      <span className="pdf-style-name">{st.label}</span>
                      <span className="pdf-style-tag">{st.tagline}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="export-btn"
              disabled={exporting}
              onClick={() => handleExportPDF(false, false)}
            >
              <FileDown size={18} /> {exporting ? 'Building PDF…' : isNative ? 'Export & Share PDF' : 'Export PDF'}
            </button>
            {isNative && (
              <button
                type="button"
                className="export-btn"
                disabled={exporting}
                onClick={() => handleExportPDF(false, true)}
              >
                <FileDown size={18} /> Save PDF to Phone Documents
              </button>
            )}
            {explBlocks.length > 0 && (
              <button
                type="button"
                className="export-btn"
                disabled={exporting}
                onClick={() => handleExportPDF(true, false)}
              >
                <FileDown size={18} />{' '}
                {exporting ? 'Building PDF…' : 'Export PDF with AI explanations'}
              </button>
            )}
            {!isNative && (
              <button
                type="button"
                className="export-btn"
                onClick={() => handlePrintPdf(false)}
              >
                <Printer size={18} /> Print / system PDF
              </button>
            )}
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setExportOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {moveOpen && (
        <Suspense fallback={null}>
          <FolderPickerSheet
            currentId={folderId}
            onPick={handleMove}
            onClose={() => setMoveOpen(false)}
          />
        </Suspense>
      )}

      {relatedOpen && (
        <div className="export-overlay" onClick={() => setRelatedOpen(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-title">Related notes</div>
            {related === null && (
              <div className="scan-indicator">
                <span className="spinner" /> Looking through this folder…
              </div>
            )}
            {related && related.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-text">No closely related notes found in this folder.</div>
              </div>
            )}
            {related &&
              related.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="export-btn"
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}
                  onClick={async () => {
                    setRelatedOpen(false);
                    const full = await getNote(r.id);
                    if (full) onOpenNote?.(full);
                  }}
                >
                  <span className="flex items-center gap-6" style={{ fontWeight: 600 }}>
                    <FileText size={16} /> {r.title || 'New Note'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.reason}</span>
                </button>
              ))}
            <button
              type="button"
              className="export-btn cancel"
              onClick={() => setRelatedOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* FIXED: passes live chatMsgs React state so closing & reopening Chat never loses messages */}
      {chatOpen && (
        <Suspense fallback={null}>
          <ChatSheet
            note={{ ...note, body, title, subject, chat: chatMsgs }}
            subject={subject}
            noteMode={activeNoteMode}
            onClose={() => setChatOpen(false)}
            onAppendToNote={text => {
              appendTextToNote(text);
              toast('Added to note', { type: 'success' });
            }}
            onCreateNoteFromChat={async (questionTitle, content, sources = []) => {
              const citationsBlock = sources?.length
                ? '\n\n## Sources\n' +
                  sources.map(s => `- [${s.index}] [${s.title}](${s.url})`).join('\n')
                : '';
              const created = await createNote(
                folderId,
                String(questionTitle || 'Research Note').slice(0, 64),
                `${content}${citationsBlock}`,
                subject
              );
              setChatOpen(false);
              toast('Saved as a new note', { type: 'success' });
              onNoteChanged?.();
              onOpenNote?.(created);
            }}
            onSave={async msgs => {
              setChatMsgs(msgs);
              await updateNote(note.id, { chat: msgs });
            }}
          />
        </Suspense>
      )}

      {!isZeroAi && audioOpen && (
        <Suspense fallback={null}>
          <AudioStudySheet
            open={audioOpen}
            onClose={() => setAudioOpen(false)}
            mode="note"
            title={title}
            body={body}
            subject={subject}
          />
        </Suspense>
      )}

      {!isZeroAi && baiDropOpen && (
        <Suspense fallback={null}>
          <BaiDropSheet
            open={baiDropOpen}
            onClose={() => setBaiDropOpen(false)}
            note={{ ...note, title, body, subject, flashcards, quiz }}
            folderName={folderLabel || subject || 'Shared'}
          />
        </Suspense>
      )}

      {viewerOverlay}
      {printPortal}
    </div>
  );
}
