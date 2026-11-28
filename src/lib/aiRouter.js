/**
 * aiRouter ("BAI-Route") — Hidden Adaptive Task-Based Model & Provider Router.
 *
 * Routes each AI request by task intent ('fast' | 'balanced' | 'code' | 'reasoning' | 'syllabus' | 'vision')
 * across free-tier models (both intra-provider across model tiers AND cross-provider across saved keys)
 * using live EWMA latency, rolling success rate, 1-minute RPM load spreading, and exponential cooldowns.
 */
import {
  PROVIDERS,
  getDirectConfig,
  getReasonModel,
  getAutoFallback,
  getFallbackProviders,
  getModelCatalogForProvider,
  isSmartRoutingEnabled,
  isModelFree,
  isReasoningModelId,
  isVisionModelId,
  isCodeModelId,
  isFastModelId,
} from './aiConfig';

export const ROUTER_TELEMETRY_KEY = 'aicn:aiRouterTelemetry:v1';
const MAX_TELEMETRY_ENTRIES = 40;
const RPM_WINDOW_MS = 60000;

let memoryTelemetry = null;

function readTelemetry() {
  if (memoryTelemetry) return memoryTelemetry;
  try {
    const raw = localStorage.getItem(ROUTER_TELEMETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    memoryTelemetry = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    memoryTelemetry = {};
  }
  return memoryTelemetry;
}

function writeTelemetry(map) {
  memoryTelemetry = map;
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_TELEMETRY_ENTRIES) {
      entries.sort((a, b) => (b[1]?.lastUsedAt || 0) - (a[1]?.lastUsedAt || 0));
      map = Object.fromEntries(entries.slice(0, MAX_TELEMETRY_ENTRIES));
      memoryTelemetry = map;
    }
    localStorage.setItem(ROUTER_TELEMETRY_KEY, JSON.stringify(map));
  } catch {
    // non-fatal in private/sandboxed storage
  }
}

export function clearRouteTelemetry() {
  memoryTelemetry = {};
  try {
    localStorage.removeItem(ROUTER_TELEMETRY_KEY);
  } catch {
    // ignore
  }
}

function routeKey(providerId, modelId) {
  return `${String(providerId || 'unknown')}::${String(modelId || 'default')}`;
}

export function getRouteTelemetry(providerId, modelId) {
  const map = readTelemetry();
  return map[routeKey(providerId, modelId)] || null;
}

/** Record outcome & latency for a (provider, model) pair to adapt future routing. */
export function recordRouteOutcome({
  providerId,
  modelId,
  ok = true,
  ttftMs = null,
  totalMs = null,
  httpStatus = null,
  isEmpty = false,
  isStall = false,
} = {}) {
  if (!providerId || !modelId) return;
  const now = Date.now();
  const map = { ...readTelemetry() };
  const key = routeKey(providerId, modelId);
  const prev = map[key] || {
    ewmaTtftMs: null,
    ewmaTotalMs: null,
    okCount: 0,
    failCount: 0,
    emptyStreak: 0,
    failStreak: 0,
    recentTs: [],
    cooldownUntil: 0,
    lastStatus: 0,
    lastUsedAt: 0,
  };

  const recentTs = (Array.isArray(prev.recentTs) ? prev.recentTs : []).filter(
    ts => now - ts < RPM_WINDOW_MS
  );
  recentTs.push(now);

  const blend = (oldVal, sample) => {
    if (!Number.isFinite(sample) || sample <= 0) return oldVal;
    return oldVal ? Math.round(sample * 0.35 + oldVal * 0.65) : Math.round(sample);
  };

  if (ok) {
    map[key] = {
      ewmaTtftMs: blend(prev.ewmaTtftMs, ttftMs),
      ewmaTotalMs: blend(prev.ewmaTotalMs, totalMs),
      okCount: (prev.okCount || 0) + 1,
      failCount: prev.failCount || 0,
      emptyStreak: 0,
      failStreak: 0,
      recentTs,
      cooldownUntil: 0,
      lastStatus: 200,
      lastUsedAt: now,
    };
  } else {
    const failStreak = (prev.failStreak || 0) + 1;
    const emptyStreak = isEmpty ? (prev.emptyStreak || 0) + 1 : prev.emptyStreak || 0;
    let cooldownMs = 0;

    if (httpStatus === 402 || httpStatus === 404 || httpStatus === 410) {
      cooldownMs = 10 * 60 * 1000;
    } else if (httpStatus === 429) {
      cooldownMs = Math.min(180000, 25000 * Math.pow(2, Math.min(failStreak - 1, 2)));
    } else if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
      cooldownMs = Math.min(90000, 15000 * Math.pow(2, Math.min(failStreak - 1, 2)));
    } else if (isStall) {
      cooldownMs = Math.min(90000, 20000 * failStreak);
    } else if (emptyStreak >= 2) {
      cooldownMs = 45000;
    }

    map[key] = {
      ewmaTtftMs: prev.ewmaTtftMs,
      ewmaTotalMs: prev.ewmaTotalMs,
      okCount: prev.okCount || 0,
      failCount: (prev.failCount || 0) + 1,
      emptyStreak,
      failStreak,
      recentTs,
      cooldownUntil: cooldownMs > 0 ? now + cooldownMs : prev.cooldownUntil || 0,
      lastStatus: httpStatus || (isStall ? 408 : 0),
      lastUsedAt: now,
    };
  }

  writeTelemetry(map);
}

