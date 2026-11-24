/**
 * Built-in note templates & mid-note Smart Building Blocks (v2.0.0).
 * Short, zero-filler, phone-first layouts with live visual mini-previews.
 */

function todayLabel() {
  try {
    return new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export const TEMPLATE_CATEGORIES = [
  { id: 'quick', label: 'Quick' },
  { id: 'school', label: 'School' },
  { id: 'coding', label: 'Coding' },
  { id: 'personal', label: 'Personal' },
  { id: 'custom', label: 'Mine' },
];

export const NOTE_TEMPLATES = [
  // ---------- QUICK START ----------
  {
    id: 'blank',
    category: 'quick',
    name: 'Blank Note',
    description: 'Clean canvas — auto-detects code, math & dates',
    icon: 'file',
    accent: '#0a84ff',
    previewLines: ['Start typing anything…', 'Code · Math · Dates', 'Auto-detected live'],
    title: '',
    body: '',
  },
  {
    id: 'class_note',
    category: 'quick',
    name: 'Class Notes',
    description: 'Date, topic, bullets & questions — zero clutter',
    icon: 'book',
    accent: '#28b44c',
    previewLines: ['# Topic', '• Key point', '• Example', '☐ Follow-up'],
    getTitle: () => `Class — ${todayLabel()}`,
    body: `## Topic
- 

## Examples
- 

## Questions
- [ ] `,
  },
  {
    id: 'quick_todo',
    category: 'quick',
    name: 'Daily Focus',
    description: 'Top 3 priorities & quick checklist',
    icon: 'check',
    accent: '#ff9f0a',
    previewLines: ['# Top 3 Today', '☐ Priority 1', '☐ Priority 2', '• Notes'],
    getTitle: () => `Focus — ${todayLabel()}`,
    body: `## Top 3 Today
- [ ] 
- [ ] 
- [ ] 

## Quick Notes
- `,
  },
  {
    id: 'assignment',
    category: 'quick',
    name: 'Assignment Tracker',
    description: 'Due date, requirements & submission checklist',
    icon: 'clipboard',
    accent: '#af52de',
    previewLines: ['Due: ___', '☐ Draft', '☐ Review', '☐ Submit'],
    title: 'Assignment — ',
    body: `**Course:** 
**Due:** 

## Tasks
- [ ] Read instructions
- [ ] Draft work
- [ ] Review & submit

## Links & Draft
- `,
  },
  {
    id: 'meeting',
    category: 'quick',
    name: 'Group / Meeting',
    description: 'Agenda, decisions & who does what',
    icon: 'users',
    accent: '#30b0c7',
    previewLines: ['# Agenda', '• Decisions', '☐ Action items'],
    getTitle: () => `Group Notes — ${todayLabel()}`,
    body: `## Agenda
- 

## Decisions
- 

## Action Items
- [ ] `,
  },

  // ---------- SCHOOL & STUDY ----------
  {
    id: 'cheatsheet',
    category: 'school',
    name: 'Exam Cheat Sheet',
    description: 'Compact terms, formulas & high-yield reminders',
    icon: 'zap',
    accent: '#ff375f',
    previewLines: ['# Key Terms', '# Formulas', '• Watch out for'],
    title: 'Cheat Sheet — ',
    body: `## Key Terms
- 

## Formulas & Rules
- 

## Watch Out For
- `,
  },
  {
    id: 'study_qa',
    category: 'school',
    name: 'Flashcard Q&A',
    description: 'Term: Definition format -> 1-tap offline flashcards',
    icon: 'layers',
    accent: '#5856d6',
    previewLines: ['Term: Definition', 'Term: Definition', '→ 1-Tap Flashcards'],
    title: 'Study Cards — ',
    body: `Concept 1: Write a short definition here
Concept 2: Write a short definition here
Concept 3: Write a short definition here`,
  },
  {
    id: 'cornell',
    category: 'school',
    name: 'Clean Cornell',
    description: 'Questions, main notes & 2-line takeaway',
    icon: 'columns',
    accent: '#0a84ff',
    previewLines: ['# Questions', '# Notes', '# Summary'],
    title: 'Cornell — ',
    body: `## Questions
- 

## Notes
- 

## Summary
- `,
  },
  {
    id: 'lab',
    category: 'school',
    name: 'Lab Notes',
    description: 'Goal, data table & concise conclusion',
    icon: 'flask',
    accent: '#28b44c',
    previewLines: ['# Goal', '| Trial | Result |', '# Conclusion'],
    title: 'Lab — ',
    body: `## Goal
- 

## Data
| Trial | Measurement | Notes |
| --- | --- | --- |
| 1 |  |  |
| 2 |  |  |

## Conclusion
- `,
  },

  // ---------- CODING & TECH ----------
  {
    id: 'code_lab',
    category: 'coding',
    name: 'Code Scratchpad',
    description: 'Runnable code block with 1-tap output & notes',
    icon: 'code',
    accent: '#0a84ff',
    previewLines: ['```js', 'console.log(...)', '```', '▶ 1-Tap Run'],
    title: 'Code — ',
    body: `\`\`\`js
console.log("Hello, Bai!");
\`\`\`

## Notes
- `,
  },
  {
    id: 'buglog',
    category: 'coding',
    name: 'Bug Fix Log',
    description: 'Error message, cause & working fix snippet',
    icon: 'bug',
    accent: '#ff375f',
    previewLines: ['# Error', '# Root Cause', '``` Fix ```'],
    title: 'Bug Fix — ',
    body: `## Error
\`\`\`
\`\`\`

## Cause & Fix
- 

\`\`\`js
\`\`\``,
  },
  {
    id: 'project_plan',
    category: 'coding',
    name: 'Project Plan',
    description: 'Goal, stack & build milestones',
    icon: 'database',
    accent: '#af52de',
    previewLines: ['# Goal', '• Tech Stack', '☐ Milestones'],
    title: 'Project — ',
    body: `## Goal
- 

## Stack
- 

## Milestones
- [ ] MVP working
- [ ] Test & polish`,
  },

  // ---------- PERSONAL & VAULT ----------
  {
    id: 'journal',
    category: 'personal',
    name: 'Daily Journal',
    description: 'Quick thoughts, highlight & tomorrow',
    icon: 'heart',
    accent: '#ff6b81',
    previewLines: ['# On My Mind', '# Highlight', '# Tomorrow'],
    getTitle: () => `Journal — ${todayLabel()}`,
    body: `## On My Mind
- 

## Highlight Today
- 

## Tomorrow
- `,
  },
  {
    id: 'pros_cons',
    category: 'personal',
    name: 'Pros & Cons',
    description: 'Clean 2-column decision table',
    icon: 'scale',
    accent: '#ff9f0a',
    previewLines: ['| Pros | Cons |', '| --- | --- |', '# Decision'],
    title: 'Decision — ',
    body: `| Pros | Cons |
| --- | --- |
|  |  |
|  |  |

## Decision
- `,
  },
  {
    id: 'password_entry',
    category: 'personal',
    name: 'Password & Key',
    description: 'Stored 100% locally in Zero-AI Vault',
    icon: 'key',
    accent: '#30b0c7',
    previewLines: ['🔒 Zero-AI Vault', 'User: ___', 'Pass: ___'],
    title: 'Account — ',
    body: `- **Service:** 
- **Username / Email:** 
- **Password / Key:** 
- **Recovery / 2FA:** `,
  },
];

/** Backward-compatibility aliases for older template IDs */
const LEGACY_TEMPLATE_MAP = {
  lecture: 'class_note',
  formula: 'cheatsheet',
  curiosity: 'class_note',
  algorithm: 'code_lab',
  sql: 'code_lab',
  capstone: 'project_plan',
};

/** Mid-note 1-tap Smart Building Blocks for the Edit Toolbar ("+ Block"). */
export const INSERT_BLOCKS = [
  {
    id: 'checklist',
    name: 'Checklist',
    desc: 'Interactive tasks',
    icon: 'check',
    snippet: '- [ ] \n- [ ] ',
  },
  {
    id: 'table2',
    name: '2-Col Table',
    desc: 'Compare side by side',
    icon: 'table',
    snippet: '| Column A | Column B |\n| --- | --- |\n|  |  |',
  },
  {
    id: 'code_js',
    name: 'JS Code Block',
    desc: 'Runnable offline JS',
    icon: 'code',
    snippet: '```js\nconsole.log("Hello");\n```',
  },
  {
    id: 'code_py',
    name: 'Python Block',
    desc: '1-tap Python runner',
    icon: 'code',
    snippet: '```py\nprint("Hello")\n```',
  },
  {
    id: 'math_pad',
    name: 'Math Scratchpad',
    desc: 'Auto-solving variables',
    icon: 'sigma',
    snippet: 'a = 10\nb = 5\na * b + 2',
  },
  {
    id: 'callout',
    name: 'Key Callout',
    desc: 'Highlighted takeaway',
    icon: 'zap',
    snippet: '> **Key Takeaway:** ',
  },
  {
    id: 'qa_block',
    name: 'Flashcard Terms',
    desc: 'Auto-makes flashcards',
    icon: 'layers',
    snippet: 'Term 1: Definition here\nTerm 2: Definition here\nTerm 3: Definition here',
  },
  {
    id: 'class_hdr',
    name: 'Class Header',
    desc: 'Dated topic section',
    icon: 'book',
    getSnippet: () => `## Class — ${todayLabel()}\n- `,
  },
];

export function instantiateTemplate(templateOrId, opts = {}) {
  const tagPrefix = opts?.tagPrefix ? String(opts.tagPrefix).trim() : '';
  const appendTag = body => {
    if (!tagPrefix) return body;
    return body ? `${body}\n\n${tagPrefix}` : tagPrefix;
  };
  if (templateOrId && typeof templateOrId === 'object') {
    return {
      title: String(templateOrId.title || ''),
      body: appendTag(String(templateOrId.body || '')),
    };
  }
  const resolvedId = LEGACY_TEMPLATE_MAP[templateOrId] || templateOrId;
  const tpl = NOTE_TEMPLATES.find(t => t.id === resolvedId) || NOTE_TEMPLATES[0];
  const title = typeof tpl.getTitle === 'function' ? tpl.getTitle() : tpl.title || '';
  return {
    title,
    body: appendTag(tpl.body || ''),
  };
}

export function getInsertBlockSnippet(blockId) {
  const b = INSERT_BLOCKS.find(x => x.id === blockId);
  if (!b) return '';
  return typeof b.getSnippet === 'function' ? b.getSnippet() : b.snippet || '';
}
