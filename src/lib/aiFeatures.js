/**
 * aiFeatures — prompt builders, critical-thinking pipelines, research synthesis,
 * and study generators. Designed to be both intellectually rigorous AND
 * free-tier friendly (1-call Quick mode via local RAG, graceful 429 fallback).
 */
import { aiText, aiTextStream, aiVision } from './aiCore';
import { getReasonModel, getExplainStyle } from './aiConfig';
import { extractRelevantLines, retrieveCrossNoteContext } from './localRag';
import { runMultiSourceResearch } from './research';
import { getChatModeDirective } from './noteModes';
import { parseJsonObject, stripThinking } from '../../shared/aiParsers.js';
import { styleLine } from '../../shared/aiPrompts.js';

const getStyleLine = style => styleLine(style || getExplainStyle());

function formatCrossNoteBlock(crossSnippets) {
  if (!crossSnippets || crossSnippets.length === 0) return '';
  return (
    'OTHER RELATED NOTES FROM THIS SUBJECT (cite as "From your note <Title>"):\n' +
    crossSnippets.map(s => `- [${s.title}]: ${s.excerpt}`).join('\n')
  );
}

// ---------------- 1. Chat with a note (Quick / Deep Verify / Research / Socratic) ----------------

/**
 * Chat with a note — returns { text, reasoning, verified, sources, relatedNotes, queries, truncated }.
 *
 * Modes:
 * - Default (Quick): 1 single LLM call (half previous API usage!) grounded via
 *   local BM25 relevant lines + Cross-Note Local RAG.
 * - deep=true: 2-pass Solve → Skeptical Verify pipeline checking math, logic,
 *   hidden assumptions, and contradictions (graceful fallback to Pass 1 on 429).
 * - research=true: Multi-step scholarly research (Query Planner → Wikipedia +
 *   OpenAlex academic papers + optional Tavily → Cited synthesis).
 * - socratic=true: Socratic coach that probes reasoning & asks guiding questions
 *   instead of spoon-feeding answers.
 */
