/**
 * ThemeStudioScreen — Dedicated "Themes & Palettes" Visual Studio (v2.0.2).
 * Lets users mix and match 12 full surface themes (5 Light + 7 Dark),
 * 12 single/dual-tone color palettes, 4 note paper styles, and text sizes
 * with a live interactive preview card.
 */
import { useState } from 'react';
import { ChevronLeft, Palette, RotateCcw, Check, Sun, Moon, Sparkles } from 'lucide-react';
import {
  THEME_KEY,
  THEME_PRESET_KEY,
  ACCENT_KEY,
  SIZE_KEY,
  PAPER_KEY,
  FONT_KEY,
  SURFACE_KEY,
  PAPER_STYLES,
  SURFACE_STYLES,
  THEME_PRESETS,
  FONT_PRESETS,
  getFontPreset,
  normalizeSurface,
  ACCENTS,
  getSettings,
  applySettings,
} from '../theme';
import { useDialog } from './ui/DialogProvider';

export default function ThemeStudioScreen({ onBack }) {
  const { toast } = useDialog();
  const initial = getSettings();

  const [theme, setTheme] = useState(initial.theme);
  const [preset, setPreset] = useState(initial.themePreset || 'default');
  const [surface, setSurface] = useState(() => normalizeSurface(initial.surface));
  const [accent, setAccent] = useState(initial.accent);
  const [size, setSize] = useState(initial.size);
  const [paper, setPaper] = useState(initial.paper);
  const [font, setFont] = useState(initial.font || 'system');

  const persistAndApply = patch => {
    try {
      if (patch.theme !== undefined) {
        localStorage.setItem(THEME_KEY, patch.theme);
        setTheme(patch.theme);
      }
      if (patch.themePreset !== undefined) {
        localStorage.setItem(THEME_PRESET_KEY, patch.themePreset);
        setPreset(patch.themePreset);
      }
      if (patch.surface !== undefined) {
        const cleanSurface = normalizeSurface(patch.surface);
        localStorage.setItem(SURFACE_KEY, cleanSurface);
        setSurface(cleanSurface);
      }
      if (patch.accent !== undefined) {
        localStorage.setItem(ACCENT_KEY, patch.accent);
        setAccent(patch.accent);
      }
      if (patch.size !== undefined) {
        localStorage.setItem(SIZE_KEY, patch.size);
        setSize(patch.size);
      }
      if (patch.paper !== undefined) {
        localStorage.setItem(PAPER_KEY, patch.paper);
        setPaper(patch.paper);
      }
      if (patch.font !== undefined) {
        localStorage.setItem(FONT_KEY, patch.font);
        setFont(patch.font);
      }
    } catch {
      // ignore storage errors
    }
    applySettings();
  };

  const handleSelectBaseMode = nextMode => {
    persistAndApply({ theme: nextMode, themePreset: 'default' });
  };

  const handleSelectPreset = p => {
    persistAndApply({
      themePreset: p.id,
      theme: p.isOled ? 'oled' : p.mode,
      accent: ACCENTS[accent] ? accent : 'indigo',
    });
  };

  const handleReset = () => {
    persistAndApply({
      theme: 'auto',
      themePreset: 'default',
      surface: 'glass-frosted',
      accent: 'indigo',
      size: 'medium',
      paper: 'blank',
      font: 'system',
    });
    toast('Reset to default Liquid Glass theme');
  };

  const lightPresets = THEME_PRESETS.filter(p => p.mode === 'light');
  const darkPresets = THEME_PRESETS.filter(p => p.mode === 'dark');
  const activeAccentMeta = ACCENTS[accent] || ACCENTS.indigo;
  const activeFontMeta = getFontPreset(font);
  const activeSurfaceLabel = SURFACE_STYLES.find(([id]) => id === surface)?.[1] || 'Frosted Glass';

  return (
    <div className="screen list-pad-bottom">
      <header className="navbar">
        <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
          <ChevronLeft size={20} /> Back
        </button>
        <span className="navbar-title">Themes &amp; Palettes</span>
        <button
          type="button"
          className="navbar-btn"
          aria-label="Reset appearance"
          title="Reset to default theme"
          onClick={handleReset}
        >
          <RotateCcw size={17} />
        </button>
      </header>

      <div className="screen-body" style={{ padding: '10px 14px 32px' }}>
        {/* Live Interactive Studio Preview */}
        <div className="theme-preview-stage">
          <div className="theme-preview-card">
            <div className="theme-preview-top">
              <span className="theme-preview-badge">
                <Sparkles size={11} /> Live Preview
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                {preset !== 'default'
                  ? THEME_PRESETS.find(x => x.id === preset)?.name
                  : theme === 'oled'
                    ? 'OLED Black'
                    : theme === 'dark'
                      ? 'Dark'
                      : theme === 'light'
                        ? 'Light'
                        : 'Auto'} · {activeAccentMeta.label}
              </span>
            </div>
            <div className="theme-preview-title">Linear Algebra Notes</div>
            <div className="theme-preview-body">
              Eigenvalues satisfy det(A - λI) = 0 with clean cards, legible contrast, and crisp dual-tone accents.
            </div>
            <div className="theme-preview-actions">
              <span className="theme-preview-cta">Explain Note</span>
              <span className="theme-preview-chip">{activeSurfaceLabel}</span>
              <span className="theme-preview-chip">{activeFontMeta.name}</span>
            </div>
          </div>
        </div>

        {/* Surface Finish (Studio vs iOS Liquid Glass) */}
        <div className="settings-section-title">Surface Finish</div>
        <div className="view-switcher view-switcher-inline" style={{ marginBottom: 14 }}>
          {SURFACE_STYLES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`view-switch-btn${surface === id ? ' active' : ''}`}
              onClick={() => persistAndApply({ surface: id })}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Quick Base Mode */}
        <div className="settings-section-title">Base Mode</div>
        <div className="view-switcher view-switcher-inline" style={{ marginBottom: 14 }}>
          {[
            ['auto', 'Auto'],
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['oled', 'OLED'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`view-switch-btn${preset === 'default' && theme === id ? ' active' : ''}`}
              onClick={() => handleSelectBaseMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Light Surface Themes */}
        <div className="settings-section-title flex items-center gap-6">
          <Sun size={13} /> Light Surface Themes ({lightPresets.length})
        </div>
        <div className="theme-preset-grid" style={{ marginBottom: 16 }}>
          {lightPresets.map(p => {
            const selected = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`theme-preset-card${selected ? ' active' : ''}`}
                onClick={() => handleSelectPreset(p)}
              >
                <div className="theme-preset-swatch" style={{ background: p.bg }}>
                  <div className="theme-preset-mini-card" style={{ background: p.card, color: p.text }}>
                    <span className="theme-preset-dot" style={{ background: p.accent }} />
                    <span className="theme-preset-bar" style={{ background: p.text }} />
                    <span className="theme-preset-bar is-sub" style={{ background: p.text }} />
                  </div>
                </div>
                <div className="theme-preset-meta">
                  <div>
                    <div className="theme-preset-name">{p.name}</div>
                    <div className="theme-preset-desc">{p.desc}</div>
                  </div>
                  {selected && (
                    <span className="theme-preset-check">
                      <Check size={13} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Dark Surface Themes */}
        <div className="settings-section-title flex items-center gap-6">
          <Moon size={13} /> Dark Surface Themes ({darkPresets.length})
        </div>
        <div className="theme-preset-grid" style={{ marginBottom: 18 }}>
          {darkPresets.map(p => {
            const selected = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`theme-preset-card${selected ? ' active' : ''}`}
                onClick={() => handleSelectPreset(p)}
              >
                <div className="theme-preset-swatch" style={{ background: p.bg }}>
                  <div className="theme-preset-mini-card" style={{ background: p.card, color: p.text }}>
                    <span className="theme-preset-dot" style={{ background: p.accent }} />
                    <span className="theme-preset-bar" style={{ background: p.text }} />
                    <span className="theme-preset-bar is-sub" style={{ background: p.text }} />
                  </div>
                </div>
                <div className="theme-preset-meta">
                  <div>
                    <div className="theme-preset-name">{p.name}</div>
                    <div className="theme-preset-desc">{p.desc}</div>
                  </div>
                  {selected && (
                    <span className="theme-preset-check">
                      <Check size={13} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 12 Color Combinations & Dual-Tone Palettes */}
        <div className="settings-section-title flex items-center gap-6">
          <Palette size={13} /> Color Palettes &amp; Combinations ({Object.keys(ACCENTS).length})
        </div>
        <div className="palette-combo-grid" style={{ marginBottom: 18 }}>
          {Object.entries(ACCENTS).map(([id, a]) => {
            const active = accent === id;
            return (
              <button
                key={id}
                type="button"
                className={`palette-combo-card${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => persistAndApply({ accent: id })}
              >
                <span
                  className="palette-combo-dots"
                  style={{
                    background: `linear-gradient(135deg, ${a.c} 0%, ${a.c2 || a.p} 100%)`,
                  }}
                />
                <span className="palette-combo-label">{a.label}</span>
              </button>
            );
          })}
        </div>

        {/* Note Paper Texture & Text Size */}
        <div className="list-group settings-group" style={{ margin: 0 }}>
          <div className="settings-label">Note Paper Style</div>
          <div className="view-switcher view-switcher-inline">
            {PAPER_STYLES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`view-switch-btn${paper === id ? ' active' : ''}`}
                onClick={() => persistAndApply({ paper: id })}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings-label mt-16">Note Text Size</div>
          <div className="view-switcher view-switcher-inline">
            {[
              ['small', 'Small'],
              ['medium', 'Medium'],
              ['large', 'Large'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`view-switch-btn${size === id ? ' active' : ''}`}
                onClick={() => persistAndApply({ size: id })}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings-label mt-16">Note Typeface / Font ({FONT_PRESETS.length})</div>
          <div className="font-picker-grid">
            {FONT_PRESETS.map(f => {
              const active = font === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`font-pick-card${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => persistAndApply({ font: f.id })}
                >
                  <span className="font-pick-aa" style={{ fontFamily: f.stack }}>
                    Aa
                  </span>
                  <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
                    <span className="font-pick-name" style={{ fontFamily: f.stack }}>
                      {f.name}
                    </span>
                    <span className="font-pick-cat">{f.category}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
