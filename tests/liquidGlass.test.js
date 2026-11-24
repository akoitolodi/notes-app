import { describe, it, expect, afterEach } from 'vitest';
import {
  SURFACE_KEY,
  SURFACE_STYLES,
  normalizeSurface,
  getSettings,
  applySettings,
} from '../src/theme';

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
  it('exposes 3 valid Surface Finish modes and defaults to Frosted Glass', () => {
    expect(SURFACE_STYLES.map(([id]) => id)).toEqual([
      'studio',
      'glass-frosted',
      'glass-aurora',
    ]);
    expect(normalizeSurface(null)).toBe('glass-frosted');
    expect(normalizeSurface('unknown')).toBe('glass-frosted');
    expect(normalizeSurface('studio')).toBe('studio');
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

    expect(getSettings().surface).toBe('glass-frosted');
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