export async function chatWithNote({
  note,
  title,
  subject,
  noteMode = 'study',
  siblingNotes = [],
  learnerContext = '',
  history = [],
  question,
  style,
  deep = false,
  research = false,
  socratic = false,
  onToken = null,
  onStatus = null,
  onFallback = null,
  signal = null,
}) {
  const fullNote = String(note || '');
  const truncated = fullNote.length > 8000;
  const noteSlice = fullNote.slice(0, 8000);
  const memoryBlock =
    learnerContext && noteMode !== 'journal' && noteMode !== 'vault'
      ? `\n${learnerContext}\n`
      : '';
  const sLine = getStyleLine(style);
  const modeDirective = getChatModeDirective(noteMode);
  const lang = "Reply in the note's language.";

  const cleanHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }));

  // ---- Local Cross-Note RAG (0 API calls, runs offline in <5ms) ----
  const crossSnippets = retrieveCrossNoteContext(
    { title, body: fullNote },
    siblingNotes,
    question,
    { maxSnippets: 3, maxChars: 1500 }
  );
  const relatedNotes = [...new Set(crossSnippets.map(s => s.title))];
  const crossBlock = formatCrossNoteBlock(crossSnippets);

  // ---- Optional Multi-Step Scholarly Research (Wikipedia + OpenAlex + optional Tavily) ----
  let sources = [];
  let queries = [];
  let researchBlock = '';
  if (research) {
    const res = await runMultiSourceResearch({
      question,
      noteTitle: title,
      subject,
      noteExcerpt: noteSlice.slice(0, 700),
      signal,
      onStatus,
    });
    sources = res.sources;
    queries = res.queries;
    if (sources.length > 0) {
      researchBlock =
        'EXTERNAL RESEARCH SOURCES (cite with [1], [2]…):\n' +
        sources
          .map(
            s =>
              `[${s.index}] (${s.kind.toUpperCase()}${s.year ? ` ${s.year}` : ''}) ${s.title}\n${s.content}`
          )
          .join('\n\n');
    }
  }

  // ---- Socratic Coaching Mode ----
  if (socratic) {
    onStatus?.('Preparing guiding question…');
    const sys = `You are a Socratic critical-thinking tutor helping a student master their class notes.
RULES:
1. Do NOT give away the full final answer right away unless the student has already worked through it or explicitly says "just tell me".
2. Briefly validate what is right or spot any hidden assumption/flaw in the student's question or reasoning.
3. Offer at most ONE concise conceptual hint grounded in the note${crossBlock ? ' or related folder notes' : ''}${researchBlock ? ' or research [n]' : ''}.
4. End with ONE sharp, probing follow-up question that pushes the student to deduce the next logical step themselves.
5. Keep total reply under 130 words. ${sLine} ${lang}

NOTE TITLE: ${title || 'Untitled'} (${subject || 'General'})
NOTE:
---
${noteSlice}
---
${crossBlock}
${researchBlock}`;

    const text = await aiTextStream({
      system: sys,
      user: question,
      history: cleanHistory.slice(-8),
      maxTokens: 900,
      timeoutMs: 180000,
      signal,
      onToken,
      onStatus,
      onFallback,
    });
    return {
      text: stripThinking(text),
      reasoning: null,
      verified: false,
      sources,
      relatedNotes,
      queries,
      truncated,
    };
  }

  // ---- Deep Think: 2-Pass "Solve → Skeptical Verify" Pipeline ----
  if (deep) {
    const reasonModel = getReasonModel();
    onStatus?.('Pass 1/2 — Solving step-by-step…');

    const solveSys = `You are DeepTutor, a rigorous dual-loop analytical tutor. Work through the student's question thoroughly:
1. Restate the core problem and identify all premises/assumptions.
2. Derive the logic, code, or math step by step (use LaTeX $...$ for formulas).
3. Explicitly distinguish claims from: (a) the student's notes, (b) external sources [n] if provided, and (c) general principles.
4. Check at least one edge case, counterexample, or alternative interpretation.
${sLine} ${lang}
${memoryBlock}
NOTE TITLE: ${title || 'Untitled'} (${subject || 'General'})
NOTE:
---
${noteSlice}
---
${crossBlock}
${researchBlock}`;

    const draftReasoning = await aiText({
      system: solveSys,
      user: question,
      history: cleanHistory.slice(-6),
      maxTokens: 2200,
      timeoutMs: 240000,
      modelOverride: reasonModel,
      useReasoning: true,
      signal,
      onFallback,
    });

    // Pass 2: Skeptical Logical Verification & Clean Synthesis (streams live!)
    onStatus?.('Pass 2/2 — Verifying logic & edge cases…');
    try {
      const verifySys = `You are a skeptical logic & accuracy reviewer auditing a tutor's draft answer against a student's class notes.
AUDIT CHECKLIST (apply silently, then produce the improved final answer):
- Catch any arithmetic, algebra, unit, or formula mistakes.
- Catch unsupported leaps, hidden assumptions, or contradictions with the student's notes.
- If external sources [n] are provided, keep citations accurate and highlight any nuance or disagreement.
- Present a crisp, high-signal final answer (under 240 words) with clear structure (bold key takeaways, bullet steps, or math $...$).
- If there is an important caveat, assumption, or edge case, include a brief **Key Nuance** line at the end.
${sLine} ${lang}`;

      const verifyUser = `STUDENT QUESTION: ${question}

STUDENT NOTE (${title || 'Untitled'}):
---
${noteSlice.slice(0, 4500)}
---
${crossBlock ? '\n' + crossBlock : ''}
${researchBlock ? '\n' + researchBlock : ''}

DRAFT REASONING TO AUDIT:
---
${draftReasoning.slice(0, 3500)}
---

Write ONLY the verified, clear final answer now.`;

      const verifiedText = await aiTextStream({
        system: verifySys,
        user: verifyUser,
        maxTokens: 1600,
        timeoutMs: 180000,
        signal,
        onToken,
        onStatus,
        onFallback,
      });

      return {
        text: stripThinking(verifiedText),
        reasoning: stripThinking(draftReasoning),
        verified: true,
        sources,
        relatedNotes,
        queries,
        truncated,
      };
    } catch (verifyErr) {
      if (verifyErr?.isCancelled) throw verifyErr;
      // Graceful free-tier fallback: never lose Pass 1's valid work if Pass 2 hits a 429!
      const fallbackText = stripThinking(draftReasoning);
      onToken?.(fallbackText);
      return {
        text: fallbackText,
        reasoning: null,
        verified: false,
        sources,
        relatedNotes,
        queries,
        truncated,
      };
    }
  }

  // ---- Multi-Step Research Synthesis (without Deep Think's extra verification pass) ----
  if (research) {
    onStatus?.('Synthesizing research brief…');
    const sys = `You are a rigorous academic research tutor. Synthesize the EXTERNAL RESEARCH SOURCES and the student's class notes to answer the question deeply and critically.

STRUCTURE YOUR ANSWER (clean Markdown, ~200-280 words):
- **Core Answer**: Direct, clear synthesis citing sources as [1], [2]…
- **Evidence & Nuance**: Mention methodology, limits, edge cases, or competing viewpoints if relevant.
- **Connection to Your Notes**: Explicitly note how this confirms, extends, or corrects what the student wrote${crossBlock ? ' (including related folder notes)' : ''}.
- **Think Further**: End with 1 sharp critical-thinking question for the student.

STRICT: Never fabricate citations — only cite numbers present in EXTERNAL RESEARCH SOURCES. ${sLine} ${lang}

NOTE TITLE: ${title || 'Untitled'} (${subject || 'General'})
NOTE:
---
${noteSlice.slice(0, 4500)}
---
${crossBlock}
${researchBlock || '(No external sources returned — answer from the notes and clearly state that external search returned no hits.)'}`;

    const text = await aiTextStream({
      system: sys,
      user: question,
      history: cleanHistory.slice(-6),
      maxTokens: 1800,
      timeoutMs: 180000,
      signal,
      onToken,
      onStatus,
      onFallback,
    });

    return {
      text: stripThinking(text),
      reasoning: null,
      verified: false,
      sources,
      relatedNotes,
      queries,
      truncated,
    };
  }

  // ---- Quick Mode (1 single API call! Deduplicated prompt context for faster TTFT, zero quality loss) ----
  let focusHint;
  if (noteSlice.length <= 4500) {
    focusHint = `NOTE:\n---\n${noteSlice}\n---`;
  } else {
    const relevantLines = extractRelevantLines(noteSlice, question, { maxLines: 16 });
    const introSlice = noteSlice.slice(0, 1600);
    focusHint =
      relevantLines.length > 0
        ? `MOST RELEVANT LINES IN THIS NOTE:\n${relevantLines.map(l => `- ${l}`).join('\n')}\n\nNOTE OPENING CONTEXT:\n---\n${introSlice}\n---`
        : `NOTE:\n---\n${noteSlice.slice(0, 5000)}\n---`;
  }

  const sys = `${
    modeDirective
      ? modeDirective
      : 'You are a sharp, rigorous study tutor.'
  } ${sLine} ${lang}
${memoryBlock}
NOTE TITLE: ${title || 'Untitled'} (${subject || 'General'})
${focusHint}
${crossBlock}

GUIDELINES:
${
  noteMode === 'journal'
    ? `- Ground your response in what the user actually shared. Never lecture, quiz, or treat personal feelings as factual mistakes.
