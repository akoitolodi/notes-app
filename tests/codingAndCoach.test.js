import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CODING_LANGUAGES,
  CODING_CHALLENGES,
  parseLearnXMarkdown,
} from '../src/lib/codingCatalog.js';
import { runJavaScriptLocally } from '../src/lib/codeRunner.js';
import {
  analyzeWritingCraft,
  applySafeWordyFix,
} from '../src/lib/writingCoach.js';
import {
  recordLearningSignal,
  getWeakTopics,
  getStrengthTopics,
  getLearnerContextDigest,
  clearLearnerMemory,
} from '../src/lib/learnerMemory.js';
import { db } from '../src/store/db.js';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('Learn Coding Studio — Catalog, Parser & Local JS Runner', () => {
  it('exposes 18 languages and 15 Exercism challenges and parses Learn X Markdown into chapters', () => {
    expect(CODING_LANGUAGES.length).toBe(18);
    expect(CODING_CHALLENGES.length).toBe(15);

    const sampleMd = `---
name: Python
---
Python is a widely used general-purpose language.

\`\`\`python
####################################################
## 1. Primitive Datatypes and Operators
####################################################
# You have numbers
3  # => 3
1 + 1  # => 2
8 - 1  # => 7
10 * 2  # => 20
35 / 5  # => 7.0
5 // 3  # => 1
7 % 3  # => 1
2**3  # => 8

####################################################
## 2. Variables and Collections
####################################################
# Python has a print function
print("I'm Python. Nice to meet you!")
li = [1, 2, 3]
li.append(4)
print(li)
\`\`\`
`;
    const chapters = parseLearnXMarkdown(sampleMd, CODING_LANGUAGES[0]);
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(chapters[0].title).toContain('Overview');
    expect(chapters.some(c => /Variables and Collections/i.test(c.title))).toBe(true);
  });

  it('executes JavaScript locally offline and captures stdout and errors safely', () => {
    const ok = runJavaScriptLocally('const a = [1, 2, 3]; console.log("Sum:", a.reduce((x, y) => x + y, 0));');
    expect(ok.ok).toBe(true);
    expect(ok.stdout).toBe('Sum: 6');
    expect(ok.stderr).toBe('');

    const fail = runJavaScriptLocally('throw new Error("Boom");');
    expect(fail.ok).toBe(false);
    expect(fail.stderr).toContain('Boom');
  });
});

describe('Offline LaTeX- & Code-Safe Writing Craft Coach', () => {
  it('scores readability, detects wordiness & monotonous openers, and never modifies $LaTeX$ or code blocks', () => {
    const sample = [
      'In order to understand entropy, we study $E = mc^2$ and `in order to` inside code.',
      'The process is fast. The process is reliable. The process is documented.',
      '```js',
      '// in order to keep this comment untouched',
      'const x = 1;',
      '```',
      'Due to the fact that heat flows spontaneously, the system was analyzed by researchers.',
    ].join('\n');

    const report = analyzeWritingCraft(sample);
    expect(report.words).toBeGreaterThan(20);
    expect(report.protectedCount).toBe(3); // $E = mc^2$, `in order to`, and fenced ```js```
    expect(report.wordyFixes.some(f => f.phrase === 'in order to')).toBe(true);
    expect(report.wordyFixes.some(f => f.phrase === 'due to the fact that')).toBe(true);
    expect(report.monotonousRuns.length).toBeGreaterThanOrEqual(1);
    expect(report.passiveHits.some(h => /was analyzed/i.test(h))).toBe(true);

    const fixed = applySafeWordyFix(sample, 'in order to', 'to');
    expect(fixed).toContain('To understand entropy');
    // Inline code and fenced code comment MUST remain untouched!
    expect(fixed).toContain('`in order to`');
    expect(fixed).toContain('// in order to keep this comment untouched');
    expect(fixed).toContain('$E = mc^2$');
  });
});

describe('DeepTutor Persistent Learner Memory (Zero-AI Vault Safe)', () => {
  beforeEach(async () => {
    memStore.clear();
    await clearLearnerMemory();
    await db.learnerMemory.clear();
  });

  it('tracks weak spots & strengths, generates compact digest, and strictly ignores vault/Passwords & Keys', async () => {
    // Vault / Passwords & Keys must be completely ignored!
    const ignored1 = await recordLearningSignal({
      subject: 'Passwords & Keys',
      topic: 'Bank PIN',
      correct: false,
      noteMode: 'study',
    });
    const ignored2 = await recordLearningSignal({
      subject: 'Private',
      topic: 'Secret API Token',
      correct: false,
      noteMode: 'vault',
    });
    expect(ignored1).toBeNull();
    expect(ignored2).toBeNull();

    // Real study & coding signals should persist and update mastery
    await recordLearningSignal({ subject: 'Python', topic: 'List Comprehensions', correct: true, source: 'coding' });
    await recordLearningSignal({ subject: 'Python', topic: 'List Comprehensions', correct: true, source: 'coding' });
    await recordLearningSignal({ subject: 'Python', topic: 'Recursion Base Cases', correct: false, source: 'exam' });

    const weak = await getWeakTopics('Python');
    const strong = await getStrengthTopics('Python');
    expect(weak.map(w => w.topic)).toContain('Recursion Base Cases');
    expect(strong.map(s => s.topic)).toContain('List Comprehensions');

    const digest = await getLearnerContextDigest('Python');
    expect(digest).toContain('[DeepTutor Persistent Learner Memory]');
    expect(digest).toContain('Recursion Base Cases');
    expect(digest).toContain('List Comprehensions');
    expect(digest).not.toContain('Bank PIN');
  });
});
