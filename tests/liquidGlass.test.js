import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  SURFACE_KEY,
  SURFACE_STYLES,
  normalizeSurface,
  getSettings,
  applySettings,
} from '../src/theme';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');

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

describe('iOS 26 Liquid Glass Surface System (Studio | Frosted Glass | Aurora Glass)', () => {
  it('exposes 3 valid Surface Finish modes and defaults to Studio', () => {
    expect(SURFACE_STYLES.map(([id]) => id)).toEqual([
      'studio',
      'glass-frosted',
      'glass-aurora',
    ]);
    expect(normalizeSurface(null)).toBe('studio');
    expect(normalizeSurface('unknown')).toBe('studio');
    expect(normalizeSurface('studio')).toBe('studio');
    expect(normalizeSurface('glass-frosted')).toBe('glass-frosted');
    expect(normalizeSurface('glass-aurora')).toBe('glass-aurora');
  });

  it('syncs data-surface attribute onto documentElement across all 3 surface finishes', () => {
    globalThis.localStorage = createMockStorage();
    const dataset = {};
    const styleProps = new Map();
    const attrs = new Map();
    globalThis.document = {
      documentElement: {
        dataset,
        style: { setProperty: (k, v) => styleProps.set(k, v), backgroundColor: '' },
        classList: { remove: () => {}, add: () => {} },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: k => attrs.delete(k),
      },
      querySelector: () => null,
    };
    globalThis.window = {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    };

    expect(getSettings().surface).toBe('studio');
    applySettings();
    expect(dataset.surface).toBe('studio');

    localStorage.setItem(SURFACE_KEY, 'glass-frosted');
    applySettings();
    expect(dataset.surface).toBe('glass-frosted');

    localStorage.setItem(SURFACE_KEY, 'glass-aurora');
    applySettings();
    expect(dataset.surface).toBe('glass-aurora');

    localStorage.setItem(SURFACE_KEY, 'studio');
    applySettings();
    expect(dataset.surface).toBe('studio');
  });
});

describe('Pass 2 True Liquid Glass CSS Architecture (60fps-Safe)', () => {
  const glassStart = stylesCss.indexOf('iOS 26 "Liquid Glass" Surface System');
  const studioCss = glassStart >= 0 ? stylesCss.slice(0, glassStart) : stylesCss;
  const glassCss = glassStart >= 0 ? stylesCss.slice(glassStart) : '';

  it('keeps default Studio chrome zero-blur for fastest launch and 60fps scrolling', () => {
    const baseNavbar = studioCss.match(/\.navbar\s*\{[\s\S]*?\}/);
    expect(baseNavbar).not.toBeNull();
    expect(baseNavbar[0]).not.toContain('backdrop-filter');

    const studioToolbar = studioCss.match(/\.format-toolbar\s*\{\s*\n\s*background:\s*var\(--card-bg\);[\s\S]*?\}/);
    expect(studioToolbar).not.toBeNull();
    expect(studioToolbar[0]).not.toContain('backdrop-filter');
  });

  it('uses detached transparent .navbar with floating capsule headers', () => {
    expect(glassStart).toBeGreaterThan(-1);
    expect(glassCss).toContain(":root[data-surface^='glass-'] .navbar");
    expect(glassCss).toContain(':root[data-surface^=\'glass-\'] .navbar > .navbar-back');
    expect(glassCss).toContain(':root[data-surface^=\'glass-\'] .navbar > .navbar-title');
    expect(glassCss).toContain(':root[data-surface^=\'glass-\'] .navbar > div');
    expect(glassCss).toMatch(/\.navbar,\s*\n:root\[data-surface\^='glass-'\] \.navbar\.navbar-home[\s\S]*?background:\s*transparent;/);
  });

  it('keeps scrolling cards and segmented controls blur-free for 60fps mobile scroll', () => {
    const viewSwitcherBlock = glassCss.match(
      /:root\[data-surface\^='glass-'\] \.view-switcher,\s*\n:root\[data-surface\^='glass-'\] \.feynman-lang-switch\s*\{[\s\S]*?\}/
    );
    expect(viewSwitcherBlock).not.toBeNull();
    expect(viewSwitcherBlock[0]).toContain('backdrop-filter: none;');

    const cardLayerBlock = glassCss.match(
      /\/\* Layer 3 — Zero-Blur Diagonal Specular Scrolling Cards[\s\S]*?\.note-cards-list \.swipe-row-wrap\s*\{[\s\S]*?\}/
    );
    expect(cardLayerBlock).not.toBeNull();
    expect(cardLayerBlock[0]).not.toContain('backdrop-filter: blur');
    expect(cardLayerBlock[0]).toContain('background: var(--glass-card-bg);');
  });

  it('supports Dark, OLED, Auto-Dark, and data-reduce-motion fallbacks preserving FAB accent', () => {
    expect(glassCss).toContain(":root[data-theme='dark'][data-surface='glass-frosted']");
    expect(glassCss).toContain(":root[data-theme='dark'][data-surface='glass-aurora']");
    expect(glassCss).toContain(":root[data-oled='true'][data-surface^='glass-']");
    expect(glassCss).toContain('@media (prefers-color-scheme: dark)');
    expect(glassCss).toContain(":root[data-reduce-motion='true'][data-surface^='glass-'] .fab.fab-pill");

    const reduceMotionFabBlock = glassCss.match(
      /:root\[data-reduce-motion='true'\]\[data-surface\^='glass-'\] \.fab\.fab-pill\s*\{[\s\S]*?\}/
    );
    expect(reduceMotionFabBlock).not.toBeNull();
    expect(reduceMotionFabBlock[0]).toContain('backdrop-filter: none !important;');
    expect(reduceMotionFabBlock[0]).toContain('background: var(--accent);');
    expect(glassCss).toMatch(/:root\[data-surface\^='glass-'\] \.row-action-chip\.active-chip[\s\S]*?color:\s*var\(--accent-text\)/);
  });
});
