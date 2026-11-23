/**
 * aiCore — unified AI text/vision/streaming router with Free-Tier Resilience:
 * - ES2015-compatible AbortController timeout helper (safe on all Android WebViews)
 * - External AbortSignal support (Stop button / unmount cancellation)
 * - SSE token streaming for both Direct API and Termux server modes
 * - Automatic 429 / 503 backoff retry + optional failover to another saved free provider
 */
import { getApiBase } from '../config';
import { getAiMode, getDirectConfig, getAutoFallback, getFallbackProviders } from './aiConfig';
import { stripThinking } from '../../shared/aiParsers.js';

/** ES2015-safe AbortController with timeout + optional parent signal forwarding. */
export function createAbortController(timeoutMs, externalSignal = null) {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    wasTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { isCancelled: true }));
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Cancelled'), { isCancelled: true }));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

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

/** Test Termux / Express backend reachability via /api/health. */
export async function testTermuxConnection() {
  const apiBase = getApiBase();
  const { signal, cleanup } = createAbortController(8000);
  try {
    const res = await fetch(`${apiBase}/api/health`, { method: 'GET', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Connection timed out');
    throw new Error(`Can't reach backend${apiBase ? ` at ${apiBase}` : ''}`);
  } finally {
    cleanup();
  }
}

/** Build candidate list of direct endpoints (primary first, then saved fallbacks if enabled). */
function getDirectCandidates(modelOverride = null, useReasoning = false) {
  const primary = getDirectConfig();
  if (!primary.key) throw new Error('No API key configured. Set your key in Settings → AI backend.');
  if (!primary.baseUrl) throw new Error('No base URL configured for the selected provider.');

  const list = [
    {
      name: primary.preset?.name || primary.providerId,
      baseUrl: primary.baseUrl,
      key: primary.key,
      model: (modelOverride || '').trim() || primary.model,
      isFallback: false,
    },
  ];

  if (getAutoFallback()) {
    for (const fb of getFallbackProviders()) {
      list.push({
        name: fb.name,
        baseUrl: fb.baseUrl,
        key: fb.key,
        model: useReasoning ? fb.reasonModel : fb.model,
        isFallback: true,
      });
    }
  }
  return list;
}

export async function aiText({
  system,
  user,
  maxTokens = 2048,
  timeoutMs = 180000,
  history = [],
  modelOverride = null,
  useReasoning = false,
  signal = null,
  onFallback = null,
}) {
  const messages = buildMessages({ system, user, history });

  if (getAiMode() === 'direct') {
    return directChatWithResilience(messages, maxTokens, timeoutMs, modelOverride, useReasoning, signal, onFallback);
  }

  return termuxChat(messages, maxTokens, timeoutMs, modelOverride, signal);
}

/**
 * Streaming chat completion with progressive token callback `onToken(partialText)`.
 * Includes automatic 429/503 retry + free-tier provider failover before tokens start flowing.
 */
export async function aiTextStream({
  system,
  user,
  maxTokens = 2048,
  timeoutMs = 180000,
  history = [],
  modelOverride = null,
  useReasoning = false,
  signal = null,
  onToken = null,
  onStatus = null,
  onFallback = null,
}) {
  if (!onToken) {
    return aiText({ system, user, maxTokens, timeoutMs, history, modelOverride, useReasoning, signal, onFallback });
  }

  const messages = buildMessages({ system, user, history });
  const isDirect = getAiMode() === 'direct';

  if (!isDirect) {
    return streamRequest({
      url: `${getApiBase()}/api/chat-stream`,
      headers: { 'Content-Type': 'application/json' },
      bodyObj: { messages, maxTokens, modelOverride },
      timeoutMs,
      firstByteTimeoutMs: 0,
      signal,
      onToken,
      onStatus,
      fallbackTextFn: () => termuxChat(messages, maxTokens, timeoutMs, modelOverride, signal),
    });
  }

  const candidates = getDirectCandidates(modelOverride, useReasoning);
  const hasFallbacks = candidates.length > 1;
  let lastErr = null;

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const moreLeft = idx < candidates.length - 1;
    if (c.isFallback) onFallback?.(c.name);

    // If a backup provider exists and primary stalls with 0 bytes for 18s (25s for reasoning), fail over fast!
    const ttftWatchdogMs =
      hasFallbacks && moreLeft ? (useReasoning ? 28000 : 18000) : 0;

    for (let attempt = 0; attempt < (c.isFallback ? 1 : 2); attempt++) {
      try {
        return await streamRequest({
          url: `${c.baseUrl}/chat/completions`,
          headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
          bodyObj: { model: c.model, messages, temperature: 0.4, max_tokens: maxTokens, stream: true },
          timeoutMs,
          firstByteTimeoutMs: ttftWatchdogMs,
          signal,
          onToken,
          onStatus,
          fallbackTextFn: () => directSingleCall(c, messages, maxTokens, timeoutMs, signal),
        });
      } catch (err) {
        if (err?.isCancelled) throw err;
        lastErr = err;
        if (err?.retryable && !err?.isFirstByteStall && attempt === 0 && !c.isFallback) {
          await sleep(750, signal);
          continue;
        }
        // Fail over to backup provider on rate-limit / server error / stall / retired model
        if (
          !(
            err?.retryable ||
            err?.isFirstByteStall ||
            err?.httpStatus === 404 ||
            err?.httpStatus === 410
          )
        ) {
          throw err;
        }
        break;
      }
    }
  }

  throw lastErr || new Error('AI request failed');
}

async function streamRequest({
  url,
  headers,
  bodyObj,
  timeoutMs,
  firstByteTimeoutMs = 0,
  signal,
  onToken,
  onStatus = null,
  fallbackTextFn,
}) {
  const ctrl = createAbortController(timeoutMs, signal);
  let stalledFirstByte = false;
  let ttftTimer = null;

  const clearTtft = () => {
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
  };

  // Dedicated controller so TTFT watchdog can abort fetch without firing parent signal
  const innerCtrl = new AbortController();
  const onOuterAbort = () => innerCtrl.abort();
  ctrl.signal.addEventListener('abort', onOuterAbort, { once: true });

  if (firstByteTimeoutMs > 0) {
    ttftTimer = setTimeout(() => {
      stalledFirstByte = true;
      innerCtrl.abort();
    }, firstByteTimeoutMs);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      signal: innerCtrl.signal,
    });

    clearTtft();

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw buildHttpError(res.status, text);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!res.body?.getReader || !contentType.includes('event-stream')) {
      const data = await res.json().catch(() => null);
      const full = data?.choices?.[0]?.message?.content || data?.content || '';
      if (!full) throw new Error('AI returned no content');
      const cleaned = stripThinking(full);
      onToken(cleaned);
      return cleaned;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let rawAccum = '';
    let reasoningChars = 0;
    let lastStatusTs = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error?.message || String(parsed.error));
          const deltaObj = parsed.choices?.[0]?.delta || {};

          // Surface live thinking activity for reasoning models (Nemotron / DeepSeek-R1 / Qwen3)
          const rDelta = deltaObj.reasoning_content || deltaObj.reasoning || '';
          if (typeof rDelta === 'string' && rDelta) {
            reasoningChars += rDelta.length;
            const now = Date.now();
            if (onStatus && now - lastStatusTs > 450) {
              lastStatusTs = now;
              const estToks = Math.max(1, Math.round(reasoningChars / 4));
              onStatus(`Reasoning… (~${estToks} tokens)`);
            }
          }

          const delta = deltaObj.content;
          if (typeof delta === 'string' && delta) {
            rawAccum += delta;
            const visible = hideLiveThinking(rawAccum);
            if (visible) {
              onToken(visible);
            } else if (rawAccum.toLowerCase().includes('<think>') && onStatus) {
              const now = Date.now();
              if (now - lastStatusTs > 450) {
                lastStatusTs = now;
                const estToks = Math.max(1, Math.round(rawAccum.length / 4));
                onStatus(`Reasoning… (~${estToks} tokens)`);
              }
            }
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    }

    const finalClean = stripThinking(rawAccum);
    if (!finalClean) {
      return fallbackTextFn();
    }
    onToken(finalClean);
    return finalClean;
  } catch (err) {
    if (stalledFirstByte) {
      const stallErr = new Error('Primary AI provider stalled — trying backup provider…');
      stallErr.isFirstByteStall = true;
      stallErr.retryable = true;
      throw stallErr;
    }
    if (err?.name === 'AbortError') {
      if (ctrl.wasTimeout()) throw new Error('The AI took too long to answer. Tap Retry.');
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    throw err;
  } finally {
    clearTtft();
    ctrl.signal.removeEventListener('abort', onOuterAbort);
    ctrl.cleanup();
  }
}