- Keep your reply warm, clear, and concise (under 180 words) using clean Markdown.`
    : `- Ground claims in the note (and related notes when relevant). Clearly distinguish note facts from general knowledge.
- Think critically before answering: verify any math/logic internally, challenge flawed premises respectfully, and note key assumptions.
- Keep answers crisp and clear (under 180 words) using clean Markdown (bold, bullets, code blocks, inline math $...$).
- If the note doesn't cover the question, answer helpfully from general knowledge while explicitly noting it's outside the note (and suggest toggling **Research** for cited sources).`
}`;

  const text = await aiTextStream({
    system: sys,
    user: question,
    history: cleanHistory.slice(-6),
    maxTokens: 1400,
    timeoutMs: 180000,
    signal,
    onToken,
    onStatus,
    onFallback,
  });

  return {
    text: stripThinking(text),
    reasoning: null,
    verified: false,
    sources: [],
    relatedNotes,
    queries: [],
    truncated,
  };
}

// ---------------- 2. Challenge My Notes (Critical & Logical Audit) ----------------
export async function critiqueNote({ note, title, subject, siblingNotes = [], signal = null }) {
  const crossSnippets = retrieveCrossNoteContext(
    { title, body: note },
    siblingNotes,
    `${title || ''} ${String(note || '').slice(0, 500)}`,
    { maxSnippets: 3, maxChars: 1400 }
  );
  const crossBlock = formatCrossNoteBlock(crossSnippets);

  const sys = `You are a sharp university professor performing a critical-thinking audit on a student's class notes.
Identify:
1. "strengths": 1-2 concepts explained clearly and accurately.
2. "gaps": 2-4 logical gaps, missing causal links, unstated assumptions, or vague statements that an exam would expose.
3. "contradictions": any internal contradictions or conflicts with sibling notes (empty array if none).
4. "challenges": 3 higher-order critical thinking questions (Why? / What happens if X changes? / Counterexample? / Compare & evaluate) with concise model reasoning.

OUTPUT ONLY valid JSON:
{
  "strengths": ["..."],
  "gaps": [{"issue": "...", "whyItMatters": "...", "suggestion": "..."}],
  "contradictions": ["..."],
  "challenges": [{"question": "...", "reasoning": "..."}]
}
Reply in the note's language.`;

  const user = `TITLE: ${title || 'Untitled'} (${subject || 'General'})
NOTE:
---
${String(note || '').slice(0, 7000)}
---
${crossBlock}`;

  const raw = await aiText({ system: sys, user, maxTokens: 2400, timeoutMs: 180000, signal });
  const d = parseJsonObject(raw);
  return {
    strengths: Array.isArray(d.strengths) ? d.strengths.map(String).filter(Boolean) : [],
    gaps: Array.isArray(d.gaps)
      ? d.gaps
          .filter(g => g && (g.issue || typeof g === 'string'))
          .map(g =>
            typeof g === 'string'
              ? { issue: g, whyItMatters: '', suggestion: '' }
              : {
                  issue: String(g.issue || '').trim(),
                  whyItMatters: String(g.whyItMatters || '').trim(),
                  suggestion: String(g.suggestion || '').trim(),
                }
          )
      : [],
    contradictions: Array.isArray(d.contradictions) ? d.contradictions.map(String).filter(Boolean) : [],
    challenges: Array.isArray(d.challenges)
      ? d.challenges
          .filter(c => c && c.question)
          .map(c => ({
            question: String(c.question).trim(),
            reasoning: String(c.reasoning || '').trim(),
          }))
      : [],
  };
}

