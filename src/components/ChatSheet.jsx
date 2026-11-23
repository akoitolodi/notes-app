/**
 * ChatSheet — streaming AI tutor & research assistant grounded in the current
 * note AND sibling notes from the same subject folder (Cross-Note Local RAG).
 *
 * Modes:
 * - Quick (default): 1 single LLM call (free-tier friendly!) + local cross-note RAG
 * - Deep Think: 2-pass Solve → Skeptical Verify with collapsible reasoning drawer
 * - Research: Zero-key multi-step Wikipedia + OpenAlex papers (+ optional Tavily)
 * - Socratic: Guides with probing questions instead of spoon-feeding answers
 */
import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Brain,
  BookOpen,
  Compass,
  Send,
  Square,
  Copy,
  Plus,
  FilePlus2,
  ExternalLink,
  MessageSquare,
  Trash2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Link2,
} from 'lucide-react';
import { chatWithNote } from '../lib/aiFeatures';
import { getModeMeta } from '../lib/noteModes';
import { getLearnerContextDigest } from '../lib/learnerMemory';
import { resolveLinkedNotes } from '../lib/wikiLinks';
import { db, getHiddenLockedFolderIds, getZeroAiFolderIds } from '../store/db';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (/429|rate.?limit|quota|too many/i.test(m)) {
    return 'Rate limit hit on the free tier. Wait a moment, tap Retry, or add a backup provider key in Settings.';
  }
  if (/401|403|unauthori[sz]ed|invalid.*key|api key/i.test(m)) {
    return 'The API key was rejected. Check your key in Settings → AI Backend.';
  }
  if (/404|410|model/i.test(m) && /retired|not found|does not exist|unknown/i.test(m)) {
    return 'This AI model is no longer available. Pick another model in Settings → AI Backend.';
  }
  if (/can.?t reach|failed to fetch|network|load failed/i.test(m)) {
    return "Can't reach the AI. Check your internet, or that the Termux server is running.";
  }
  if (/timeout|timed out|aborted/i.test(m)) {
    return 'The AI took too long to respond. Tap Retry.';
  }
  if (/5\d\d/.test(m)) {
    return 'The AI service had a temporary issue. Tap Retry in a moment.';
  }
  return m || 'Something went wrong. Tap Retry.';
}

function cleanHistory(chat) {
  const out = [];
  for (const m of chat || []) {
    if (m.role === 'assistant' && /^⚠/.test(m.content || '')) {
      if (out.length && out[out.length - 1].role === 'user') out.pop();
    } else if (m && (m.role === 'user' || m.role === 'assistant')) {
      out.push(m);
    }
  }
  return out;
}

function ReasoningDrawer({ reasoning, verified }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reasoning-wrap">
      <button
        type="button"
        className="reasoning-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-6">
          <ShieldCheck size={14} style={{ color: 'var(--ok)' }} />
          <span>{verified ? 'Logic verified · View reasoning' : 'View reasoning'}</span>
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="reasoning-body">
          <MarkdownContent text={reasoning} />
        </div>
      )}
    </div>
  );
}

