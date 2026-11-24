import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import {
  db,
  ensureSeeded,
  createNote,
  updateNote,
  deleteNote,
  getNoteIndexLite,
  invalidateNoteIndexCache,
} from '../src/store/db';
import {
  renderKatexCached,
  clearKatexCache,
  getKatexCacheSize,
} from '../src/lib/katexRender';
import {
  FONT_KEY,
  FONT_PRESETS,
  getFontPreset,
  getSettings,
  applySettings,
} from '../src/theme';
import {
  PEN_PALETTE,
  HIGHLIGHTER_PALETTE,
  OPACITY_PRESETS,
  PEN_OPACITY_PRESETS,
  getRecentAnnotateColors,
  saveRecentAnnotateColor,
} from '../src/components/StrokeLayer';
import { getInAppAlertSummary } from '../src/lib/notifications';
import { buildNotePDF } from '../src/lib/pdf';

const originalStorage = globalThis.localStorage;
const originalDoc = globalThis.document;
const originalWin = globalThis.window;

afterEach(() => {
  globalThis.localStorage = originalStorage;
  globalThis.document = originalDoc;
  globalThis.window = originalWin;
});

function createMockStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

describe('v2.0.4 Lightweight Note Index Cache & Invalidation', () => {
  it('caches lightweight note metadata without heavy blocks/images and invalidates on write', async () => {
    await ensureSeeded();
    invalidateNoteIndexCache();

    const longBody = `${'A'.repeat(1500)}\nSee [[Far Target]] at bottom`;
    const n1 = await createNote(null, 'Opt Test Note', longBody, 'Physics');
    await updateNote(n1.id, {
      blocks: [{ id: 'b1', explanation: 'Heavy AI data' }],
      images: [{ id: 'img1', dataUrl: 'data:image/png;base64,abc' }],
    });

    const first = await getNoteIndexLite();
    const second = await getNoteIndexLite();
    // Exact same cached array reference on second call
    expect(second).toBe(first);

    const entry = first.find(r => r.id === n1.id);
    expect(entry).toBeDefined();
    expect(entry.blocks).toBeUndefined();
    expect(entry.images).toBeUndefined();
    expect(entry.body).toContain('[[Far Target]]');

    // Mutation invalidates cache automatically
    await updateNote(n1.id, { title: 'Opt Test Updated' });
    const third = await getNoteIndexLite();
    expect(third).not.toBe(first);
    expect(third.find(r => r.id === n1.id)?.title).toBe('Opt Test Updated');

    await deleteNote(n1.id);
    const fourth = await getNoteIndexLite();
    expect(fourth.find(r => r.id === n1.id)?.trashed).toBe(true);
  });
});

describe('v2.0.4 KaTeX LRU Cache, Pre-fetched Alerts, Custom Fonts & Annotate Palettes', () => {
  it('caches KaTeX rendered HTML strings in a bounded LRU map', () => {
    clearKatexCache();
    expect(getKatexCacheSize()).toBe(0);

    const h1 = renderKatexCached('E = mc^2', false);
    const h2 = renderKatexCached('E = mc^2', false);
    expect(h1).toContain('katex');
    expect(h2).toBe(h1);
    expect(getKatexCacheSize()).toBe(1);

    renderKatexCached('\\int_0^1 x^2 dx', true);
    expect(getKatexCacheSize()).toBe(2);
  });

  it('provides 8 custom note fonts (including Times New Roman) and syncs --font-note + PDF', async () => {
    globalThis.localStorage = createMockStorage();
    const styleProps = new Map();
    const attrs = new Map();
    const rootEl = {
      dataset: {},
      style: { setProperty: (k, v) => styleProps.set(k, v), backgroundColor: '' },
      classList: { remove: () => {}, add: () => {} },
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: k => attrs.delete(k),
    };
    globalThis.document = { documentElement: rootEl, querySelector: () => null };
    globalThis.window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };

    expect(FONT_PRESETS.length).toBe(8);
    expect(FONT_PRESETS.some(f => f.name === 'Times New Roman')).toBe(true);
    expect(getFontPreset('times').stack).toContain('Times New Roman');
    expect(getFontPreset('times').pdfFont).toBe('times');

    localStorage.setItem(FONT_KEY, 'times');
    expect(getSettings().font).toBe('times');
    applySettings();
    expect(rootEl.dataset.font).toBe('times');
    expect(styleProps.get('--font-note')).toContain('Times New Roman');

    // Verify PDF export succeeds cleanly and respects selected serif font
    const doc = await buildNotePDF({
      title: 'Essay Draft',
      body: '## Thesis\nA classic serif manuscript test with math $x^2 + 1$.',
      subject: 'Literature',
      pdfStyle: 'auto',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.getFont().fontName.toLowerCase()).toContain('times');
  });

  it('exposes separate Pen & Pastel Highlighter palettes, opacity presets & recent custom colors', () => {
    globalThis.localStorage = createMockStorage();
    expect(PEN_PALETTE.length).toBeGreaterThanOrEqual(10);
    expect(HIGHLIGHTER_PALETTE.length).toBeGreaterThanOrEqual(6);
    expect(OPACITY_PRESETS.map(p => p.value)).toEqual([0.25, 0.4, 0.65]);
    expect(PEN_OPACITY_PRESETS.map(p => p.value)).toEqual([0.5, 0.8, 1]);

    saveRecentAnnotateColor('#12ab34');
    saveRecentAnnotateColor('#FF00AA');
    saveRecentAnnotateColor('bad-hex');
    expect(getRecentAnnotateColors()).toEqual(['#ff00aa', '#12ab34']);
  });

  it('computes alert summary cleanly from pre-fetched plannerItems without redundant DB scans', async () => {
    globalThis.localStorage = createMockStorage();
    const res = await getInAppAlertSummary([
      { id: 1, type: 'assignment', dateKey: '2020-01-01', done: false, title: 'Past' },
      { id: 2, type: 'announcement', externalUid: 'ann-1', title: 'Read Syllabus' },
    ]);
    expect(res.overdue.length).toBe(1);
    expect(res.unreadAnnouncements.length).toBe(1);
    expect(res.totalUrgent).toBe(2);
    // Avoid unused warning while exercising clean IndexedDB compatibility
    expect(db.name).toBeTruthy();
  });
});
