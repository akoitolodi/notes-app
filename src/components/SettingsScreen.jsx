/**
 * Appearance settings — theme (auto/light/dark), accent color, note font size.
 * Changes apply instantly via theme.js and persist in localStorage.
 */
import { useState } from 'react';
import { THEME_KEY, ACCENT_KEY, SIZE_KEY, ACCENTS, getSettings, applySettings } from '../theme';

export default function SettingsScreen({ onBack }) {
  const initial = getSettings();
  const [theme, setTheme] = useState(initial.theme);
  const [accent, setAccent] = useState(initial.accent);
  const [size, setSize] = useState(initial.size);

  const set = (key, value, setter) => {
    setter(value);
    localStorage.setItem(key, value);
    applySettings();
  };

  const Segmented = ({ options, value, onChange }) => (
    <div className="view-switcher" style={{ margin: '8px 0 0' }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          className={`view-switch-btn${value === v ? ' active' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="screen">
      <header className="navbar safe-top">
        <button className="navbar-btn" style={{ width: 'auto', paddingLeft: 0 }} onClick={onBack} aria-label="Back to folders">
          ‹ Folders
        </button>
        <span className="navbar-title" style={{ fontSize: 15 }}>Settings</span>
        <span style={{ width: 44 }} />
      </header>
      <div className="large-title">Settings</div>

      <div className="list-group" style={{ padding: '14px 16px' }}>
        <div className="settings-label">Appearance</div>
        <Segmented
          options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]}
          value={theme}
          onChange={v => set(THEME_KEY, v, setTheme)}
        />

        <div className="settings-label" style={{ marginTop: 18 }}>Accent color</div>
        <div className="accent-row">
          {Object.entries(ACCENTS).map(([key, a]) => (
            <button
              key={key}
              className={`accent-swatch${accent === key ? ' active' : ''}`}
              style={{ background: a.c }}
              aria-label={a.label}
              aria-pressed={accent === key}
              onClick={() => set(ACCENT_KEY, key, setAccent)}
            />
          ))}
        </div>

        <div className="settings-label" style={{ marginTop: 18 }}>Note text size</div>
        <Segmented
          options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]}
          value={size}
          onChange={v => set(SIZE_KEY, v, setSize)}
        />
      </div>

      <div className="list-group" style={{ padding: '14px 16px' }}>
        <div className="settings-label">Tips</div>
        <div className="settings-tip">
          • Type <strong>- [ ] task</strong> for a checklist you can tick in read mode.<br />
          • Add <strong>#tags</strong> anywhere — tap one in a note list to filter.<br />
          • Long-press a note or folder for more actions.<br />
          • Use the share icon in a note to export a PDF.
        </div>
      </div>
    </div>
  );
}