/** Score a candidate (higher = better) based on task affinity, speed, health, and RPM load. */
function scoreCandidate(candidate, task, now) {
  const { providerId, model, isPrimaryProvider, isConfiguredPrimaryModel, affinity = 0 } = candidate;
  const stats = getRouteTelemetry(providerId, model);

  let score = affinity;

  // Give primary provider a preference when healthy; honor configured MODEL_KEY strongly on 'balanced'
  if (isPrimaryProvider) score += 16;
  if (isConfiguredPrimaryModel && (task === 'balanced' || !task)) score += 14;

  if (!stats) {
    return score;
  }

  // Cooldown penalty (effectively pushes cooled-down routes to the end unless everything is down)
  if (stats.cooldownUntil && stats.cooldownUntil > now) {
    const remainingSec = Math.ceil((stats.cooldownUntil - now) / 1000);
    score -= 220 + Math.min(180, remainingSec);
  }

  // Speed bonus from EWMA latency (relevant especially for 'fast' and 'balanced')
  const latency = stats.ewmaTtftMs || stats.ewmaTotalMs;
  if (Number.isFinite(latency) && latency > 0) {
    const speedWeight = task === 'fast' ? 1.4 : task === 'reasoning' ? 0.45 : 0.9;
    if (latency < 1200) score += Math.round(18 * speedWeight);
    else if (latency < 3000) score += Math.round(10 * speedWeight);
    else if (latency > 10000) score -= Math.round(18 * speedWeight);
  }

  // 1-minute RPM load spreading across providers/models
  const recentLoad = (Array.isArray(stats.recentTs) ? stats.recentTs : []).filter(
    ts => now - ts < RPM_WINDOW_MS
  ).length;
  score -= Math.min(45, recentLoad * 6);

  // Rolling error penalty
  const total = (stats.okCount || 0) + (stats.failCount || 0);
  if (total >= 2) {
    const failRate = (stats.failCount || 0) / total;
    score -= Math.round(failRate * 55);
  }

  return score;
}

function getProviderEndpoints(autoFallback) {
  const primary = getDirectConfig();
  if (!primary.key) throw new Error('No API key configured. Set your key in Settings → AI backend.');
  if (!primary.baseUrl) throw new Error('No base URL configured for the selected provider.');

  const primaryPreset = primary.preset || PROVIDERS[primary.providerId] || {};
  const list = [
    {
      providerId: primary.providerId,
      name: primaryPreset.name || primary.providerId,
      baseUrl: primary.baseUrl,
      key: primary.key,
      configuredModel: primary.model,
      configuredReasonModel: getReasonModel(),
      preset: primaryPreset,
      isPrimaryProvider: true,
    },
  ];

  if (autoFallback) {
    for (const fb of getFallbackProviders()) {
      const preset = PROVIDERS[fb.providerId] || {};
      list.push({
        providerId: fb.providerId,
        name: fb.name,
        baseUrl: fb.baseUrl,
        key: fb.key,
        configuredModel: fb.model,
        configuredReasonModel: fb.reasonModel || fb.model,
        preset,
        isPrimaryProvider: false,
      });
    }
  }
  return list;
}