// ---------------- 3. Feynman Technique Coach ----------------
export async function evaluateFeynman({ note, concept, explanation, subject, signal = null }) {
  const sys = `You are a Feynman Technique coach evaluating a student's plain-language explanation of a concept against their class notes.
Look specifically for:
- Jargon used without explaining what it actually means
- Logical leaps or missing cause-and-effect steps
- Hidden assumptions or factual slips vs the note

OUTPUT ONLY valid JSON:
{
  "score": <0-100>,
  "verdict": "crystal clear|solid|hand-wavy|needs work",
  "strengths": "1 sentence on what they nailed",
  "gaps": ["specific logical leap or unexplained jargon 1", "..."],
  "followUpQuestion": "1 sharp probing question to force them to close their biggest conceptual gap"
}
Reply in the note's language.`;

  const user = `SUBJECT: ${subject || 'General'}
CONCEPT: ${concept}
REFERENCE NOTE:
---
${String(note || '').slice(0, 5000)}
---
STUDENT'S PLAIN-LANGUAGE EXPLANATION:
${explanation}`;

  const raw = await aiText({ system: sys, user, maxTokens: 1400, timeoutMs: 180000, signal });
  const d = parseJsonObject(raw);
  const score = Number.isFinite(Number(d.score)) ? Math.max(0, Math.min(100, Math.round(Number(d.score)))) : 0;
  return {
    score,
    verdict: typeof d.verdict === 'string' ? d.verdict : score >= 80 ? 'crystal clear' : score >= 60 ? 'solid' : 'hand-wavy',
    strengths: typeof d.strengths === 'string' ? d.strengths.trim() : '',
    gaps: Array.isArray(d.gaps) ? d.gaps.map(String).filter(Boolean) : [],
    followUpQuestion: typeof d.followUpQuestion === 'string' ? d.followUpQuestion.trim() : '',
  };
}

// ---------------- 4. TL;DR summary ----------------
export async function summarizeNote({ note, subject, style, onToken = null, signal = null }) {
  const sLine = getStyleLine(style);
  const sys = `Summarize the student's ${subject || ''} note in one concise paragraph or 3-4 crisp bullet points (max 90 words), capturing the core mechanism and key takeaways. ${sLine} Reply in the note's language. Output ONLY the summary.`;
  return aiTextStream({
    system: sys,
    user: (note || '').slice(0, 8000),
    maxTokens: 500,
    timeoutMs: 120000,
    onToken,
    signal,
  });
}

