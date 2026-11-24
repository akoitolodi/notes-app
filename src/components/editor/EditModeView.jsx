/**
 * EditModeView — focused writing view with:
 * - Debounced auto-save status indicator ("Saved" / "Saving…")
 * - Clear separation: "Done" (instant offline save → Read) vs "Explain" (AI scan + Cancel)
 * - Floating mobile formatting & attachment bar (Checklist, Heading, Bold, Bullet,
 *   Code, LaTeX Math $…$, Camera, Gallery, OCR Scan)
 * - Working Undo/Redo with disabled states + Ctrl/Cmd+S shortcut
 */
import { useEffect, useState, useRef } from 'react';
import {
  ChevronLeft,
  Undo2,
  Redo2,
  Sparkles,
  Check,
  X,
  CheckSquare,
  Heading2,
  Bold,
  List,
  Code,
  Sigma,
  Camera,
  Image as ImageIcon,
  Paperclip,
  ScanText,
  LayoutTemplate,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  Wand2,
  SpellCheck,
  Link2,
  PlusSquare,
  Zap,
  ZapOff,
} from 'lucide-react';
import ImageStrip, { pickImage, compressImage } from '../ImageManager';
import FileAttachmentStrip from '../FileAttachmentStrip';
import TemplatePickerSheet from '../TemplatePickerSheet';
import InsertBlockSheet from './InsertBlockSheet';
import SmartDetectBar from './SmartDetectBar';
import CleanRichEditor from './CleanRichEditor';
import {
  isSmartDetectEnabled,
  setSmartDetectEnabled,
} from '../../lib/smartNoteDetect';
import {
  DICTATION_LANGS,
  createDictationSession,
} from '../../lib/voiceDictation';
import { cleanDictation, polishWritingWithAI } from '../../lib/aiFeatures';
import { runGrammarCheck, applyGrammarFix } from '../../lib/grammarCheck';
import { analyzeWritingCraft, applySafeWordyFix } from '../../lib/writingCoach';
import { getModeMeta, isZeroAiMode } from '../../lib/noteModes';
import { db, getHiddenLockedFolderIds, getZeroAiFolderIds } from '../../store/db';
import { useDialog } from '../ui/DialogProvider';