function pickModelsForEndpoint(ep, task) {
  const p = ep.preset || {};
  const catalog = getModelCatalogForProvider(ep.providerId);
  const freeModels = catalog.filter(m => m.free).map(m => m.id);
  const pool = freeModels.length > 0 ? freeModels : catalog.map(m => m.id);

  const candidates = [];
  const push = (modelId, affinity, extra = {}) => {
    const m = String(modelId || '').trim();
    if (!m) return;
    candidates.push({
      providerId: ep.providerId,
      name: ep.name,
      baseUrl: ep.baseUrl,
      key: ep.key,
      model: m,
      isFallback: !ep.isPrimaryProvider,
      isPrimaryProvider: ep.isPrimaryProvider,
      isConfiguredPrimaryModel: ep.isPrimaryProvider && m === ep.configuredModel,
      affinity,
      ...extra,
    });
  };

  if (task === 'fast') {
    const fast = p.fastModel || pool.find(id => isFastModelId(id)) || ep.configuredModel;
    push(fast, 58);
    if (ep.configuredModel && ep.configuredModel !== fast) {
      push(ep.configuredModel, isFastModelId(ep.configuredModel) ? 46 : 24);
    }
  } else if (task === 'code') {
    const code = p.codeModel || pool.find(id => isCodeModelId(id)) || ep.configuredModel;
    push(code, 58);
    if (ep.configuredModel && ep.configuredModel !== code) {
      push(ep.configuredModel, isCodeModelId(ep.configuredModel) ? 46 : 26);
    }
  } else if (task === 'vision') {
    const vis = p.visionModel || pool.find(id => isVisionModelId(id));
    if (vis) push(vis, 62);
    if (isVisionModelId(ep.configuredModel)) {
      push(ep.configuredModel, 50);
    } else if (!vis && ep.isPrimaryProvider) {
      push(ep.configuredModel, 10);
    }
  } else if (task === 'syllabus') {
    const syl =
      p.defaultModel && !isFastModelId(p.defaultModel)
        ? p.defaultModel
        : p.codeModel || ep.configuredModel;
    push(syl, 56);
    if (p.reasonModel && p.reasonModel !== syl) push(p.reasonModel, 38);
    if (ep.configuredModel && ep.configuredModel !== syl) push(ep.configuredModel, 30);
  } else {
    // 'balanced': 1 clean model per provider so errors/402/empty failover directly across saved providers
    push(ep.isPrimaryProvider ? ep.configuredModel : p.defaultModel || ep.configuredModel, 48);
  }

  // Filter out obviously paid models on free-capable providers unless explicitly chosen by user
  return candidates.filter(c => {
    if (c.isConfiguredPrimaryModel) return true;
    if (ep.providerId === 'custom') return true;
    return isModelFree(ep.providerId, c.model) || c.model === p.defaultModel || c.model === p.reasonModel;
  });
}

/**
 * Select an ordered list of direct API candidates for the given task.
 * Guarantees deterministic legacy behavior when smartRouting is OFF or an explicit
 * non-reasoning modelOverride is supplied.
 */
