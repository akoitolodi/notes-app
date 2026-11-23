/**
 * Built-in study note templates — instant, 100% offline, zero API calls.
 */

export const NOTE_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank Note',
    description: 'Start fresh with a clean empty page',
    icon: 'file',
    title: '',
    body: '',
  },
  {
    id: 'cornell',
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
- [ ] Solve 2 practice problems from scratch
- [ ] Review all due flashcards

#exam #review`,
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
