/**
 * FeynmanCoachTab — Interactive "Teach the AI" Reverse Feynman Roleplay.
 *
 * The AI plays a curious 1st-year student who asks probing follow-up questions
 * until you truly understand the topic. Tap "Grade My Teaching" anytime to get
 * a Clarity / Accuracy rubric and sync missed concepts into DeepTutor Memory.
 */
import { useState, useRef } from 'react';
import { Send, Award, RotateCcw, Sparkles, User, GraduationCap } from 'lucide-react';
import { aiText, aiTextStream } from '../../lib/aiCore';
import { recordLearningSignal } from '../../lib/learnerMemory';
import { logStudyActivity } from '../../store/db';
import MarkdownContent from '../ui/MarkdownContent';
import { useDialog } from '../ui/DialogProvider';

function parseGradeJson(raw) {
  const txt = String(raw || '').trim();
  const match = /\{[\s\S]*\}/.exec(txt);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      return {
        clarity: Math.max(0, Math.min(10, Number(obj.clarity) || 7)),
        accuracy: Math.max(0, Math.min(10, Number(obj.accuracy) || 7)),
        summary: String(obj.summary || obj.verdict || 'Good effort teaching this concept!'),
        missingGaps: Array.isArray(obj.missingGaps || obj.gaps)
          ? (obj.missingGaps || obj.gaps).map(String).filter(Boolean).slice(0, 6)
          : [],
      };
    } catch {
      // fall through
    }
  }
  return {
    clarity: 7,
    accuracy: 7,
    summary: txt.slice(0, 400) || 'Teaching session graded.',
    missingGaps: [],
  };
}

export default function FeynmanCoachTab({ note }) {
  const { toast } = useDialog();
  const topicTitle = note?.title || 'this topic';
  const subject = note?.subject || 'General';

  const makeInitialMessages = () => [
    {
      role: 'assistant',
      content: `Hey! I'm a 1st-year student trying to learn **${topicTitle}**. I read the title, but I'm totally lost — can you explain the main idea to me in your own words?`,
    },
  ];

  const [messages, setMessages] = useState(makeInitialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [report, setReport] = useState(null);
  const abortRef = useRef(null);

  const userTurns = messages.filter(m => m.role === 'user').length;

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
        system: `You are playing the role of a curious, friendly 1st-year college student learning "${topicTitle}" (${subject}) from the user (your tutor).
Reference notes (do NOT recite them — use them silently to spot gaps or vague hand-waving in the user's explanation):
${noteContext || '(No note body provided)'}

Rules:
- Stay in character as a genuinely curious student.
- Briefly react to what the user explained (1 sentence), then ask ONE sharp, specific follow-up question probing a detail they glossed over, skipped, or haven't given an example for yet (e.g., "Wait, why does X happen if Y changes?" or "Can you give me a real-life analogy for that?").
- Keep replies short (2–4 sentences max) and encouraging.`,
        user: text,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        maxTokens: 450,
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
        .map(m => `${m.role === 'user' ? 'Student-Teacher' : 'AI-Learner'}: ${m.content}`)
        .join('\n');
      const raw = await aiText({
        system:
          'You are an academic evaluator grading a Feynman Technique teaching session. Return STRICT JSON ONLY: {"clarity": 0-10, "accuracy": 0-10, "summary": "2 sentences of constructive feedback", "missingGaps": ["specific concept skipped or explained inaccurately"]}.',
        user: `Reference Note ("${topicTitle}"):\n${String(note?.body || '').slice(0, 4000)}\n\nTeaching Transcript:\n${transcript}`,
        maxTokens: 700,
      });
      const parsed = parseGradeJson(raw);
      setReport(parsed);

      // Sync weak gaps into DeepTutor Persistent Learner Memory!
      if (parsed.missingGaps.length > 0) {
        for (const gap of parsed.missingGaps.slice(0, 3)) {
          await recordLearningSignal({
            subject,
            topic: gap.slice(0, 72),
            correct: false,
            mistakeSummary: `Missed while teaching "${topicTitle}"`,
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
    setMessages(makeInitialMessages());
    setInput('');
    setReport(null);
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="explanation-card" style={{ marginBottom: 0 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
          <div className="flex items-center gap-6" style={{ fontSize: 15, fontWeight: 700 }}>
            <GraduationCap size={17} style={{ color: 'var(--accent-ink)' }} /> Teach the AI (Reverse Feynman)
          </div>
          <button type="button" className="row-action-chip" onClick={handleReset} title="Restart roleplay">
            <RotateCcw size={12} /> Restart
          </button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          You are the professor. Explain <strong>{topicTitle}</strong> simply — the AI plays a curious student and asks
          probing follow-ups to uncover blind spots.
        </div>
      </div>

      {/* Chat bubbles */}
      <div className="feynman-chat-box">
        {messages.map((m, idx) => (
          <div key={idx} className={`feynman-msg ${m.role === 'user' ? 'is-user' : 'is-ai'}`}>
            <div className="feynman-msg-head">
              {m.role === 'user' ? (
                <>
                  <User size={12} /> You (Teacher)
                </>
              ) : (
                <>
                  <Sparkles size={12} /> Curious Student (AI)
                </>
              )}
            </div>
            <div className="feynman-msg-body">
              {m.content ? (
                <MarkdownContent text={m.content} />
              ) : (
                <span className="scan-indicator" style={{ padding: 0 }}>
                  <span className="spinner" style={{ width: 13, height: 13 }} /> Thinking of a question…
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
          placeholder="Teach the student in plain words…"
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
          ? 'Evaluating your teaching…'
          : userTurns === 0
            ? 'Explain at least once to unlock Grade My Teaching'
            : `Grade My Teaching (${userTurns} turn${userTurns === 1 ? '' : 's'})`}
      </button>

      {/* Rubric Report Card */}
      {report && (
        <div className="explanation-card" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Teaching Rubric Report</div>
          <div className="grade-stats-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
            <div className="grade-stat-card">
              <div className="grade-stat-label">Clarity</div>
              <div className="grade-stat-val">{report.clarity}/10</div>
            </div>
            <div className="grade-stat-card">
              <div className="grade-stat-label">Accuracy</div>
              <div className="grade-stat-val">{report.accuracy}/10</div>
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