export default function EditModeView({
  title,
  onTitleChange,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  textareaRef,
  images,
  onAddImage,
  onRemoveImage,
  files = [],
  onAddFile = null,
  onRemoveFile = null,
  onViewFile = null,
  onAppendText,
  onOcrScan,
  ocrBusy,
  isScanning,
  onCancelScan,
  scanError,
  saveState, // 'saved' | 'saving' | 'dirty'
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBackToList,
  onSaveOnly,
  onSaveAndExplain,
  onApplyTemplate = null,
  onSaveFlashcards = null,
  onMoveToFolder = null,
  onOpenRelatedNote = null,
  noteMode = 'study',
  currentNoteId = null,
  currentFolderId = null,
}) {
  const { toast } = useDialog();
  const modeMeta = getModeMeta(noteMode);
  const isZeroAi = isZeroAiMode(noteMode);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [blockSheetOpen, setBlockSheetOpen] = useState(false);
  const [smartDetectOn, setSmartDetectOn] = useState(() => isSmartDetectEnabled());

  const handleToggleSmartDetect = nextVal => {
    const val = typeof nextVal === 'boolean' ? nextVal : !smartDetectOn;
    setSmartDetectOn(val);
    setSmartDetectEnabled(val);
    toast(val ? 'Smart Blank-Note Auto-Detect ON' : 'Smart Auto-Detect muted (tap ⚡ in toolbar to re-enable)');
  };

  // Clean visual edit mode (default — zero raw ## or ** clutter!) vs Raw Markdown mode
  const [editorMode, setEditorMode] = useState(() => {
    try {
      return localStorage.getItem('aicn:editStyle') === 'raw' ? 'raw' : 'clean';
    } catch {
      return 'clean';
    }
  });
  const cleanEditorRef = useRef(null);

  const toggleEditorMode = next => {
    setEditorMode(next);
    setWikiSuggest(null);
    try {
      localStorage.setItem('aicn:editStyle', next);
    } catch {
      // ignore
    }
  };

  // [[Wiki-Link]] autocomplete state
  const [allNoteTitles, setAllNoteTitles] = useState([]);
  const [wikiSuggest, setWikiSuggest] = useState(null); // { query, startIdx, cursorIdx }

  // Writing & Grammar Polish tray state
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [grammarBusy, setGrammarBusy] = useState(false);
  const [grammarResult, setGrammarResult] = useState(null);
  const [grammarError, setGrammarError] = useState('');
  const [polishBusy, setPolishBusy] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([db.notes.toArray(), getHiddenLockedFolderIds(), getZeroAiFolderIds()])
      .then(([allNotes, hiddenIds, zeroAiIds]) => {
        if (!live) return;
        const titles = allNotes
          .filter(
            n =>
              n &&
              !n.trashed &&
              n.id !== currentNoteId &&
              !hiddenIds.has(n.folderId) &&
              !zeroAiIds.has(n.folderId) &&
              n.mode !== 'vault' &&
              (n.title || '').trim()
          )
          .map(n => n.title.trim());
        setAllNoteTitles([...new Set(titles)].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [currentNoteId]);

  const detectWikiTrigger = (val, cursorPos) => {
    const before = String(val || '').slice(0, cursorPos);
    const m = /\[\[([^[\]\n]*)$/.exec(before);
    if (!m) {
      setWikiSuggest(null);
      return;
    }
    setWikiSuggest({
      query: m[1].toLowerCase(),
      startIdx: before.length - m[0].length,
      cursorIdx: cursorPos,
    });
  };

  const insertWikiSuggestion = targetTitle => {
    if (!wikiSuggest) return;
    if (wikiSuggest.isCleanMode) {
      cleanEditorRef.current?.insertWikiTitle(targetTitle);
      setWikiSuggest(null);
      return;
    }
    const { startIdx, cursorIdx } = wikiSuggest;
    const next = `${body.slice(0, startIdx)}[[${targetTitle}]]${body.slice(cursorIdx)}`;
    onBodyChange(next);
    setWikiSuggest(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = startIdx + targetTitle.length + 4;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleRunGrammar = async () => {
    if (!body.trim() || grammarBusy) return;
    setGrammarOpen(true);
    setGrammarBusy(true);
    setGrammarError('');
    try {
      const res = await runGrammarCheck(body);
      setGrammarResult(res);
    } catch (e) {
      setGrammarError(e?.message || 'Grammar check failed');
    } finally {
      setGrammarBusy(false);
    }
  };

  const handleApplyGrammarIssue = (issue, replacement) => {
    const updated = applyGrammarFix(body, issue, replacement);
    if (updated !== body) {
      onBodyChange(updated);
      setGrammarResult(prev =>
        prev ? { ...prev, issues: prev.issues.filter(x => x.id !== issue.id) } : prev
      );
      toast('Applied grammar fix');
    }
  };

  const handleAiPolish = async goal => {
    if (!body.trim() || polishBusy) return;
    setPolishBusy(goal);
    setGrammarError('');
    try {
      const revised = await polishWritingWithAI({ text: body, goal, subject });
      if (revised) {
        onBodyChange(revised);
        setGrammarResult(null);
        toast('Polished — tap Undo anytime to revert', { type: 'success' });
      }
    } catch (e) {
      setGrammarError(e?.message || 'AI polish failed');
    } finally {
      setPolishBusy('');
    }
  };

  // Voice-to-Notes dictation state
  const [dictState, setDictState] = useState('idle'); // 'idle' | 'listening' | 'paused'
  const [dictLang, setDictLang] = useState('');
  const [interimText, setInterimText] = useState('');
  const [dictError, setDictError] = useState(null);
  const [hasDictated, setHasDictated] = useState(false);
  const [cleaningVoice, setCleaningVoice] = useState(false);

  const bodyRef = useRef(body);
  const onBodyChangeRef = useRef(onBodyChange);
  const dictSessionRef = useRef(null);
  const cleanAbortRef = useRef(null);
  const docInputRef = useRef(null);

  const handleDocPick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onAddFile) return;
    try {
      await onAddFile(file);
    } catch (err) {
      toast(err?.message || 'Could not attach document', { type: 'error' });
    }
  };

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  useEffect(() => {
    onBodyChangeRef.current = onBodyChange;
  }, [onBodyChange]);

  useEffect(() => {
    return () => {
      dictSessionRef.current?.stop();
      cleanAbortRef.current?.abort();
    };
  }, []);

  const appendDictatedChunk = chunk => {
    const clean = String(chunk || '').trim();
    if (!clean) return;
    const cur = bodyRef.current || '';
    const sep = !cur ? '' : /[\s\n]$/.test(cur) ? '' : ' ';
    const next = cur + sep + clean;
    bodyRef.current = next;
    onBodyChangeRef.current(next);
    setHasDictated(true);
  };

  const handleToggleDictation = async () => {
    if (dictState !== 'idle') {
      dictSessionRef.current?.stop();
      return;
    }
    setDictError(null);
    const session = createDictationSession({
      lang: dictLang,
      onInterim: setInterimText,
      onFinal: appendDictatedChunk,
      onError: msg => setDictError(msg),
      onStateChange: setDictState,
    });
    dictSessionRef.current = session;
    await session.start();
  };

  const handleCleanDictation = async () => {
    const raw = (bodyRef.current || '').trim();
    if (!raw || cleaningVoice) return;
    dictSessionRef.current?.stop();
    const controller = new AbortController();
    cleanAbortRef.current = controller;
    setCleaningVoice(true);
    setDictError(null);
    try {
      const cleaned = await cleanDictation({
        transcript: raw,
        subject: subject || 'General',
        signal: controller.signal,
      });
      if (!controller.signal.aborted && cleaned) {
        bodyRef.current = cleaned;
        onBodyChange(cleaned);
        setHasDictated(false);
        toast('Transcript cleaned — tap Undo if you want the raw text back', { type: 'success' });
      }
    } catch (err) {
      if (!err?.isCancelled) {
        setDictError(`AI cleanup failed: ${err.message}`);
      }
    } finally {
      setCleaningVoice(false);
    }
  };
  // Auto-grow textarea to content height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(320, el.scrollHeight)}px`;
  }, [body, textareaRef]);

  // Keyboard shortcuts: Ctrl/Cmd+S saves instantly, Ctrl/Cmd+Shift+S runs AI Explain
  useEffect(() => {
    const onKeyDown = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) onSaveAndExplain();
        else onSaveOnly();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSaveOnly, onSaveAndExplain]);

  const insertFormat = (before, after = '', placeholder = '') => {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange((body ? body + '\n' : '') + before + placeholder + after);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || placeholder;
    const next = body.slice(0, start) + before + selected + after + body.slice(end);
    onBodyChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + selected.length;
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const insertLinePrefix = prefix => {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange((body ? body + '\n' : '') + prefix);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    onBodyChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + prefix.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handlePhotoPick = async source => {
    const picked = await pickImage(source);
    if (!picked?.dataUrl) return;
    const finalUrl = picked.alreadyCompressed
      ? picked.dataUrl
      : await compressImage(picked.dataUrl);
    onAddImage(finalUrl);
  };

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="screen screen-paper">
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
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={18} />
          </button>

          {isScanning ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onCancelScan}
            >
              <X size={15} /> Stop
            </button>
          ) : isZeroAi ? (
            <button
              type="button"
              className="btn btn-primary btn-sm btn-pill"
              onClick={onSaveOnly}
              title="Save locally without AI (Ctrl+S)"
            >
              <Check size={14} /> Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-pill"
                onClick={onSaveOnly}
                title="Save without running AI (Ctrl+S)"
              >
                Done
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm btn-pill"
                onClick={onSaveAndExplain}
                title={`Save and ${modeMeta.actionLabel.toLowerCase()} with AI (Ctrl+Shift+S)`}
              >
                <Sparkles size={14} /> {modeMeta.actionLabel}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="editor">
        {isScanning && (
          <div className="scan-indicator" style={{ paddingLeft: 0 }}>
            <span className="spinner" /> Explaining your notes with AI…
          </div>
        )}
        {scanError && (
          <div className="inline-mistake" style={{ marginBottom: 10 }}>
            {scanError}
          </div>
        )}

        {(dictState !== 'idle' || hasDictated || dictError) && (
          <div className={`dictation-bar${dictState === 'listening' ? ' is-live' : ''}`}>
            <div className="dictation-bar-top">
              <div className="dictation-status">
                {dictState === 'listening' && <span className="dictation-dot" />}
                <span>
                  {dictState === 'listening'
                    ? 'Listening…'
                    : dictState === 'paused'
                      ? 'Dictation paused'
                      : hasDictated
                        ? 'Dictation captured'
                        : 'Voice dictation'}
                </span>
              </div>
              <div className="dictation-controls">
                <select
                  className="dictation-lang"
                  aria-label="Dictation language"
                  value={dictLang}
                  onChange={e => {
                    const next = e.target.value;
                    setDictLang(next);
                    dictSessionRef.current?.setLang(next);
                  }}
                >
                  {DICTATION_LANGS.map(l => (
                    <option key={l.code || 'auto'} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                {dictState === 'listening' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => dictSessionRef.current?.pause()}
                    aria-label="Pause dictation"
                  >
                    <Pause size={13} /> Pause
                  </button>
                )}
                {dictState === 'paused' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => dictSessionRef.current?.resume()}
                    aria-label="Resume dictation"
                  >
                    <Play size={13} /> Resume
                  </button>
                )}
                {dictState !== 'idle' && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => dictSessionRef.current?.stop()}
                    aria-label="Stop dictation"
                  >
                    <Square size={12} /> Stop
                  </button>
                )}
                {dictState === 'idle' && (
                  <button
                    type="button"
                    className="navbar-btn"
                    style={{ width: 28, height: 28 }}
                    onClick={() => {
                      setHasDictated(false);
                      setDictError(null);
                    }}
                    aria-label="Dismiss dictation bar"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {interimText && (
              <div className="dictation-interim">“{interimText}…”</div>
            )}

            {dictError && (
              <div className="dictation-error">{dictError}</div>
            )}

            {!isZeroAi && (hasDictated || (dictError && body.trim())) && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={cleaningVoice || !body.trim()}
                  onClick={handleCleanDictation}
                >
                  {cleaningVoice ? (
                    <>
                      <span className="spinner" style={{ width: 13, height: 13 }} /> Cleaning transcript…
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} /> Clean transcript with AI
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="editor-meta-bar">
          <span className={`save-status${saveState === 'saved' ? ' saved' : ''}`}>
            {saveState === 'saving' ? (
              <>
                <span className="spinner" style={{ width: 11, height: 11 }} /> Saving…
              </>
            ) : saveState === 'dirty' ? (
              <>
                <span className="save-live-dot is-dirty" /> Unsaved edits
              </>
            ) : (
              <>
                <span className="save-live-dot" /> Saved offline
              </>
            )}
          </span>
          <div className="flex items-center gap-8">
            {isZeroAi && (
              <span className="mode-badge mode-vault" title="Zero-AI Vault — no AI can access this note">
                🔒 Zero-AI Vault
              </span>
            )}
            <span>
              {words} {words === 1 ? 'word' : 'words'}
            </span>
            <div className="editor-mode-pill" role="group" aria-label="Editor view mode">
              <button
                type="button"
                className={editorMode === 'clean' ? 'active' : ''}
                onClick={() => toggleEditorMode('clean')}
                title="Clean formatted writing (hides raw Markdown symbols)"
              >
                Clean
              </button>
              <button
                type="button"
                className={editorMode === 'raw' ? 'active' : ''}
                onClick={() => toggleEditorMode('raw')}
                title="Raw Markdown source"
              >
                MD
              </button>
            </div>
          </div>
        </div>

        <input
          type="text"
          className="editor-title"
          placeholder="Title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          aria-label="Note title"
        />
        <input
          type="text"
          className="editor-subject"
          placeholder="Subject"
          value={subject}
          onChange={e => onSubjectChange(e.target.value)}
          aria-label="Subject"
        />

        {onApplyTemplate && !body.trim() && (
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setTemplateSheetOpen(true)}
            >
              <LayoutTemplate size={14} /> Use a note template
            </button>
          </div>
        )}

        <ImageStrip
          images={images}
          onAdd={onAddImage}
          onRemove={onRemoveImage}
          onAppendText={onAppendText}
          noteContext={body}
          subject={subject}
          showAdd={false}
          zeroAi={isZeroAi}
        />

        <FileAttachmentStrip
          files={files}
          onOpenFile={onViewFile}
          onRemoveFile={onRemoveFile}
        />

        {!isZeroAi && grammarOpen && (
          <div className="grammar-bar">
            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <span className="flex items-center gap-6" style={{ fontSize: 13, fontWeight: 700 }}>
                <SpellCheck size={15} style={{ color: 'var(--accent-ink)' }} />
                Writing Craft &amp; Grammar Coach
              </span>
              <button
                type="button"
                className="navbar-btn"
                style={{ width: 28, height: 28 }}
                aria-label="Close grammar tray"
                onClick={() => setGrammarOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            {/* 100% Offline, Deterministic, LaTeX- & Code-Safe Style & Readability Coach */}
            {(() => {
              const craft = analyzeWritingCraft(body);
              if (craft.words === 0) return null;
              return (
                <div className="craft-panel">
                  <div className="craft-stats-row">
                    <span className="craft-pill">
                      Grade <strong>{craft.gradeLevel}</strong> · {craft.readabilityLabel}
                    </span>
                    <span className="craft-pill">
                      Rhythm <strong>{craft.rhythmScore}/100</strong>
                    </span>
                    <span className="craft-pill">
                      Avg <strong>{craft.avgWordsPerSentence}</strong> w/sent · ~{craft.readingMinutes}m read
                    </span>
                    {craft.protectedCount > 0 && (
                      <span className="craft-pill" style={{ color: 'var(--ok)' }}>
                        {craft.protectedCount} math/code block{craft.protectedCount === 1 ? '' : 's'} protected
                      </span>
                    )}
                  </div>

                  {craft.wordyFixes.length > 0 && (
                    <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                      {craft.wordyFixes.slice(0, 5).map(fix => (
                        <button
                          key={fix.phrase}
                          type="button"
                          className="tag-pill"
                          style={{ cursor: 'pointer', background: 'var(--ok-bg)', color: 'var(--ok)' }}
                          onClick={() => {
                            const updated = applySafeWordyFix(body, fix.phrase, fix.replacement);
                            if (updated !== body) {
                              onBodyChange(updated);
                              toast(`Tightened "${fix.phrase}" → "${fix.replacement}"`);
                            }
                          }}
                          title={`${fix.note} (LaTeX & code safe)`}
                        >
                          “{fix.phrase}” → “{fix.replacement}”
                        </button>
                      ))}
                    </div>
                  )}

                  {(craft.monotonousRuns.length > 0 || craft.repeatedPhrases.length > 0 || craft.passiveHits.length > 0) && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>
                      {craft.monotonousRuns.length > 0 && (
                        <div>• Rhythm: {craft.monotonousRuns.join('; ')}</div>
                      )}
                      {craft.repeatedPhrases.length > 0 && (
                        <div>
                          • Repeated phrases:{' '}
                          {craft.repeatedPhrases.map(r => `"${r.phrase}" (×${r.count})`).join(', ')}
                        </div>
                      )}
                      {craft.passiveHits.length > 0 && (
                        <div>• Passive voice check: {craft.passiveHits.slice(0, 4).join(', ')}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={grammarBusy || !body.trim()}
                onClick={handleRunGrammar}
              >
                {grammarBusy ? (
                  <>
                    <span className="spinner" style={{ width: 12, height: 12 }} /> Checking…
                  </>
                ) : (
                  <>
                    <SpellCheck size={13} /> Check Grammar (Free)
                  </>
                )}
              </button>
              {[
                ['grammar', 'AI Fix'],
                ['clearer', 'Clearer'],
                ['academic', 'Academic'],
                ['concise', 'Concise'],
              ].map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={Boolean(polishBusy) || !body.trim()}
                  onClick={() => handleAiPolish(g)}
                >
                  {polishBusy === g ? (
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                  ) : (
                    <Wand2 size={12} />
                  )}
                  {label}
                </button>
              ))}
            </div>

            {grammarError && <div className="inline-mistake">{grammarError}</div>}

            {grammarResult && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Engine: <strong>{grammarResult.engine}</strong>
                  {grammarResult.writingScore && (
                    <span className="tag-pill" style={{ marginLeft: 8 }}>
                      Grammarly Score: {JSON.stringify(grammarResult.writingScore.score ?? grammarResult.writingScore).slice(0, 48)}
                    </span>
                  )}
                </div>
                {grammarResult.notice && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {grammarResult.notice}
                  </div>
                )}
                {grammarResult.issues.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }}>
                    No grammar or spelling issues found!
                  </div>
                ) : (
                  <div className="grammar-issue-list">
                    {grammarResult.issues.slice(0, 8).map(iss => (
                      <div key={iss.id} className="grammar-issue-item">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                          “{iss.badText || '…'}” — <span style={{ fontWeight: 400 }}>{iss.message}</span>
                        </div>
                        {iss.replacements.length > 0 && (
                          <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                            {iss.replacements.map(rep => (
                              <button
                                key={rep}
                                type="button"
                                className="tag-pill"
                                style={{ cursor: 'pointer', background: 'var(--ok-bg)', color: 'var(--ok)' }}
                                onClick={() => handleApplyGrammarIssue(iss, rep)}
                              >
                                Apply “{rep}”
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {wikiSuggest && (
          <div className="wiki-suggest-tray">
            <div className="flex items-center gap-6" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <Link2 size={12} /> Link to note:
            </div>
            {(() => {
              const matches = allNoteTitles
                .filter(t => !wikiSuggest.query || t.toLowerCase().includes(wikiSuggest.query))
                .slice(0, 5);
              if (matches.length === 0) {
                return (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Type any title + <code>]]</code> to create a new link
                  </div>
                );
              }
              return (
                <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
                  {matches.map(t => (
                    <button
                      key={t}
                      type="button"
                      className="wiki-link-pill"
                      onClick={() => insertWikiSuggestion(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {editorMode === 'clean' ? (
          <CleanRichEditor
            ref={cleanEditorRef}
            value={body}
            onChange={onBodyChange}
            placeholder="Start writing…"
            onWikiDetect={setWikiSuggest}
          />
        ) : (
          <textarea
            ref={textareaRef}
            className="editor-body"
            placeholder="Start writing…"
            value={body}
            onChange={e => {
              onBodyChange(e.target.value);
              detectWikiTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyUp={e => detectWikiTrigger(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            aria-label="Note body"
            autoFocus
          />
        )}
      </div>

      {/* Smart Blank-Note Auto-Detection Strip — docked right above toolbar (hidden on plain text & Zero-AI Vault) */}
      <SmartDetectBar
        title={title}
        body={body}
        subject={subject}
        currentNoteId={currentNoteId}
        currentFolderId={currentFolderId}
        isZeroAi={isZeroAi}
        enabled={smartDetectOn}
        onToggleEnabled={handleToggleSmartDetect}
        onAppendText={text => {
          const clean = String(text || '').trim();
          if (!clean) return;
          const next = (body ? `${body.replace(/\s+$/, '')}\n\n` : '') + clean;
          onBodyChange(next);
        }}
        onReplaceBody={nextBody => onBodyChange(nextBody)}
        onSaveFlashcards={onSaveFlashcards}
        onMoveToFolder={onMoveToFolder}
        onOpenRelatedNote={onOpenRelatedNote}
      />

      {/* Mobile-friendly Formatting & Attachment Bar */}
      <div className="format-toolbar" role="toolbar" aria-label="Formatting and media">
        <button
          type="button"
          className="fmt-btn"
          onClick={() => setBlockSheetOpen(true)}
          title="Insert smart building block (table, code, math, checklist)"
          aria-label="Insert block"
        >
          <PlusSquare size={17} />
          <span>Block</span>
        </button>
        {!isZeroAi && (
          <button
            type="button"
            className={`fmt-btn${smartDetectOn ? ' active-smart' : ''}`}
            onClick={() => handleToggleSmartDetect(!smartDetectOn)}
            title={smartDetectOn ? 'Smart Auto-Detect ON (tap to mute)' : 'Smart Auto-Detect OFF (tap to enable)'}
            aria-label="Toggle Smart Auto-Detect"
          >
            {smartDetectOn ? <Zap size={16} /> : <ZapOff size={16} />}
            <span>Smart</span>
          </button>
        )}

        <span className="fmt-sep" />

        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.insertChecklist()
              : insertLinePrefix('- [ ] ')
          }
          title="Checklist"
          aria-label="Insert checklist item"
        >
          <CheckSquare size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.insertHeading()
              : insertLinePrefix('## ')
          }
          title="Heading"
          aria-label="Insert heading"
        >
          <Heading2 size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.toggleBold()
              : insertFormat('**', '**', 'bold')
          }
          title="Bold"
          aria-label="Bold"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.insertBullet()
              : insertLinePrefix('- ')
          }
          title="Bullet point"
          aria-label="Insert bullet"
        >
          <List size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.insertCode()
              : insertFormat('`', '`', 'code')
          }
          title="Inline code"
          aria-label="Insert code"
        >
          <Code size={16} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onMouseDown={e => editorMode === 'clean' && e.preventDefault()}
          onClick={() =>
            editorMode === 'clean'
              ? cleanEditorRef.current?.insertMath()
              : insertFormat('$', '$', 'E = mc^2')
          }
          title="LaTeX Math"
          aria-label="Insert math equation"
        >
          <Sigma size={16} />
        </button>

        <span className="fmt-sep" />

        <button
          type="button"
          className="fmt-btn"
          onClick={() => handlePhotoPick('camera')}
          title="Take photo"
          aria-label="Take photo"
        >
          <Camera size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => handlePhotoPick('library')}
          title="Add from gallery"
          aria-label="Add image from gallery"
        >
          <ImageIcon size={17} />
        </button>
        {onAddFile && (
          <>
            <button
              type="button"
              className="fmt-btn"
              onClick={() => docInputRef.current?.click()}
              title="Attach PDF, PowerPoint, Word, or text file"
              aria-label="Attach document"
            >
              <Paperclip size={16} />
              <span>File</span>
            </button>
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.pptx,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              style={{ display: 'none' }}
              onChange={handleDocPick}
            />
          </>
        )}
        {!isZeroAi && (
          <button
            type="button"
            className={`fmt-btn${grammarOpen ? ' active-rec' : ''}`}
            style={grammarOpen ? { background: 'var(--accent)', color: 'var(--accent-text)' } : undefined}
            onClick={() => setGrammarOpen(o => !o)}
            title="Grammar check & AI writing polish"
            aria-label="Grammar and writing polish"
          >
            <SpellCheck size={17} />
            <span>Polish</span>
          </button>
        )}
        <button
          type="button"
          className={`fmt-btn${dictState !== 'idle' ? ' active-rec' : ''}`}
          onClick={handleToggleDictation}
          title={dictState !== 'idle' ? 'Stop voice dictation' : 'Voice dictation'}
          aria-label={dictState !== 'idle' ? 'Stop voice dictation' : 'Start voice dictation'}
        >
          {dictState !== 'idle' ? <MicOff size={17} /> : <Mic size={17} />}
          <span>{dictState !== 'idle' ? 'Stop' : 'Mic'}</span>
        </button>
        {!isZeroAi && (
          <button
            type="button"
            className="fmt-btn"
            disabled={ocrBusy}
            onClick={onOcrScan}
            title="Scan text from photo (OCR)"
            aria-label="Scan text from photo"
          >
            {ocrBusy ? (
              <span className="spinner" style={{ width: 15, height: 15 }} />
            ) : (
              <ScanText size={17} />
            )}
            <span>OCR</span>
          </button>
        )}
      </div>

      {templateSheetOpen && (
        <TemplatePickerSheet
          title="Apply Template"
          onPick={idOrCustom => {
            setTemplateSheetOpen(false);
            onApplyTemplate?.(idOrCustom);
          }}
          onClose={() => setTemplateSheetOpen(false)}
        />
      )}

      {blockSheetOpen && (
        <InsertBlockSheet
          onInsert={(snippet, blockName) => {
            if (!snippet) return;
            if (editorMode === 'raw' && textareaRef.current) {
              const el = textareaRef.current;
              const start = el.selectionStart ?? body.length;
              const end = el.selectionEnd ?? body.length;
              const prefix = start > 0 && body[start - 1] !== '\n' ? '\n' : '';
              const next = body.slice(0, start) + prefix + snippet + '\n' + body.slice(end);
              onBodyChange(next);
            } else {
              const next = (body ? `${body.replace(/\s+$/, '')}\n\n` : '') + snippet;
              onBodyChange(next);
            }
            toast(`Inserted ${blockName}`, { type: 'success' });
          }}
          onClose={() => setBlockSheetOpen(false)}
        />
      )}
    </div>
  );
}