function hideLiveThinking(raw) {
  let out = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openIdx = out.toLowerCase().indexOf('<think>');
  if (openIdx !== -1) out = out.slice(0, openIdx);
  return out.replace(/<\/?think>/gi, '').trim();
}

function buildHttpError(status, body) {
  let msg = `AI API error ${status}: ${String(body || '').slice(0, 200)}`;
  if (status === 404 || status === 410) {
    msg += '\n\nThis model may have been retired by the provider. Pick another model in Settings → AI Backend.';
  }
  const err = new Error(msg);
  err.httpStatus = status;
  err.retryable = isRetryableStatus(status);
  return err;
}

async function termuxChat(messages, maxTokens, timeoutMs, modelOverride = null, signal = null) {
  const apiBase = getApiBase();
  const ctrl = createAbortController(timeoutMs, signal);
  let res;
  try {
    res = await fetch(`${apiBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, maxTokens, modelOverride }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (ctrl.wasTimeout()) throw new Error('The AI took too long to answer. Tap Retry.');
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    throw new Error(
      `Can't reach the AI backend${apiBase ? ` at ${apiBase}` : ''}. Start the Termux server: node server.js`
    );
  } finally {
    ctrl.cleanup();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'AI request failed' }));
    throw buildHttpError(res.status, err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error('AI returned no content');
  return stripThinking(data.content);
}

