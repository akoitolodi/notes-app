/**
 * FeynmanCoachTab — Human-like "Teach the AI" Reverse Feynman Roleplay.
 *
 * Pick who you're explaining to (Close Friend, Friend / Classmate, Junior,
 * Curious Kid, Your Teacher, or Panicking Groupmate) in English (default) or
 * Taglish, then grade Clarity, Accuracy & Audience Fit and sync missed gaps
 * into DeepTutor Learner Memory.
 */
import { useState, useRef } from 'react';
import { Send, Award, RotateCcw, User, GraduationCap } from 'lucide-react';
import { aiText, aiTextStream } from '../../lib/aiCore';
import { recordLearningSignal } from '../../lib/learnerMemory';
import { logStudyActivity } from '../../store/db';
import {
  FEYNMAN_PERSONAS,
  getFeynmanPersona,
  getSavedFeynmanPrefs,
  saveFeynmanPrefs,
  buildFeynmanOpeningMessage,
  buildFeynmanSystemPrompt,
  buildFeynmanGradingPrompt,
  parseFeynmanGradeJson,
} from '../../lib/feynmanPersonas';
import MarkdownContent from '../ui/MarkdownContent';
import { useDialog } from '../ui/DialogProvider';

export default function FeynmanCoachTab({ note }) {
  const { toast, confirm } = useDialog();
  const topicTitle = note?.title || 'this topic';
  const subject = note?.subject || 'General';

  const savedPrefs = useRef(getSavedFeynmanPrefs()).current;
  const [personaId, setPersonaId] = useState(savedPrefs.personaId);
  const [lang, setLang] = useState(savedPrefs.lang);

  const activePersona = getFeynmanPersona(personaId);

  const [messages, setMessages] = useState(() => [
    {
      role: 'assistant',
      content: buildFeynmanOpeningMessage({
        personaId: savedPrefs.personaId,
        lang: savedPrefs.lang,
        topicTitle,
      }),
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [report, setReport] = useState(null);
  const abortRef = useRef(null);

  const userTurns = messages.filter(m => m.role === 'user').length;

  const applyPersonaOrLangSwitch = async (nextPersonaId, nextLang) => {
    if (nextPersonaId === personaId && nextLang === lang) return;
    if (busy || grading) return;

    const targetPersona = getFeynmanPersona(nextPersonaId);
    if (userTurns > 0) {
      const ok = await confirm({
        title: `Switch listener to ${targetPersona.label}?`,
        message: 'This restarts the current teaching chat so the new listener can open fresh.',
        confirmLabel: 'Switch & Restart',
      });
      if (!ok) return;
    }

    abortRef.current?.abort();
    setPersonaId(targetPersona.id);
    setLang(nextLang);
    saveFeynmanPrefs({ personaId: targetPersona.id, lang: nextLang });
    setMessages([
      {
        role: 'assistant',
        content: buildFeynmanOpeningMessage({
          personaId: targetPersona.id,
          lang: nextLang,
          topicTitle,
        }),
      },
    ]);
    setInput('');
    setReport(null);
    setBusy(false);
  };

  const handleSend = async e => {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || busy) return;

    const nextHistory = [...messages, { role: 'user', content: text }];
    setMessages([...nextHistory, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const noteContext = String(note?.body || '').slice(0, 4500);
      const reply = await aiTextStream({
        system: buildFeynmanSystemPrompt({
          personaId,
          lang,
          topicTitle,
          subject,
          noteContext,
        }),
        user: text,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        maxTokens: 380,
        signal: ctrl.signal,
        onToken: partial => {
          setMessages(prev => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: 'assistant', content: partial };
            return copy;
          });
        },
      });
      setMessages(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: 'assistant', content: reply };
        return copy;
      });
      logStudyActivity('reviews', 1).catch(() => {});
    } catch (err) {
      if (!err?.isCancelled) {
        setMessages(nextHistory);
        toast(`Teach AI failed: ${err.message}`, { type: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGradeTeaching = async () => {
    if (userTurns === 0 || grading || busy) return;
    setGrading(true);
    try {
      const transcript = messages
        .map(m => `${m.role === 'user' ? 'You (Teacher)' : activePersona.name}: ${m.content}`)
        .join('\n');
      const raw = await aiText({
        system: buildFeynmanGradingPrompt({ personaId, lang }),
        user: `Reference Note ("${topicTitle}"):\n${String(note?.body || '').slice(0, 4000)}\n\nTeaching Transcript:\n${transcript}`,
        maxTokens: 700,
      });
      const parsed = parseFeynmanGradeJson(raw);
      setReport(parsed);

      if (parsed.missingGaps.length > 0) {
        for (const gap of parsed.missingGaps.slice(0, 3)) {
          await recordLearningSignal({
            subject,
            topic: gap.slice(0, 72),
            correct: false,
            mistakeSummary: `Missed while teaching "${topicTitle}" to ${activePersona.label}`,
            source: 'feynman',
            noteMode: 'study',
          });
        }
      } else {
        await recordLearningSignal({
          subject,
          topic: topicTitle.slice(0, 72),
          correct: parsed.accuracy >= 7 && parsed.clarity >= 7,
          source: 'feynman',
          noteMode: 'study',
        });
      }
      await logStudyActivity('reviews', 1);
      toast('Teaching graded & synced to DeepTutor Learner Memory!', { type: 'success' });
    } catch (err) {
      toast(`Could not grade session: ${err.message}`, { type: 'error' });
    } finally {
      setGrading(false);
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setMessages([
      {
        role: 'assistant',
        content: buildFeynmanOpeningMessage({ personaId, lang, topicTitle }),
      },
    ]);
    setInput('');
    setReport(null);
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="explanation-card" style={{ marginBottom: 0 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
          <div className="flex items-center gap-6" style={{ fontSize: 15, fontWeight: 700 }}>
            <GraduationCap size={17} style={{ color: 'var(--accent-ink)' }} /> Teach {activePersona.name}
          </div>
          <div className="flex items-center gap-6">
            <div className="feynman-lang-switch" role="group" aria-label="Conversation language">
              <button
                type="button"
                className={`feynman-lang-btn${lang === 'en' ? ' active' : ''}`}
                onClick={() => applyPersonaOrLangSwitch(personaId, 'en')}
              >
                English
              </button>
              <button
                type="button"
                className={`feynman-lang-btn${lang === 'taglish' ? ' active' : ''}`}
                onClick={() => applyPersonaOrLangSwitch(personaId, 'taglish')}
              >
                Taglish
              </button>
            </div>
            <button type="button" className="row-action-chip" onClick={handleReset} title="Restart roleplay">
              <RotateCcw size={12} /> Restart
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
          Who are you explaining <strong>{topicTitle}</strong> to? Pick a listener — each pushes you differently:
        </div>

        <div className="feynman-persona-row" role="listbox" aria-label="Reverse Feynman listener persona">
          {FEYNMAN_PERSONAS.map(p => {
            const selected = p.id === personaId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`feynman-persona-chip${selected ? ' active' : ''}`}
                onClick={() => applyPersonaOrLangSwitch(p.id, lang)}
              >
                <span>{p.emoji}</span>
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat bubbles */}
      <div className="feynman-chat-box">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`feynman-msg feynman-msg-enter ${m.role === 'user' ? 'is-user' : 'is-ai'}`}
            style={
              m.role === 'assistant'
                ? {
                    borderColor: activePersona.borderTint,
                    background: `linear-gradient(180deg, ${activePersona.tint}, var(--card-bg) 52%)`,
                  }
                : undefined
            }
          >
            <div className="feynman-msg-head">
              {m.role === 'user' ? (
                <>
                  <User size={12} /> You
                </>
              ) : (
                <>
                  <span>{activePersona.emoji}</span>
                  <span>
                    {activePersona.name} · {activePersona.roleBadge}
                  </span>
                </>
              )}
            </div>
            <div className="feynman-msg-body">
              {m.content ? (
                <MarkdownContent text={m.content} />
              ) : (
                <span className="scan-indicator" style={{ padding: 0, gap: 8 }}>
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>{activePersona.name} is thinking…</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Teaching Input */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          className="ai-input"
          style={{ marginTop: 0, flex: 1, minHeight: 54 }}
          placeholder={`Explain ${topicTitle} to ${activePersona.name} in your own words…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !input.trim()}
          aria-label="Send teaching explanation"
          style={{ height: 54, padding: '0 14px' }}
        >
          <Send size={16} />
        </button>
      </form>

      {/* Grade My Teaching Action */}
      <button
        type="button"
        className="btn btn-secondary w-full"
        disabled={userTurns === 0 || grading || busy}
        onClick={handleGradeTeaching}
      >
        <Award size={16} />
        {grading
          ? 'Evaluating clarity & audience fit…'
          : userTurns === 0
            ? 'Explain at least once to unlock Grade My Teaching'
            : `Grade My Teaching (${userTurns} turn${userTurns === 1 ? '' : 's'})`}
      </button>

      {/* 3-Axis Rubric Report Card */}
      {report && (
        <div className="explanation-card feynman-msg-enter" style={{ marginBottom: 0 }}>
          <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Teaching Rubric Report</div>
            <span className="row-action-chip active-chip">
              {activePersona.emoji} {activePersona.label}
            </span>
          </div>
          <div className="grade-stats-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 10 }}>
            <div className="grade-stat-card">
              <div className="grade-stat-label">Clarity</div>
              <div className="grade-stat-val">{report.clarity}/10</div>
              <div className="rubric-bar-track">
                <div className="rubric-bar-fill" style={{ width: `${report.clarity * 10}%` }} />
              </div>
            </div>
            <div className="grade-stat-card">
              <div className="grade-stat-label">Accuracy</div>
              <div className="grade-stat-val">{report.accuracy}/10</div>
              <div className="rubric-bar-track">
                <div className="rubric-bar-fill" style={{ width: `${report.accuracy * 10}%` }} />
              </div>
            </div>
            <div className="grade-stat-card">
              <div className="grade-stat-label">Audience Fit</div>
              <div className="grade-stat-val">{report.audienceFit}/10</div>
              <div className="rubric-bar-track">
                <div className="rubric-bar-fill" style={{ width: `${report.audienceFit * 10}%` }} />
              </div>
            </div>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: report.missingGaps.length ? 10 : 0 }}>
            {report.summary}
          </div>
          {report.missingGaps.length > 0 && (
            <div className="grade-box warn" style={{ marginTop: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Missing Concepts (Logged to DeepTutor Memory):
              </div>
              {report.missingGaps.map((g, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>
                  • {g}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
