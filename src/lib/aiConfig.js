/**
 * AI backend configuration — mode, provider presets, API keys, explanation style.
 */
export const MODE_KEY = 'aicn:aiMode';          // 'termux' | 'direct'
export const PROVIDER_KEY = 'aicn:aiProvider';  // preset id
export const AIKEY_KEY = 'aicn:aiKey';          // legacy single key (migrated to map)
export const KEYS_KEY = 'aicn:aiKeys';          // JSON map { providerId: key }
export const BASEURL_KEY = 'aicn:aiBaseUrl';    // base URL override
export const MODEL_KEY = 'aicn:aiModel';        // model override
export const REASON_KEY = 'aicn:aiReasonModel'; // reasoning model for Deep Think
export const TAVILY_KEY = 'aicn:tavilyKey';     // Tavily API key for web search
export const STYLE_KEY = 'aicn:explainStyle';   // 'default' | 'simple' | 'exam-prep' | 'detailed'
export const FALLBACK_KEY = 'aicn:autoFallback'; // boolean string ('true' default)
export const AI_LOCK_KEY = 'aicn:aiProviderLocked'; // passwordless Hold-to-Unlock safety lock
export const DEV_TOOLKIT_KEY = 'aicn:addonDevToolkit'; // optional Dev & IT Toolkit add-on ('true' default)
export const GRAMMAR_CONFIG_KEY = 'aicn:grammarConfig'; // JSON { provider, ltUrl, ltUsername, ltApiKey, grammarlyClientId, grammarlyClientSecret, grammarlyToken, saplingKey }

export const EXPLAIN_STYLES = [
  ['simple', 'Simple'],
  ['default', 'Balanced'],
  ['exam-prep', 'Exam Prep'],
  ['detailed', 'Detailed'],
];

/**
 * Provider presets. baseUrl must be an OpenAI-compatible chat/completions root.
 */
