/**
 * SmartDetectBar — Calm, thumb-friendly Blank-Note Auto-Detection Strip docked
 * just above the editor formatting toolbar.
 *
 * - 100% disabled in Zero-AI / Hidden Vault notes (`isZeroAi === true`)
 * - Completely hidden (0px) when writing normal prose
 * - 1-tap Run for ALL languages (offline JS/HTML, Codapi + AI fallback for Python/C/C++/Java/SQL/etc.)
 * - Instant offline Math, Algebra, Units, Chemistry, Physics, Stats, Subnets, Deadlines,
 *   Offline Flashcards, Error Debugging, Google Docs Import, and Filipino/Bisaya <-> English Translation!
 */
import { memo, lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Code2,
  Calculator,
  FlaskConical,
  Atom,
  BarChart3,
  Network,
  CalendarPlus,
  Layers,
  Bug,
  Languages,
  FileDown,
  Palette,
  Sparkles,
  Plus,
  X,
  LineChart,
  Copy,
  Check,
  ZapOff,
  FolderInput,
  Link2,
} from 'lucide-react';
import { detectBlankNoteIntents } from '../../lib/smartNoteDetect';
import { classifyFolderNaiveBayes, findSimilarNotesOffline } from '../../lib/userPatterns';
import { executeCode } from '../../lib/codeRunner';
import { aiText } from '../../lib/aiCore';
import { importPublicGoogleLink } from '../../lib/courseExtras';
import { db, getNoteIndexLite } from '../../store/db';
import { syncDeadlineNotifications } from '../../lib/notifications';
import { useDialog } from '../ui/DialogProvider';

const MathGrapherTab = lazy(() => import('../toolkit/MathGrapherTab'));

const KIND_ICONS = {
  code: Code2,
  math: Calculator,
  chemistry: FlaskConical,
  physics: Atom,
  stats: BarChart3,
  subnet: Network,
  deadline: CalendarPlus,
  flashcards: Layers,
  error: Bug,
  translate: Languages,
  gdoc: FileDown,
  color: Palette,
  move_folder: FolderInput,
  similar_note: Link2,
};

