import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanOcrText } from '../src/lib/aiFeatures';
import {
  PDF_STYLES,
  detectPdfStyle,
  stripMarkdownToCleanText,
  parseMarkdownBlocksForPdf,
  buildNotePDF,
} from '../src/lib/pdf';
import {
  classifyFolderNaiveBayes,
  findSimilarNotesOffline,
  analyzeStudyRhythm,
  analyzeWeakPatterns,
  buildUserPatternProfile,
} from '../src/lib/userPatterns';
import { THEME_PRESETS, ACCENTS } from '../src/theme';
import { createDictationSession, isSpeechRecognitionSupported } from '../src/lib/voiceDictation';

describe('v2.0.2 OCR Text Cleaning & Argument Flexibility', () => {
  it('strips Markdown #, **, *, backticks, fences & AI preambles while preserving math and plain bullets', () => {
    const raw = `Here is the transcribed text:

\`\`\`markdown
## Chapter 3 Notes
- **Osmosis:** Water moves across a *semipermeable* membrane.
* Solve force = 3 * 4 + 2
* Check \`config.json\` before submitting
---
\`\`\``;
    const cleaned = cleanOcrText(raw);
    expect(cleaned).not.toContain('Here is the transcribed');
    expect(cleaned).not.toContain('##');
    expect(cleaned).not.toContain('**');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('`');
    expect(cleaned).toContain('Chapter 3 Notes');
    expect(cleaned).toContain('- Osmosis: Water moves across a semipermeable membrane.');
    expect(cleaned).toContain('- Solve force = 3 * 4 + 2');
    expect(cleaned).toContain('Check config.json before submitting');
  });
});