export const PROVIDERS = {
  groq: {
    name: 'Groq',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    reasonModel: 'qwen/qwen3-32b',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ],
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    name: 'Google Gemini',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    reasonModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    name: 'OpenRouter',
    badge: 'Free models',
    free: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    reasonModel: 'deepseek/deepseek-r1:free',
    models: [
      'openrouter/free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'inclusionai/ling-3.2-flash:free',
      'baidu/ernie-5.5-flash-preview:free',
      'deepseek/deepseek-r1:free',
    ],
    keyUrl: 'https://openrouter.ai/keys',
  },
  openai: {
    name: 'OpenAI',
    badge: 'Paid',
    free: false,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    reasonModel: 'o4-mini',
    models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  cerebras: {
    name: 'Cerebras',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    reasonModel: 'qwen-3-32b',
    models: ['llama-3.3-70b', 'qwen-3-32b', 'llama3.1-8b'],
    keyUrl: 'https://cloud.cerebras.ai',
  },
  mistral: {
    name: 'Mistral',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    reasonModel: 'magistral-medium-latest',
    models: ['mistral-small-latest', 'mistral-large-latest', 'magistral-medium-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  nvidia: {
    name: 'NVIDIA',
    badge: 'Free credits',
    free: true,
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    reasonModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    models: [
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3.5-bolt-e4b',
      'google/gemma-4-31b-it',
      'moonshotai/kimi-k3.1-pro',
      'mistralai/mistral-large-4-1t-a52b',
      'minimaxai/minimax-m3.1-flash',
    ],
    keyUrl: 'https://build.nvidia.com',
  },
  kilo: {
    name: 'Kilo',
    badge: 'Free models',
    free: true,
    baseUrl: 'https://api.kilo.ai/api/gateway',
    defaultModel: 'nvidia/nemotron-3.5-super-vl:free',
    reasonModel: 'deepseek/deepseek-r1:free',
    models: [
      'nvidia/nemotron-3.5-super-vl:free',
      'inclusionai/ling-3.2-flash:free',
      'baidu/ernie-5.5-flash-preview:free',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.4',
      'google/gemini-3-pro-preview',
    ],
    keyUrl: 'https://kilo.ai',
  },
  custom: {
    name: 'Custom',
    badge: 'Your endpoint',
    free: false,
    baseUrl: '',
    defaultModel: '',
    reasonModel: '',
    models: [],
    keyUrl: '',
  },
};

export function getAiMode() {
  try {
    return localStorage.getItem(MODE_KEY) || 'termux';
  } catch {
    return 'termux';
  }
}

export function getProviderId() {
  try {
    return localStorage.getItem(PROVIDER_KEY) || 'groq';
  } catch {
    return 'groq';
  }
}

export function getExplainStyle() {
  try {
    return localStorage.getItem(STYLE_KEY) || 'default';
  } catch {
    return 'default';
  }
}

export function setExplainStyle(style) {
  try {
    localStorage.setItem(STYLE_KEY, style || 'default');
  } catch {
    // non-fatal
  }
}

function getKeysMap() {
  try {
    return JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

let legacyMigrated = false;

/** One-time migration: legacy single key → per-provider map. */
export function migrateLegacyKey() {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    const legacy = localStorage.getItem(AIKEY_KEY);
    if (legacy) {
      const map = getKeysMap();
      const pid = getProviderId();
      if (!map[pid]) map[pid] = legacy;
      localStorage.setItem(KEYS_KEY, JSON.stringify(map));
      localStorage.removeItem(AIKEY_KEY);
    }
  } catch {
    // non-fatal
  }
}

export function setKeyForProvider(pid, key) {
  try {
    const map = getKeysMap();
    if (key && key.trim()) map[pid] = key.trim();
    else delete map[pid];
    localStorage.setItem(KEYS_KEY, JSON.stringify(map));
  } catch {
    // non-fatal
  }
}

export function getKeyForProvider(pid) {
  migrateLegacyKey();
  return getKeysMap()[pid] || '';
}

/** Full effective config for direct mode. Always strips trailing slashes from baseUrl. */
export function getDirectConfig() {
  migrateLegacyKey();
  const pid = getProviderId();
  const preset = PROVIDERS[pid] || PROVIDERS.groq;
  let baseUrl = preset.baseUrl;
  let model = preset.defaultModel;
  try {
    baseUrl = localStorage.getItem(BASEURL_KEY) || preset.baseUrl;
  } catch {
    // default
  }
  try {
    model = localStorage.getItem(MODEL_KEY) || preset.defaultModel;
  } catch {
    // default
  }
  const key = getKeyForProvider(pid).trim();
  return {
    providerId: pid,
    preset,
    baseUrl: (baseUrl || '').trim().replace(/\/+$/, ''),
    model: (model || '').trim(),
    key,
  };
}

/** Reasoning model for Deep Think: override > preset.reasonModel > preset.defaultModel. */
export function getReasonModel() {
  const pid = getProviderId();
  const preset = PROVIDERS[pid] || PROVIDERS.groq;
  let override = '';
  try {
    override = (localStorage.getItem(REASON_KEY) || '').trim();
  } catch {
    // default
  }
  return override || preset.reasonModel || preset.defaultModel || '';
}

/** Tavily key for web search (free tier: app.tavily.com). */
export function getTavilyKey() {
  try {
    return (localStorage.getItem(TAVILY_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** Auto-failover to another saved free provider on 429/503 (defaults to true). */
export function getAutoFallback() {
  try {
    const val = localStorage.getItem(FALLBACK_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setAutoFallback(enabled) {
  try {
    localStorage.setItem(FALLBACK_KEY, enabled ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

/**
 * Return alternative providers for which the user already saved an API key.
 * Used for graceful free-tier failover when the primary provider returns 429/503.
 */
export function getFallbackProviders() {
  migrateLegacyKey();
  const activeId = getProviderId();
  const map = getKeysMap();
  const out = [];
  for (const [pid, rawKey] of Object.entries(map)) {
    const key = String(rawKey || '').trim();
    if (!key || pid === activeId || pid === 'custom') continue;
    const preset = PROVIDERS[pid];
    if (!preset || !preset.baseUrl || !preset.defaultModel) continue;
    out.push({
      providerId: pid,
      name: preset.name,
      baseUrl: preset.baseUrl.replace(/\/+$/, ''),
      model: preset.defaultModel,
      reasonModel: preset.reasonModel || preset.defaultModel,
      key,
    });
  }
  return out;
}

/** Masked key for display only — never log or send full key. */
export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

/** Passwordless Hold-to-Unlock safety lock for AI Provider config. */
export function isAiProviderLocked() {
  try {
    return localStorage.getItem(AI_LOCK_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAiProviderLocked(locked) {
  try {
    localStorage.setItem(AI_LOCK_KEY, locked ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

/** Optional Dev & IT Toolkit add-on toggle (defaults ON, hideable anytime). */
export function isDevToolkitEnabled() {
  try {
    const val = localStorage.getItem(DEV_TOOLKIT_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setDevToolkitEnabled(enabled) {
  try {
    localStorage.setItem(DEV_TOOLKIT_KEY, enabled ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

/** Pluggable Grammar & Writing Engine config (defaults to zero-key LanguageTool Free). */
export function getGrammarConfig() {
  const defaults = {
    provider: 'languagetool-free', // 'languagetool-free' | 'languagetool-plus' | 'grammarly' | 'sapling'
    ltUrl: 'https://api.languagetool.org/v2/check',
    ltUsername: '',
    ltApiKey: '',
    grammarlyClientId: '',
    grammarlyClientSecret: '',
    grammarlyToken: '',
    saplingKey: '',
  };
  try {
    const raw = JSON.parse(localStorage.getItem(GRAMMAR_CONFIG_KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...defaults, ...raw };
  } catch {
    // default
  }
  return defaults;
}

export function setGrammarConfig(patch) {
  const next = { ...getGrammarConfig(), ...(patch || {}) };
  try {
    localStorage.setItem(GRAMMAR_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // non-fatal
  }
  return next;
}