export default function ChatSheet({
  note,
  subject,
  noteMode = 'study',
  style,
  onClose,
  onSave,
  onAppendToNote,
  onCreateNoteFromChat,
}) {
  const { confirm, toast } = useDialog();
  const modeMeta = getModeMeta(noteMode);
  const starterPrompts = modeMeta.chatStarters;
  const [messages, setMessages] = useState(() => cleanHistory(note?.chat));
  const [siblingNotes, setSiblingNotes] = useState([]);
  const [learnerContext, setLearnerContext] = useState('');
  const [pending, setPending] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const [statusLabel, setStatusLabel] = useState('');
  const [error, setError] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [deepOn, setDeepOn] = useState(false);
  const [researchOn, setResearchOn] = useState(false);
  const [socraticOn, setSocraticOn] = useState(false);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Load sibling folder notes + explicitly [[Wiki-Linked]] notes across unlocked folders for Cross-Note RAG
  // Strictly excludes Zero-AI Vault folders (Passwords & Keys) even when the vault is unlocked!
  useEffect(() => {
    let live = true;
    Promise.all([db.notes.toArray(), getHiddenLockedFolderIds(), getZeroAiFolderIds()])
      .then(([allNotes, hiddenIds, zeroAiIds]) => {
        if (!live) return;
        const excludedFolderIds = new Set([...hiddenIds, ...zeroAiIds]);
        const safeNotes = allNotes.filter(
          n => n && !n.trashed && n.mode !== 'vault' && !excludedFolderIds.has(n.folderId)
        );
        const siblings =
          typeof note?.folderId === 'number' && !excludedFolderIds.has(note.folderId)
            ? safeNotes.filter(n => n.folderId === note.folderId && n.id !== note.id)
            : [];
        const linked = resolveLinkedNotes(note, safeNotes, excludedFolderIds);
        const byId = new Map();
        [...linked, ...siblings].forEach(n => byId.set(n.id, n));
        setSiblingNotes([...byId.values()]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [note?.folderId, note?.id, note?.body]);

  // Load DeepTutor Persistent Learner Memory for this subject (skipped for journal & vault)
  useEffect(() => {
    if (noteMode === 'journal' || noteMode === 'vault') {
      setLearnerContext('');
      return undefined;
    }
    let live = true;
    getLearnerContextDigest(note?.subject || subject)
      .then(ctx => {
        if (live) setLearnerContext(ctx);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [note?.subject, subject, noteMode]);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, pending, streamingText, statusLabel, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(130, Math.max(44, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
    };
  }, [onClose]);

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  const ask = async (q, overrideOpts = {}) => {
    const question = String(q || '').trim();
    if (!question || busy) return;

    const useDeep = overrideOpts.deep ?? deepOn;
    const useResearch = overrideOpts.research ?? researchOn;
    const useSocratic = overrideOpts.socratic ?? socraticOn;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setPending(question);
    setStreamingText('');
    setStatusLabel(
      useResearch
        ? 'Planning research queries…'
        : useDeep
          ? 'Solving step-by-step…'
          : useSocratic
            ? 'Preparing guiding question…'
            : 'Thinking…'
    );
    setBusy(true);

    try {
      const res = await chatWithNote({
        note: note.body,
        title: note.title,
        subject: note.subject || subject,
        noteMode,
        siblingNotes,
        learnerContext,
        history: messages,
        question,
        style,
        deep: useDeep,
        research: useResearch,
        socratic: useSocratic,
        signal: controller.signal,
        onStatus: label => setStatusLabel(label),
        onFallback: providerName => toast(`Rate limit hit — switched to ${providerName}`),
        onToken: partial => setStreamingText(partial),
      });

      const assistantMsg = {
        role: 'assistant',
        content: res.text,
        ...(res.reasoning ? { reasoning: res.reasoning, verified: res.verified } : {}),
        ...(res.sources?.length ? { sources: res.sources } : {}),
        ...(res.relatedNotes?.length ? { relatedNotes: res.relatedNotes } : {}),
      };
      const done = [...messages, { role: 'user', content: question }, assistantMsg];
      setMessages(done);
      setPending(null);
      setStreamingText('');
      setStatusLabel('');
      onSave?.(done);
      if (res.truncated) {
        toast('Note is very long — answer used the first 8,000 characters');
      }
    } catch (err) {
      if (err?.isCancelled) {
        if (streamingText.trim()) {
          const done = [
            ...messages,
            { role: 'user', content: question },
            { role: 'assistant', content: `${streamingText.trim()}\n\n_(stopped)_` },
          ];
          setMessages(done);
          onSave?.(done);
        }
        setPending(null);
        setStreamingText('');
        setStatusLabel('');
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    ask(q);
  };

  const clearChat = async () => {
    if (busy) return;
    const ok = await confirm({
      title: 'Clear conversation?',
      message: 'All chat messages for this note will be removed.',
      confirmLabel: 'Clear chat',
      destructive: true,
    });
    if (!ok) return;
    setMessages([]);
    setPending(null);
    setStreamingText('');
    setError(null);
    onSave?.([]);
  };

  const copyText = async text => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied answer');
    } catch {
      toast('Could not copy', { type: 'error' });
    }
  };

  const empty = messages.length === 0 && !pending;

  return (
    <div className="chat-overlay" role="dialog" aria-modal="true" aria-label="Chat with note">
      <header className="chat-header">
        <button type="button" className="navbar-btn" onClick={onClose} aria-label="Close chat">
          <ArrowLeft size={20} />
        </button>
        <div className="chat-head-text">
          <div className="chat-title">AI Tutor & Research</div>
          <div className="chat-sub">
            {note?.title || 'Untitled'}
            {siblingNotes.length > 0 ? ` · ${siblingNotes.length} folder notes linked` : ''}
            {learnerContext ? ' · DeepTutor Memory' : ''}
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={clearChat}
            disabled={busy}
          >
            <Trash2 size={14} /> Clear
          </button>
        )}
      </header>

      <div className="chat-messages" ref={listRef}>
        {empty && (
          <div className="empty-state">
            <div className="empty-icon">
              <MessageSquare size={26} />
            </div>
            <div className="empty-title">
              {noteMode === 'journal'
                ? 'A calm space to unpack your thoughts'
                : noteMode === 'explore'
                  ? 'Explore mechanisms, myths & deeper questions'
                  : noteMode === 'code'
                    ? 'Trace, debug & sharpen your technical notes'
                    : 'Think deeper & research your notes'}
            </div>
            <div className="empty-text">
              {noteMode === 'journal'
                ? 'No quizzes, grading, or mistake flags — just a grounded conversation about what you wrote.'
                : 'Connects related & [[linked]] notes automatically. Use Deep Think for 2-pass verified logic, Research for Wikipedia & papers, or Socratic mode.'}
            </div>
            <div className="chat-starters">
              {starterPrompts.map(promptText => (
                <button
                  key={promptText}
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => {
                    const isRes = promptText.toLowerCase().includes('research');
                    if (isRes) setResearchOn(true);
                    ask(promptText, isRes ? { research: true } : {});
                  }}
                >
                  {promptText}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === 'assistant' ? (
              <>
                {m.reasoning && (
                  <ReasoningDrawer reasoning={m.reasoning} verified={m.verified} />
                )}

                <MarkdownContent text={m.content} sources={m.sources || null} />

                {m.relatedNotes && m.relatedNotes.length > 0 && (
                  <div className="connected-notes-row">
                    <Link2 size={12} />
                    <span>Connected notes: {m.relatedNotes.join(', ')}</span>
                  </div>
                )}

                {m.sources && m.sources.length > 0 && (
                  <div className="chat-sources">
                    {m.sources.map(src => (
                      <a
                        key={src.index}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-source-link"
                        title={src.title}
                      >
                        <span className={`source-kind-badge kind-${src.kind || 'web'}`}>
                          {src.kind === 'paper'
                            ? `Paper${src.year ? ` ${src.year}` : ''}`
                            : src.kind === 'wiki'
                              ? 'Wiki'
                              : 'Web'}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          [{src.index}] {src.title}
                        </span>
                        <ExternalLink size={11} style={{ flexShrink: 0 }} />
                      </a>
                    ))}
                  </div>
                )}

                <div className="chat-msg-actions">
                  <button
                    type="button"
                    className="chat-msg-action"
                    onClick={() => copyText(m.content)}
                  >
                    <Copy size={12} /> Copy
                  </button>
                  {onAppendToNote && (
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() => onAppendToNote(m.content)}
                    >
                      <Plus size={13} /> Add to note
                    </button>
                  )}
                  {onCreateNoteFromChat && (
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() => {
                        const prevUser = messages[i - 1]?.content || 'Research Note';
                        onCreateNoteFromChat(prevUser, m.content, m.sources);
                      }}
                    >
                      <FilePlus2 size={13} /> Save as note
                    </button>
                  )}
                  {m.verified && !busy && (
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() =>
                        ask('Give me one similar practice problem to test if I truly understood that, and wait for my answer.', {
                          socratic: true,
                          deep: false,
                        })
                      }
                    >
                      <Brain size={12} /> Practice similar
                    </button>
                  )}
                </div>
              </>
            ) : (
              m.content
            )}
          </div>
        ))}

        {pending && <div className="chat-msg user">{pending}</div>}

        {busy && (
          <div className="chat-msg assistant">
            {streamingText ? (
              <MarkdownContent text={streamingText} />
            ) : (
              <div className="flex items-center gap-8">
                <span className="spinner" style={{ width: 14, height: 14 }} />
                <span>{statusLabel || 'Thinking…'}</span>
              </div>
            )}
          </div>
        )}

        {error && !busy && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => ask(pending)}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="chat-toggles">
        <button
          type="button"
          className={`chat-chip${deepOn ? ' active' : ''}`}
          onClick={() => {
            setDeepOn(d => {
              if (!d) setSocraticOn(false);
              return !d;
            });
          }}
          aria-pressed={deepOn}
          title="2-pass Solve → Skeptical Verify for stronger logic & math"
        >
          <Brain size={14} /> Deep Think
        </button>
        <button
          type="button"
          className={`chat-chip${researchOn ? ' active' : ''}`}
          onClick={() => setResearchOn(r => !r)}
          aria-pressed={researchOn}
          title="Searches Wikipedia, OpenAlex academic papers & optional Tavily web"
        >
          <BookOpen size={14} /> Research
        </button>
        <button
          type="button"
          className={`chat-chip${socraticOn ? ' active' : ''}`}
          onClick={() => {
            setSocraticOn(s => {
              if (!s) setDeepOn(false);
              return !s;
            });
          }}
          aria-pressed={socraticOn}
          title="Guides you with probing questions to build critical thinking"
        >
          <Compass size={14} /> Socratic
        </button>
      </div>

      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          rows={1}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            socraticOn
              ? 'Share your reasoning or ask for a hint…'
              : researchOn
                ? 'Enter a topic or question to research…'
                : 'Ask a question… (Shift+Enter for new line)'
          }
          autoFocus
        />
        {busy ? (
          <button
            type="button"
            className="chat-send stop"
            onClick={stopGeneration}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="chat-send"
            onClick={send}
            disabled={!input.trim()}
            aria-label="Send message"
          >
            <Send size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