async function directSingleCall(candidate, messages, maxTokens, timeoutMs, signal = null) {
  const ctrl = createAbortController(timeoutMs, signal);
  try {
    const res = await fetch(`${candidate.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${candidate.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: candidate.model, messages, temperature: 0.4, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw buildHttpError(res.status, body);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI returned no content');
    return stripThinking(content);
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (ctrl.wasTimeout()) throw new Error('The AI took too long to answer. Tap Retry.');
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    throw err;
  } finally {
    ctrl.cleanup();
  }
}

async function directChatWithResilience(
  messages,
  maxTokens,
  timeoutMs,
  modelOverride = null,
  useReasoning = false,
  signal = null,
  onFallback = null
) {
  const candidates = getDirectCandidates(modelOverride, useReasoning);
  let lastErr = null;

  for (const c of candidates) {
    if (c.isFallback) onFallback?.(c.name);

    for (let attempt = 0; attempt < (c.isFallback ? 1 : 2); attempt++) {
      try {
        return await directSingleCall(c, messages, maxTokens, timeoutMs, signal);
      } catch (err) {
        if (err?.isCancelled) throw err;
        lastErr = err;
        if (err?.retryable && attempt === 0 && !c.isFallback) {
          await sleep(1200, signal);
          continue;
        }
        if (!(err?.retryable || err?.httpStatus === 404 || err?.httpStatus === 410)) {
          throw err;
        }
        break;
      }
    }
  }

  throw lastErr || new Error('AI request failed');
}

/**
 * Web search via Tavily (free tier: app.tavily.com — 1,000 searches/month).
 * Returns [{title, url, content, kind: 'web'}].
 */
export async function webSearch(query, apiKey, maxResults = 5, signal = null) {
  const ctrl = createAbortController(15000, signal);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Search failed ${res.status}: ${body.slice(0, 150)}`);
    }
    const data = await res.json();
    return (data.results || [])
      .filter(r => r && r.content)
      .map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        kind: 'web',
      }));
  } finally {
    ctrl.cleanup();
  }
}

/** Vision request (image + prompt). Requires a vision-capable model. */
export async function aiVision({
  system,
  user,
  imageDataUrl,
  maxTokens = 2048,
  timeoutMs = 240000,
  signal = null,
}) {
  const messages = buildMessages({ system, user, imageDataUrl });
  if (getAiMode() === 'direct') {
    return directChatWithResilience(messages, maxTokens, timeoutMs, null, false, signal, null);
  }
  return termuxChat(messages, maxTokens, timeoutMs, null, signal);
}
