/**
 * API base URL configuration.
 * - Web (same origin): relative '' — Vite dev proxy / Express static serve handle it.
 * - Native (Capacitor): the app runs from a local webview with no server,
 *   so it must point at a running backend. On-device Termux server is reachable
 *   at http://127.0.0.1:8080 (Android loopback is device-wide).
 * Override anytime via localStorage key 'aicmp:apiBase'.
 */
const LS_KEY = 'aicmp:apiBase';

function detectBase() {
  const override = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY);
  if (override) return override.replace(/\/$/, '');

  // Capacitor native WebView
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform?.()) {
    return 'http://127.0.0.1:8080';
  }
  return '';
}

export const API_BASE = detectBase();

export function setApiBase(url) {
  if (url) localStorage.setItem(LS_KEY, url.replace(/\/$/, ''));
  else localStorage.removeItem(LS_KEY);
  location.reload();
}