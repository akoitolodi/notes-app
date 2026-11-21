/**
 * Appearance settings — theme (auto/light/dark), accent color, font size.
 * Persisted in localStorage and applied to <html> as data-theme / classes /
 * CSS variables. applySettings() is idempotent — call it on boot and on change.
 */
export const THEME_KEY = 'aicn:theme';   // 'auto' | 'light' | 'dark'
export const ACCENT_KEY = 'aicn:accent'; // key into ACCENTS
export const SIZE_KEY = 'aicn:size';     // 'small' | 'medium' | 'large'

export const ACCENTS = {
  yellow: { c: '#ffcc00', p: '#e6b800', label: 'Yellow' },
  blue:   { c: '#0a84ff', p: '#0060df', label: 'Blue' },
  green:  { c: '#34c759', p: '#248a3d', label: 'Green' },
  pink:   { c: '#ff375f', p: '#d11e42', label: 'Pink' },
  purple: { c: '#bf5af2', p: '#9d3fd0', label: 'Purple' },
};

export function getSettings() {
  return {
    theme: localStorage.getItem(THEME_KEY) || 'auto',
    accent: localStorage.getItem(ACCENT_KEY) || 'yellow',
    size: localStorage.getItem(SIZE_KEY) || 'medium',
  };
}

export function applySettings() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { theme, accent, size } = getSettings();

  // Theme: 'auto' → follow prefers-color-scheme (no attribute)
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;

  // Accent color → CSS variables used across the app
  const a = ACCENTS[accent] || ACCENTS.yellow;
  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-pressed', a.p);

  // Font size → html-level class consumed by CSS variables
  root.classList.remove('fs-small', 'fs-large');
  if (size !== 'medium') root.classList.add('fs-' + size);
}
