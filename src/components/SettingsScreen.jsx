/**
 * Appearance settings — theme (auto/light/dark), accent color, note font size.
 * Changes apply instantly via theme.js and persist in localStorage.
 */
import { useState, useEffect } from 'react';
import { THEME_KEY, ACCENT_KEY, SIZE_KEY, HINT_KEY, ACCENTS, getSettings, applySettings } from '../theme';
import { getAiMode, getProviderId, getDirectConfig, PROVIDERS, maskKey, MODE_KEY, PROVIDER_KEY, AIKEY_KEY, BASEURL_KEY, MODEL_KEY } from '../lib/aiConfig';

export default function SettingsScreen({ onBack }) {
  const initial = getSettings();
  const [theme, setTheme] = useState(initial.theme);
  const [accent, setAccent] = useState(initial.accent);
  const [size, setSize] = useState(initial.size);
  const [showHint, setShowHint] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) === 'true'; } catch { return false; }
  });
  const [toast, setToast] = useState(null);

  const set = (key, value, setter) => {
    setter(value);
    localStorage.setItem(key, value);
    applySettings();
  };

  const handleHintChange = v => {
    setShowHint(v);
    localStorage.setItem(HINT_KEY, v.toString());
  };

  const handleModeChange = mode => {
    set(MODE_KEY, mode, setMode);
    if (mode === 'direct') {
      const currentProvider = getProviderId();
      const preset = PROVIDERS[currentProvider] || PROVIDERS.groq;
      if (!localStorage.getItem(BASEURL_KEY)) localStorage.setItem(BASEURL_KEY, preset.baseUrl);
      if (!localStorage.getItem(MODEL_KEY)) localStorage.setItem(MODEL_KEY, preset.defaultModel);
      // Refresh local state to reflect stored defaults
      setBaseUrl(localStorage.getItem(BASEURL_KEY) || preset.baseUrl);
      setModel(localStorage.getItem(MODEL_KEY) || preset.defaultModel);
    }
  };

  const handleProviderChange = providerId => {
    const preset = PROVIDERS[providerId] || PROVIDERS.groq;
    set(PROVIDER_KEY, providerId, setProvider);
    localStorage.setItem(BASEURL_KEY, preset.baseUrl);
    localStorage.setItem(MODEL_KEY, preset.defaultModel);
    setBaseUrl(preset.baseUrl);
    setModel(preset.defaultModel);
    // Clear key when switching providers (different keys per provider)
    localStorage.removeItem(AIKEY_KEY);
    setKey('');
  };

  // IMPORTANT: update React state on every keystroke, otherwise the
  // controlled input wipes the value and "nothing shows when pasting".
  const handleKeyChange = e => {
    setKey(e.target.value);
    localStorage.setItem(AIKEY_KEY, e.target.value);
  };

  const handleBaseUrlChange = e => {
    setBaseUrl(e.target.value);
    localStorage.setItem(BASEURL_KEY, e.target.value);
  };

  const handleModelChange = e => {
    setModel(e.target.value);
    localStorage.setItem(MODEL_KEY, e.target.value);
  };

  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const testConnection = async () => {
    const bUrl = baseUrl.trim().replace(/\/$/, '');
    const k = key.trim();
    const m = model.trim();
    if (!k) { showToast('Enter an API key first'); return; }
    if (!bUrl || !m) { showToast('Base URL / model missing — check Advanced'); return; }
    showToast('Testing…');
    try {
      const res = await fetch(`${bUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) { showToast('✅ Connected!'); }
      else {
        const t = await res.text().catch(() => '');
        showToast(`❌ ${res.status}: ${t.slice(0, 80)}`);
      }
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  };

  const [mode, setMode] = useState(() => getAiMode());
  const [provider, setProvider] = useState(() => getProviderId());
  const directConfig = getDirectConfig();
  const [key, setKey] = useState(directConfig.key);
  const [baseUrl, setBaseUrl] = useState(directConfig.baseUrl);
  const [model, setModel] = useState(directConfig.model);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
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

        <div className="settings-label" style={{ marginTop: 18 }}>Reading</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showHint}
            onChange={e => handleHintChange(e.target.checked)}
          />
          <span style={{ fontSize: 15, color: 'var(--text)' }}>Show AI hint under lines</span>
        </label>
      </div>

      {/* AI Backend — own group, clean structure */}
      <div className="list-group" style={{ padding: '14px 16px' }}>
        <div className="settings-label">AI Backend</div>
        <Segmented
          options={[['termux', 'Termux'], ['direct', 'Direct API']]}
          value={mode}
          onChange={handleModeChange}
        />
        <div className="settings-tip" style={{ marginTop: 8 }}>
          {mode === 'termux'
            ? 'Uses the free local Termux server. Start it with the "notes" command.'
            : 'Calls your chosen AI provider straight from this device — no Termux needed.'}
        </div>

        {mode === 'direct' && (
          <>
            <div className="settings-label" style={{ marginTop: 16 }}>Provider</div>
            <div className="provider-grid">
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <button
                  key={id}
                  className={`provider-chip${provider === id ? ' active' : ''}`}
                  onClick={() => handleProviderChange(id)}
                >
                  <span className="provider-name">{p.name}</span>
                  <span className="provider-badge">{p.badge}</span>
                </button>
              ))}
            </div>

            <div className="settings-label" style={{ marginTop: 16 }}>API key</div>
            <div className="key-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="ai-input"
                value={key}
                onChange={handleKeyChange}
                placeholder="Paste your API key"
                autoComplete="off"
                spellCheck="false"
              />
              <button className="key-toggle" onClick={() => setShowKey(s => !s)} aria-label="Show or hide key">
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {PROVIDERS[provider]?.keyUrl && (
              <div className="settings-tip" style={{ marginTop: 6 }}>
                Free key: <a href={PROVIDERS[provider].keyUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{PROVIDERS[provider].keyUrl.replace('https://', '')}</a>
              </div>
            )}

            <button className="btn btn-primary" onClick={testConnection} style={{ width: '100%', marginTop: 14 }}>
              🔍 Test Connection
            </button>

            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 8, fontSize: 13 }}
              onClick={() => setShowAdvanced(s => !s)}
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced (base URL, model)'}
            </button>

            {showAdvanced && (
              <>
                <div className="settings-label" style={{ marginTop: 12 }}>Base URL</div>
                <input
                  type="url"
                  className="ai-input"
                  value={baseUrl}
                  onChange={handleBaseUrlChange}
                  placeholder="OpenAI-compatible endpoint"
                  spellCheck="false"
                />
                <div className="settings-label" style={{ marginTop: 12 }}>Model</div>
                <input
                  type="text"
                  className="ai-input"
                  value={model}
                  onChange={handleModelChange}
                  placeholder="Model ID"
                  spellCheck="false"
                />
                <div className="settings-tip" style={{ marginTop: 6 }}>
                  Default for {PROVIDERS[provider]?.name}: <strong>{PROVIDERS[provider]?.defaultModel || '—'}</strong>
                </div>
              </>
            )}
          </>
        )}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
