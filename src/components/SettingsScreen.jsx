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
    // When switching to direct, we might need to initialize provider config
    if (mode === 'direct') {
      // Initialize default provider if not set
      const currentProvider = getProviderId();
      const preset = PROVIDERS[currentProvider] || PROVIDERS.groq;
      localStorage.setItem(PROVIDER_KEY, 'groq');
      // Initialize default baseUrl/model if not present
      if (!localStorage.getItem('aicn:aiBaseUrl')) {
        localStorage.setItem('aicn:aiBaseUrl', preset.baseUrl);
      }
      if (!localStorage.getItem('aicn:aiModel')) {
        localStorage.setItem('aicn:aiModel', preset.defaultModel);
      }
    }
  };

  const handleProviderChange = providerId => {
    const preset = PROVIDERS[providerId] || PROVIDERS.groq;
    set(PROVIDER_KEY, providerId, setProvider);
    localStorage.setItem('aicn:aiBaseUrl', preset.baseUrl);
    localStorage.setItem('aicn:aiModel', preset.defaultModel);
    // Clear key when switching providers (different keys for different providers)
    localStorage.removeItem('aicn:aiKey');
  };

  const handleKeyChange = (e) => {
    const key = e.target.value.trim();
    localStorage.setItem('aicn:aiKey', key);
  };

  const handleBaseUrlChange = (e) => {
    localStorage.setItem('aicn:aiBaseUrl', e.target.value.trim());
  };

  const handleModelChange = (e) => {
    localStorage.setItem('aicn:aiModel', e.target.value.trim());
  };

  const testConnection = async () => {
    const { baseUrl, key, model, preset } = await import('../lib/aiConfig').then(m => m.getDirectConfig());
    if (!key) { showToast('Enter an API key first'); return; }
    showToast('Testing…');
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "OK" in 3 words.' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) { showToast('✅ Connected!'); }
      else { const t = await res.text(); showToast(`❌ ${res.status}: ${t.slice(0, 80)}`); }
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

        </div>

        <div className="settings-label" style={{ marginTop: 18 }}>Reading</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showHint}
            onChange={e => handleHintChange(e.target.checked)}
          />
          <span style={{ fontSize: 15, color: 'var(--text)' }}>Show AI hint under lines</span>
        </label>

        <div className="settings-label" style={{ marginTop: 18 }}>AI Backend</div>
        <div className="list-group" style={{ margin: 0, padding: 0 }}>
          {/* Mode selector */}
          <div className="list-item" style={{ padding: 14, borderBottom: '1px solid var(--divider)' }}>
            <div className="settings-label" style={{ marginBottom: 12 }}>Mode</div>
            <Segmented
              options={[['termux', 'Termux server (local, free)'], ['direct', 'Direct API (cloud, no server needed)']]}
              value={mode}
              onChange={handleModeChange}
            />
          </div>

          {/* Direct mode configuration */}
          {mode === 'direct' && (
            <>
              <div className="list-item" style={{ padding: 14, borderBottom: '1px solid var(--divider)' }}>
                <div className="settings-label" style={{ marginBottom: 12 }}>Provider</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(PROVIDERS).map(([id, p]) => (
                    <button
                      key={id}
                      className={`attach-btn${provider === id ? ' active' : ''}`}
                      style={{ flex: '1 1 calc(50% - 4px)', minWidth: 140 }}
                      onClick={() => handleProviderChange(id)}
                    >
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.badge}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="list-item" style={{ padding: 14, borderBottom: '1px solid var(--divider)' }}>
                <div className="settings-label" style={{ marginBottom: 8 }}>API Key</div>
                <input
                  type="password"
                  value={key}
                  onChange={handleKeyChange}
                  placeholder="Paste your API key here"
                  style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--divider)', background: 'var(--bg)', fontSize: 15, fontFamily: 'monospace' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  Get a free key at: <a href={PROVIDERS[provider]?.keyUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{PROVIDERS[provider]?.keyUrl || 'provider console'}</a>
                </div>
              </div>

              <div className="list-item" style={{ padding: 14, borderBottom: '1px solid var(--divider)' }}>
                <div className="settings-label" style={{ marginBottom: 8 }}>Base URL</div>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={handleBaseUrlChange}
                  placeholder="OpenAI-compatible endpoint (e.g., https://api.groq.com/openai/v1)"
                  style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--divider)', background: 'var(--bg)', fontSize: 15, fontFamily: 'monospace' }}
                />
              </div>

              <div className="list-item" style={{ padding: 14, borderBottom: '1px solid var(--divider)' }}>
                <div className="settings-label" style={{ marginBottom: 8 }}>Model</div>
                <input
                  type="text"
                  value={model}
                  onChange={handleModelChange}
                  placeholder="Model ID (e.g., llama-3.3-70b-versatile)"
                  style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--divider)', background: 'var(--bg)', fontSize: 15, fontFamily: 'monospace' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  Default for {PROVIDERS[provider]?.name}: <strong>{PROVIDERS[provider]?.defaultModel}</strong>
                </div>
              </div>

              <div className="list-item" style={{ padding: 14 }}>
                <button className="btn btn-primary" onClick={testConnection} style={{ width: '100%' }}>
                  🔍 Test Connection
                </button>
              </div>
            </>
          )}
        </div>

        <div className="settings-label" style={{ marginTop: 18 }}>Reading</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showHint}
            onChange={e => handleHintChange(e.target.checked)}
          />
          <span style={{ fontSize: 15, color: 'var(--text)' }}>Show AI hint under lines</span>
        </label>
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
