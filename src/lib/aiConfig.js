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
export const LEARN_CODING_KEY = 'aicn:addonLearnCoding'; // optional Learn Coding Studio ('true' default)
export const CODAPI_URL_KEY = 'aicn:codapiUrl'; // optional self-hosted Codapi URL (default https://api.codapi.org)
export const CODAPI_KEY_KEY = 'aicn:codapiKey'; // optional Codapi API key
export const DEEPTUTOR_URL_KEY = 'aicn:deepTutorUrl'; // optional self-hosted HKUDS/DeepTutor bridge URL
export const DEEPTUTOR_MEMORY_KEY = 'aicn:deepTutorMemory'; // built-in DeepTutor Learner Memory ('true' default)
export const GRAMMAR_CONFIG_KEY = 'aicn:grammarConfig'; // JSON { provider, ltUrl, ltUsername, ltApiKey, grammarlyClientId, grammarlyClientSecret, grammarlyToken, saplingKey }
export const FETCHED_MODELS_KEY = 'aicn:fetchedModels'; // JSON { [providerId]: string[] }

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
      'deepseek-r1-distill-llama-70b',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
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
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
    ],
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
      'deepseek/deepseek-r1:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen3-235b-a22b:free',
      'google/gemma-3-27b-it:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'mistralai/mistral-small-3.2-24b-instruct:free',
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
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'o4-mini', 'o3', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  cerebras: {
    name: 'Cerebras',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    reasonModel: 'qwen-3-32b',
    models: [
      'llama-3.3-70b',
      'qwen-3-32b',
      'qwen-3-235b-a22b',
      'llama-4-scout-17b-16e-instruct',
      'llama3.1-8b',
    ],
    keyUrl: 'https://cloud.cerebras.ai',
  },
  mistral: {
    name: 'Mistral',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    reasonModel: 'magistral-small-latest',
    models: [
      'mistral-small-latest',
      'magistral-small-latest',
      'codestral-latest',
      'mistral-medium-latest',
      'mistral-large-latest',
      'magistral-medium-latest',
    ],
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
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen3-235b-a22b',
      'google/gemma-3-27b-it',
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
      'deepseek/deepseek-r1:free',
      'inclusionai/ling-3.2-flash:free',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.4',
    ],
    keyUrl: 'https://kilo.ai',
  },
  deepseek: {
    name: 'DeepSeek',
    badge: 'Low cost',
    free: false,
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    reasonModel: 'deepseek-reasoner',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  sambanova: {
    name: 'SambaNova',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    reasonModel: 'DeepSeek-R1',
    models: [
      'Meta-Llama-3.3-70B-Instruct',
      'DeepSeek-R1',
      'DeepSeek-V3-0324',
      'Qwen3-32B',
      'Meta-Llama-3.1-8B-Instruct',
    ],
    keyUrl: 'https://cloud.sambanova.ai/apis',
  },
  github: {
    name: 'GitHub Models',
    badge: 'Free w/ GitHub',
    free: true,
    baseUrl: 'https://models.inference.ai.azure.com',
    defaultModel: 'gpt-4.1-mini',
    reasonModel: 'DeepSeek-R1',
    models: [
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'DeepSeek-R1',
      'Llama-3.3-70B-Instruct',
      'Phi-4',
    ],
    keyUrl: 'https://github.com/settings/tokens',
  },
  huggingface: {
    name: 'HuggingFace',
    badge: 'Free credits',
    free: true,
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    reasonModel: 'deepseek-ai/DeepSeek-R1',
    models: [
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'meta-llama/Llama-3.3-70B-Instruct',
      'google/gemma-3-27b-it',
    ],
    keyUrl: 'https://huggingface.co/settings/tokens',
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

/** Optional Learn Coding Studio toggle (defaults ON, hideable anytime). */
export function isLearnCodingEnabled() {
  try {
    const val = localStorage.getItem(LEARN_CODING_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setLearnCodingEnabled(enabled) {
  try {
    localStorage.setItem(LEARN_CODING_KEY, enabled ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

/** Built-in DeepTutor Persistent Learner Memory toggle (defaults ON). */
export function isDeepTutorMemoryEnabled() {
  try {
    const val = localStorage.getItem(DEEPTUTOR_MEMORY_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setDeepTutorMemoryEnabled(enabled) {
  try {
    localStorage.setItem(DEEPTUTOR_MEMORY_KEY, enabled ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

export function getCodapiConfig() {
  try {
    return {
      url: (localStorage.getItem(CODAPI_URL_KEY) || 'https://api.codapi.org').trim().replace(/\/+$/, ''),
      key: (localStorage.getItem(CODAPI_KEY_KEY) || '').trim(),
    };
  } catch {
    return { url: 'https://api.codapi.org', key: '' };
  }
}

export function setCodapiConfig({ url, key }) {
  try {
    if (url !== undefined) localStorage.setItem(CODAPI_URL_KEY, String(url || '').trim());
    if (key !== undefined) localStorage.setItem(CODAPI_KEY_KEY, String(key || '').trim());
  } catch {
    // non-fatal
  }
}

export function getDeepTutorUrl() {
  try {
    return (localStorage.getItem(DEEPTUTOR_URL_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setDeepTutorUrl(url) {
  try {
    localStorage.setItem(DEEPTUTOR_URL_KEY, String(url || '').trim());
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

function getFetchedModelsMap() {
  try {
    return JSON.parse(localStorage.getItem(FETCHED_MODELS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const FREE_TIER_PROVIDERS = new Set(['groq', 'cerebras', 'sambanova', 'github', 'nvidia', 'huggingface']);
const REASONING_MODEL_ID_RE =
  /(r1\b|r1:|reasoner|thinking|qwen[-/]?3|qwq|magistral|\bo1\b|\bo3\b|\bo4\b|gemini-2\.5-pro|ultra)/i;

/** Detect whether a model ID is a dedicated reasoning/thinking model. */
export function isReasoningModelId(modelId) {
  return REASONING_MODEL_ID_RE.test(String(modelId || ''));
}

/** Detect whether a model entry is free-tier / zero-cost vs paid/subscription. */
export function isModelFree(providerId, modelId, rawObj = null) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (id.endsWith(':free') || id === 'openrouter/free') return true;

  if (rawObj && typeof rawObj === 'object') {
    const p = rawObj.pricing;
    if (p && p.prompt !== undefined && p.completion !== undefined) {
      const pr = Number(p.prompt);
      const cp = Number(p.completion);
      if (Number.isFinite(pr) && Number.isFinite(cp)) {
        return pr === 0 && cp === 0;
      }
    }
    if (typeof rawObj.is_free === 'boolean') return rawObj.is_free;
    if (typeof rawObj.free === 'boolean') return rawObj.free;
  }

  if (providerId === 'openrouter' || providerId === 'kilo') {
    return id.endsWith(':free') || id === 'openrouter/free';
  }
  if (providerId === 'gemini') {
    return /flash|pro|gemma/i.test(id) && !/ultra|deep-research/i.test(id);
  }
  if (providerId === 'mistral') {
    return /(small|open-mistral|codestral|magistral-small|pixtral-12b)/i.test(id);
  }
  if (FREE_TIER_PROVIDERS.has(providerId)) return true;
  return false;
}

function getFetchedMetaMap() {
  try {
    return JSON.parse(localStorage.getItem(`${FETCHED_MODELS_KEY}:meta`) || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * Rich catalog entries for a provider: [{ id, free, reasoning }].
 */
export function getModelCatalogForProvider(providerId) {
  const preset = PROVIDERS[providerId] || PROVIDERS.groq;
  const fetched = getFetchedModelsMap()[providerId];
  const metaMap = getFetchedMetaMap()[providerId] || {};
  const base = Array.isArray(preset.models) ? preset.models : [];
  const mergedIds =
    Array.isArray(fetched) && fetched.length > 0 ? [...new Set([...fetched, ...base])] : base;
  return mergedIds.map(id => {
    const m = metaMap[id];
    const free = typeof m?.free === 'boolean' ? m.free : isModelFree(providerId, id);
    const reasoning =
      typeof m?.reasoning === 'boolean' ? m.reasoning : isReasoningModelId(id);
    return { id, free, reasoning };
  });
}

/**
 * Returns the list of models for a provider, combining any live-fetched models
 * from the provider's /models endpoint with the curated preset defaults.
 */
export function getModelsForProvider(providerId) {
  return getModelCatalogForProvider(providerId).map(m => m.id);
}

const NON_CHAT_MODEL_RE =
  /(whisper|tts|embed|moderation|dall-e|babbage|davinci|rerank|guard|audio|transcribe|realtime|imagen|veo|aqa)/i;

/**
 * Queries GET ${baseUrl}/models to discover live available models for the provider,
 * extracts pricing/free metadata, caches both IDs & metadata, and returns cleaned chat IDs.
 */
export async function fetchLiveModelsForProvider(providerId, { baseUrl = '', key = '' } = {}) {
  const preset = PROVIDERS[providerId] || PROVIDERS.groq;
  const cleanUrl = (baseUrl || preset.baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanUrl) throw new Error('Enter a Base URL first');

  const headers = { Accept: 'application/json' };
  if (key && key.trim()) {
    headers.Authorization = `Bearer ${key.trim()}`;
  }

  const res = await fetch(`${cleanUrl}/models`, { method: 'GET', headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 80) || 'Could not fetch models'}`);
  }
  const data = await res.json();
  const rawList = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];

  const metaById = {};
  const seen = new Set();
  const allEntries = [];
  for (const item of rawList) {
    const id = String(item?.id || item?.name || '').trim().replace(/^models\//, '');
    if (!id || NON_CHAT_MODEL_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const free = isModelFree(providerId, id, item);
    const reasoning = isReasoningModelId(id);
    metaById[id] = { free, reasoning };
    allEntries.push({ id, free, reasoning });
  }

  // Sort free models first so free-tier users immediately see usable options
  const freeEntries = allEntries.filter(e => e.free);
  const paidEntries = allEntries.filter(e => !e.free);
  let orderedIds = [...freeEntries.slice(0, 24), ...paidEntries.slice(0, 10)].map(e => e.id);

  if (orderedIds.length === 0) {
    throw new Error('No chat models returned by endpoint');
  }

  const presetModels = Array.isArray(preset.models) ? preset.models : [];
  const merged = [...new Set([...presetModels.filter(m => orderedIds.includes(m)), ...orderedIds])];
  for (const id of merged) {
    if (!metaById[id]) {
      metaById[id] = { free: isModelFree(providerId, id), reasoning: isReasoningModelId(id) };
    }
  }

  try {
    const map = getFetchedModelsMap();
    map[providerId] = merged;
    localStorage.setItem(FETCHED_MODELS_KEY, JSON.stringify(map));
    const metaAll = getFetchedMetaMap();
    metaAll[providerId] = metaById;
    localStorage.setItem(`${FETCHED_MODELS_KEY}:meta`, JSON.stringify(metaAll));
  } catch {
    // non-fatal
  }
  return merged;
}
