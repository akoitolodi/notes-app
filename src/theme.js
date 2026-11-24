/**
 * Appearance settings — theme (auto/light/dark), accent color with WCAG-safe
 * foreground & ink colors, font size, and live <meta name="theme-color"> sync.
 */
export const THEME_KEY = 'aicn:theme';   // 'auto' | 'light' | 'dark' | 'oled'
export const ACCENT_KEY = 'aicn:accent'; // key into ACCENTS
export const SIZE_KEY = 'aicn:size';     // 'small' | 'medium' | 'large'
export const PAPER_KEY = 'aicn:paper';   // 'blank' | 'ruled' | 'dot' | 'grid'
export const HINT_KEY = 'aicn:showHint'; // boolean string

export const PAPER_STYLES = [
  ['blank', 'Blank'],
  ['ruled', 'Ruled'],
  ['dot', 'Dot Grid'],
  ['grid', 'Graph'],
];

export const ACCENTS = {
  indigo: {
    c: '#6366f1',
    p: '#4f46e5',
    text: '#ffffff',
    inkLight: '#4338ca',
    tint: 'rgba(99, 102, 241, 0.14)',
    label: 'Indigo',
  },
  yellow: {
    c: '#f59e0b',
    p: '#d97706',
    text: '#14151a',
    inkLight: '#b45309',
    tint: 'rgba(245, 158, 11, 0.16)',
    label: 'Amber',
  },
  blue: {
    c: '#2563eb',
    p: '#1d4ed8',
    text: '#ffffff',
    inkLight: '#1d4ed8',
    tint: 'rgba(37, 99, 235, 0.14)',
    label: 'Blue',
  },
  teal: {
    c: '#14b8a6',
    p: '#0d9488',
    text: '#ffffff',
    inkLight: '#0f766e',
    tint: 'rgba(20, 184, 166, 0.15)',
    label: 'Teal',
  },
  green: {
    c: '#10b981',
    p: '#059669',
    text: '#ffffff',
    inkLight: '#047857',
    tint: 'rgba(16, 185, 129, 0.15)',
    label: 'Emerald',
  },
  pink: {
    c: '#f43f5e',
    p: '#e11d48',
    text: '#ffffff',
    inkLight: '#be123c',
    tint: 'rgba(244, 63, 94, 0.15)',
    label: 'Rose',
  },
  purple: {
    c: '#8b5cf6',
    p: '#7c3aed',
    text: '#ffffff',
    inkLight: '#6d28d9',
    tint: 'rgba(139, 92, 246, 0.15)',
    label: 'Violet',
  },
};

export function getSettings() {
  try {
    return {
      theme: localStorage.getItem(THEME_KEY) || 'auto',
      accent: localStorage.getItem(ACCENT_KEY) || 'indigo',
      size: localStorage.getItem(SIZE_KEY) || 'medium',
      paper: localStorage.getItem(PAPER_KEY) || 'blank',
    };
  } catch {
    return { theme: 'auto', accent: 'indigo', size: 'medium', paper: 'blank' };
  }
}

export function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  const { theme } = getSettings();
  if (theme === 'dark' || theme === 'oled') return true;
  if (theme === 'light') return false;
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function updateMetaThemeColor(dark, themeSetting = 'auto') {
  if (typeof document === 'undefined') return;
  const color = dark ? (themeSetting === 'oled' ? '#000000' : '#090a0e') : '#f4f2ec';
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
  const { theme, accent, size, paper } = getSettings();

  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    root.removeAttribute('data-oled');
  } else if (theme === 'oled') {
    root.dataset.theme = 'dark';
    root.dataset.oled = 'true';
  } else {
    root.dataset.theme = theme;
    root.removeAttribute('data-oled');
  }

  if (paper && paper !== 'blank') root.dataset.paper = paper;
  else root.removeAttribute('data-paper');

  const dark = isDarkTheme();
  const a = ACCENTS[accent] || ACCENTS.indigo;

  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-pressed', a.p);
  root.style.setProperty('--accent-text', a.text);
  root.style.setProperty('--accent-ink', dark ? a.c : a.inkLight);
  root.style.setProperty('--accent-tint', a.tint);
  root.style.setProperty('--focus', dark ? a.c : a.inkLight);

  root.classList.remove('fs-small', 'fs-large');
  if (size !== 'medium') root.classList.add('fs-' + size);

  updateMetaThemeColor(dark, theme);

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
