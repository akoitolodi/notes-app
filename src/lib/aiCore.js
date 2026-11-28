/**
 * aiCore — unified AI text/vision/streaming router with Free-Tier Resilience:
 * - ES2015-compatible AbortController timeout helper (safe on all Android WebViews)
 * - External AbortSignal support (Stop button / unmount cancellation)
 * - SSE token streaming for both Direct API and Termux server modes
 * - Automatic 429 / 503 backoff retry + optional failover to another saved free provider
 */
import { getApiBase } from '../config';
import { getAiMode } from './aiConfig';
import { getAdaptiveTimeouts } from './netResilience';
import { selectCandidatesForTask, recordRouteOutcome } from './aiRouter';
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

const THINKING_MODEL_RE =
  /(deepseek-r1|r1:|qwen[-/]?3|qwq|nemotron|gemini-2\.5|gemini-3|\bo1\b|\bo3\b|\bo4\b|magistral|thinking|reasoner|gpt-5|claude-sonnet-4|claude-opus-4)/i;

/** Detect models that emit internal thinking/reasoning tokens counted against max_tokens. */
export function isThinkingModel(model = '') {
  return THINKING_MODEL_RE.test(String(model || ''));
}

/**
 * Compute safe max_tokens budget so thinking/reasoning models never exhaust their
 * token limit inside hidden reasoning before writing the final visible answer.
 */
export function computeEffectiveMaxTokens(model, requestedMax = 2048, useReasoning = false, boostRetry = false) {
  const base = Math.max(256, Number(requestedMax) || 2048);
  const needsThinkingHeadroom = Boolean(useReasoning || isThinkingModel(model));
  let budget = needsThinkingHeadroom ? Math.max(base, 4096) : base;
  if (boostRetry) {
    budget = Math.max(budget * 2, 8192);
  }
  return Math.min(16384, budget);
}

/**
 * Extract clean visible text from a model response, with optional last-resort
 * extraction from reasoning_content / unclosed <think> if the provider truncated mid-thought.
 */
export function extractUsableText(rawContent = '', reasoningText = '', { allowReasoningFallback = false } = {}) {
  const raw = String(rawContent || '');
  const hasOpenThink = /<think>/i.test(raw);
  const hasCloseThink = /<\/think>/i.test(raw);
  if (hasOpenThink && !hasCloseThink) {
    const beforeThink = raw.slice(0, raw.toLowerCase().indexOf('<think>')).trim();
    if (beforeThink) return beforeThink;
    if (!allowReasoningFallback) return '';
  }

  const cleaned = stripThinking(raw);
  if (cleaned && !(hasOpenThink && !hasCloseThink)) return cleaned;

  if (!allowReasoningFallback) return '';

  const fallbackSource = String(reasoningText || rawContent || '')
    .replace(/<\/?think>/gi, '')
    .trim();
  if (!fallbackSource) return '';

  const finalMatch = /(?:final answer|answer|conclusion|summary)\s*[:\-]\s*([\s\S]+)$/i.exec(fallbackSource);
  if (finalMatch && finalMatch[1].trim().length >= 12) {
    return finalMatch[1].trim();
  }
  return fallbackSource;
}

function buildEmptyResponseError(lastReasoning = '') {
  const err = new Error('AI returned no content');
  err.retryable = true;
  err.isEmptyResponse = true;
  err.lastReasoning = lastReasoning;
  return err;
}

function buildMessages({ system, user, imageDataUrl = null, history = [] } = {}) {
  const messages = [];
  if (system && String(system).trim()) messages.push({ role: 'system', content: String(system) });
  if (Array.isArray(history) && history.length > 0) messages.push(...history);
  const userText = String(user ?? '').trim();
  if (!userText && !imageDataUrl) {
    throw new Error('AI prompt content is empty');
  }
  if (imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userText || 'Analyze this image.' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userText });
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

const REASONING_BOOST_NOTE =
  '\n\nThink carefully step-by-step, check edge cases and arithmetic, and verify your logic before writing the final answer.';

function withReasoningBoost(messages, candidate) {
  if (!candidate?.degradedFromReasoning || !Array.isArray(messages) || messages.length === 0) {
    return messages;
  }
  const first = messages[0];
  if (first?.role === 'system') {
    return [{ ...first, content: `${first.content}${REASONING_BOOST_NOTE}` }, ...messages.slice(1)];
  }
  return [{ role: 'system', content: REASONING_BOOST_NOTE.trim() }, ...messages];
}

export async function aiText({
  system,
  user,
  maxTokens = 2048,
  timeoutMs = 180000,
  history = [],
  modelOverride = null,
  useReasoning = false,
  task = 'balanced',
  signal = null,
  onFallback = null,
  onRouteSwitch = null,
}) {
  const messages = buildMessages({ system, user, history });

  if (getAiMode() === 'direct') {
    return directChatWithResilience(
      messages,
      maxTokens,
      timeoutMs,
      modelOverride,
      useReasoning,
      task,
      signal,
      onFallback,
      onRouteSwitch
    );
  }

  return termuxChat(messages, maxTokens, timeoutMs, modelOverride, signal);
}

