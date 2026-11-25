/**
 * SettingsScreen — Appearance, Reading & AI Style, AI Backend (Direct + Termux),
 * Provider model chips, Key reveal toggles, Backup/Restore JSON, and About.
 */
import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  Eye,
  EyeOff,
  Plug,
  Download,
  Upload,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
  ShieldCheck,
  Wrench,
  SpellCheck,
  RotateCw,
  Wifi,
  Share2,
  Bell,
  Signal,
  Palette,
  ChevronRight,
  Compass,
  Gauge,
} from 'lucide-react';
import {
  THEME_KEY,
  THEME_PRESET_KEY,
  ACCENT_KEY,
  SIZE_KEY,
  PAPER_KEY,
  PAPER_STYLES,
  FONT_KEY,
  FONT_PRESETS,
  SURFACE_KEY,
  SURFACE_STYLES,
  normalizeSurface,
  HINT_KEY,
  REDUCE_MOTION_KEY,
  HIDE_STATUS_BAR_KEY,
  REFRESH_RATE_KEY,
  ACCENTS,
  getSettings,
  applySettings,
} from '../theme';
import {
  getAiMode,
  getProviderId,
  getDirectConfig,
  getKeyForProvider,
  setKeyForProvider,
  getReasonModel,
  getTavilyKey,
  getExplainStyle,
  setExplainStyle,
  getAutoFallback,
  setAutoFallback,
  getFallbackProviders,
  isAiProviderLocked,
  setAiProviderLocked,
  isDevToolkitEnabled,
  setDevToolkitEnabled,
  isLearnCodingEnabled,
  setLearnCodingEnabled,
  isDeepTutorMemoryEnabled,
  setDeepTutorMemoryEnabled,
  getCodapiConfig,
  setCodapiConfig,
  getDeepTutorUrl,
  setDeepTutorUrl,
  getGrammarConfig,
  setGrammarConfig,
  getModelsForProvider,
  fetchLiveModelsForProvider,
  maskKey,
  EXPLAIN_STYLES,
  PROVIDERS,
  MODE_KEY,
  PROVIDER_KEY,
  BASEURL_KEY,
  MODEL_KEY,
  REASON_KEY,
  TAVILY_KEY,
} from '../lib/aiConfig';
import { createAbortController, testTermuxConnection } from '../lib/aiCore';
import { getRawApiBaseOverride, setApiBase } from '../config';
import { exportBackup, importBackup, ensureDecoyVaultSeeded } from '../store/db';
import {
  getSavedLanSyncUrl,
  importNoteBaiBundle,
  runLanWifiSync,
} from '../lib/baiDrop';
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  syncDeadlineNotifications,
} from '../lib/notifications';
import {
  getSlowNetworkSetting,
  setSlowNetworkSetting,
  isSlowNetworkActive,
} from '../lib/netResilience';
import { testDeepTutorBridge } from '../lib/learnerMemory';
import { hasVaultPin, lockVault, getDecoyConfig, enableDecoyVault } from '../lib/vault';
import PinLockSheet from './PinLockSheet';
import { useDialog } from './ui/DialogProvider';

