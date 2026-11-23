/**
 * Built-in study note templates — instant, 100% offline, zero API calls.
 */

export const NOTE_TEMPLATES = [
  {
    id: 'blank',
    category: 'general',
    name: 'Blank Note',
    description: 'Start fresh with a clean empty page',
    icon: 'file',
    title: '',
    body: '',
  },
  {
    id: 'cornell',
    category: 'general',
    name: 'Cornell Notes',
    description: 'Cues & questions, structured class notes, and bottom summary',
    icon: 'columns',
    title: 'Cornell Notes — ',
    body: `## Key Cues & Questions
- What is the main concept or thesis?
- How does this connect to previous lessons?
- What could show up on the exam?

## Main Notes
- **Core Idea:** 
- **Key Mechanism / Steps:**
  1. 
  2. 
- **Example:** 

## Summary (2–3 sentences in your own words)
- 

#cornell`,
  },
  {
    id: 'lecture',
    category: 'general',
    name: 'Lecture Outline',
    description: 'Objectives, main topics, worked examples, and follow-up tasks',
    icon: 'book',
    title: 'Lecture — ',
    body: `## Learning Objectives
- 

## Core Concepts
### 1. Topic One
- **Definition:** 
- **Why it matters:** 

### 2. Topic Two
- 

## Worked Example
- **Problem:** 
- **Solution:** 

## Action Items & Review
- [ ] Re-read and highlight confusing lines
- [ ] Generate flashcards and quiz in Study mode

#lecture`,
  },
  {
    id: 'formula',
    category: 'general',
    name: 'Formula & Concept Sheet',
    description: 'LaTeX equations, variable units, conditions, and common traps',
    icon: 'sigma',
    title: 'Formula Sheet — ',
    body: `## Core Equations
- **Equation Name:** $y = mx + b$
  - Where $m$ = slope, $b$ = y-intercept
  - Valid when: linear relationship
- **Second Formula:**
$$F = m \\cdot a$$

## Key Constants & Units
- 

## Edge Cases & Common Traps
- Watch sign conventions and unit conversions
- 

#formulas #exam`,
  },
  {
    id: 'lab',
    category: 'general',
    name: 'Lab Report',
    description: 'Objective, hypothesis, procedure checklist, data, and analysis',
    icon: 'flask',
    title: 'Lab Report — ',
    body: `## Objective
- 

## Hypothesis
- If …, then … because …

## Materials & Procedure
- [ ] Prepare equipment and calibrate sensors
- [ ] Record baseline control measurement
- [ ] Run trials and log raw observations

## Data & Observations
- **Trial 1:** 
- **Trial 2:** 
- **Key Trend:** 

## Analysis & Sources of Error
- **What the data shows:** 
- **Possible errors:** 

## Conclusion
- 

#lab`,
  },
  {
    id: 'cheatsheet',
    category: 'general',
    name: 'Exam Cheat Sheet',
    description: 'High-yield definitions, must-know formulas, and self-test checklist',
    icon: 'zap',
    title: 'Exam Cheat Sheet — ',
    body: `## Must-Know Definitions
- **Term 1:** 
- **Term 2:** 

## High-Yield Formulas & Rules
- $E = mc^2$
- 

## Common Exam Traps
- Don't confuse … with …
- Always check …

## Quick Self-Test
- [ ] Explain the core concept aloud without looking (Feynman test)
- [ ] Build a custom Bond-Paper Exam from this note
- [ ] Review all due flashcards

#exam #review`,
  },
  {
    id: 'journal',
    category: 'general',
    name: 'Daily Reflection / Vent',
    description: 'Unfiltered thoughts, what is weighing on you, and one gentle next step',
    icon: 'heart',
    title: `Journal — ${new Date().toLocaleDateString()}`,
    body: `## Brain Dump (No filter)
- 

## What's Weighing on Me Most
- 

## One Kind Thing / Small Next Step
- 

#journal`,
  },
  {
    id: 'curiosity',
    category: 'general',
    name: 'Curiosity Deep-Dive',
    description: 'Explore psychology, brain science, or rabbit-hole questions + [[Wiki-Links]]',
    icon: 'compass',
    title: 'Deep Dive — ',
    body: `## What Sparked My Curiosity
- 

## Core Mechanism (How It Actually Works)
- 

## Myths vs. Evidence
| Common Claim | What Evidence Actually Shows |
| --- | --- |
| Example myth | Nuanced reality |

## Connections & Questions to Explore Next
- Related note: [[Another Topic]]
- 

#explore #curiosity`,
  },
  {
    id: 'buglog',
    category: 'tech',
    name: 'Bug & Debug Log',
    description: 'Error stack trace, root cause hypothesis, code snippet & final fix',
    icon: 'bug',
    title: 'Bug Log — ',
    body: `## Symptom / Error Message
\`\`\`
Paste error message or stack trace here
\`\`\`

## Steps to Reproduce
1. 
2. 

## Root Cause & Code Fix
\`\`\`js
// Before / After fix
\`\`\`

## Lesson Learned (Prevent Next Time)
- 

#debug #coding`,
  },
  {
    id: 'algorithm',
    category: 'tech',
    name: 'Algorithm & Big-O Sheet',
    description: 'Problem intuition, code template, complexity table & edge cases',
    icon: 'code',
    title: 'Algorithm — ',
    body: `## Core Intuition
- 

## Complexity
| Case | Time | Space |
| --- | --- | --- |
| Best / Average | $O(n \\log n)$ | $O(n)$ |
| Worst | $O(n^2)$ | $O(n)$ |

## Implementation
\`\`\`python
def solve(items):
    # Write clean reference code
    return items
\`\`\`

## Edge Cases to Test
- [ ] Empty input / single element
- [ ] Duplicate values / negative numbers

#algorithms #dsa`,
  },
  {
    id: 'dbschema',
    category: 'tech',
    name: 'Database Schema & SQL',
    description: 'Tables, keys, normalization notes & sample queries',
    icon: 'database',
    title: 'DB Schema — ',
    body: `## Entities & Columns
| Table | Primary Key | Key Columns | Relations |
| --- | --- | --- | --- |
| users | id | email, role | 1:N with orders |

## Sample Queries
\`\`\`sql
SELECT * FROM users WHERE role = 'student';
\`\`\`

## Indexing & Normalization Notes
- 

#database #sql`,
  },
  {
    id: 'systemspec',
    category: 'tech',
    name: 'System / Capstone Spec',
    description: 'Problem statement, architecture, API routes & milestone checklist',
    icon: 'layers',
    title: 'System Spec — ',
    body: `## Problem Statement & Users
- 

## Architecture & Tech Stack
- **Frontend:** 
- **Backend / Database:** 

## Key API Endpoints / Features
| Endpoint / Module | Method | Purpose |
| --- | --- | --- |
| /api/example | GET | Fetch items |

## Milestones
- [ ] MVP prototype
- [ ] Testing & edge cases
- [ ] Deployment

#capstone #architecture`,
  },
];

/**
 * Instantiate a template into { title, body }, optionally preserving a tag prefix
 * (e.g. when creating a note inside a #tag smart view).
 */
export function instantiateTemplate(templateId, { tagPrefix = '' } = {}) {
  const tpl = NOTE_TEMPLATES.find(t => t.id === templateId) || NOTE_TEMPLATES[0];
  let body = tpl.body || '';
  if (tagPrefix) {
    const cleanTag = tagPrefix.trim();
    if (cleanTag && !body.toLowerCase().includes(cleanTag.toLowerCase())) {
      body = body ? `${body}\n${cleanTag}` : `${cleanTag}\n`;
    }
  }
  return {
    title: tpl.title || '',
    body,
  };
}
