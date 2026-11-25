/**
 * Local PIN-Locked Private Vault — protects sensitive folders (e.g., Personal Diary)
 * with a salted SHA-256 hash stored locally and in-memory session unlock.
 *
 * Includes a pure-JS SHA-256 fallback so PIN verification works everywhere
 * (Android Capacitor WebView, HTTPS, localhost, plain-HTTP LAN IPs, and Node/Vitest).
 */

export const VAULT_PIN_KEY = 'aicn:vaultPin';
export const VAULT_DECOY_KEY = 'aicn:vaultDecoy';

// In-memory unlock state ('locked' | 'real' | 'decoy'), cleared automatically on reload/background
let sessionMode = 'locked';
const listeners = new Set();

function notifyVaultListeners() {
  const unlocked = sessionMode !== 'locked';
  listeners.forEach(fn => {
    try {
      fn(unlocked, sessionMode);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function subscribeVault(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getVaultSessionMode() {
  return sessionMode;
}

export function isVaultUnlocked() {
  return sessionMode !== 'locked';
}

export function isRealVaultUnlocked() {
  return sessionMode === 'real';
}

export function isDecoyVaultUnlocked() {
  return sessionMode === 'decoy';
}

export function lockVault() {
  if (sessionMode === 'locked') return;
  sessionMode = 'locked';
  notifyVaultListeners();
}

export function unlockVaultSession() {
  if (sessionMode === 'real') return;
  sessionMode = 'real';
  notifyVaultListeners();
}

export function unlockDecoyVaultSession() {
  if (sessionMode === 'decoy') return;
  sessionMode = 'decoy';
  notifyVaultListeners();
}

// ---------- Portable SHA-256 (Web Crypto + pure-JS fallback) ----------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256FallbackHex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(input) {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
      return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fall through to portable JS SHA-256
    }
  }
  return sha256FallbackHex(input);
}

function generateSalt() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ---------- PIN Storage Helpers ----------

export function getVaultConfig() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(VAULT_PIN_KEY) || 'null');
    if (raw && typeof raw.hash === 'string' && typeof raw.salt === 'string') {
      return raw;
    }
  } catch {
    // ignore corrupt JSON
  }
  return null;
}

export function hasVaultPin() {
  return Boolean(getVaultConfig());
}

export function getVaultHint() {
  return getVaultConfig()?.hint || '';
}

/** Validate PIN string (4 to 6 digits). */
export function isValidPin(pin) {
  return /^\d{4,6}$/.test(String(pin || '').trim());
}

/** Hash and persist a new 4–6 digit Vault PIN with an optional memory hint. */
export async function setupVaultPin(pin, hint = '') {
  const clean = String(pin || '').trim();
  if (!isValidPin(clean)) {
    throw new Error('PIN must be 4 to 6 digits.');
  }
  const salt = generateSalt();
  const hash = await sha256Hex(`notes-by-bai:${salt}:${clean}`);
  const payload = {
    salt,
    hash,
    hint: String(hint || '').trim().slice(0, 80),
    updatedAt: Date.now(),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VAULT_PIN_KEY, JSON.stringify(payload));
  }
  unlockVaultSession();
  return payload;
}

/** Verify a PIN candidate against the saved salted hash. */
export async function verifyVaultPin(pin) {
  const cfg = getVaultConfig();
  if (!cfg) return false;
  const clean = String(pin || '').trim();
  if (!clean) return false;
  const candidate = await sha256Hex(`notes-by-bai:${cfg.salt}:${clean}`);
  const ok = candidate === cfg.hash;
  if (ok) unlockVaultSession();
  return ok;
}

/** Clear PIN record (used only after verifying PIN if user removes all locks). */
export function clearVaultPin() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(VAULT_PIN_KEY);
  }
  lockVault();
}

// ---------- Stealth Decoy / Dummy Vault Helpers ----------

export function getDecoyConfig() {
  if (typeof localStorage === 'undefined') return { enabled: false, triggerDigit: '7' };
  try {
    const raw = JSON.parse(localStorage.getItem(VAULT_DECOY_KEY) || 'null');
    if (raw && raw.enabled && /^\d$/.test(String(raw.triggerDigit || ''))) {
      return { enabled: true, triggerDigit: String(raw.triggerDigit) };
    }
  } catch {
    // ignore corrupt JSON
  }
  return { enabled: false, triggerDigit: '7' };
}

/** One-time setup from Settings: arms stealth long-press digit trigger and hides itself from Settings. */
export function enableDecoyVault(triggerDigit = '7') {
  const digit = String(triggerDigit || '').trim();
  if (!/^\d$/.test(digit)) {
    throw new Error('Pick a single digit (0-9) for the secret long-press trigger.');
  }
  const payload = { enabled: true, triggerDigit: digit, enabledAt: Date.now() };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VAULT_DECOY_KEY, JSON.stringify(payload));
  }
  return payload;
}

/** Update decoy trigger digit — strictly allowed only while the Real Hidden Vault is unlocked. */
export function updateDecoyTriggerDigit(triggerDigit) {
  if (!isRealVaultUnlocked()) {
    throw new Error('Unlock the real Hidden Vault first.');
  }
  return enableDecoyVault(triggerDigit);
}

/** Turn off Stealth Decoy Vault — strictly allowed only while the Real Hidden Vault is unlocked. */
export function disableDecoyVault() {
  if (!isRealVaultUnlocked()) {
    throw new Error('Stealth Decoy Vault can only be turned off inside your real Hidden Vault.');
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(VAULT_DECOY_KEY);
  }
  return { enabled: false, triggerDigit: '7' };
}