export function selectCandidatesForTask({
  task = 'balanced',
  useReasoning = false,
  modelOverride = null,
  smartRouting = isSmartRoutingEnabled(),
  autoFallback = getAutoFallback(),
} = {}) {
  const effectiveTask = useReasoning ? 'reasoning' : task || 'balanced';
  const endpoints = getProviderEndpoints(autoFallback);
  const primary = endpoints[0];
  const explicitOverride = String(modelOverride || '').trim();

  // Manual pinning or explicit non-reasoning override keeps exact deterministic primary-first order
  if (!smartRouting || (explicitOverride && effectiveTask !== 'reasoning')) {
    const list = [
      {
        providerId: primary.providerId,
        name: primary.name,
        baseUrl: primary.baseUrl,
        key: primary.key,
        model: explicitOverride || (effectiveTask === 'reasoning' ? primary.configuredReasonModel : primary.configuredModel),
        isFallback: false,
        isPrimaryProvider: true,
        degradedFromReasoning: false,
      },
    ];
    for (let i = 1; i < endpoints.length; i++) {
      const fb = endpoints[i];
      list.push({
        providerId: fb.providerId,
        name: fb.name,
        baseUrl: fb.baseUrl,
        key: fb.key,
        model: effectiveTask === 'reasoning' ? fb.configuredReasonModel : fb.configuredModel,
        isFallback: true,
        isPrimaryProvider: false,
        degradedFromReasoning: false,
      });
    }
    return list;
  }

  const now = Date.now();
  const seen = new Set();
  const dedupePush = (target, c) => {
    const key = `${c.baseUrl}::${c.model}`;
    if (!c.model || seen.has(key)) return;
    seen.add(key);
    target.push(c);
  };

  // Balanced Deep Think Cascade:
  // Tier 1 = Reasoning models (primary reasonModel -> same-provider reasoning backups -> other providers' reasoning models)
  // Tier 2 = Graceful degradation to strongest fast/balanced non-thinking models (marked degradedFromReasoning: true)
  if (effectiveTask === 'reasoning') {
    const tier1 = [];
    const tier2 = [];

    for (const ep of endpoints) {
      const p = ep.preset || {};
      const primaryReason =
        ep.isPrimaryProvider && explicitOverride
          ? explicitOverride
          : ep.configuredReasonModel || p.reasonModel;
      if (primaryReason) {
        tier1.push({
          providerId: ep.providerId,
          name: ep.name,
          baseUrl: ep.baseUrl,
          key: ep.key,
          model: primaryReason,
          isFallback: !ep.isPrimaryProvider,
          isPrimaryProvider: ep.isPrimaryProvider,
          isConfiguredPrimaryModel: ep.isPrimaryProvider,
          affinity: ep.isPrimaryProvider ? 56 : 44,
          degradedFromReasoning: false,
        });
      }

      // Intra-provider secondary reasoning models (so even 1-key users get Deep Think fallback!)
      const catalog = getModelCatalogForProvider(ep.providerId);
      for (const entry of catalog) {
        if (!entry.reasoning || entry.id === primaryReason) continue;
        if (!entry.free && ep.providerId !== 'custom') continue;
        tier1.push({
          providerId: ep.providerId,
          name: ep.name,
          baseUrl: ep.baseUrl,
          key: ep.key,
          model: entry.id,
          isFallback: true,
          isPrimaryProvider: ep.isPrimaryProvider,
          isConfiguredPrimaryModel: false,
          affinity: ep.isPrimaryProvider ? 36 : 30,
          degradedFromReasoning: false,
        });
      }

      // Tier 2 graceful degradation to strong fast/balanced model
      const fastOrBalanced = ep.configuredModel || p.defaultModel || p.fastModel;
      if (fastOrBalanced && fastOrBalanced !== primaryReason) {
        tier2.push({
          providerId: ep.providerId,
          name: ep.name,
          baseUrl: ep.baseUrl,
          key: ep.key,
          model: fastOrBalanced,
          isFallback: true,
          isPrimaryProvider: ep.isPrimaryProvider,
          isConfiguredPrimaryModel: false,
          affinity: ep.isPrimaryProvider ? 24 : 16,
          degradedFromReasoning: true,
        });
      }
    }

    tier1.sort((a, b) => scoreCandidate(b, 'reasoning', now) - scoreCandidate(a, 'reasoning', now));
    tier2.sort((a, b) => scoreCandidate(b, 'balanced', now) - scoreCandidate(a, 'balanced', now));

    const out = [];
    for (const c of tier1) dedupePush(out, c);
    for (const c of tier2) dedupePush(out, c);
    return out;
  }

  // Standard Task Routing ('fast' | 'balanced' | 'code' | 'syllabus' | 'vision')
  const raw = [];
  for (const ep of endpoints) {
    raw.push(...pickModelsForEndpoint(ep, effectiveTask));
  }

  // On cold start with balanced task, ensure primary's configured model stays candidate #1 unless it is on cooldown
  raw.sort((a, b) => scoreCandidate(b, effectiveTask, now) - scoreCandidate(a, effectiveTask, now));

  const out = [];
  for (const c of raw) {
    dedupePush(out, { ...c, degradedFromReasoning: false });
  }
  if (out.length === 0) {
    out.push({
      providerId: primary.providerId,
      name: primary.name,
      baseUrl: primary.baseUrl,
      key: primary.key,
      model: primary.configuredModel,
      isFallback: false,
      isPrimaryProvider: true,
      degradedFromReasoning: false,
    });
  }
  return out;
}
