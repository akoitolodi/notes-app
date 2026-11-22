/**
 * aiCore — unified AI text/vision router for all newer features.
 * Routes by backend mode (Settings → AI Backend):
 *   - 'direct': calls the chosen provider straight from the device
 *   - 'termux': POSTs to the local Termux server /api/chat
 * Returns plain assistant text. Vision passes a dataURL image.
 */
import { API_BASE } from '../config';
import { getAiMode, getDirectConfig } from './aiConfig';

function buildMessages({ system, user, imageDataUrl = null, history = [] }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push(...history);
  if (imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: user });
  }
  return messages;
}

export async function aiText({ system, user, maxTokens = 2048, timeoutMs = 180000, history = [], modelOverride = null }) {
  const messages = buildMessages({ system, user, history });

  if (getAiMode() === 'direct') {
    return directChat(messages, maxTokens, timeoutMs, modelOverride);
  }

  // Termux mode
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(
      `Can't reach the AI backend${API_BASE ? ` at ${API_BASE}` : ''}. Start the Termux server: node server.js`
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'AI request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error('AI returned no content');
  return data.content;
}

/** Direct-provider chat with a prebuilt messages array. */
async function directChat(messages, maxTokens, timeoutMs, modelOverride = null) {
  const { baseUrl, key, model } = getDirectConfig();
  if (!key) throw new Error('No API key configured. Set your key in Settings → AI backend.');
  const useModel = (modelOverride || '').trim() || model;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: useModel, messages, temperature: 0.4, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI returned no content');
  return content;
}

/**
 * Web search via Tavily (free tier: app.tavily.com — 1,000 searches/month).
 * Returns [{title, url, content}]. Runs through CapacitorHttp in the APK,
 * so CORS is not an issue.
 */
export async function webSearch(query, apiKey, maxResults = 5) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Search failed ${res.status}: ${body.slice(0, 150)}`);
  }
  const data = await res.json();
  return (data.results || [])
    .filter(r => r && r.content)
    .map(r => ({ title: r.title || '', url: r.url || '', content: r.content || '' }));
}

/** Vision request (image + prompt). Requires a vision-capable model. */
export async function aiVision({ system, user, imageDataUrl, maxTokens = 2048, timeoutMs = 240000 }) {
  const messages = buildMessages({ system, user, imageDataUrl });

  if (getAiMode() === 'direct') {
    return directChat(messages, maxTokens, timeoutMs);
  }

  // Termux mode — server /api/chat forwards message arrays (vision support
  // depends on the configured model behind the server).
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Can't reach the AI backend. Start the Termux server: node server.js");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'AI request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error('AI returned no content');
  return data.content;
}