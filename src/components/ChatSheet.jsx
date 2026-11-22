/**
 * ChatSheet — chat with your note. Full-screen overlay with a message list
 * and an input bar. Messages persist on the note (note.chat) so the
 * conversation survives closing the note.
 */
import { useState, useRef, useEffect } from 'react';
import { chatWithNote } from '../lib/aiFeatures';

export default function ChatSheet({ note, subject, style, onClose, onSave }) {
  const history = note?.chat || [];
  const [messages, setMessages] = useState(history);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    const userMsg = { role: 'user', content: q };
    const next = [...messages, userMsg];
    setMessages(next);
    setBusy(true);
    try {
      const reply = await chatWithNote({
        note: note.body,
        title: note.title,
        subject: note.subject || subject,
        history: messages,
        question: q,
        style,
      });
      const done = [...next, { role: 'assistant', content: reply }];
      setMessages(done);
      onSave?.(done);
    } catch (err) {
      const done = [...next, { role: 'assistant', content: `⚠ ${err.message}` }];
      setMessages(done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-overlay">
      <header className="chat-header">
        <button className="chat-close" onClick={onClose} aria-label="Close chat">←</button>
        <div>
          <div className="chat-title">Ask about this note</div>
          <div className="chat-sub">{note?.title || 'Untitled'}</div>
        </div>
      </header>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-icon">💬</div>
            <div className="empty-title">Ask anything about this note</div>
            <div className="empty-text">"Explain the main idea" · "Quiz me on this" · "Why does X happen?"</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="chat-msg assistant"><span className="spinner" style={{ width: 14, height: 14 }} /> Thinking…</div>
        )}
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