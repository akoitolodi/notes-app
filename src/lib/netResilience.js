/**
 * netResilience — Slow-Internet Resilience, Adaptive Timeouts & Resilient Fetch with Backoff.
 *
 * Designed for flaky campus Wi-Fi & 2G/3G mobile data:
 * - Auto-detects slow connections via Network Information API (`2g`, `slow-2g`, `3g`, `saveData`)
 *   OR lets users force "Slow Internet Mode" manually in Settings.
 * - Widens AI first-byte watchdogs & upstream fetch timeouts so slow networks don't fail prematurely.
 * - Retries transient network drops (Failed to fetch / 429 / 5xx) with exponential backoff.
 */

export const SLOW_NET_KEY = 'aicn:slowNetMode'; // 'auto' | 'on' | 'off'

export function getSlowNetworkSetting() {
  try {
    const v = localStorage.getItem(SLOW_NET_KEY);
    if (v === 'on' || v === 'off' || v === 'auto') return v;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function setSlowNetworkSetting(mode) {
  const safe = mode === 'on' || mode === 'off' ? mode : 'auto';
  try {
    localStorage.setItem(SLOW_NET_KEY, safe);
  } catch {
    // ignore
  }
  return safe;
}

/** Detect whether Slow Internet Mode is currently active (manual ON or slow 2G/3G connection). */
export function isSlowNetworkActive() {
  const pref = getSlowNetworkSetting();
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  try {
    const conn = typeof navigator !== 'undefined' && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    if (!conn) return false;
    if (conn.saveData) return true;
    const eff = String(conn.effectiveType || '').toLowerCase();
    if (eff === 'slow-2g' || eff === '2g' || eff === '3g') return true;
    if (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 1.5) return true;
  } catch {
    // ignore
  }
  return false;
}

/** Return adaptive timeout & RAG budgets tailored to current network quality. */
export function getAdaptiveTimeouts() {
  const slow = isSlowNetworkActive();
  return {
    slow,
    aiFirstByteMs: slow ? 45000 : 18000,
    aiReasonFirstByteMs: slow ? 30000 : 12000,
    aiReasonNonStreamMs: slow ? 36000 : 14000,
    aiTotalMs: slow ? 240000 : 180000,
    fetchMs: slow ? 40000 : 22000,
    codapiMs: slow ? 30000 : 18000,
    ragTopK: slow ? 4 : 6,
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function waitMs(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { isCancelled: true }));
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Cancelled'), { isCancelled: true }));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch wrapper with per-attempt timeout + exponential backoff retries on transient
 * network drops (`TypeError: Failed to fetch`), timeouts, and 429/5xx responses.
 */
export async function fetchWithRetry(
  url,
  options = {},
  { retries = 2, timeoutMs = null, backoffBaseMs = 1000, signal = null, fetchImpl = null } = {}
) {
  const doFetch = fetchImpl || globalThis.fetch;
  const effectiveTimeout = timeoutMs || getAdaptiveTimeouts().fetchMs;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Cancelled'), { isCancelled: true });
    }
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, effectiveTimeout);
    const onOuterAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await doFetch(url, { ...options, signal: ctrl.signal });
      if (isRetryableStatus(res.status) && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await waitMs(backoffBaseMs * Math.pow(2, attempt), signal);
        continue;
      }
      return res;
    } catch (err) {
      if (signal?.aborted && !timedOut) {
        throw Object.assign(new Error('Cancelled'), { isCancelled: true });
      }
      lastErr = timedOut
        ? new Error('Connection timed out on slow network. Tap Retry or enable Slow Internet Mode.')
        : err;
      if (attempt < retries) {
        await waitMs(backoffBaseMs * Math.pow(2, attempt), signal);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastErr || new Error('Network request failed');
}
