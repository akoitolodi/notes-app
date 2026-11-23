/**
 * Appearance settings — theme (auto/light/dark), accent color with WCAG-safe
 * foreground & ink colors, font size, and live <meta name="theme-color"> sync.
 */
export const THEME_KEY = 'aicn:theme';   // 'auto' | 'light' | 'dark'
export const ACCENT_KEY = 'aicn:accent'; // key into ACCENTS
export const SIZE_KEY = 'aicn:size';     // 'small' | 'medium' | 'large'
export const HINT_KEY = 'aicn:showHint'; // boolean string

export const ACCENTS = {
  yellow: {
    c: '#ffcc00',
    p: '#e6b800',
    text: '#000000',
    inkLight: '#8f6300',
    tint: 'rgba(255, 204, 0, 0.2)',
    label: 'Yellow',
  },
  blue: {
    c: '#0a84ff',
    p: '#0060df',
    text: '#ffffff',
    inkLight: '#0060df',
    tint: 'rgba(10, 132, 255, 0.16)',
    label: 'Blue',
  },
  green: {
    c: '#28b44c',
    p: '#1e8c3a',
    text: '#ffffff',
    inkLight: '#1b7a34',
    tint: 'rgba(40, 180, 76, 0.16)',
    label: 'Green',
  },
  pink: {
    c: '#ff375f',
    p: '#d11e42',
    text: '#ffffff',
    inkLight: '#c81c40',
    tint: 'rgba(255, 55, 95, 0.16)',
    label: 'Pink',
  },
  purple: {
    c: '#af52de',
    p: '#8e38bd',
    text: '#ffffff',
    inkLight: '#822db2',
    tint: 'rgba(175, 82, 222, 0.16)',
    label: 'Purple',
  },
};

export function getSettings() {
  try {
    return {
      theme: localStorage.getItem(THEME_KEY) || 'auto',
      accent: localStorage.getItem(ACCENT_KEY) || 'yellow',
      size: localStorage.getItem(SIZE_KEY) || 'medium',
    };
  } catch {
    return { theme: 'auto', accent: 'yellow', size: 'medium' };
  }
}

export function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  const { theme } = getSettings();
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function updateMetaThemeColor(dark) {
  if (typeof document === 'undefined') return;
  const color = dark ? '#000000' : '#f2f2f7';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
  const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusMeta) statusMeta.setAttribute('content', dark ? 'black-translucent' : 'default');
  document.documentElement.style.backgroundColor = color;
}

let mediaListenerAttached = false;

export function applySettings() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { theme, accent, size } = getSettings();

  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;

  const dark = isDarkTheme();
  const a = ACCENTS[accent] || ACCENTS.yellow;

  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-pressed', a.p);
  root.style.setProperty('--accent-text', a.text);
  root.style.setProperty('--accent-ink', dark ? a.c : a.inkLight);
  root.style.setProperty('--accent-tint', a.tint);
  root.style.setProperty('--focus', dark ? a.c : a.inkLight);

  root.classList.remove('fs-small', 'fs-large');
  if (size !== 'medium') root.classList.add('fs-' + size);

  updateMetaThemeColor(dark);

  // Keep auto theme synchronized if system appearance flips while app is open
  if (!mediaListenerAttached && typeof window !== 'undefined' && window.matchMedia) {
    mediaListenerAttached = true;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (getSettings().theme === 'auto') applySettings();
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }
}
