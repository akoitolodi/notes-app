/**
 * NoteEditor — modular orchestrator for Edit Mode, Read Mode, AI explanations,
 * Chat, Annotations (with Undo/Redo/Clear), Images, Export/PDF, and Note actions.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { scanNote } from '../api/scan';
import { scanLine } from '../api/scanLine';
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
  diffAndRemapBlocks,
} from '../store/db';
import StrokeLayer, { renderStrokesToCanvas } from './StrokeLayer';
import ImageStrip, { pickImage, compressImage } from './ImageManager';
import ChatSheet from './ChatSheet';
import { summarizeNote, ocrImage, findRelatedNotes } from '../lib/aiFeatures';
import { instantiateTemplate } from '../lib/templates';
import SlideUpPanel from './SlideUpPanel';
import FolderPickerSheet from './FolderPickerSheet';
import { NoteLine as NoteLineComponent } from './InlineComponents';
import EditModeView from './editor/EditModeView';
import AnnotateBar from './editor/AnnotateBar';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';
import { isDarkTheme, HINT_KEY } from '../theme';

function normalizeDrawings(d) {
  if (Array.isArray(d)) return { refWidth: 0, strokes: d };
  if (d && Array.isArray(d.strokes)) return d;
  return { refWidth: 0, strokes: [] };
}

export default function NoteEditor({
  note,
  initialMode = null,
  folderName,
  onOpenStudy,
  onBackToList,
  onOpenNote,
  onNoteMoved,
  onNoteDeleted,
  onNoteChanged,
  onRegisterBack,
}) {
  const { confirm, toast } = useDialog();

  const [mode, setMode] = useState(() => initialMode || (noteHasContent(note) ? 'read' : 'edit'));
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
  const [pinned, setPinned] = useState(Boolean(note?.pinned));
  const [blocks, setBlocks] = useState(note?.blocks || []);
  const [flashcards, setFlashcards] = useState(note?.flashcards || []);
  const [quiz, setQuiz] = useState(note?.quiz || []);
  const [chatMsgs, setChatMsgs] = useState(note?.chat || []);
  const [images, setImages] = useState(note?.images || []);
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
  const [dismissed, setDismissed] = useState(() => {
    const map = {};
    (note?.blocks || []).forEach(b => {
      if (b.mistakeIgnored) map[b.id] = true;
    });
    return map;
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  // Draw mode state — defaults to adaptive ink (#ffffff in Dark, #000000 in Light)
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(() => (isDarkTheme() ? '#ffffff' : '#000000'));
  const [size, setSize] = useState('medium');

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
        // Keep existing explanations remapped onto moved lines during edits
        const { remappedBlocks } = diffAndRemapBlocks(blocks, savedRef.current.body, body);
        await updateNote(note.id, { title, body, subject, blocks: remappedBlocks });
        savedRef.current = { title, body, subject };
        setBlocks(remappedBlocks);
        setSaveState('saved');
        onNoteChanged?.({ title, body, subject, blocks: remappedBlocks });
      } catch {
        setSaveState('dirty');
      }
    }, 700);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [mode, title, body, subject, note.id, blocks, onNoteChanged]);

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
      if (drawMode) {
        setDrawMode(false);
        return true;
      }
      return false;
    });
    return () => onRegisterBack(null);
  }, [onRegisterBack, chatOpen, panelOpen, moreOpen, exportOpen, moveOpen, relatedOpen, drawMode]);

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
    onNoteChanged?.({ title, body, subject, blocks: remappedBlocks, images, drawings });
    return remappedBlocks;
  }, [note.id, title, body, subject, blocks, images, drawings, onNoteChanged]);

  const handleBackFromEdit = useCallback(async () => {
    await persistCurrentText();
    onBackToList?.();
  }, [persistCurrentText, onBackToList]);

  const handleSaveOnly = useCallback(async () => {
    await persistCurrentText();
    setMode('read');
  }, [persistCurrentText]);

  const handleSaveAndExplain = useCallback(async () => {
    if (!body.trim() && !title.trim()) {
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
      const result = await scanNote(body, subject, linesToScan, { signal: controller.signal });
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

  /** Tap ANY line in Read Mode: show explanation or fetch on demand (retryable if failed). */
  const handleLineTap = useCallback(
    async (block, lineIdx) => {
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
        const result = await scanNote(body, subject, [lineIdx + 1]);
        const fresh = (result.blocks || []).find(b => b.id === id);
        if (fresh) {
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
                ? { ...b, explanation: 'The AI had no extra explanation for this line.', _failed: true }
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
    [body, subject, note.id, busyLine, toast]
  );

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

  const handleExportPDF = async withExpl => {
    setExportOpen(false);
    setExporting(true);
    try {
      const { buildNotePDF, saveNotePDF } = await import('../lib/pdf');
      const doc = await buildNotePDF({
        title: title || 'New Note',
        body,
        blocks,
        images,
        drawings,
        withExplanations: withExpl,
      });
      const how = await saveNotePDF(doc, title || 'note');
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
    const resolvedImgs = [];
    for (const img of images) {
      const url = await resolveImageDataUrl(img);
      if (url) resolvedImgs.push({ id: img.id, dataUrl: url });
    }
    const drawingPreview = renderStrokesToCanvas(drawings, 620, { dark: false });
    setPrintPayload({
      title: title || 'New Note',
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
          <div className="print-root">
            <h1 className="print-title">{printPayload.title}</h1>
            <div className="print-meta">
              {new Date().toLocaleDateString([], {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
            {printPayload.images.length > 0 && (
              <div className="print-images">
                {printPayload.images.map(img => (
                  <img key={img.id} src={img.dataUrl} alt="Note attachment" />
                ))}
              </div>
            )}
            <div className="print-body">
              {printPayload.body.split('\n').map((l, i) => (
                <p key={i} className="print-line">
                  {l || '\u00A0'}
                </p>
              ))}
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

  // ---------- Edit Mode ----------
  if (mode === 'edit') {
    return (
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
      />
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
            className="navbar-btn"
            onClick={() => setChatOpen(true)}
            aria-label="Chat with this note"
            title="Ask AI about this note"
          >
            <MessageSquare size={19} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            onClick={onOpenStudy}
            aria-label="Study mode"
            title="Study mode (Cards, Quiz, Blanks, Practice)"
          >
            <GraduationCap size={20} />
          </button>
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

      <div className={`editor${drawMode ? ' draw-padding' : ''}`}>
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
          </div>

          {/* AI Summary card */}
          {(summary || summarizing) && (
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

          {!summary && !summarizing && body.trim() && (
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
            />
          )}

          {/* Note Lines */}
          <div className="note-lines">
            {lines.map((_, i) => (
              <NoteLineComponent
                key={i}
                i={i}
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
              />
            ))}
          </div>

          {body.trim() && (
            <button
              type="button"
              className="related-trigger"
              onClick={handleRelated}
              disabled={relatedBusy}
            >
              {relatedBusy ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Finding related notes…
                </>
              ) : (
                <>
                  <Link2 size={16} /> Find related notes
                </>
              )}
            </button>
          )}

          {(drawMode || drawings.strokes.length > 0) && (
            <StrokeLayer
              drawing={drawings}
              editable={drawMode}
              tool={tool}
              color={color}
              size={size}
              onChange={updateDrawings}
            />
          )}
        </div>
      </div>

      {drawMode && (
        <AnnotateBar
          tool={tool}
          onTool={setTool}
          size={size}
          onSize={setSize}
          color={color}
          onColor={setColor}
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
            <button
              type="button"
              className="export-btn"
              onClick={() => {
                setMoreOpen(false);
                handleSaveAndExplain();
              }}
            >
              <Sparkles size={18} /> Re-scan with AI
            </button>
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
            <button type="button" className="export-btn" onClick={handleCopyText}>
              <ClipboardCopy size={18} /> Copy note text
            </button>
            <button
              type="button"
              className="export-btn"
              disabled={exporting}
              onClick={() => handleExportPDF(false)}
            >
              <FileDown size={18} /> {exporting ? 'Building PDF…' : 'Export PDF'}
            </button>
            {explBlocks.length > 0 && (
              <button
                type="button"
                className="export-btn"
                disabled={exporting}
                onClick={() => handleExportPDF(true)}
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
        <FolderPickerSheet
          currentId={folderId}
          onPick={handleMove}
          onClose={() => setMoveOpen(false)}
        />
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
        <ChatSheet
          note={{ ...note, body, title, subject, chat: chatMsgs }}
          subject={subject}
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
      )}

      {printPortal}
    </div>
  );
}
