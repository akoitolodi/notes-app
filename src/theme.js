/**
 * Appearance settings — themes (12 curated surface themes + auto/light/dark/oled),
 * 12 single & dual-tone color combinations/palettes, text sizes, paper textures,
 * and live <meta name="theme-color"> synchronization.
 */
export const THEME_KEY = 'aicn:theme';             // 'auto' | 'light' | 'dark' | 'oled'
export const THEME_PRESET_KEY = 'aicn:themePreset'; // 'default' | preset id
export const ACCENT_KEY = 'aicn:accent';           // key into ACCENTS
export const SIZE_KEY = 'aicn:size';               // 'small' | 'medium' | 'large'
export const PAPER_KEY = 'aicn:paper';             // 'blank' | 'ruled' | 'dot' | 'grid'
export const FONT_KEY = 'aicn:font';               // key into FONT_PRESETS
export const SURFACE_KEY = 'aicn:surface';         // 'studio' | 'glass-frosted' | 'glass-aurora'
export const HINT_KEY = 'aicn:showHint';           // boolean string
export const REDUCE_MOTION_KEY = 'aicn:reduceMotion'; // 'true' | 'false'
export const HIDE_STATUS_BAR_KEY = 'aicn:hideStatusBar'; // 'true' | 'false'
export const REFRESH_RATE_KEY = 'aicn:refreshRate'; // 'max' | '90' | '60'

export const SURFACE_STYLES = [
  ['studio', 'Studio'],
  ['glass-frosted', 'Frosted Glass'],
  ['glass-aurora', 'Aurora Glass'],
];

export function normalizeSurface(val) {
  if (val === 'studio' || val === 'glass-frosted' || val === 'glass-aurora') return val;
  return 'studio';
}

export const FONT_PRESETS = [
  {
    id: 'system',
    name: 'Clean Sans',
    sample: 'Modern legible clarity',
    category: 'Sans-Serif',
    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
    pdfFont: 'helvetica',
  },
  {
    id: 'times',
    name: 'Times New Roman',
    sample: 'Classic academic serif',
    category: 'Serif',
    stack: "'Times New Roman', Times, 'Liberation Serif', 'Noto Serif', Georgia, serif",
    pdfFont: 'times',
  },
  {
    id: 'georgia',
    name: 'Georgia',
    sample: 'Warm editorial book print',
    category: 'Serif',
    stack: "Georgia, Cambria, 'Noto Serif', 'Times New Roman', serif",
    pdfFont: 'times',
  },
  {
    id: 'garamond',
    name: 'Garamond',
    sample: 'Refined classic literature',
    category: 'Serif',
    stack: "Garamond, 'EB Garamond', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
    pdfFont: 'times',
  },
  {
    id: 'palatino',
    name: 'Palatino',
    sample: 'Crisp thesis & essay type',
    category: 'Serif',
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    pdfFont: 'times',
  },
  {
    id: 'rounded',
    name: 'Friendly Rounded',
    sample: 'Soft casual study feel',
    category: 'Rounded',
    stack: "ui-rounded, 'SF Pro Rounded', 'Trebuchet MS', 'Segoe UI', sans-serif",
    pdfFont: 'helvetica',
  },
  {
    id: 'typewriter',
    name: 'Courier Typewriter',
    sample: 'Draft & outline typewriter',
    category: 'Monospace',
    stack: "'Courier New', Courier, 'Liberation Mono', monospace",
    pdfFont: 'courier',
  },
  {
    id: 'mono',
    name: 'Code Mono',
    sample: 'Aligned CS & math tables',
    category: 'Monospace',
    stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace",
    pdfFont: 'courier',
  },
];

export function getFontPreset(id) {
  return FONT_PRESETS.find(f => f.id === id) || FONT_PRESETS[0];
}

export const PAPER_STYLES = [
  ['blank', 'Blank'],
  ['ruled', 'Ruled'],
  ['dot', 'Dot Grid'],
  ['grid', 'Graph'],
];

