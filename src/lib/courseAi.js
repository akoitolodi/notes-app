/**
 * courseAi — Course-Scoped AI Tutor grounded directly in a specific Course's
 * manually uploaded Modules & Files (.pdf, .pptx, .docx, pasted Canvas pages, OCR)
 * plus non-vault notes in the course's linked folder.
 *
 * Strictly enforces Zero-AI & Hidden Vault isolation (never touches locked or vault folders).
 */
import { db, buildMaterialChunks } from '../store/db';
import { retrieveCourseChunks } from './localRag';
import { aiText, aiTextStream } from './aiCore';
import { getAdaptiveTimeouts } from './netResilience';
import { getLearnerContextDigest } from './learnerMemory';

/** Load all indexed chunks for a specific course (strictly excluding locked/vault folders). */
export async function loadSafeCourseChunks(course, { selectedMaterialIds = null } = {}) {
  if (!course?.id) return [];
  const matChunks = await db.materialChunks.where('courseId').equals(course.id).toArray().catch(() => []);
  const filterActive = Array.isArray(selectedMaterialIds) && selectedMaterialIds.length > 0;
  const scopedMatChunks = filterActive
    ? matChunks.filter(c => selectedMaterialIds.includes(c.materialId))
    : matChunks;

  // Also include notes from the course's linked folder ONLY if unlocked & non-vault AND user didn't pin specific files only
  const noteChunks = [];
  if (!filterActive && typeof course.folderId === 'number') {
    const folder = await db.folders.get(course.folderId).catch(() => null);
    if (folder && !folder.locked && !folder.isSystemVault && folder.mode !== 'vault') {
      const notes = (await db.notes.where('folderId').equals(course.folderId).toArray().catch(() => [])).filter(
        n => !n.trashed && n.mode !== 'vault' && (n.body || '').trim()
      );
      for (const n of notes.slice(0, 20)) {
        const split = buildMaterialChunks(n.body, n.title || 'Class Note').slice(0, 6);
        for (const ch of split) {
          noteChunks.push({
            courseId: course.id,
            materialId: `note:${n.id}`,
            moduleName: 'Class Notes',
            materialTitle: n.title || 'Untitled Note',
            label: ch.label,
            text: ch.text,
          });
        }
      }
    }
  }

  return [...scopedMatChunks, ...noteChunks];
}

/** Stream a Course AI Tutor response grounded in the course's uploaded modules/files with citations. */
export async function askCourseAiStream({
  course,
  question,
  history = [],
  selectedMaterialIds = null,
  signal = null,
  onToken = null,
  onStatus = null,
}) {
  const { ragTopK, slow } = getAdaptiveTimeouts();
  const allChunks = await loadSafeCourseChunks(course, { selectedMaterialIds });
  const hits = retrieveCourseChunks(allChunks, question, {
    topK: ragTopK,
    maxChars: slow ? 3600 : 5400,
    materialIds: selectedMaterialIds,
  });

  const memoryDigest = await getLearnerContextDigest(course.name || course.code || 'General');

  const contextBlock =
    hits.length > 0
      ? hits
          .map((h, i) => `[Source ${i + 1}: ${h.citation}]\n${h.excerpt}`)
          .join('\n\n---\n\n')
      : '(No uploaded modules or notes found yet for this course — answer helpfully using general academic knowledge and remind the student they can upload PDFs/PPTXs/DOCXs in Modules & Files.)';

  const system = `You are DeepTutor, a dedicated AI study coach for the course "${course.name}" (${course.code || ''}).
Answer the student's question grounded strictly in the uploaded course module excerpts below whenever relevant.
- Cite sources inline using exact bracket labels like **[Module 1 · Lecture2.pptx — Slide 5]** when referencing uploaded files.
- Use clear Markdown, concise bullet points, and KaTeX math ($...$) where helpful.
- If a detail isn't in the uploaded materials, say so briefly before filling in the concept cleanly.
${memoryDigest ? `\n${memoryDigest}` : ''}`;

  const answer = await aiTextStream({
    system,
    user: `Course Materials Context:\n${contextBlock}\n\nStudent Question:\n${question}`,
    history: history.slice(-8),
    maxTokens: 1600,
    task: 'balanced',
    signal,
    onToken,
    onStatus,
  });

  return { answer, sources: hits };
}

/** Generate a structured Study Guide or Flashcards + Quiz pack from selected course modules/files. */
export async function generateCourseStudyPack({
  course,
  selectedMaterialIds = null,
  kind = 'summary', // 'summary' | 'flashcards'
  signal = null,
}) {
  const allChunks = await loadSafeCourseChunks(course, { selectedMaterialIds });
  const hits = retrieveCourseChunks(allChunks, 'key concepts definitions formulas summary', {
    topK: 8,
    maxChars: 6800,
    materialIds: selectedMaterialIds,
  });

  if (hits.length === 0) {
    throw new Error('Upload at least one PDF, PPTX, DOCX, or Canvas Page in Modules & Files first.');
  }

  const contextText = hits.map(h => `### ${h.citation}\n${h.excerpt}`).join('\n\n');

  if (kind === 'flashcards') {
    const raw = await aiText({
      system:
        'You create high-yield college study packs from course modules. Return STRICT JSON ONLY: {"title":"Short study pack title","summary":"3-bullet overview in markdown","flashcards":[{"q":"question","a":"concise accurate answer"}],"quiz":[{"q":"multiple choice question","options":["A","B","C","D"],"answer":0,"why":"1 sentence rationale"}]}. Include 8 flashcards and 5 quiz items.',
      user: `Course: ${course.name}\n\nUploaded Module Excerpts:\n${contextText}`,
      maxTokens: 2200,
      task: 'syllabus',
      signal,
    });
    const m = /\{[\s\S]*\}/.exec(String(raw || ''));
    if (!m) throw new Error('Could not parse generated study pack — tap Retry.');
    const parsed = JSON.parse(m[0]);
    return {
      title: String(parsed.title || `${course.code || course.name} Study Pack`),
      body: String(parsed.summary || `## ${course.name} Study Pack\nGenerated from uploaded course modules.`),
      flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
      quiz: Array.isArray(parsed.quiz) ? parsed.quiz : [],
    };
  }

  const guide = await aiText({
    system: `You create concise, exam-ready Course Study Guides from uploaded slides/handouts for "${course.name}". Use ## headings, bold key terms, LaTeX formulas ($...$), and cite which module each section came from.`,
    user: `Uploaded Module Excerpts:\n${contextText}`,
    maxTokens: 2200,
    task: 'syllabus',
    signal,
  });
  return {
    title: `${course.code || course.name} — Module Study Guide`,
    body: guide,
    flashcards: [],
    quiz: [],
  };
}

/** Build combined exam source text from selected course modules/files for Bond-Paper Exam Builder. */
export async function buildCourseExamSourceText(course, { selectedMaterialIds = null } = {}) {
  const allMaterials = await db.courseMaterials.where('courseId').equals(course.id).toArray().catch(() => []);
  const filterActive = Array.isArray(selectedMaterialIds) && selectedMaterialIds.length > 0;
  const chosen = filterActive
    ? allMaterials.filter(m => selectedMaterialIds.includes(m.id))
    : allMaterials;

  const parts = [];
  for (const mat of chosen) {
    if ((mat.extractedText || '').trim()) {
      parts.push(`## ${mat.moduleName} — ${mat.title}\n${mat.extractedText.slice(0, 4500)}`);
    }
  }
  return parts.join('\n\n').slice(0, 18000);
}