function HoldToUnlockButton({ onUnlock, durationMs = 1400 }) {
  const [pct, setPct] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  const cancel = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startRef.current = null;
    setPct(0);
  };

  useEffect(() => () => cancel(), []);

  const begin = e => {
    e?.preventDefault?.();
    if (rafRef.current) return;
    startRef.current = performance.now();
    const tick = now => {
      const elapsed = now - startRef.current;
      const next = Math.min(100, (elapsed / durationMs) * 100);
      setPct(next);
      if (next >= 100) {
        cancel();
        try {
          navigator.vibrate?.(25);
        } catch {
          // ignore
        }
        onUnlock?.();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      className="hold-unlock-btn"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={e => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(e);
      }}
      onKeyUp={e => {
        if (e.key === ' ' || e.key === 'Enter') cancel();
      }}
      onContextMenu={e => e.preventDefault()}
      aria-label="Press and hold to unlock AI provider settings"
    >
      <span className="hold-unlock-fill" style={{ width: `${pct}%` }} />
      <span className="hold-unlock-content">
        <Unlock size={15} />
        <span>{pct > 0 ? 'Keep holding to unlock…' : 'Hold 1.5s to unlock & edit'}</span>
      </span>
    </button>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="view-switcher view-switcher-inline">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={`view-switch-btn${value === v ? ' active' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsScreen({
  onBack,
  onDataImported,
  onOpenThemes,
  onOpenSetupWizard = null,
  onOpenFeatureGuide = null,
}) {
  const { confirm, toast } = useDialog();
  const initial = getSettings();
  const [theme, setTheme] = useState(initial.theme);
  const [surface, setSurface] = useState(() => normalizeSurface(initial.surface));
  const [accent, setAccent] = useState(initial.accent);
  const [size, setSize] = useState(initial.size);
  const [paper, setPaper] = useState(initial.paper || 'blank');
  const [font, setFont] = useState(initial.font || 'system');
  const [explainStyle, setStyleState] = useState(() => getExplainStyle());
  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [reduceMotion, setReduceMotion] = useState(() => Boolean(initial.reduceMotion));
  const [hideStatusBar, setHideStatusBar] = useState(() => Boolean(initial.hideStatusBar));
  const [refreshRate, setRefreshRate] = useState(() => initial.refreshRate || 'max');
  const [displayInfo, setDisplayInfo] = useState(() => {
    try {
      const raw = window.BaiNativeDisplay?.getDisplayInfoJson?.();
      if (raw) return JSON.parse(raw);
    } catch {
      // non-native
    }
    return null;
  });
  const [measuredHz, setMeasuredHz] = useState(null);

  useEffect(() => {
    if (displayInfo) return undefined;
    if (typeof requestAnimationFrame !== 'function') return undefined;
    let frames = 0;
    let start = 0;
    let rafId = 0;
    const step = ts => {
      if (!start) start = ts;
      frames += 1;
      const elapsed = ts - start;
      if (elapsed >= 450 && frames >= 12) {
        const est = Math.round(((frames - 1) * 1000) / elapsed);
        setMeasuredHz(est >= 105 ? 120 : est >= 80 ? 90 : 60);
        return;
      }
      if (elapsed < 1200) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [displayInfo]);

  const [mode, setMode] = useState(() => getAiMode());
  const [provider, setProvider] = useState(() => getProviderId());
  const [key, setKey] = useState(() => getKeyForProvider(getProviderId()));
  const [baseUrl, setBaseUrl] = useState(() => getDirectConfig().baseUrl);
  const [model, setModel] = useState(() => getDirectConfig().model);
  const [reasonModel, setReasonModel] = useState(() => getReasonModel());
  const [tavilyKey, setTavilyKey] = useState(() => getTavilyKey());
  const [termuxUrl, setTermuxUrl] = useState(() => getRawApiBaseOverride());
  const [autoFallback, setAutoFallbackState] = useState(() => getAutoFallback());
  const [aiLocked, setAiLocked] = useState(() => isAiProviderLocked() && Boolean(getKeyForProvider(getProviderId()).trim()));
  const [devToolkitOn, setDevToolkitOn] = useState(() => isDevToolkitEnabled());
  const [learnCodingOn, setLearnCodingOn] = useState(() => isLearnCodingEnabled());
  const [deepMemoryOn, setDeepMemoryOn] = useState(() => isDeepTutorMemoryEnabled());
  const [codapiCfg, setCodapiCfg] = useState(() => getCodapiConfig());
  const [deepTutorUrl, setDeepTutorUrlState] = useState(() => getDeepTutorUrl());
  const [testingBridge, setTestingBridge] = useState(false);
  const [grammarCfg, setGrammarCfg] = useState(() => getGrammarConfig());
  const [pinModal, setPinModal] = useState(null); // null | 'setup' | 'change' | 'verify-ai-unlock'
  const [vaultPinExists, setVaultPinExists] = useState(() => hasVaultPin());
  const [decoyCfg, setDecoyCfg] = useState(() => getDecoyConfig());
  const [decoyPickDigit, setDecoyPickDigit] = useState(() => getDecoyConfig().triggerDigit || '7');
  const [availableModels, setAvailableModels] = useState(() => getModelsForProvider(getProviderId()));
  const [fetchingModels, setFetchingModels] = useState(false);

  const [showKey, setShowKey] = useState(false);
  const [showTavily, setShowTavily] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [baiCode, setBaiCode] = useState('');
  const [lanUrl, setLanUrl] = useState(() => getSavedLanSyncUrl() || 'http://192.168.1.5:3000');
  const [lanSyncing, setLanSyncing] = useState(false);
  const [notifCfg, setNotifCfg] = useState(() => getNotificationSettings());
  const [slowNetMode, setSlowNetMode] = useState(() => getSlowNetworkSetting());

  const importInputRef = useRef(null);
  const baiFileInputRef = useRef(null);

  const setPref = (lsKey, value, setter) => {
    setter(value);
    try {
      localStorage.setItem(lsKey, value);
      if (lsKey === THEME_KEY) {
        localStorage.setItem(THEME_PRESET_KEY, 'default');
      }
    } catch {
      // ignore
    }
    applySettings();
  };

  const handleStyleChange = val => {
    setStyleState(val);
    setExplainStyle(val);
    toast(`Explanation style: ${EXPLAIN_STYLES.find(([v]) => v === val)?.[1] || val}`);
  };

  const handleHintChange = v => {
    setShowHint(v);
    try {
      localStorage.setItem(HINT_KEY, v.toString());
    } catch {
      // ignore
    }
  };

  const handleModeChange = nextMode => {
    setPref(MODE_KEY, nextMode, setMode);
    if (nextMode === 'direct') {
      const pid = getProviderId();
      const preset = PROVIDERS[pid] || PROVIDERS.groq;
      if (!localStorage.getItem(BASEURL_KEY)) localStorage.setItem(BASEURL_KEY, preset.baseUrl);
      if (!localStorage.getItem(MODEL_KEY)) localStorage.setItem(MODEL_KEY, preset.defaultModel);
      setBaseUrl(localStorage.getItem(BASEURL_KEY) || preset.baseUrl);
      setModel(localStorage.getItem(MODEL_KEY) || preset.defaultModel);
      setReasonModel(getReasonModel());
    }
  };

  // FIXED: switching provider now resets baseUrl, model, AND reasonModel cleanly!
  const handleProviderChange = providerId => {
    const preset = PROVIDERS[providerId] || PROVIDERS.groq;
    setPref(PROVIDER_KEY, providerId, setProvider);
    try {
      localStorage.setItem(BASEURL_KEY, preset.baseUrl);
      localStorage.setItem(MODEL_KEY, preset.defaultModel);
      localStorage.setItem(REASON_KEY, preset.reasonModel || '');
    } catch {
      // ignore
    }
    setBaseUrl(preset.baseUrl);
    setModel(preset.defaultModel);
    setReasonModel(preset.reasonModel || preset.defaultModel || '');
    setKey(getKeyForProvider(providerId));
    setAvailableModels(getModelsForProvider(providerId));
  };

  const handleRefreshLiveModels = async () => {
    if (fetchingModels) return;
    setFetchingModels(true);
    try {
      const list = await fetchLiveModelsForProvider(provider, { baseUrl, key });
      setAvailableModels(list);
      if (list.length > 0 && !list.includes(model)) {
        handleModelChange(list[0]);
      }
      toast(`Loaded ${list.length} live models from ${PROVIDERS[provider]?.name || 'endpoint'}`, {
        type: 'success',
      });
    } catch (err) {
      toast(`Could not fetch live models: ${err.message}`, { type: 'error' });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleKeyChange = e => {
    const v = e.target.value;
    setKey(v);
    setKeyForProvider(provider, v);
  };

  const handleBaseUrlChange = e => {
    setBaseUrl(e.target.value);
    try {
      localStorage.setItem(BASEURL_KEY, e.target.value);
    } catch {
      // ignore
    }
  };

  const handleModelChange = val => {
    setModel(val);
    try {
      localStorage.setItem(MODEL_KEY, val);
    } catch {
      // ignore
    }
  };

  const handleReasonModelChange = val => {
    setReasonModel(val);
    try {
      localStorage.setItem(REASON_KEY, val);
    } catch {
      // ignore
    }
  };

  const handleTavilyChange = e => {
    setTavilyKey(e.target.value);
    try {
      localStorage.setItem(TAVILY_KEY, e.target.value);
    } catch {
      // ignore
    }
  };

  const handleTermuxUrlChange = e => {
    setTermuxUrl(e.target.value);
    setApiBase(e.target.value, { reload: false });
  };

  const testDirectConnection = async () => {
    const bUrl = baseUrl.trim().replace(/\/+$/, '');
    const k = key.trim();
    const m = model.trim();
    if (!k) return toast('Enter an API key first', { type: 'error' });
    if (!bUrl || !m) return toast('Base URL or model is missing', { type: 'error' });
    setTesting(true);
    const t0 = performance.now();
    const ctrl = createAbortController(15000);
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
        signal: ctrl.signal,
      });
      if (res.ok) {
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        setAiProviderLocked(true);
        setAiLocked(true);
        setShowKey(false);
        toast(`Connected in ${secs}s & locked! Hold to unlock anytime.`, {
          type: 'success',
          duration: 3800,
        });
      } else {
        const t = await res.text().catch(() => '');
        toast(`Error ${res.status}: ${t.slice(0, 90)}`, { type: 'error', duration: 4000 });
      }
    } catch (e) {
      toast(`Connection failed: ${e.message}`, { type: 'error', duration: 4000 });
    } finally {
      ctrl.cleanup();
      setTesting(false);
    }
  };

  const handleTestTermux = async () => {
    setTesting(true);
    try {
      const info = await testTermuxConnection();
      toast(
        info.configured
          ? `Connected! Model: ${info.model}`
          : 'Server reachable, but FREELLMAPI_API_KEY is not set in .env',
        { type: info.configured ? 'success' : 'info', duration: 3500 }
      );
    } catch (err) {
      toast(err.message, { type: 'error', duration: 3500 });
    } finally {
      setTesting(false);
    }
  };

  // Backup Export (JSON)
  const handleExportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-class-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${data.notes.length} notes & ${data.folders.length} folders`, {
        type: 'success',
      });
    } catch (err) {
      toast(`Backup failed: ${err.message}`, { type: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const replace = await confirm({
        title: 'Import backup',
        message: `Found ${parsed?.notes?.length || 0} notes in "${file.name}". Merge with your existing notes, or replace everything?`,
        confirmLabel: 'Merge safely',
        cancelLabel: 'Cancel',
      });
      if (!replace) return;
      const stats = await importBackup(parsed, { mode: 'merge' });
      toast(`Imported ${stats.notesAdded} notes`, { type: 'success' });
      onDataImported?.();
    } catch (err) {
      toast(`Import failed: ${err.message}`, { type: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const preset = PROVIDERS[provider] || PROVIDERS.groq;

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back to folders"
        >
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">Settings</span>
        <span style={{ width: 64 }} />
      </header>

      <div className="large-title">Settings</div>

      {/* Setup Wizard & Visual Feature Guide */}
      {(onOpenSetupWizard || onOpenFeatureGuide) && (
        <div className="list-group settings-group">
          <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
            <span className="bento-tile-icon" style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}>
              <Compass size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                Quick Setup &amp; Visual Feature Guide
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
                Easy API key setup, schedule PDF import, starter notes &amp; visual tour
              </div>
            </div>
          </div>
          <div className="flex gap-8 mt-8">
            {onOpenSetupWizard && (
              <button
                type="button"
                className="btn btn-primary btn-sm flex-1"
                onClick={onOpenSetupWizard}
              >
                Setup Wizard
              </button>
            )}
            {onOpenFeatureGuide && (
              <button
                type="button"
                className="btn btn-secondary btn-sm flex-1"
                onClick={onOpenFeatureGuide}
              >
                Feature Guide
              </button>
            )}
          </div>
        </div>
      )}

      {/* Appearance & Reading */}
      <div className="list-group settings-group">
        {onOpenThemes && (
          <button
            type="button"
            className="theme-studio-entry-btn"
            onClick={onOpenThemes}
          >
            <span className="bento-tile-icon" style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}>
              <Palette size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                Themes &amp; Palettes Studio
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
                12 full surface themes · 12 dual-tone palettes · Paper styles
              </div>
            </span>
            <ChevronRight size={17} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          </button>
        )}

        <div className="settings-label">Appearance</div>
        <Segmented
          options={[
            ['auto', 'Auto'],
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['oled', 'OLED'],
          ]}
          value={theme}
          onChange={v => setPref(THEME_KEY, v, setTheme)}
        />

        <div className="settings-label mt-16">Surface finish</div>
        <Segmented
          options={SURFACE_STYLES}
          value={surface}
          onChange={v => setPref(SURFACE_KEY, v, setSurface)}
        />
        <div className="settings-tip">
          Studio is default for fastest launch &amp; 60fps scrolling. Turn on Frosted Glass or Aurora Glass for iOS Liquid Glass.
        </div>

        <div className="settings-label mt-16">Note paper style</div>
        <Segmented
          options={PAPER_STYLES}
          value={paper}
          onChange={v => setPref(PAPER_KEY, v, setPaper)}
        />

        <div className="settings-label mt-16">Accent color</div>
        <div className="accent-row">
          {Object.entries(ACCENTS).map(([id, a]) => (
            <button
              key={id}
              type="button"
              className={`accent-swatch${accent === id ? ' active' : ''}`}
              style={{ background: a.c }}
              aria-label={a.label}
              aria-pressed={accent === id}
              onClick={() => setPref(ACCENT_KEY, id, setAccent)}
            />
          ))}
        </div>

        <div className="settings-label mt-16">Note text size</div>
        <Segmented
          options={[
            ['small', 'Small'],
            ['medium', 'Medium'],
            ['large', 'Large'],
          ]}
          value={size}
          onChange={v => setPref(SIZE_KEY, v, setSize)}
        />

        <div className="settings-label mt-16">Note font</div>
        <select
          className="input-field"
          value={font}
          aria-label="Note font"
          onChange={e => setPref(FONT_KEY, e.target.value, setFont)}
        >
          {FONT_PRESETS.map(f => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.category})
            </option>
          ))}
        </select>

        <div className="settings-label mt-16">AI Explanation Style</div>
        <Segmented
          options={EXPLAIN_STYLES}
          value={explainStyle}
          onChange={handleStyleChange}
        />

        <label className="ios-switch-row mt-12">
          <span className="ios-switch-label">Show AI hint preview under lines</span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={showHint}
              onChange={e => handleHintChange(e.target.checked)}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-12">
          <div style={{ flex: 1 }}>
            <span className="ios-switch-label">Reduce animations</span>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Disables launch splash, card stagger &amp; chat motion
            </div>
          </div>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={reduceMotion}
              onChange={e => setPref(REDUCE_MOTION_KEY, e.target.checked ? 'true' : 'false', v => setReduceMotion(v === 'true'))}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-12">
          <div style={{ flex: 1 }}>
            <span className="ios-switch-label">Hide status bar (Fullscreen)</span>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Hides Android clock &amp; notification icons; swipe down from top to peek
            </div>
          </div>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={hideStatusBar}
              onChange={e =>
                setPref(
                  HIDE_STATUS_BAR_KEY,
                  e.target.checked ? 'true' : 'false',
                  v => setHideStatusBar(v === 'true')
                )
              }
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <div className="settings-label mt-16 flex items-center justify-between gap-8">
          <span className="flex items-center gap-6">
            <Gauge size={14} /> Display Refresh Rate
          </span>
          <span className="mode-badge mode-study" style={{ fontSize: 10.5 }}>
            {displayInfo
              ? `${displayInfo.activeHz}Hz (max ${displayInfo.maxHz}Hz)`
              : measuredHz
                ? `~${measuredHz}Hz screen`
                : 'Auto'}
          </span>
        </div>
        <Segmented
          options={[
            ['max', 'Auto Max'],
            ['90', '90 Hz'],
            ['60', '60 Hz'],
          ]}
          value={refreshRate}
          onChange={v => {
            setPref(REFRESH_RATE_KEY, v, setRefreshRate);
            setTimeout(() => {
              try {
                const raw = window.BaiNativeDisplay?.getDisplayInfoJson?.();
                if (raw) setDisplayInfo(JSON.parse(raw));
              } catch {
                // ignore
              }
            }, 120);
            toast(
              v === 'max'
                ? 'High refresh rate: Auto Max (up to 120/144Hz)'
                : v === '90'
                  ? 'High refresh rate target: 90 Hz'
                  : 'Battery mode: 60 Hz'
            );
          }}
        />
        <div className="settings-tip">
          Uses native Display.Mode &amp; touch frame-rate boost on supported Android phones.
          {displayInfo && displayInfo.maxHz <= 60
            ? ' Note: Your system currently reports 60Hz max — enable High Refresh Rate for Notes by Bai in Android Display settings if supported.'
            : ''}
        </div>
      </div>

      {/* AI Backend */}
      <div className="list-group settings-group">
        <div className="settings-label">AI Backend</div>
        <Segmented
          options={[
            ['termux', 'Termux / Local'],
            ['direct', 'Direct API'],
          ]}
          value={mode}
          onChange={handleModeChange}
        />
        <div className="settings-tip">
          {mode === 'termux'
            ? 'Relays AI requests through your local Express/Termux backend.'
            : 'Calls your chosen AI provider straight from this device — no backend server needed.'}
        </div>

        {mode === 'termux' && (
          <>
            <div className="settings-label mt-16">Server URL override (optional)</div>
            <input
              type="url"
              className="ai-input"
              value={termuxUrl}
              onChange={handleTermuxUrlChange}
              placeholder="Default: same origin (web) or http://127.0.0.1:8080 (APK)"
              spellCheck="false"
            />
            <button
              type="button"
              className="btn btn-primary w-full mt-12"
              disabled={testing}
              onClick={handleTestTermux}
            >
              <Plug size={16} /> {testing ? 'Checking…' : 'Test Backend Connection'}
            </button>
          </>
        )}

        {mode === 'direct' && aiLocked && (
          <div className="ai-locked-card mt-12">
            <div className="ai-locked-head">
              <span className="ai-locked-badge">
                <ShieldCheck size={15} /> Connected &amp; Locked
              </span>
              <span className="provider-badge">{preset.name}</span>
            </div>
            <div className="ai-locked-meta">
              <div><strong>Model:</strong> {model || preset.defaultModel || '—'}</div>
              <div><strong>API Key:</strong> {maskKey(key) || 'Saved'}</div>
            </div>
            <div className="flex gap-8 mt-12">
              <button
                type="button"
                className="btn btn-secondary btn-sm flex-1"
                disabled={testing}
                onClick={testDirectConnection}
              >
                <Plug size={14} /> {testing ? 'Testing…' : 'Re-test'}
              </button>
            </div>
            <div className="mt-8">
              <HoldToUnlockButton
                onUnlock={() => {
                  if (hasVaultPin()) {
                    setPinModal('verify-ai-unlock');
                    return;
                  }
                  setAiProviderLocked(false);
                  setAiLocked(false);
                  toast('AI provider settings unlocked', { type: 'info' });
                }}
              />
            </div>
          </div>
        )}

        {mode === 'direct' && !aiLocked && (
          <>
            <div className="flex justify-between items-center mt-16">
              <div className="settings-label" style={{ marginBottom: 0 }}>Provider</div>
              {key.trim() && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAiProviderLocked(true);
                    setAiLocked(true);
                    setShowKey(false);
                    toast('AI provider settings locked', { type: 'success' });
                  }}
                >
                  <Lock size={13} /> Lock config
                </button>
              )}
            </div>
            <div className="provider-grid mt-8">
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  className={`provider-chip${provider === id ? ' active' : ''}`}
                  onClick={() => handleProviderChange(id)}
                >
                  <span className="provider-name">{p.name}</span>
                  <span className="provider-badge">{p.badge}</span>
                </button>
              ))}
            </div>

            <div className="settings-label mt-16">API key ({preset.name})</div>
            <div className="ai-input-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="ai-input"
                value={key}
                onChange={handleKeyChange}
                placeholder="Paste your API key"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShowKey(s => !s)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {preset.keyUrl && (
              <div className="settings-tip">
                Get a key:{' '}
                <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer">
                  {preset.keyUrl.replace('https://', '')}
                </a>
              </div>
            )}

            {/* Quick-pick Model Chips + Live /models Refresh */}
            <div className="flex justify-between items-center mt-16" style={{ marginBottom: 6 }}>
              <div className="settings-label" style={{ marginBottom: 0 }}>Model</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={fetchingModels}
                onClick={handleRefreshLiveModels}
                title="Fetch latest available models from provider /models endpoint"
              >
                <RotateCw size={13} className={fetchingModels ? 'spin' : ''} />{' '}
                {fetchingModels ? 'Refreshing…' : 'Refresh live models'}
              </button>
            </div>
            {availableModels.length > 0 && (
              <div className="model-chips">
                {availableModels.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`model-chip${model === m ? ' active' : ''}`}
                    onClick={() => handleModelChange(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary w-full mt-12"
              disabled={testing}
              onClick={testDirectConnection}
            >
              <Plug size={16} /> {testing ? 'Testing…' : 'Test Connection'}
            </button>

            <label className="ios-switch-row mt-12">
              <span className="ios-switch-label" style={{ fontSize: 14 }}>
                Auto-fallback on rate limits (429)
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {(() => {
                    const count = getFallbackProviders().length;
                    return count > 0
                      ? `${count} backup provider key${count === 1 ? '' : 's'} ready if ${preset.name} hits free-tier limits.`
                      : 'Save keys for 2+ free providers (e.g. NVIDIA, Kilo, Gemini, Groq) to auto-failover.';
                  })()}
                </div>
              </span>
              <span className="ios-switch">
                <input
                  type="checkbox"
                  checked={autoFallback}
                  onChange={e => {
                    setAutoFallbackState(e.target.checked);
                    setAutoFallback(e.target.checked);
                  }}
                />
                <span className="ios-switch-track" />
              </span>
            </label>

            <button
              type="button"
              className="btn btn-ghost btn-sm w-full mt-8"
              onClick={() => setShowAdvanced(s => !s)}
            >
              {showAdvanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {showAdvanced ? 'Hide advanced settings' : 'Advanced (Custom URL, Model, Deep Think)'}
            </button>

            {showAdvanced && (
              <>
                <div className="settings-label mt-12">Base URL</div>
                <input
                  type="url"
                  className="ai-input"
                  value={baseUrl}
                  onChange={handleBaseUrlChange}
                  placeholder="https://api.example.com/v1"
                  spellCheck="false"
                />

                <div className="settings-label mt-12">Custom Model ID</div>
                <input
                  type="text"
                  className="ai-input"
                  value={model}
                  onChange={e => handleModelChange(e.target.value)}
                  placeholder="Model ID"
                  spellCheck="false"
                />

                <div className="settings-label mt-12">Reasoning model (Deep Think)</div>
                <input
                  type="text"
                  className="ai-input"
                  value={reasonModel}
                  onChange={e => handleReasonModelChange(e.target.value)}
                  placeholder="e.g. deepseek/deepseek-r1:free"
                  spellCheck="false"
                />
                <div className="settings-tip">
                  Preset defaults: <strong>{preset.defaultModel || '—'}</strong> · Deep Think:{' '}
                  <strong>{preset.reasonModel || '—'}</strong>
                </div>
              </>
            )}
          </>
        )}

        {/* Tavily Web Search Key */}
        <div className="settings-label mt-16">Web search (optional)</div>
        <div className="ai-input-wrap">
          <input
            type={showTavily ? 'text' : 'password'}
            className="ai-input"
            value={tavilyKey}
            onChange={handleTavilyChange}
            placeholder="Paste Tavily API key"
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="button"
            className="input-reveal-btn"
            onClick={() => setShowTavily(s => !s)}
            aria-label={showTavily ? 'Hide Tavily key' : 'Show Tavily key'}
          >
            {showTavily ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="settings-tip">
          <strong>Research mode</strong> already searches Wikipedia & OpenAlex academic papers for free with no key. Add an optional Tavily key (1,000 free searches/mo) to layer on live general web results:{' '}
          <a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer">
            app.tavily.com
          </a>
        </div>
      </div>

      {/* Optional Add-ons & Private Vault */}
      <div className="list-group settings-group">
        <div className="settings-label flex items-center gap-6">
          <Wrench size={14} /> Optional Add-ons &amp; Privacy
        </div>

        <label className="ios-switch-row mt-8">
          <span className="ios-switch-label" style={{ fontSize: 14 }}>
            Show Learn Coding Studio (18 Languages)
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Fetches live open-source lessons &amp; Exercism challenges online with in-app multi-language code execution.
            </div>
          </span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={learnCodingOn}
              onChange={e => {
                const v = e.target.checked;
                setLearnCodingOn(v);
                setLearnCodingEnabled(v);
                onDataImported?.();
                toast(v ? 'Learn Coding Studio enabled' : 'Learn Coding Studio hidden');
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-8">
          <span className="ios-switch-label" style={{ fontSize: 14 }}>
            Show Dev &amp; IT Toolkit
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Separate offline space for Subnet Calc, Base Converter, JSON/JWT, Regex &amp; Tech Templates. Turn off anytime for a pure notes layout.
            </div>
          </span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={devToolkitOn}
              onChange={e => {
                const v = e.target.checked;
                setDevToolkitOn(v);
                setDevToolkitEnabled(v);
                onDataImported?.();
                toast(v ? 'Dev & IT Toolkit enabled' : 'Dev & IT Toolkit hidden');
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-8">
          <span className="ios-switch-label" style={{ fontSize: 14 }}>
            DeepTutor Persistent Learner Memory
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Remembers your weak spots &amp; strengths locally across Chat, Exams, Flashcards &amp; Learn Coding (never touches Hidden Vault or Passwords &amp; Keys).
            </div>
          </span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={deepMemoryOn}
              onChange={e => {
                const v = e.target.checked;
                setDeepMemoryOn(v);
                setDeepTutorMemoryEnabled(v);
                toast(v ? 'DeepTutor Memory enabled' : 'DeepTutor Memory paused');
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <div className="settings-label mt-16">Open-Source Bridges (Optional — Leave Blank Normally)</div>
        <div className="settings-tip">
          Built-in <strong>DeepTutor Learner Memory</strong> &amp; <strong>Codapi</strong> already work automatically with zero setup. Only fill these if you self-host your own Docker/Python server on PC or Termux.
        </div>
        <div className="settings-label mt-12">Codapi Sandbox URL (optional)</div>
        <input
          type="url"
          className="ai-input"
          value={codapiCfg.url}
          onChange={e => {
            const next = { ...codapiCfg, url: e.target.value };
            setCodapiCfg(next);
            setCodapiConfig(next);
          }}
          placeholder="https://api.codapi.org"
          spellCheck="false"
        />
        <div className="settings-label mt-12">Self-Hosted HKUDS/DeepTutor URL (optional)</div>
        <div className="flex gap-8">
          <input
            type="url"
            className="ai-input flex-1"
            value={deepTutorUrl}
            onChange={e => {
              setDeepTutorUrlState(e.target.value);
              setDeepTutorUrl(e.target.value);
            }}
            placeholder="Leave blank (built-in works offline) or http://127.0.0.1:8001"
            spellCheck="false"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={testingBridge || !deepTutorUrl.trim()}
            onClick={async () => {
              setTestingBridge(true);
              try {
                const r = await testDeepTutorBridge(deepTutorUrl);
                toast(`DeepTutor server reachable (${r.status})!`, { type: 'success' });
              } catch (err) {
                toast(err.message, { type: 'error' });
              } finally {
                setTestingBridge(false);
              }
            }}
          >
            <Plug size={14} /> {testingBridge ? '…' : 'Test'}
          </button>
        </div>

        <div className="settings-label mt-16">Hidden Vault PIN</div>
        <div className="settings-tip">
          {vaultPinExists
            ? 'Your PIN protects locked folders and hides them from All Notes, Search, and Daily Review.'
            : 'Set a 4–6 digit PIN to lock personal journal or rant folders privately on this device.'}
        </div>
        <div className="flex gap-8 mt-8">
          <button
            type="button"
            className="btn btn-secondary btn-sm flex-1"
            onClick={() => setPinModal(vaultPinExists ? 'change' : 'setup')}
          >
            <Lock size={14} /> {vaultPinExists ? 'Change Vault PIN' : 'Set Up Vault PIN'}
          </button>
          {vaultPinExists && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                lockVault();
                toast('Private vault locked');
              }}
            >
              Lock now
            </button>
          )}
        </div>

        {/* One-time Stealth Decoy Vault setup — vanishes completely once enabled; disable only inside Real Vault */}
        {!decoyCfg.enabled && (
          <div className="class-reminder-subbox" style={{ marginTop: 12 }}>
            <div className="settings-label" style={{ margin: '0 0 4px' }}>
              Stealth Decoy Vault (One-Time Setup)
            </div>
            <div className="settings-help" style={{ margin: '0 0 8px' }}>
              Pick a secret keypad digit to long-press (~0.5s). After holding it, <strong>any</strong> 4–6 digits open a harmless dummy vault. Once enabled, this option disappears from Settings and can only be turned off inside your real Hidden Vault.
            </div>
            <div className="flex items-center gap-6" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button
                  key={d}
                  type="button"
                  className={`row-action-chip${decoyPickDigit === d ? ' active-chip' : ''}`}
                  onClick={() => setDecoyPickDigit(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm w-full"
              onClick={async () => {
                enableDecoyVault(decoyPickDigit);
                await ensureDecoyVaultSeeded().catch(() => {});
                setDecoyCfg(getDecoyConfig());
                toast(
                  `Stealth Decoy Vault armed on digit "${decoyPickDigit}"! Only manageable inside your real Hidden Vault now.`,
                  { type: 'success', duration: 4500 }
                );
              }}
            >
              Activate Stealth Decoy Vault
            </button>
          </div>
        )}
      </div>

      {/* Pluggable Writing & Grammar Engine (Optional Keys) */}
      <div className="list-group settings-group">
        <div className="settings-label flex items-center gap-6">
          <SpellCheck size={14} /> Writing &amp; Grammar (Optional)
        </div>
        <Segmented
          options={[
            ['languagetool-free', 'Free (LT)'],
            ['grammarly', 'Grammarly'],
            ['languagetool-plus', 'LT Key'],
            ['sapling', 'Sapling'],
          ]}
          value={grammarCfg.provider}
          onChange={p => setGrammarCfg(setGrammarConfig({ provider: p }))}
        />

        {grammarCfg.provider === 'languagetool-free' && (
          <div className="settings-tip">
            Uses <strong>LanguageTool Free</strong> (0 API key needed) for per-word spelling &amp; grammar checks, plus 1-tap <strong>AI Polish</strong> in Edit mode.
          </div>
        )}

        {grammarCfg.provider === 'grammarly' && (
          <>
            <div className="settings-tip">
              Optional connector for school/organization <strong>Grammarly EDU / Enterprise Writing Score API</strong> (OAuth Client ID + Secret or Bearer token). Paired with free LanguageTool for inline fixes.
            </div>
            <div className="settings-label mt-12">Grammarly Client ID (optional)</div>
            <input
              type="text"
              className="ai-input"
              value={grammarCfg.grammarlyClientId}
              onChange={e => setGrammarCfg(setGrammarConfig({ grammarlyClientId: e.target.value }))}
              placeholder="OAuth Client ID from school admin"
              spellCheck="false"
            />
            <div className="settings-label mt-12">Grammarly Client Secret (optional)</div>
            <input
              type="password"
              className="ai-input"
              value={grammarCfg.grammarlyClientSecret}
              onChange={e => setGrammarCfg(setGrammarConfig({ grammarlyClientSecret: e.target.value }))}
              placeholder="OAuth Client Secret"
              spellCheck="false"
            />
            <div className="settings-label mt-12">Or direct Access / Bearer Token (optional)</div>
            <input
              type="password"
              className="ai-input"
              value={grammarCfg.grammarlyToken}
              onChange={e => setGrammarCfg(setGrammarConfig({ grammarlyToken: e.target.value }))}
              placeholder="Paste access token if already issued"
              spellCheck="false"
            />
          </>
        )}

        {grammarCfg.provider === 'languagetool-plus' && (
          <>
            <div className="settings-label mt-12">LanguageTool Endpoint URL</div>
            <input
              type="url"
              className="ai-input"
              value={grammarCfg.ltUrl}
              onChange={e => setGrammarCfg(setGrammarConfig({ ltUrl: e.target.value }))}
              placeholder="https://api.languagetoolplus.com/v2/check"
              spellCheck="false"
            />
            <div className="settings-label mt-12">Username / Email</div>
            <input
              type="text"
              className="ai-input"
              value={grammarCfg.ltUsername}
              onChange={e => setGrammarCfg(setGrammarConfig({ ltUsername: e.target.value }))}
              placeholder="Account email"
              spellCheck="false"
            />
            <div className="settings-label mt-12">API Key</div>
            <input
              type="password"
              className="ai-input"
              value={grammarCfg.ltApiKey}
              onChange={e => setGrammarCfg(setGrammarConfig({ ltApiKey: e.target.value }))}
              placeholder="LanguageTool API key"
              spellCheck="false"
            />
          </>
        )}

        {grammarCfg.provider === 'sapling' && (
          <>
            <div className="settings-label mt-12">Sapling API Key</div>
            <input
              type="password"
              className="ai-input"
              value={grammarCfg.saplingKey}
              onChange={e => setGrammarCfg(setGrammarConfig({ saplingKey: e.target.value }))}
              placeholder="Paste Sapling API key (sapling.ai)"
              spellCheck="false"
            />
          </>
        )}
      </div>

      {/* Persistent Notifications & Slow Internet Resilience */}
      <div className="list-group settings-group">
        <div className="settings-label flex items-center gap-6">
          <Bell size={14} /> Due-Date &amp; Announcement Reminders
        </div>
        <div className="settings-tip">
          Schedules native offline reminders (24h before, 3h before, 7 AM on exam day) plus instant alerts for new
          Canvas announcements.
        </div>

        <label className="ios-switch-row mt-10">
          <span className="ios-switch-label">Enable deadline &amp; announcement alerts</span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={notifCfg.enabled}
              onChange={async e => {
                const next = e.target.checked;
                if (next) {
                  await requestNotificationPermission();
                }
                saveNotificationSettings({ enabled: next });
                setNotifCfg(prev => ({ ...prev, enabled: next }));
                const res = await syncDeadlineNotifications();
                toast(
                  next
                    ? `Reminders enabled (${res.scheduledCount} upcoming scheduled)`
                    : 'Reminders paused',
                  { type: 'info' }
                );
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-8">
          <span className="ios-switch-label">Persistent sticky reminder for Due Today / Overdue</span>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={notifCfg.stickyOngoing}
              onChange={async e => {
                const next = e.target.checked;
                saveNotificationSettings({ stickyOngoing: next });
                setNotifCfg(prev => ({ ...prev, stickyOngoing: next }));
                await syncDeadlineNotifications();
                toast(next ? 'Sticky reminders enabled' : 'Sticky reminders disabled');
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        <label className="ios-switch-row mt-8">
          <div style={{ flex: 1 }}>
            <span className="ios-switch-label">
              Before-class reminders ({notifCfg.classReminderLeadMin || 10}m)
            </span>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Weekly background alarms fire even when the app is closed (room/lab, teacher &amp; unread posts)
            </div>
          </div>
          <span className="ios-switch">
            <input
              type="checkbox"
              checked={Boolean(notifCfg.classRemindersEnabled || notifCfg.classReminders15m)}
              onChange={async e => {
                const next = e.target.checked;
                if (next) {
                  await requestNotificationPermission();
                }
                saveNotificationSettings({ classReminders15m: next, classRemindersEnabled: next });
                setNotifCfg(prev => ({ ...prev, classReminders15m: next, classRemindersEnabled: next }));
                const res = await syncDeadlineNotifications();
                toast(
                  next
                    ? `Class reminders enabled (${notifCfg.classReminderLeadMin || 10}m before · ${res.scheduledCount} total)`
                    : 'Before-class reminders disabled'
                );
              }}
            />
            <span className="ios-switch-track" />
          </span>
        </label>

        {(notifCfg.classRemindersEnabled || notifCfg.classReminders15m) && (
          <div className="class-reminder-subbox">
            <div className="settings-help" style={{ margin: '0 0 6px', fontWeight: 600 }}>
              Remind me before class (minutes):
            </div>
            <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
              {[5, 10, 15, 20, 30].map(mins => (
                <button
                  key={mins}
                  type="button"
                  className={`row-action-chip${Number(notifCfg.classReminderLeadMin) === mins ? ' active-chip' : ''}`}
                  onClick={async () => {
                    saveNotificationSettings({ classReminderLeadMin: mins });
                    setNotifCfg(prev => ({ ...prev, classReminderLeadMin: mins }));
                    await syncDeadlineNotifications();
                    toast(`Class reminder set to ${mins} min before class`);
                  }}
                >
                  {mins}m
                </button>
              ))}
              <input
                type="number"
                min="1"
                max="60"
                className="input-field"
                style={{ width: 64, padding: '4px 7px', fontSize: 12, textAlign: 'center' }}
                aria-label="Custom reminder lead minutes"
                value={notifCfg.classReminderLeadMin || 10}
                onChange={async e => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw) || raw < 1) return;
                  const val = Math.max(1, Math.min(60, Math.round(raw)));
                  saveNotificationSettings({ classReminderLeadMin: val });
                  setNotifCfg(prev => ({ ...prev, classReminderLeadMin: val }));
                  await syncDeadlineNotifications();
                }}
              />
            </div>

            <label className="ios-switch-row mt-10">
              <div style={{ flex: 1 }}>
                <span className="ios-switch-label" style={{ fontSize: 13 }}>
                  Persistent pinned class alert
                </span>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 1 }}>
                  Stays pinned in notification shade until dismissed or class starts
                </div>
              </div>
              <span className="ios-switch">
                <input
                  type="checkbox"
                  checked={notifCfg.classReminderPersistent !== false}
                  onChange={async e => {
                    const next = e.target.checked;
                    saveNotificationSettings({ classReminderPersistent: next });
                    setNotifCfg(prev => ({ ...prev, classReminderPersistent: next }));
                    await syncDeadlineNotifications();
                    toast(next ? 'Persistent class alert enabled' : 'Standard dismissible class alert');
                  }}
                />
                <span className="ios-switch-track" />
              </span>
            </label>
          </div>
        )}

        <div className="settings-label mt-16 flex items-center gap-6">
          <Signal size={14} /> Slow Internet Mode ({isSlowNetworkActive() ? 'Active' : 'Normal'})
        </div>
        <div className="settings-tip">
          Widens AI &amp; Canvas timeouts (45s–60s), retries dropped connections automatically, and trims RAG chunks
          so AI stays fast on weak campus Wi-Fi or 3G mobile data.
        </div>
        <Segmented
          options={[
            ['auto', 'Auto'],
            ['on', 'Always On'],
            ['off', 'Off'],
          ]}
          value={slowNetMode}
          onChange={v => {
            setSlowNetMode(setSlowNetworkSetting(v));
            toast(`Slow Internet Mode: ${v === 'on' ? 'Always On' : v === 'off' ? 'Off' : 'Auto-detect'}`);
          }}
        />
      </div>

      {/* BaiDrop Offline Import & Local Wi-Fi PC <-> Phone Sync */}
      <div className="list-group settings-group">
        <div className="settings-label flex items-center gap-6">
          <Share2 size={14} /> BaiDrop Import &amp; Local Wi-Fi Sync
        </div>
        <div className="settings-tip">
          Import a classmate&apos;s portable <code>.bai.json</code> note or paste a <code>BAIDROP1:</code> share code
          completely offline — or sync unlocked notes over your home/campus Wi-Fi with zero cloud accounts.
        </div>

        <div className="flex gap-8 mt-10">
          <input
            className="ai-input"
            style={{ marginTop: 0, flex: 1 }}
            placeholder="Paste BAIDROP1:... share code"
            value={baiCode}
            onChange={e => setBaiCode(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!baiCode.trim()}
            onClick={async () => {
              try {
                const res = await importNoteBaiBundle(baiCode);
                setBaiCode('');
                toast(`Imported "${res.note.title}" into ${res.folder.name}!`, { type: 'success' });
                onDataImported?.();
              } catch (err) {
                toast(`BaiDrop import failed: ${err.message}`, { type: 'error' });
              }
            }}
          >
            Import Code
          </button>
        </div>

        <div className="flex gap-8 mt-8">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => baiFileInputRef.current?.click()}
          >
            <Upload size={14} /> Import .bai.json File
          </button>
          <input
            ref={baiFileInputRef}
            type="file"
            accept=".bai.json,.json,application/json"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const txt = await file.text();
                const res = await importNoteBaiBundle(txt);
                toast(`Imported "${res.note.title}" into ${res.folder.name}!`, { type: 'success' });
                onDataImported?.();
              } catch (err) {
                toast(`BaiDrop file failed: ${err.message}`, { type: 'error' });
              }
            }}
          />
        </div>

        <div className="settings-label mt-16 flex items-center gap-6">
          <Wifi size={14} /> 1-Tap Local Wi-Fi Sync (PC ↔ Phone)
        </div>
        <div className="settings-tip">
          Run <code>node server.js</code> on your PC on the same Wi-Fi, enter its LAN address below, and tap Sync.
          Hidden Vault &amp; <strong>Passwords &amp; Keys</strong> are strictly excluded and never leave your device.
        </div>
        <div className="flex gap-8 mt-8">
          <input
            className="ai-input"
            style={{ marginTop: 0, flex: 1 }}
            placeholder="http://192.168.1.5:3000"
            value={lanUrl}
            onChange={e => setLanUrl(e.target.value)}
            spellCheck="false"
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={lanSyncing}
            onClick={async () => {
              setLanSyncing(true);
              try {
                const res = await runLanWifiSync(lanUrl);
                toast(
                  `Wi-Fi synced! Pushed ${res.pushedNotes} notes, merged ${res.mergedNotes} notes & ${res.mergedPlanner} planner items.`,
                  { type: 'success', duration: 4000 }
                );
                onDataImported?.();
              } catch (err) {
                toast(`Wi-Fi Sync failed: ${err.message}`, { type: 'error', duration: 4000 });
              } finally {
                setLanSyncing(false);
              }
            }}
          >
            <Wifi size={14} /> {lanSyncing ? 'Syncing…' : 'Sync Wi-Fi'}
          </button>
        </div>
      </div>

      {/* Data Backup & Restore */}
      <div className="list-group settings-group">
        <div className="settings-label">Backup & Restore</div>
        <div className="settings-tip">
          All notes live offline on this device. Export a JSON backup regularly so you can restore or move to another device anytime.
        </div>
        <div className="flex gap-8 mt-12">
          <button
            type="button"
            className="btn btn-secondary flex-1"
            disabled={backupBusy}
            onClick={handleExportBackup}
          >
            <Download size={16} /> Export JSON
          </button>
          <button
            type="button"
            className="btn btn-secondary flex-1"
            disabled={backupBusy}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={16} /> Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      </div>

      {/* Tips & Version */}
      <div className="list-group settings-group">
        <div className="settings-label">Quick Tips</div>
        <div className="settings-tip">
          • Use <strong># Heading</strong>, <strong>**bold**</strong>, <strong>- [ ] task</strong>, and <strong>$E = mc^2$</strong> math.<br />
          • Tap any line in Read mode to inspect or fetch its AI explanation on demand.<br />
          • Tap an attached photo to zoom, run OCR, or ask AI to explain diagrams.<br />
          • Press <strong>Ctrl+S</strong> to save immediately or <strong>Ctrl+Shift+S</strong> to save & explain.
        </div>
        <div className="settings-tip" style={{ marginTop: 10, opacity: 0.7 }}>
          Notes by Bai v2.3.0
        </div>
      </div>

      {pinModal && (
        <PinLockSheet
          mode={pinModal === 'verify-ai-unlock' ? 'verify' : pinModal}
          title={
            pinModal === 'verify-ai-unlock'
              ? 'Confirm PIN to Unlock AI Settings'
              : undefined
          }
          onSuccess={() => {
            const action = pinModal;
            setPinModal(null);
            setVaultPinExists(hasVaultPin());
            if (action === 'verify-ai-unlock') {
              setAiProviderLocked(false);
              setAiLocked(false);
              toast('AI provider settings unlocked', { type: 'info' });
            } else {
              toast('Hidden Vault PIN saved!', { type: 'success' });
            }
          }}
          onClose={() => setPinModal(null)}
        />
      )}
    </div>
  );
}
