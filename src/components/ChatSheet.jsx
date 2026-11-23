/**
 * ChatSheet — chat with your note. Full-screen overlay with a message list
 * and an input bar. Messages persist on the note (note.chat) so the
 * conversation survives closing the note.
 *
 * v3 changes:
 *  - AI answers are rendered as formatted text (bold, lists, headings, code)
 *    instead of showing raw **markdown** symbols.
 *  - Errors are NOT saved as chat messages (they used to be stored and then
 *    sent back to the model as if the AI had said them). They show in a
 *    banner with a Retry button and a plain-language reason.
 *  - "Clear chat" button.
 */
import { useState, useRef, useEffect } from 'react';
import { chatWithNote } from '../lib/aiFeatures';
import { getTavilyKey } from '../lib/aiConfig';

/** Turn a raw error into one sentence the user can act on. */
function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (/429|rate.?limit|quota|too many/i.test(m)) return 'The AI is out of free requests for the moment. Wait a minute, then tap Retry.';
  if (/401|403|unauthori[sz]ed|invalid.*key|api key/i.test(m)) return 'The AI key was rejected. Check your key in Settings → AI backend.';
  if (/404|410|model/i.test(m) && /retired|not found|does not exist|unknown/i.test(m)) return 'The selected AI model is no longer available. Pick another one in Settings → AI backend.';
  if (/can.?t reach|failed to fetch|network|load failed/i.test(m)) return "Can't reach the AI. Check your internet, or that the Termux server is running.";
  if (/timeout|timed out|aborted/i.test(m)) return 'The AI took too long to answer. Tap Retry.';
  if (/5\d\d/.test(m)) return 'The AI service had a problem on its side. Tap Retry in a moment.';
  return 'Something went wrong. Tap Retry.';
}

/** Older versions saved "⚠ error" bubbles into the note. Drop them (and the question they belonged to). */
function cleanHistory(chat) {
  const out = [];
  for (const m of chat || []) {
    if (m.role === 'assistant' && /^⚠/.test(m.content || '')) {
      if (out.length && out[out.length - 1].role === 'user') out.pop();
    } else out.push(m);
  }
  return out;
}

/** **bold**, *italic*, `code` — everything else stays plain text (no HTML injection). */
function renderInline(text, keyBase) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={keyBase + i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={keyBase + i}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={keyBase + i} className="chat-code">{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Small, safe markdown renderer: paragraphs, #headings, - bullets, 1. lists, ``` code. */
function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(<pre key={k++} className="chat-pre">{code.join('\n')}</pre>);
    } else if (/^#{1,4}\s+/.test(line)) {
      out.push(<div key={k++} className="chat-h">{renderInline(line.replace(/^#{1,4}\s+/, ''), `h${k}`)}</div>);
      i++;
    } else if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      out.push(<ul key={k++} className="chat-list">{items.map((t, j) => <li key={j}>{renderInline(t, `u${k}${j}`)}</li>)}</ul>);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(<ol key={k++} className="chat-list">{items.map((t, j) => <li key={j}>{renderInline(t, `o${k}${j}`)}</li>)}</ol>);
    } else if (!line.trim()) {
      i++;
    } else {
      const para = [];
      while (
        i < lines.length && lines[i].trim() &&
        !/^```/.test(lines[i]) && !/^#{1,4}\s+/.test(lines[i]) &&
        !/^\s*[-*•]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])
      ) para.push(lines[i++]);
      out.push(
        <p key={k++} className="chat-p">
          {para.map((t, j) => <span key={j}>{j > 0 && <br />}{renderInline(t, `p${k}${j}`)}</span>)}
        </p>
      );
    }
  }
  return <>{out}</>;
}

export default function ChatSheet({ note, subject, style, onClose, onSave }) {
  const [messages, setMessages] = useState(() => cleanHistory(note?.chat));   // confirmed conversation only
  const [pending, setPending] = useState(null);                  // question being answered (or that failed)
  const [error, setError] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [deepOn, setDeepOn] = useState(false);
  const [webOn, setWebOn] = useState(false);
  const hasTavily = !!getTavilyKey();
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, pending, error]);

  const ask = async q => {
    if (!q || busy) return;
    setError(null);
    setPending(q);
    setBusy(true);
    try {
      const reply = await chatWithNote({
        note: note.body,
        title: note.title,
        subject: note.subject || subject,
        history: messages,
        question: q,
        style,
        deep: deepOn,
        web: webOn && hasTavily,
      });
      const done = [...messages, { role: 'user', content: q }, { role: 'assistant', content: reply }];
      setMessages(done);
      setPending(null);
      onSave?.(done);
    } catch (err) {
      setError(friendlyError(err));
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

  const clearChat = () => {
    if (busy) return;
    if (!window.confirm('Clear this conversation?')) return;
    setMessages([]);
    setPending(null);
    setError(null);
    onSave?.([]);
  };

  const empty = messages.length === 0 && !pending;

  return (
    <div className="chat-overlay">
      <header className="chat-header">
        <button className="chat-close" onClick={onClose} aria-label="Close chat">←</button>
        <div className="chat-head-text">
          <div className="chat-title">Ask about this note</div>
          <div className="chat-sub">{note?.title || 'Untitled'}</div>
        </div>
        {messages.length > 0 && (
          <button className="chat-clear" onClick={clearChat} disabled={busy}>Clear</button>
        )}
      </header>

      <div className="chat-messages" ref={listRef}>
        {empty && (
          <div className="chat-empty">
            <div className="empty-icon">💬</div>
            <div className="empty-title">Ask anything about this note</div>
            <div className="empty-text">"Explain the main idea" · "Quiz me on this" · "Why does X happen?"</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {pending && <div className="chat-msg user">{pending}</div>}
        {busy && (
          <div className="chat-msg assistant chat-busy"><span className="spinner" style={{ width: 14, height: 14 }} /> {deepOn ? 'Deep thinking…' : 'Thinking…'}</div>
        )}
        {error && !busy && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button className="chat-retry" onClick={() => ask(pending)}>Retry</button>
          </div>
        )}
      </div>

      <div className="chat-toggles">
        <button
          className={`chat-chip${deepOn ? ' active' : ''}`}
          onClick={() => setDeepOn(d => !d)}
          aria-pressed={deepOn}
          title="Slower but thinks step by step with a reasoning model"
        >
          🧠 Deep Think
        </button>
        <button
          className={`chat-chip${webOn ? ' active' : ''}`}
          onClick={() => {
            if (!hasTavily) return;
            setWebOn(w => !w);
          }}
          aria-pressed={webOn}
          disabled={!hasTavily}
          title={hasTavily ? 'Search the web for context' : 'Needs a free Tavily key — Settings → AI Backend → Web search'}
        >
          🌐 Web
        </button>
      </div>

      <div className="chat-input-bar">
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask a question…"
          autoFocus
        />
        <button className="chat-send" onClick={send} disabled={busy || !input.trim()} aria-label="Send">
          ➤
        </button>
      </div>
    </div>
  );
}