// ---------------- 5. OCR (photo → text) ----------------
export async function ocrImage({ imageDataUrl, subject, signal = null }) {
  const sys =
    'You are an OCR assistant. Transcribe ALL visible handwritten or printed text from the image exactly as written, preserving line breaks. Clean up obvious OCR artifacts but never invent content. Output ONLY the transcribed text.';
  return aiVision({
    system: sys,
    user: `Transcribe all text from this ${subject || ''} note photo. Output only the text.`,
    imageDataUrl,
    maxTokens: 2000,
    signal,
  });
}

// ---------------- 6. Explain a photo ----------------
export async function explainImage({ imageDataUrl, noteContext, subject, style, signal = null }) {
  const sLine = getStyleLine(style);
  const sys = `You are a study tutor. The student photographed part of their study material. Explain what the image shows, how the parts relate logically, and the key ideas to learn from it in under 160 words. Use clean markdown bullets if helpful. ${sLine} Reply in the same language as any text in the image.`;
  const ctx = noteContext ? `Note context (may help): ${noteContext.slice(0, 1500)}` : '';
  return aiVision({
    system: sys,
    user: `Explain this image for studying.${ctx ? '\n\n' + ctx : ''}`,
    imageDataUrl,
    maxTokens: 1200,
    signal,
  });
}

// ---------------- 7. Fill-in-the-blank (cloze) ----------------
export async function generateCloze({ note, subject, count = 8, signal = null }) {
  const sys = `Create ${count} fill-in-the-blank study questions from the ${subject || ''} note. Each takes one KEY word or short phrase from the note and replaces it with "____".
OUTPUT: ONLY valid JSON: {"items": [{"text": "sentence with ____ inside", "answer": "the missing word(s)"}]}
Rules: answers must appear in the note; test cause-effect & key definitions rather than filler words; reply in the note's language.`;
  const raw = await aiText({
    system: sys,
    user: (note || '').slice(0, 8000),
    maxTokens: 2000,
    timeoutMs: 180000,
    signal,
  });
  const d = parseJsonObject(raw);
  return (d.items || []).filter(
    i => i && typeof i.text === 'string' && typeof i.answer === 'string' && i.text.trim() && i.answer.trim()
  );
}

// ---------------- 8. Mnemonics ----------------
export async function generateMnemonics({ note, subject, signal = null }) {
  const sys = `From the ${subject || ''} note, extract up to 6 key terms/lists and create a memorable mnemonic or memory hook for each (acronyms, rhymes, vivid associations).
OUTPUT: ONLY valid JSON: {"items": [{"term": "the term or list", "hook": "the mnemonic"}]}
Reply in the note's language. Make hooks genuinely memorable, not generic.`;
  const raw = await aiText({
    system: sys,
    user: (note || '').slice(0, 8000),
    maxTokens: 1500,
    timeoutMs: 180000,
    signal,
  });
  const d = parseJsonObject(raw);
  return (d.items || []).filter(
    i => i && typeof i.term === 'string' && typeof i.hook === 'string' && i.term.trim() && i.hook.trim()
  );
}

// ---------------- 9. Exam predictor (Bloom's higher-order focus) ----------------
export async function predictExamQuestions({ notes, subject, count = 6, signal = null }) {
  const notesText = notes
    .map((n, i) => `Note ${i + 1} — ${n.title || 'Untitled'}:\n${(n.body || '').slice(0, 1500)}`)
    .join('\n\n');
  const sys = `You are an experienced university examiner. From these ${subject || ''} class notes, predict ${count} likely EXAM questions prioritizing conceptual understanding, application, comparison, and edge-case reasoning ("What happens if…?", "Compare X vs Y…", "Explain why…") rather than pure rote trivia. Write a clear model answer (2-4 sentences) and difficulty ("easy" | "medium" | "hard") for each.
OUTPUT: ONLY valid JSON: {"items": [{"question": "...", "answer": "model answer", "difficulty": "medium"}]}
Vary difficulty. Reply in the notes' language.`;
  const raw = await aiText({
    system: sys,
    user: notesText.slice(0, 10000),
    maxTokens: 3000,
    timeoutMs: 240000,
    signal,
  });
  const d = parseJsonObject(raw);
  return (d.items || [])
    .filter(i => i && typeof i.question === 'string' && typeof i.answer === 'string')
    .map(i => ({
      question: i.question.trim(),
      answer: i.answer.trim(),
      difficulty: ['easy', 'medium', 'hard'].includes(i.difficulty) ? i.difficulty : 'medium',
    }));
}

