/**
 * AI backend configuration — mode + provider presets + API key storage.
 *
 * SECURITY MODEL:
 * - The API key lives ONLY in localStorage of the app's private sandbox
 *   (on Android, app storage is isolated per-app and unreachable by others).
 * - The key is sent ONLY as an Authorization header to the provider's own
 *   HTTPS endpoint — never in URLs, never in logs, never in error text.
 * - Never committed to git (runtime user input only).
 */
export const MODE_KEY = 'aicn:aiMode';       // 'termux' | 'direct'
export const PROVIDER_KEY = 'aicn:aiProvider'; // preset id
export const AIKEY_KEY = 'aicn:aiKey';       // the API key (secret)
export const BASEURL_KEY = 'aicn:aiBaseUrl'; // custom base URL override
export const MODEL_KEY = 'aicn:aiModel';     // custom model override

/**
 * Provider presets. baseUrl must be an OpenAI-compatible chat/completions root.
 * free: has a free tier. keyUrl: where the user creates the key.
 */
export const PROVIDERS = {
  groq: {
    name: 'Groq',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    name: 'Google Gemini',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    name: 'OpenRouter',
    badge: 'Free models',
    free: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen-2.5-72b-instruct:free',
    ],
    keyUrl: 'https://openrouter.ai/keys',
  },
  openai: {
    name: 'OpenAI',
    badge: 'Paid',
    free: false,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  cerebras: {
    name: 'Cerebras',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    models: ['llama-3.3-70b', 'llama3.1-8b'],
    keyUrl: 'https://cloud.cerebras.ai',
  },
  mistral: {
    name: 'Mistral',
    badge: 'Free tier',
    free: true,
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  custom: {
    name: 'Custom',
    badge: 'Your endpoint',
    free: false,
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyUrl: '',
  },
};

export function getAiMode() {
  try { return localStorage.getItem(MODE_KEY) || 'termux'; } catch { return 'termux'; }
}

export function getProviderId() {
  try { return localStorage.getItem(PROVIDER_KEY) || 'groq'; } catch { return 'groq'; }
}

/** Full effective config for direct mode. Key is secret — handle with care. */
export function getDirectConfig() {
  const pid = getProviderId();
  const preset = PROVIDERS[pid] || PROVIDERS.groq;
  let baseUrl = preset.baseUrl;
  let model = preset.defaultModel;
  try { baseUrl = localStorage.getItem(BASEURL_KEY) || preset.baseUrl; } catch { /* default */ }
  try { model = localStorage.getItem(MODEL_KEY) || preset.defaultModel; } catch { /* default */ }
  let key = '';
  try { key = localStorage.getItem(AIKEY_KEY) || ''; } catch { /* empty */ }
  return { providerId: pid, preset, baseUrl: (baseUrl || '').trim(), model: (model || '').trim(), key: key.trim() };
}

/** Masked key for display only — never log or send the full key. */
export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}
