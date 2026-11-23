/**
 * API base URL configuration.
 * - Web (same origin): relative '' — Vite dev proxy / Express static serve handle it.
 * - Native (Capacitor): defaults to on-device Termux server at http://127.0.0.1:8080.
 * Override anytime via Settings → AI Backend → Termux server URL (localStorage 'aicmp:apiBase').
 */
const LS_KEY = 'aicmp:apiBase';

export function getApiBase() {
  try {
    const override = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY);
    if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  } catch {
    // private browsing fallback
  }

  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform?.()) {
    return 'http://127.0.0.1:8080';
  }
  return '';
}

export function getRawApiBaseOverride() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || '';
  } catch {
    return '';
  }
}

export function setApiBase(url, { reload = false } = {}) {
  try {
    const cleaned = String(url || '').trim().replace(/\/+$/, '');
    if (cleaned) localStorage.setItem(LS_KEY, cleaned);
    else localStorage.removeItem(LS_KEY);
  } catch {
    // non-fatal
  }
  if (reload && typeof location !== 'undefined') location.reload();
}

export const API_BASE = getApiBase();