// ---------------- 10. Weakness detection ----------------
export async function analyzeWeakness({ note, quiz, answers, style, signal = null }) {
  const qa = quiz.map((q, i) => ({
    question: q.question,
    correct: q.choices[q.answer],
    yourAnswer: answers[i] != null ? q.choices[answers[i]] : '(skipped)',
    isCorrect: answers[i] === q.answer,
  }));
  const sLine = getStyleLine(style);
  const sys = `A student took a quiz on their notes. Diagnose their conceptual blind spots and create 3 targeted practice questions that test application & reasoning (not just reworded recall).
OUTPUT: ONLY valid JSON: {"weakAreas": ["area1", "area2"], "practice": [{"question": "...", "choices": ["A","B","C","D"], "answer": 0, "explanation": "why this choice is right and why common traps fail"}]}
Base everything on the quiz results and the note. ${sLine} Reply in the note's language.`;
  const user = `NOTE:\n---\n${(note || '').slice(0, 5000)}\n---\n\nQUIZ RESULTS:\n${JSON.stringify(qa, null, 1)}`;
  const raw = await aiText({ system: sys, user, maxTokens: 2000, timeoutMs: 180000, signal });
  const d = parseJsonObject(raw);
  const practice = (d.practice || [])
    .filter(p => p && typeof p.question === 'string' && Array.isArray(p.choices) && p.choices.length >= 2)
    .map(p => {
      const choices = p.choices.map(String);
      const ans = Number(p.answer);
      return {
        question: p.question.trim(),
        choices,
        answer: Number.isInteger(ans) && ans >= 0 && ans < choices.length ? ans : 0,
        explanation: typeof p.explanation === 'string' ? p.explanation.trim() : '',
      };
    });
  return {
    weakAreas: Array.isArray(d.weakAreas) ? d.weakAreas.map(String).filter(Boolean) : [],
    practice,
  };
}

// ---------------- 11. Answer grader ----------------
export async function gradeAnswer({ note, question, userAnswer, style, signal = null }) {
  const sLine = getStyleLine(style);
  const sys = `You are a strict but fair examiner. Grade the student's answer on logical soundness, accuracy, and completeness against the study notes.
OUTPUT: ONLY valid JSON: {"score": <0-100>, "verdict": "excellent|good|partial|poor", "feedback": "2-3 sentences: what was logically sound, what was missing or imprecise, and how to sharpen it"}
Reply in the notes' language. ${sLine}`;
  const user = `NOTES:\n---\n${(note || '').slice(0, 6000)}\n---\nQUESTION: ${question}\n\nSTUDENT ANSWER: ${userAnswer || '(empty)'}`;
  const raw = await aiText({ system: sys, user, maxTokens: 1200, timeoutMs: 180000, signal });
  const d = parseJsonObject(raw);
  const score = Number.isFinite(Number(d.score))
    ? Math.max(0, Math.min(100, Math.round(Number(d.score))))
    : 0;
  return {
    score,
    verdict:
      typeof d.verdict === 'string'
        ? d.verdict
        : score >= 85
          ? 'excellent'
          : score >= 65
            ? 'good'
            : score >= 40
              ? 'partial'
              : 'poor',
    feedback: typeof d.feedback === 'string' ? d.feedback : '',
  };
}

// ---------------- 12. Cross-note links ----------------
export async function findRelatedNotes({ currentNote, otherNotes, signal = null }) {
  const list = otherNotes
    .map((n, i) => `${i}: ${n.title || 'Untitled'} — ${(n.body || '').slice(0, 300).replace(/\n/g, ' ')}`)
    .join('\n');
  const sys = `Identify which of the student's OTHER notes relate to the current note (shared concepts, prerequisites, causal links, or contrasting ideas).
OUTPUT: ONLY valid JSON: {"links": [{"index": <number from the list>, "reason": "why they relate (one short sentence)"}]}
Only include genuinely related notes (max 4). If none relate, return {"links": []}. Reply in the current note's language.`;
  const user = `CURRENT NOTE: ${currentNote.title || 'Untitled'}\n${(currentNote.body || '').slice(0, 2500)}\n\nOTHER NOTES:\n${list.slice(0, 7000)}`;
  const raw = await aiText({ system: sys, user, maxTokens: 1200, timeoutMs: 180000, signal });
  const d = parseJsonObject(raw);
  return (d.links || [])
    .filter(l => Number.isInteger(l.index) && otherNotes[l.index])
    .map(l => ({
      note: otherNotes[l.index],
      reason: l.reason || '',
    }));
}