/** 12 Curated Full Surface Themes (5 Light + 7 Dark) */
export const THEME_PRESETS = [
  // Light Surface Themes
  {
    id: 'warm-ivory',
    name: 'Warm Ivory',
    desc: 'Soft editorial paper',
    mode: 'light',
    bg: '#f4f2ec',
    card: '#ffffff',
    text: '#14151a',
    accent: '#6366f1',
  },
  {
    id: 'matcha-sage',
    name: 'Matcha Sage',
    desc: 'Calm green study tint',
    mode: 'light',
    bg: '#ecf3ec',
    card: '#fafdfa',
    text: '#132118',
    accent: '#059669',
  },
  {
    id: 'sakura-mist',
    name: 'Sakura Mist',
    desc: 'Warm blush daylight',
    mode: 'light',
    bg: '#faf1f4',
    card: '#ffffff',
    text: '#1f1218',
    accent: '#e11d48',
  },
  {
    id: 'nordic-ice',
    name: 'Nordic Ice',
    desc: 'Crisp arctic blue tint',
    mode: 'light',
    bg: '#edf3fa',
    card: '#fbfdff',
    text: '#0f172a',
    accent: '#2563eb',
  },
  {
    id: 'sepia-book',
    name: 'Sepia Book',
    desc: 'Warm eye-comfort reading',
    mode: 'light',
    bg: '#f3ecdd',
    card: '#fcf9f2',
    text: '#292118',
    accent: '#b45309',
  },

  // Dark Surface Themes
  {
    id: 'deep-obsidian',
    name: 'Deep Obsidian',
    desc: 'Signature studio dark',
    mode: 'dark',
    bg: '#090a0e',
    card: '#141720',
    text: '#f3f4f8',
    accent: '#6366f1',
  },
  {
    id: 'oled-black',
    name: 'OLED True Black',
    desc: 'Pure #000 battery saver',
    mode: 'dark',
    isOled: true,
    bg: '#000000',
    card: '#0c0e14',
    text: '#f8fafc',
    accent: '#f59e0b',
  },
  {
    id: 'midnight-ocean',
    name: 'Midnight Ocean',
    desc: 'Deep abyssal navy',
    mode: 'dark',
    bg: '#071120',
    card: '#0e1c32',
    text: '#eef5ff',
    accent: '#38bdf8',
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    desc: 'Cozy pastel dark',
    mode: 'dark',
    bg: '#181825',
    card: '#1e1e2e',
    text: '#cdd6f4',
    accent: '#b4befe',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    desc: 'Neon twilight slate',
    mode: 'dark',
    bg: '#131522',
    card: '#1b1e30',
    text: '#c0caf5',
    accent: '#7aa2f7',
  },
  {
    id: 'forest-night',
    name: 'Forest Night',
    desc: 'Deep evergreen focus',
    mode: 'dark',
    bg: '#08120c',
    card: '#101f16',
    text: '#ecfdf5',
    accent: '#34d399',
  },
  {
    id: 'dracula-plum',
    name: 'Dracula Plum',
    desc: 'Rich violet studio',
    mode: 'dark',
    bg: '#15111f',
    card: '#211b30',
    text: '#f8f8f2',
    accent: '#f472b6',
  },
];

/** 12 Single & Dual-Tone Color Combinations / Palettes */
export const ACCENTS = {
  indigo: {
    c: '#6366f1',
    c2: '#a855f7',
    p: '#4f46e5',
    text: '#ffffff',
    inkLight: '#4338ca',
    tint: 'rgba(99, 102, 241, 0.14)',
    label: 'Indigo · Violet',
  },
  yellow: {
    c: '#f59e0b',
    c2: '#fb7185',
    p: '#d97706',
    text: '#14151a',
    inkLight: '#b45309',
    tint: 'rgba(245, 158, 11, 0.16)',
    label: 'Amber · Gold',
  },
  blue: {
    c: '#2563eb',
    c2: '#06b6d4',
    p: '#1d4ed8',
    text: '#ffffff',
    inkLight: '#1d4ed8',
    tint: 'rgba(37, 99, 235, 0.14)',
    label: 'Ocean · Cyan',
  },
  teal: {
    c: '#14b8a6',
    c2: '#38bdf8',
    p: '#0d9488',
    text: '#ffffff',
    inkLight: '#0f766e',
    tint: 'rgba(20, 184, 166, 0.15)',
    label: 'Teal · Aqua',
  },
  green: {
    c: '#10b981',
    c2: '#84cc16',
    p: '#059669',
    text: '#ffffff',
    inkLight: '#047857',
    tint: 'rgba(16, 185, 129, 0.15)',
    label: 'Emerald · Mint',
  },
  pink: {
    c: '#f43f5e',
    c2: '#f97316',
    p: '#e11d48',
    text: '#ffffff',
    inkLight: '#be123c',
    tint: 'rgba(244, 63, 94, 0.15)',
    label: 'Rose · Sunset',
  },
  purple: {
    c: '#8b5cf6',
    c2: '#ec4899',
    p: '#7c3aed',
    text: '#ffffff',
    inkLight: '#6d28d9',
    tint: 'rgba(139, 92, 246, 0.15)',
    label: 'Violet · Pink',
  },
  coral: {
    c: '#ff6b4a',
    c2: '#fbbf24',
    p: '#ea580c',
    text: '#ffffff',
    inkLight: '#c2410c',
    tint: 'rgba(255, 107, 74, 0.15)',
    label: 'Coral · Peach',
  },
  sky: {
    c: '#0ea5e9',
    c2: '#6366f1',
    p: '#0284c7',
    text: '#ffffff',
    inkLight: '#0369a1',
    tint: 'rgba(14, 165, 233, 0.15)',
    label: 'Sky · Indigo',
  },
  lavender: {
    c: '#a78bfa',
    c2: '#38bdf8',
    p: '#8b5cf6',
    text: '#14151a',
    inkLight: '#6d28d9',
    tint: 'rgba(167, 139, 250, 0.18)',
    label: 'Lavender · Ice',
  },
  crimson: {
    c: '#e11d48',
    c2: '#9333ea',
    p: '#be123c',
    text: '#ffffff',
    inkLight: '#9f1239',
    tint: 'rgba(225, 29, 72, 0.14)',
    label: 'Crimson · Plum',
  },
  slate: {
    c: '#475569',
    c2: '#94a3b8',
    p: '#334155',
    text: '#ffffff',
    inkLight: '#334155',
    tint: 'rgba(100, 116, 139, 0.16)',
    label: 'Mono · Graphite',
  },
};