describe('v2.0.2 Clean Markdown-to-PDF Engine & Adaptive PDF Designs', () => {
  it('exposes adaptive PDF styles and detects note category accurately', () => {
    expect(PDF_STYLES.length).toBe(6);
    expect(detectPdfStyle({ noteMode: 'code', body: 'print(123)' })).toBe('technical');
    expect(detectPdfStyle({ body: '```py\nx = 1\n```' })).toBe('technical');
    expect(detectPdfStyle({ noteMode: 'journal', title: 'Daily Reflection' })).toBe('editorial');
    expect(detectPdfStyle({ title: 'Physics Formula Cheat Sheet', body: '$F = m a$' })).toBe('cheatsheet');
    expect(detectPdfStyle({ noteMode: 'study', title: 'History Chapter 5', body: 'Treaty of Versailles' })).toBe('academic');
  });

  it('strips all Markdown symbols and converts inline math cleanly', () => {
    const dirty = '## **Euler Identity**: [$e^{i\\pi} + 1 = 0$](https://math.example) & [[Complex Numbers|Complex]] with `code` and *emphasis*';
    const clean = stripMarkdownToCleanText(dirty);
    expect(clean).not.toContain('#');
    expect(clean).not.toContain('**');
    expect(clean).not.toContain('`');
    expect(clean).not.toContain('[[');
    expect(clean).toContain('Euler Identity');
    expect(clean).toContain('π');
    expect(clean).toContain('Complex');
    expect(clean).toContain('emphasis');
  });

  it('parses headings, code blocks, tables, quotes, checkboxes & lists and builds valid PDFs across all styles', async () => {
    const sampleBody = `# Lecture Notes
**Important:** Remember \\alpha and $\\sqrt{x}$!

- [x] Read syllabus
- [ ] Practice lab

| Topic | Weight |
| --- | --- |
| Midterm | 30% |

> Focus on understanding, not rote memorization.

\`\`\`js
console.log("Clean PDF!");
\`\`\``;

    const blocks = parseMarkdownBlocksForPdf(sampleBody);
    expect(blocks.some(b => b.type === 'table')).toBe(true);
    expect(blocks.some(b => b.type === 'code')).toBe(true);
    expect(blocks.some(b => b.type === 'checkbox' && b.checked)).toBe(true);
    expect(blocks.some(b => b.type === 'quote')).toBe(true);

    for (const style of ['academic', 'cheatsheet', 'technical', 'editorial', 'minimal']) {
      const doc = await buildNotePDF({
        title: 'Test Note',
        body: sampleBody,
        subject: 'CS 201',
        pdfStyle: style,
      });
      expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('v2.0.2 Offline User Pattern Recognition Engine', () => {
  it('classifies notes into folders using Naive Bayes while excluding Zero-AI Vault folders', () => {
    const folders = [
      { id: 1, name: 'General', mode: 'study' },
      { id: 2, name: 'Networking', mode: 'code' },
      { id: 3, name: 'Biology', mode: 'study' },
      { id: 4, name: 'Passwords & Keys', mode: 'vault', locked: true, isSystemVault: true },
    ];
    const notes = [
      { id: 10, folderId: 2, title: 'Subnets', body: 'Router IPv4 packet subnet gateway VLAN switch TCP UDP' },
      { id: 11, folderId: 3, title: 'Cells', body: 'Mitochondria ribosome photosynthesis chloroplast DNA RNA membrane' },
      { id: 12, folderId: 4, title: 'Secret Bank', body: 'Router password login secret token key' },
    ];

    const match = classifyFolderNaiveBayes('Configure the VLAN switch packet routing subnet gateway', folders, notes, {
      currentFolderId: 1,
    });
    expect(match?.folderId).toBe(2);
    expect(match?.folderName).toBe('Networking');

    // Never classifies or picks Zero-AI Vault folders
    const vaultCheck = classifyFolderNaiveBayes('password login secret token key router', folders, notes, {
      currentFolderId: 1,
    });
    expect(vaultCheck?.folderId).not.toBe(4);
  });

  it('finds similar non-vault notes offline via cosine similarity', () => {
    const folders = [
      { id: 1, name: 'CS 101', mode: 'code' },
      { id: 2, name: 'Passwords & Keys', mode: 'vault', isSystemVault: true },
    ];
    const notes = [
      { id: 10, folderId: 1, title: 'OSI Model Layers', body: 'Physical data link network transport session presentation application packet router TCP UDP' },
      { id: 20, folderId: 2, title: 'Private Keys', body: 'Physical data link network transport session secret token key' },
    ];
    const hit = findSimilarNotesOffline(
      'Reviewing OSI physical data link network transport layer packet routing',
      { currentNoteId: 99, notes, folders }
    );
    expect(hit?.noteId).toBe(10);
    expect(hit?.title).toBe('OSI Model Layers');
  });

  it('analyzes circadian study rhythm, writing habits, and weak-topic/bug patterns offline', () => {
    const tsEvening = new Date(2026, 10, 24, 19, 30).getTime();
    const profile = buildUserPatternProfile({
      folders: [{ id: 1, name: 'Programming', mode: 'code' }],
      notes: [
        { id: 1, folderId: 1, body: '```js\nconsole.log(1)\n```', updatedAt: tsEvening },
        { id: 2, folderId: 1, body: 'console.log(2)', updatedAt: tsEvening },
      ],
      activityLog: [{ dateKey: '2026-11-24', reviews: 3 }],
      learnerMemory: [{ subject: 'Programming', topic: 'Recursion', mastery: 0.35, mistakesCount: 4 }],
      allCards: [{ noteTitle: 'Async JS', state: { lapses: 3 } }],
      bugLogs: [{ errorType: 'TypeError' }, { errorType: 'TypeError' }],
    });
    expect(profile.rhythm.peakWindow).toContain('Evening');
    expect(profile.rhythm.dominantHabit).toBe('Code Snippets');
    expect(profile.weakInsights.some(w => w.title.includes('Recursion'))).toBe(true);
    expect(profile.weakInsights.some(w => w.title.includes('TypeError'))).toBe(true);
  });
});

describe('v2.0.2 Themes Studio & Native Android Speech Bridge', () => {
  afterEach(() => {
    if (typeof window !== 'undefined') {
      delete window.BaiNativeSpeech;
      delete window.__baiSpeechCallback;
    }
  });

  it('exposes 12 curated surface themes (5 Light + 7 Dark) and 12 dual-tone color palettes', () => {
    expect(THEME_PRESETS.length).toBe(12);
    expect(THEME_PRESETS.filter(p => p.mode === 'light').length).toBe(5);
    expect(THEME_PRESETS.filter(p => p.mode === 'dark').length).toBe(7);
    expect(Object.keys(ACCENTS).length).toBe(12);
    for (const a of Object.values(ACCENTS)) {
      expect(a.c).toMatch(/^#/);
      expect(a.c2).toMatch(/^#/);
      expect(a.label.length).toBeGreaterThan(2);
    }
  });

  it('uses BaiNativeSpeech bridge cleanly for live Android dictation when available', async () => {
    const startMock = vi.fn();
    const stopMock = vi.fn();
    globalThis.window = globalThis.window || {};
    window.BaiNativeSpeech = {
      isAvailable: () => true,
      start: startMock,
      stop: stopMock,
    };

    expect(isSpeechRecognitionSupported()).toBe(true);
    const interims = [];
    const finals = [];
    const states = [];
    const session = createDictationSession({
      lang: 'en-US',
      onInterim: t => interims.push(t),
      onFinal: t => finals.push(t),
      onStateChange: s => states.push(s),
    });

    const ok = await session.start();
    expect(ok).toBe(true);
    expect(startMock).toHaveBeenCalledWith('en-US');
    expect(states).toContain('listening');

    window.__baiSpeechCallback('interim', 'hello class');
    window.__baiSpeechCallback('final', 'hello class notes');
    expect(interims[0]).toBe('hello class');
    expect(finals).toEqual(['hello class notes']);

    session.stop();
    expect(stopMock).toHaveBeenCalled();
    expect(states[states.length - 1]).toBe('idle');
  });
});
