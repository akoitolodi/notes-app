/**
 * katexRender.js — Bounded LRU-cached wrapper around `katex.renderToString`.
 * Keeps formula rendering instant across scroll/re-renders (up to 250 formulas in RAM).
 */
import katex from 'katex';

const MAX_CACHE = 250;
const _cache = new Map();

export function renderKatexCached(expr, displayMode = false) {
  const clean = String(expr || '').trim();
  if (!clean) return null;
  const key = `${displayMode ? 'D' : 'I'}:${clean}`;
  if (_cache.has(key)) {
    const hit = _cache.get(key);
    // Refresh recency (LRU)
    _cache.delete(key);
    _cache.set(key, hit);
    return hit;
  }
  try {
    const html = katex.renderToString(clean, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
    if (_cache.size >= MAX_CACHE) {
      const oldestKey = _cache.keys().next().value;
      _cache.delete(oldestKey);
    }
    _cache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

export function clearKatexCache() {
  _cache.clear();
}

export function getKatexCacheSize() {
  return _cache.size;
}