const SmartDetectBar = memo(function SmartDetectBar({
  title = '',
  body,
  subject = 'General',
  currentNoteId = null,
  currentFolderId = null,
  isZeroAi = false,
  enabled = true,
  onToggleEnabled,
  onAppendText,
  onReplaceBody,
  onSaveFlashcards,
  onMoveToFolder,
  onOpenRelatedNote,
}) {
  const { toast } = useDialog();
  const [debouncedBody, setDebouncedBody] = useState(body || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const [corpus, setCorpus] = useState(null); // { folders, notes } cached for offline pattern matching

  // Inline result drawer state (code output OR AI step-by-step / translation / debug)
  const [busyAction, setBusyAction] = useState('');
  const [outputCard, setOutputCard] = useState(null); // { title, subtitle, text, error, html, insertText }
  const [graphModalExpr, setGraphModalExpr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedBody(body || ''), 320);
    return () => clearTimeout(t);
  }, [body]);

  // Load non-vault folders & lightweight note index once note has >= 20 chars
  useEffect(() => {
    if (isZeroAi || !enabled || debouncedBody.trim().length < 20) {
      return undefined;
    }
    if (corpus) return undefined;
    let live = true;
    Promise.all([db.folders.toArray(), getNoteIndexLite()])
      .then(([folders, notes]) => {
        if (!live) return;
        setCorpus({ folders, notes });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isZeroAi, enabled, debouncedBody, corpus]);

  const detections = useMemo(() => {
    const base = detectBlankNoteIntents(debouncedBody, { isZeroAi, enabled });
    if (isZeroAi || !enabled || !corpus || debouncedBody.trim().length < 28) {
      return base;
    }
    const combinedText = `${title || ''} ${debouncedBody}`;
    const extra = [];

    if (onMoveToFolder) {
      const folderMatch = classifyFolderNaiveBayes(combinedText, corpus.folders, corpus.notes, {
        currentFolderId,
      });
      if (folderMatch) {
        extra.push({
          id: `move:${folderMatch.folderId}`,
          kind: 'move_folder',
          badge: `File → ${folderMatch.folderName}`,
          title: `Looks like ${folderMatch.folderName} (${folderMatch.confidence}%)`,
          summary: '1-tap offline pattern match',
          meta: folderMatch,
        });
      }
    }

    if (onOpenRelatedNote) {
      const sim = findSimilarNotesOffline(combinedText, {
        currentNoteId,
        notes: corpus.notes,
        folders: corpus.folders,
      });
      if (sim) {
        extra.push({
          id: `sim:${sim.noteId}`,
          kind: 'similar_note',
          badge: 'Related',
          title: `Similar: ${sim.title}`,
          summary: `${sim.score}% topic overlap (offline)`,
          meta: sim,
        });
      }
    }

    return [...base, ...extra].slice(0, 3);
  }, [
    debouncedBody,
    title,
    isZeroAi,
    enabled,
    corpus,
    currentFolderId,
    currentNoteId,
    onMoveToFolder,
    onOpenRelatedNote,
  ]);

  // Keep activeIdx within bounds when detections change
  const safeIdx = activeIdx < detections.length ? activeIdx : 0;
  const active = detections[safeIdx] || null;
  const activeId = active?.id || '';

  // Clear stale inline output drawer whenever detected intent switches or clears
  useEffect(() => {
    setOutputCard(null);
  }, [activeId]);

  if (isZeroAi || !enabled || detections.length === 0) {
    return null;
  }

  const handleRunCode = async meta => {
    if (!meta?.code || busyAction) return;
    setBusyAction('run');
    try {
      const res = await executeCode({
        langId: meta.langId,
        code: meta.code,
        allowAiFallback: true,
      });
      const outText = res.ok
        ? res.stdout || '(No output)'
        : [res.stdout, res.stderr].filter(Boolean).join('\n') || 'Execution failed';
      const insertText =
        res.mode === 'preview'
          ? ''
          : outText.includes('\n')
            ? `\`\`\`output\n${outText}\n\`\`\``
            : `// Output: ${outText}`;
      setOutputCard({
        title: `${meta.langName} Output`,
        subtitle: `${res.engine || 'Runner'}${res.durationMs ? ` · ${res.durationMs}ms` : ''}${res.notice ? ` · ${res.notice}` : ''}`,
        text: outText,
        isError: !res.ok,
        html: res.mode === 'preview' ? res.html : '',
        insertText,
      });
    } catch (err) {
      setOutputCard({
        title: `${meta.langName} Error`,
        subtitle: 'Execution failed',
        text: err?.message || 'Could not run code',
        isError: true,
        html: '',
        insertText: '',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleWrapCodeBlock = meta => {
    if (!meta || meta.isFenced || typeof meta.startLine !== 'number') return;
    const lines = String(body || '').split(/\r?\n/);
    const before = lines.slice(0, meta.startLine);
    const codeSeg = lines.slice(meta.startLine, meta.endLine + 1);
    const after = lines.slice(meta.endLine + 1);
    const fenceTag = meta.langId === 'javascript' ? 'js' : meta.langId === 'python' ? 'py' : meta.langId;
    const next = [...before, `\`\`\`${fenceTag}`, ...codeSeg, '```', ...after].join('\n');
    onReplaceBody?.(next);
    toast(`Formatted as ${meta.langName} code block`, { type: 'success' });
  };

  const handleAiAssist = async ({ mode, promptTitle, systemPrompt, userPrompt, insertHeading }) => {
    if (busyAction) return;
    setBusyAction(mode);
    try {
      const reply = await aiText({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 900,
        timeoutMs: 45000,
      });
      const clean = String(reply || '').trim();
      setOutputCard({
        title: promptTitle,
        subtitle: 'AI Assistant',
        text: clean,
        isError: false,
        html: '',
        insertText: insertHeading ? `### ${insertHeading}\n${clean}` : clean,
      });
    } catch (err) {
      toast(`AI failed: ${err?.message || 'Check connection or API settings'}`, { type: 'error' });
    } finally {
      setBusyAction('');
    }
  };

  const handleAddDeadline = async meta => {
    await db.plannerItems.add({
      title: meta.title,
      course: subject || 'Class',
      type: meta.type || 'assignment',
      source: 'manual',
      dateKey: meta.dateKey,
      timeLabel: 'From note',
      dueAt: new Date(`${meta.dateKey}T23:59:00`).getTime(),
      description: String(body || '').slice(0, 500),
      done: false,
      priority: meta.type === 'exam' ? 'high' : 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    syncDeadlineNotifications().catch(() => {});
    toast(`Added "${meta.title.slice(0, 32)}" (${meta.dateKey}) to Calendar!`, { type: 'success' });
  };

  const handleMakeFlashcards = async meta => {
    if (!meta?.cards?.length) return;
    if (onSaveFlashcards) {
      await onSaveFlashcards(meta.cards);
    }
  };

  const handleSaveBugLog = async meta => {
    await db.bugLogs.add({
      title: meta.title || 'Error Trace',
      language: 'Auto',
      errorType: meta.title.split(':')[0] || 'Runtime Error',
      symptom: meta.snippet,
      rootCause: '',
      fix: '',
      createdAt: Date.now(),
    });
    toast('Saved error to your Bug Log!', { type: 'success' });
  };

  const handleImportGoogleDoc = async meta => {
    if (busyAction) return;
    setBusyAction('gdoc');
    try {
      const res = await importPublicGoogleLink(meta.url);
      onAppendText?.(`\n## ${res.title}\n${res.extractedText.slice(0, 12000)}`);
      toast(`Imported ${meta.kind} into this note!`, { type: 'success' });
    } catch (err) {
      toast(err?.message || 'Could not import Google link', { type: 'error' });
    } finally {
      setBusyAction('');
    }
  };

  const handleCopyOutput = async text => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Copy unavailable');
    }
  };

  const ActiveIcon = KIND_ICONS[active.kind] || Sparkles;

  return (
    <div className="smart-detect-wrap" role="region" aria-label="Smart note auto-detection">
      {/* Collapsible Inline Output / AI Result Drawer */}
      {outputCard && (
        <div className={`smart-output-drawer${outputCard.isError ? ' is-error' : ''}`}>
          <div className="smart-output-header">
            <div style={{ minWidth: 0 }}>
              <div className="smart-output-title">{outputCard.title}</div>
              {outputCard.subtitle && <div className="smart-output-sub">{outputCard.subtitle}</div>}
            </div>
            <div className="flex items-center gap-6">
              {outputCard.insertText && (
                <button
                  type="button"
                  className="row-action-chip active-chip"
                  onClick={() => {
                    onAppendText?.(outputCard.insertText);
                    toast('Inserted into note!', { type: 'success' });
                  }}
                >
                  <Plus size={12} /> Insert
                </button>
              )}
              {outputCard.text && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy output"
                  onClick={() => handleCopyOutput(outputCard.text)}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Close output"
                onClick={() => setOutputCard(null)}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {outputCard.html ? (
            <iframe
              title="Live HTML Preview"
              sandbox="allow-scripts"
              srcDoc={outputCard.html}
              className="smart-html-preview"
            />
          ) : (
            <pre className="smart-output-pre">{outputCard.text}</pre>
          )}
        </div>
      )}

      {/* Multi-detection tabs when 2–3 distinct types are recognized simultaneously */}
      {detections.length > 1 && (
        <div className="smart-detect-tabs">
          {detections.map((d, idx) => {
            const TabIcon = KIND_ICONS[d.kind] || Sparkles;
            return (
              <button
                key={d.id}
                type="button"
                className={`smart-detect-tab${idx === safeIdx ? ' active' : ''}`}
                onClick={() => setActiveIdx(idx)}
              >
                <TabIcon size={12} /> {d.badge}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Compact Smart Strip Row */}
      <div className="smart-detect-bar">
        <div className="smart-detect-info">
          <span className="smart-detect-icon">
            {active.kind === 'color' && active.meta?.hex ? (
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: active.meta.hex,
                  border: '1px solid rgba(255,255,255,0.35)',
                }}
              />
            ) : (
              <ActiveIcon size={15} />
            )}
          </span>
          <div className="smart-detect-text">
            <div className="smart-detect-title">{active.title}</div>
            <div className="smart-detect-sub">{active.summary}</div>
          </div>
        </div>

        <div className="smart-detect-actions">
          {active.kind === 'code' && (
            <>
              <button
                type="button"
                className="row-action-chip active-chip"
                disabled={Boolean(busyAction)}
                onClick={() => handleRunCode(active.meta)}
              >
                {busyAction === 'run' ? (
                  <span className="spinner" style={{ width: 11, height: 11 }} />
                ) : (
                  <Play size={12} />
                )}
                {busyAction === 'run' ? 'Running…' : 'Run'}
              </button>
              {!active.meta?.isFenced && (
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => handleWrapCodeBlock(active.meta)}
                >
                  <Code2 size={12} /> Wrap
                </button>
              )}
            </>
          )}

          {active.kind === 'math' && (
            <>
              {active.insertText && (
                <button
                  type="button"
                  className="row-action-chip active-chip"
                  onClick={() => {
                    onAppendText?.(`${active.meta.label} ${active.insertText}`);
                    toast('Answer inserted into note!', { type: 'success' });
                  }}
                >
                  <Plus size={12} /> Insert
                </button>
              )}
              {active.meta?.graphExpr && (
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => setGraphModalExpr(active.meta.graphExpr)}
                >
                  <LineChart size={12} /> Graph
                </button>
              )}
              <button
                type="button"
                className="row-action-chip"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  handleAiAssist({
                    mode: 'math-steps',
                    promptTitle: 'Step-by-Step Solution',
                    insertHeading: 'Step-by-Step Solution',
                    systemPrompt:
                      'You are a concise, crystal-clear math tutor. Show the clean numbered step-by-step solution and final boxed answer.',
                    userPrompt: `Solve step by step:\n${active.meta.label}`,
                  })
                }
              >
                <Sparkles size={12} /> {busyAction === 'math-steps' ? '…' : 'Steps'}
              </button>
            </>
          )}

          {active.kind === 'chemistry' && (
            <>
              {active.insertText && (
                <button
                  type="button"
                  className="row-action-chip active-chip"
                  onClick={() => {
                    onAppendText?.(active.insertText);
                    toast('Molar mass inserted!', { type: 'success' });
                  }}
                >
                  <Plus size={12} /> Insert
                </button>
              )}
              <button
                type="button"
                className="row-action-chip"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  handleAiAssist({
                    mode: 'chem',
                    promptTitle: 'Chemistry Breakdown',
                    insertHeading: 'Chemistry Notes',
                    systemPrompt:
                      'You are a helpful chemistry tutor. Balance any chemical reaction, list molar masses, and briefly explain the reaction type or compound properties.',
                    userPrompt: active.meta?.reaction || `Explain compound ${active.meta?.formula}`,
                  })
                }
              >
                <Sparkles size={12} /> {busyAction === 'chem' ? '…' : 'Balance / AI'}
              </button>
            </>
          )}

          {active.kind === 'physics' && (
            <>
              {active.insertText && (
                <button
                  type="button"
                  className="row-action-chip active-chip"
                  onClick={() => {
                    onAppendText?.(active.insertText);
                    toast('Physics answer inserted!', { type: 'success' });
                  }}
                >
                  <Plus size={12} /> Insert
                </button>
              )}
              <button
                type="button"
                className="row-action-chip"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  handleAiAssist({
                    mode: 'phys',
                    promptTitle: 'Physics Solution',
                    insertHeading: 'Physics Solution',
                    systemPrompt:
                      'You are a concise physics tutor. List Given, Formula, Substitution with SI units, and Final Answer.',
                    userPrompt: String(body || '').slice(-1000),
                  })
                }
              >
                <Sparkles size={12} /> {busyAction === 'phys' ? '…' : 'Solve AI'}
              </button>
            </>
          )}

          {(active.kind === 'stats' || active.kind === 'subnet' || active.kind === 'color') && (
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => {
                onAppendText?.(active.insertText);
                toast('Inserted into note!', { type: 'success' });
              }}
            >
              <Plus size={12} /> Insert
            </button>
          )}

          {active.kind === 'deadline' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => handleAddDeadline(active.meta)}
            >
              <CalendarPlus size={12} /> + Calendar
            </button>
          )}

          {active.kind === 'flashcards' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => handleMakeFlashcards(active.meta)}
            >
              <Layers size={12} /> Make Cards
            </button>
          )}

          {active.kind === 'error' && (
            <>
              <button
                type="button"
                className="row-action-chip active-chip"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  handleAiAssist({
                    mode: 'debug',
                    promptTitle: 'Error Diagnosis & Fix',
                    insertHeading: 'Bug Fix',
                    systemPrompt:
                      'You are an expert debugging mentor. Explain the root cause in 2 sentences and show the exact corrected code fix.',
                    userPrompt: String(body || '').slice(-2000),
                  })
                }
              >
                <Sparkles size={12} /> {busyAction === 'debug' ? '…' : 'Debug AI'}
              </button>
              <button
                type="button"
                className="row-action-chip"
                onClick={() => handleSaveBugLog(active.meta)}
              >
                <Bug size={12} /> Log Bug
              </button>
            </>
          )}

          {active.kind === 'translate' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              disabled={Boolean(busyAction)}
              onClick={() =>
                handleAiAssist({
                  mode: 'translate',
                  promptTitle: `Translation (${active.meta.targetLang})`,
                  insertHeading: `Translation (${active.meta.targetLang})`,
                  systemPrompt: `Translate the user's text naturally and accurately into ${active.meta.targetLang}. Return ONLY the translated text without filler.`,
                  userPrompt: active.meta.text,
                })
              }
            >
              <Languages size={12} /> {busyAction === 'translate' ? '…' : 'Translate'}
            </button>
          )}

          {active.kind === 'gdoc' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              disabled={Boolean(busyAction)}
              onClick={() => handleImportGoogleDoc(active.meta)}
            >
              <FileDown size={12} /> {busyAction === 'gdoc' ? 'Importing…' : 'Import'}
            </button>
          )}

          {active.kind === 'move_folder' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => onMoveToFolder?.({ id: active.meta.folderId, name: active.meta.folderName })}
            >
              <FolderInput size={12} /> Move
            </button>
          )}

          {active.kind === 'similar_note' && (
            <button
              type="button"
              className="row-action-chip active-chip"
              onClick={() => onOpenRelatedNote?.(active.meta.noteId)}
            >
              <Link2 size={12} /> Open
            </button>
          )}

          {onToggleEnabled && (
            <button
              type="button"
              className="icon-btn"
              title="Turn off Smart Auto-Detect"
              aria-label="Turn off Smart Auto-Detect"
              onClick={() => onToggleEnabled(false)}
            >
              <ZapOff size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Inline 2D Math Grapher Modal */}
      {graphModalExpr &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div className="export-overlay" onClick={() => setGraphModalExpr('')}>
            <div
              className="export-sheet"
              style={{ maxHeight: '88vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
                <div className="export-title" style={{ marginBottom: 0, textAlign: 'left' }}>
                  2D Math Grapher
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setGraphModalExpr('')}
                  aria-label="Close grapher"
                >
                  <X size={17} />
                </button>
              </div>
              <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading grapher…</div>}>
                <MathGrapherTab initialExpr={graphModalExpr} />
              </Suspense>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
});

export default SmartDetectBar;