// ---------------- 13. Clean Voice Dictation Transcript ----------------
export async function cleanDictation({ transcript, subject = 'General', signal = null }) {
  const clean = String(transcript || '').trim();
  if (!clean) return '';
  const sys = `You are a study-note editor cleaning up a raw voice-dictated class lecture or spoken study note.

RULES:
- Remove verbal filler words ("um", "uh", "like", "you know", "ano", "kumbaga", false starts, repetitions).
- Fix punctuation, capitalization, and obvious speech-to-text typos while keeping the speaker's exact technical meaning.
- Organize into clean Markdown using ## headings (when multiple topics exist) and concise bullet points (bold key terms, use $...$ LaTeX for spoken math formulas).
- Keep the same language (or Taglish/code-switching) the student spoke in.
- Output ONLY the cleaned Markdown note text — no preamble or commentary.`;

  const out = await aiText({
    system: sys,
    user: `SUBJECT: ${subject}\n\nRAW TRANSCRIPT:\n---\n${clean.slice(0, 9000)}\n---`,
    maxTokens: 2000,
    timeoutMs: 180000,
    signal,
  });
  return stripThinking(out).trim() || clean;
}

// ---------------- 14. 1-Tap AI Writing Polish ----------------
export async function polishWritingWithAI({ text, goal = 'grammar', subject = 'General', signal = null }) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const goalDirectives = {
    grammar: 'Fix spelling, grammar, punctuation, and awkward phrasing while preserving the author’s voice, structure, Markdown, code blocks, and math formulas.',
    clearer: 'Improve clarity, flow, and readability while preserving all facts, Markdown headings, code blocks, and math formulas.',
    academic: 'Elevate the tone to clear, formal academic writing suitable for university reports and papers while keeping exact meaning, Markdown, and math.',
    concise: 'Tighten wordiness and remove repetition while keeping every key fact, definition, code block, and formula intact.',
  };
  const sys = `You are a careful writing editor.
TASK: ${goalDirectives[goal] || goalDirectives.grammar}
RULES:
- Preserve Markdown formatting, [[wiki-links]], #tags, fenced code blocks, and $LaTeX$ math exactly.
- Keep the original language (including English or Taglish if used).
- Output ONLY the revised text — no intro, no explanations, no markdown fence wrapping the whole reply.`;

  const out = await aiText({
    system: sys,
    user: `CONTEXT: ${subject}\n\nTEXT TO POLISH:\n---\n${clean.slice(0, 9000)}\n---`,
    maxTokens: 2400,
    timeoutMs: 180000,
    signal,
  });
  return stripThinking(out).trim() || clean;
}

// ---------------- 15. Explain / Trace / Debug Code Block (Live Streaming!) ----------------
export async function debugCodeWithAI({ code, lang = '', noteContext = '', onToken = null, signal = null }) {
  const src = String(code || '').trim();
  if (!src) return '';
  const sys = `You are a sharp computer science & programming mentor reviewing a code snippet from a student's note.
Provide a crisp, high-signal Markdown analysis (under 240 words):
- **What It Does**: 1–2 sentences explaining the intent.
- **Step-by-Step Trace**: Brief dry run of key variables / execution flow.
- **Bugs & Edge Cases**: Flag any syntax/logic bugs, off-by-one errors, null/empty pitfalls, or security issues (or state "Looks solid" if clean).
- **Complexity & Tip**: Time/Space Big-O (when applicable) and 1 practical improvement.`;

  const out = await aiTextStream({
    system: sys,
    user: `LANGUAGE: ${lang || 'auto-detect'}\n${noteContext ? `NOTE CONTEXT: ${noteContext.slice(0, 600)}\n\n` : ''}CODE:\n\`\`\`${lang}\n${src.slice(0, 5000)}\n\`\`\``,
    maxTokens: 1200,
    timeoutMs: 180000,
    onToken,
    signal,
  });
  return stripThinking(out).trim();
}