export function getSettings() {
  try {
    return {
      theme: localStorage.getItem(THEME_KEY) || 'auto',
      themePreset: localStorage.getItem(THEME_PRESET_KEY) || 'default',
      surface: normalizeSurface(localStorage.getItem(SURFACE_KEY)),
      accent: localStorage.getItem(ACCENT_KEY) || 'indigo',
      size: localStorage.getItem(SIZE_KEY) || 'medium',
      paper: localStorage.getItem(PAPER_KEY) || 'blank',
      font: localStorage.getItem(FONT_KEY) || 'system',
      reduceMotion: localStorage.getItem(REDUCE_MOTION_KEY) === 'true',
      hideStatusBar: localStorage.getItem(HIDE_STATUS_BAR_KEY) === 'true',
      refreshRate: localStorage.getItem(REFRESH_RATE_KEY) || 'max',
    };
  } catch {
    return {
      theme: 'auto',
      themePreset: 'default',
      surface: 'studio',
      accent: 'indigo',
      size: 'medium',
      paper: 'blank',
      font: 'system',
      reduceMotion: false,
      hideStatusBar: false,
      refreshRate: 'max',
    };
  }
}

export function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  const { theme, themePreset } = getSettings();
  const preset = THEME_PRESETS.find(p => p.id === themePreset);
  if (preset) return preset.mode === 'dark';
  if (theme === 'dark' || theme === 'oled') return true;
  if (theme === 'light') return false;
  return Boolean(
    typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function updateMetaThemeColor(dark, themeSetting = 'auto', presetObj = null) {
  if (typeof document === 'undefined') return;
  const color = presetObj
    ? presetObj.bg
    : dark
      ? themeSetting === 'oled'
        ? '#000000'
        : '#090a0e'
      : '#f4f2ec';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
  const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusMeta) statusMeta.setAttribute('content', dark ? 'black-translucent' : 'default');
  document.documentElement.style.backgroundColor = color;
  document.documentElement.style.setProperty('--boot-bg', color);
  try {
    window.BaiNativeTheme?.setBgColor?.(color, Boolean(dark));
  } catch {
    // non-native web
  }
}

let mediaListenerAttached = false;

export function applySettings() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { theme, themePreset, surface, accent, size, paper, font, reduceMotion, hideStatusBar, refreshRate } = getSettings();
  const preset = THEME_PRESETS.find(p => p.id === themePreset) || null;
  root.dataset.surface = normalizeSurface(surface);

  if (preset) {
    root.dataset.theme = preset.mode;
    root.dataset.themePreset = preset.id;
    if (preset.isOled) root.dataset.oled = 'true';
    else root.removeAttribute('data-oled');
  } else {
    root.removeAttribute('data-themePreset');
    delete root.dataset.themePreset;
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
  }

  if (paper && paper !== 'blank') root.dataset.paper = paper;
  else root.removeAttribute('data-paper');

  if (reduceMotion) root.dataset.reduceMotion = 'true';
  else {
    delete root.dataset.reduceMotion;
    root.removeAttribute('data-reduce-motion');
  }

  const dark = isDarkTheme();
  const a = ACCENTS[accent] || ACCENTS.indigo;

  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-2', a.c2 || a.c);
  root.style.setProperty('--accent-pressed', a.p);
  root.style.setProperty('--accent-text', a.text);
  root.style.setProperty('--accent-ink', dark ? a.c : a.inkLight);
  root.style.setProperty('--accent-tint', a.tint);
  root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${a.c}, ${a.c2 || a.p})`);
  root.style.setProperty('--focus', dark ? a.c : a.inkLight);

  root.classList.remove('fs-small', 'fs-large');
  if (size !== 'medium') root.classList.add('fs-' + size);

  const fontPreset = getFontPreset(font);
  root.style.setProperty('--font-note', fontPreset.stack);
  root.dataset.font = fontPreset.id;

  updateMetaThemeColor(dark, theme, preset);

  try {
    window.BaiNativeTheme?.setHideStatusBar?.(Boolean(hideStatusBar));
  } catch {
    // non-native web
  }

  try {
    window.BaiNativeDisplay?.setRefreshRateMode?.(refreshRate || 'max');
  } catch {
    // non-native web
  }

  // Keep auto theme synchronized if system appearance flips while app is open
  if (!mediaListenerAttached && typeof window !== 'undefined' && window.matchMedia) {
    mediaListenerAttached = true;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const cur = getSettings();
      if (cur.theme === 'auto' && (!cur.themePreset || cur.themePreset === 'default')) {
        applySettings();
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }
}
