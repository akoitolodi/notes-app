/**
 * Universal Folder & Note Modes — lets the app adapt cleanly across
 * Study, Personal Journal/Venting, Curiosity Deep-Dives, and Coding/Tech
 * without locking the app into any single school program.
 */

export const NOTE_MODES = {
  study: {
    id: 'study',
    label: 'Study',
    badge: 'Study',
    actionLabel: 'Explain',
    description: 'Class notes, line explanations, mistake spotting, flashcards & quizzes',
    chatTitle: 'Ask AI',
    chatStarters: [
      'Explain the main idea simply',
      'What assumptions or gaps are in these notes?',
      'Quiz me with 3 reasoning questions',
      'Research recent evidence on this topic',
    ],
  },
  journal: {
    id: 'journal',
    label: 'Journal',
    badge: 'Journal',
    actionLabel: 'Reflect',
    description: 'Personal rants, venting & reflection — never flags feelings as mistakes or forces quizzes',
    chatTitle: 'Reflect',
    chatStarters: [
      'Help me untangle what I am feeling here',
      'What recurring patterns or stressors stand out?',
      'Offer a grounded, kind perspective without invalidating me',
      'Ask me 2 gentle reflection questions',
    ],
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    badge: 'Explore',
    actionLabel: 'Explore',
    description: 'Curiosity rabbit holes (psychology, brain science, philosophy) — mechanisms, myth-checks & next questions',
    chatTitle: 'Explore',
    chatStarters: [
      'Explain the deeper mechanism behind this',
      'Separate solid science from pop-science myths here',
      'Give me 3 rabbit-hole questions to explore next',
      'Research peer-reviewed studies on this topic',
    ],
  },
  code: {
    id: 'code',
    label: 'Code',
    badge: 'Code',
    actionLabel: 'Analyze',
    description: 'Technical & coding notes — bug spotting, dry-run tracing, edge cases & Big-O complexity',
    chatTitle: 'Code Mentor',
    chatStarters: [
      'Trace this logic step-by-step and spot bugs',
      'Analyze time/space complexity and edge cases',
      'Suggest a cleaner, safer refactor',
      'Explain how this works under the hood',
    ],
  },
  vault: {
    id: 'vault',
    label: 'Zero-AI Vault',
    badge: 'Zero-AI',
    actionLabel: 'Save',
    zeroAi: true,
    description: '100% offline local-only vault for passwords, keys & sensitive notes — no AI can ever access this area',
    chatTitle: 'Zero-AI Vault',
    chatStarters: [],
  },
};

export const NOTE_MODE_LIST = [
  NOTE_MODES.study,
  NOTE_MODES.journal,
  NOTE_MODES.explore,
  NOTE_MODES.code,
  NOTE_MODES.vault,
];

export function normalizeNoteMode(mode) {
  return NOTE_MODES[mode] ? mode : 'study';
}

export function isZeroAiMode(mode) {
  return normalizeNoteMode(mode) === 'vault';
}

export function getModeMeta(mode) {
  return NOTE_MODES[normalizeNoteMode(mode)];
}

export function resolveNoteMode(note, folder = null) {
  // If the parent folder is a Zero-AI Vault (like Passwords & Keys), enforce Zero-AI strictly
  if (folder?.mode === 'vault' || folder?.isSystemVault) return 'vault';
  if (note?.mode && NOTE_MODES[note.mode]) return note.mode;
  if (folder?.mode && NOTE_MODES[folder.mode]) return folder.mode;
  return 'study';
}

/** Extra system instruction injected into ChatSheet / chatWithNote based on active note mode. */
export function getChatModeDirective(mode) {
  switch (normalizeNoteMode(mode)) {
    case 'journal':
      return `CONVERSATION PERSONA (Personal Journal / Reflection):
- The user is writing a personal journal entry, rant, or private reflection — NOT a graded class assignment.
- Be warm, calm, empathetic, and grounded. NEVER grade them, lecture them, quiz them, or treat personal feelings as factual errors.
- Acknowledge their emotions plainly without toxic positivity or robotic clichés.
- Help untangle messy thoughts, gently surface underlying needs or cognitive traps only when helpful, and keep your tone human and respectful.`;
    case 'explore':
      return `CONVERSATION PERSONA (Curiosity & Deep Exploration):
- The user is exploring an intellectual curiosity (e.g., neuroscience, psychology, science, philosophy, history).
- Explain underlying mechanisms clearly, distinguish strong scientific consensus from pop-science myths or open debates, and connect ideas across domains.
- End with 2–3 brief, genuinely intriguing "Go Deeper" follow-up questions to spark further curiosity.`;
    case 'code':
      return `CONVERSATION PERSONA (Technical & Coding Mentor):
- The user is working on software, IT, math, or engineering concepts.
- Focus on precision: dry-run variable states, catch subtle bugs or off-by-one/security edge cases, note Big-O time & space complexity where relevant, and write idiomatic fenced code blocks.`;
    default:
      return '';
  }
}

/** Extra directive for line-by-line scanNote based on note mode. */
export function getScanModeDirective(mode) {
  switch (normalizeNoteMode(mode)) {
    case 'journal':
      return `MODE: PERSONAL JOURNAL / REFLECTION.
- NEVER flag personal feelings or opinions as mistakes (ALWAYS set "mistake": null for every line).
- Instead of textbook definitions, give brief, gentle, insightful 1-sentence reflections or clarifying observations for key lines.
- Return EMPTY arrays for "flashcards": [] and "quiz": [] (do not quiz personal journal entries).`;
    case 'explore':
      return `MODE: CURIOSITY & DEEP EXPLORATION.
- Focus explanations on mechanisms ("how/why it works"), nuances, and common myths worth checking.
- Only flag a mistake if there is a clear factual misconception.`;
    case 'code':
      return `MODE: TECHNICAL & CODING NOTES.
- Focus explanations on execution behavior, edge cases, complexity, and best practices.
- Flag syntax bugs, logic errors, or security pitfalls as mistakes with clean fixes.`;
    default:
      return '';
  }
}