/**
 * Streaming chat completion with progressive token callback `onToken(partialText)`.
 * Includes automatic 429/503 retry, adaptive task routing, and Deep Think auto-switch.
 */
export async function aiTextStream({
  system,
  user,
  maxTokens = 2048,
  timeoutMs = 180000,
  history = [],
  modelOverride = null,
  useReasoning = false,
  task = 'balanced',
  signal = null,
  onToken = null,
  onStatus = null,
  onFallback = null,
  onRouteSwitch = null,
}) {
  if (!onToken) {
    return aiText({
      system,
      user,
      maxTokens,
      timeoutMs,
      history,
      modelOverride,
      useReasoning,
      task,
      signal,
      onFallback,
      onRouteSwitch,
    });
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

  const effectiveTask = useReasoning ? 'reasoning' : task || 'balanced';
  const candidates = selectCandidatesForTask({
    task: effectiveTask,
    useReasoning,
    modelOverride,
  });
  const hasFallbacks = candidates.length > 1;
  let lastErr = null;
  let lastReasoningSeen = '';
  let prevCandidate = null;

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const moreLeft = idx < candidates.length - 1;
    if (idx > 0) {
      onFallback?.(c.name);
      onRouteSwitch?.({
        reason: lastErr?.isFirstByteStall ? 'slow' : lastErr?.httpStatus === 429 ? 'rate-limit' : 'unavailable',
        fromName: prevCandidate?.name || '',
        fromModel: prevCandidate?.model || '',
        toName: c.name,
        toModel: c.model,
        degraded: Boolean(c.degradedFromReasoning),
      });
    }
    prevCandidate = c;

    const adaptive = getAdaptiveTimeouts();
    const effectiveTimeoutMs = Math.max(timeoutMs || 0, adaptive.aiTotalMs);
    const ttftWatchdogMs =
      hasFallbacks && moreLeft
        ? effectiveTask === 'reasoning'
          ? adaptive.aiReasonFirstByteMs
          : adaptive.aiFirstByteMs
        : 0;
    const reqMessages = withReasoningBoost(messages, c);

    for (let attempt = 0; attempt < (c.isFallback ? 1 : 2); attempt++) {
      const effectiveMax = computeEffectiveMaxTokens(c.model, maxTokens, useReasoning, attempt > 0);
      const tStart = Date.now();
      try {
        const result = await streamRequest({
          url: `${c.baseUrl}/chat/completions`,
          headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
          bodyObj: { model: c.model, messages: reqMessages, temperature: 0.4, max_tokens: effectiveMax, stream: true },
          timeoutMs: effectiveTimeoutMs,
          firstByteTimeoutMs: ttftWatchdogMs,
          signal,
          onToken,
          onStatus,
          fallbackTextFn: () =>
            directSingleCall(
              c,
              reqMessages,
              computeEffectiveMaxTokens(c.model, effectiveMax, useReasoning, true),
              effectiveTimeoutMs,
              signal
            ),
        });
        recordRouteOutcome({
          providerId: c.providerId,
          modelId: c.model,
          ok: true,
          totalMs: Date.now() - tStart,
        });
        return result;
      } catch (err) {
        if (err?.isCancelled) throw err;
        if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''))) {
          err.retryable = true;
        }
        recordRouteOutcome({
          providerId: c.providerId,
          modelId: c.model,
          ok: false,
          totalMs: Date.now() - tStart,
          httpStatus: err?.httpStatus || 0,
          isEmpty: Boolean(err?.isEmptyResponse),
          isStall: Boolean(err?.isFirstByteStall),
        });
        lastErr = err;
        if (err?.lastReasoning) lastReasoningSeen = err.lastReasoning;
        if (err?.retryable && !err?.isFirstByteStall && attempt === 0 && !c.isFallback) {
          onStatus?.(err?.isEmptyResponse ? 'Model stopped mid-thought — retrying with more tokens…' : 'Retrying…');
          await sleep(err?.isEmptyResponse ? 300 : 750, signal);
          continue;
        }
        if (
          !(
            err?.retryable ||
            err?.isFirstByteStall ||
            err?.isEmptyResponse ||
            err?.httpStatus === 402 ||
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

  // Last-resort recovery: if every provider returned only reasoning_content, surface the clean conclusion rather than failing empty
  const recovered = extractUsableText('', lastReasoningSeen, { allowReasoningFallback: true });
  if (recovered) {
    onToken?.(recovered);
    return recovered;
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

    const contentType = res.headers?.get?.('content-type') || '';
    if (!res.body?.getReader || !contentType.includes('event-stream')) {
      const data = await res.json().catch(() => null);
      const msgObj = data?.choices?.[0]?.message || {};
      const full = msgObj.content || data?.content || '';
      const reasoning = msgObj.reasoning_content || msgObj.reasoning || '';
      const cleaned = extractUsableText(full, reasoning);
      if (!cleaned) throw buildEmptyResponseError(reasoning || full);
      onToken(cleaned);
      return cleaned;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let rawAccum = '';
    let reasoningAccum = '';
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
            reasoningAccum += rDelta;
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

    const finalClean = extractUsableText(rawAccum, reasoningAccum);
    if (!finalClean) {
      try {
        const fb = await fallbackTextFn();
        if (fb) {
          onToken(fb);
          return fb;
        }
      } catch (fbErr) {
        if (fbErr?.isCancelled) throw fbErr;
        throw buildEmptyResponseError(fbErr?.lastReasoning || reasoningAccum || rawAccum);
      }
      throw buildEmptyResponseError(reasoningAccum || rawAccum);
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
  let msg = `AI API error ${status}: ${String(body || '').slice(0, 180)}`;
  if (status === 402) {
    msg = 'Paid subscription required for this model (HTTP 402). Pick a FREE model in Settings → AI Backend.';
  } else if (status === 404 || status === 410) {
    msg += '\n\nModel unavailable or retired. Pick another model in Settings → AI Backend.';
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
    const msgObj = data.choices?.[0]?.message || {};
    const content = msgObj.content || '';
    const reasoning = msgObj.reasoning_content || msgObj.reasoning || '';
    const cleaned = extractUsableText(content, reasoning);
    if (!cleaned) throw buildEmptyResponseError(reasoning || content);
    return cleaned;
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (ctrl.wasTimeout()) {
        const tErr = new Error('The AI took too long to answer on slow internet. Tap Retry.');
        tErr.retryable = true;
        tErr.isTimeoutStall = true;
        throw tErr;
      }
      const cancelled = new Error('Cancelled');
      cancelled.isCancelled = true;
      throw cancelled;
    }
    if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''))) {
      err.retryable = true;
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
  task = 'balanced',
  signal = null,
  onFallback = null,
  onRouteSwitch = null
) {
  const effectiveTask = useReasoning ? 'reasoning' : task || 'balanced';
  const candidates = selectCandidatesForTask({
    task: effectiveTask,
    useReasoning,
    modelOverride,
  });
  const adaptive = getAdaptiveTimeouts();
  let lastErr = null;
  let lastReasoningSeen = '';
  let prevCandidate = null;

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const moreLeft = idx < candidates.length - 1;
    if (idx > 0) {
      onFallback?.(c.name);
      onRouteSwitch?.({
        reason: lastErr?.isTimeoutStall ? 'slow' : lastErr?.httpStatus === 429 ? 'rate-limit' : 'unavailable',
        fromName: prevCandidate?.name || '',
        fromModel: prevCandidate?.model || '',
        toName: c.name,
        toModel: c.model,
        degraded: Boolean(c.degradedFromReasoning),
      });
    }
    prevCandidate = c;

    // Balanced Deep Think stall guard on non-streaming calls when another candidate is ready
    const perAttemptTimeoutMs =
      effectiveTask === 'reasoning' && moreLeft
        ? Math.min(timeoutMs || adaptive.aiReasonNonStreamMs, adaptive.aiReasonNonStreamMs)
        : timeoutMs;
    const reqMessages = withReasoningBoost(messages, c);

    for (let attempt = 0; attempt < (c.isFallback ? 1 : 2); attempt++) {
      const effectiveMax = computeEffectiveMaxTokens(c.model, maxTokens, useReasoning, attempt > 0);
      const tStart = Date.now();
      try {
        const out = await directSingleCall(c, reqMessages, effectiveMax, perAttemptTimeoutMs, signal);
        recordRouteOutcome({
          providerId: c.providerId,
          modelId: c.model,
          ok: true,
          totalMs: Date.now() - tStart,
        });
        return out;
      } catch (err) {
        if (err?.isCancelled) throw err;
        recordRouteOutcome({
          providerId: c.providerId,
          modelId: c.model,
          ok: false,
          totalMs: Date.now() - tStart,
          httpStatus: err?.httpStatus || 0,
          isEmpty: Boolean(err?.isEmptyResponse),
          isStall: Boolean(err?.isTimeoutStall),
        });
        lastErr = err;
        if (err?.lastReasoning) lastReasoningSeen = err.lastReasoning;
        // Skip duplicate slow attempt on primary if reasoning stalled and a backup candidate exists
        if (err?.isTimeoutStall && moreLeft) {
          break;
        }
        if (err?.retryable && attempt === 0 && !c.isFallback) {
          await sleep(err?.isEmptyResponse ? 350 : 1200, signal);
          continue;
        }
        if (
          !(
            err?.retryable ||
            err?.isEmptyResponse ||
            err?.httpStatus === 402 ||
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

  const recovered = extractUsableText('', lastReasoningSeen, { allowReasoningFallback: true });
  if (recovered) return recovered;

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

/** Vision request (image + prompt). Automatically routes to a vision-capable free model. */
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
    return directChatWithResilience(messages, maxTokens, timeoutMs, null, false, 'vision', signal, null, null);
  }
  return termuxChat(messages, maxTokens, timeoutMs, null, signal);
}
