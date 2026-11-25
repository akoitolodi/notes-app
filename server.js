/**
 * Local / Termux backend server.
 * Serves the Vite build and relays /api/* to the configured OpenAI-compatible AI provider.
 *
 * Security defaults:
 * - Binds to 127.0.0.1 by default (set HOST=0.0.0.0 explicitly if you want LAN access).
 * - Restricts CORS to localhost/127.0.0.1/capacitor origins (override with CORS_ORIGIN).
 * - Loads .env automatically on Node 18+ without overwriting existing environment vars.
 */
import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanNote, chat, chatStream, validateChatMessages, getAiConfigStatus } from './lib/ai.js';
import { scanLine } from './lib/scanLine.js';
import { examSummary } from './lib/examSummary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Zero-dependency .env loader (compatible with Node 18+)
function loadDotEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('[server] Could not read .env:', err.message);
  }
}
loadDotEnv();

const app = express();

// Restrict CORS to local/Capacitor origins by default (override via CORS_ORIGIN env)
const LOCAL_ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/i;
const customCors = (process.env.CORS_ORIGIN || '').trim();
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl / CapacitorHttp native
      if (customCors === '*') return cb(null, true);
      if (customCors && customCors.split(',').map(s => s.trim()).includes(origin)) {
        return cb(null, true);
      }
      if (LOCAL_ORIGIN_RE.test(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '10mb' }));

// Light in-memory rate limiter (120 API requests / min per IP)
const rateMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'local';
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count += 1;
  rateMap.set(ip, entry);
  if (entry.count > 120) {
    return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
  }
  return next();
}
app.use('/api', rateLimit);

app.get('/api/health', (_req, res) => {
  return res.json(getAiConfigStatus());
});

app.post('/api/scan', async (req, res) => {
  try {
    const { note, subject, changedLines, style } = req.body || {};
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'Missing "note" string in request body' });
    }
    const result = await scanNote({
      note,
      subject: subject || 'General',
      changedLines,
      style: style || 'default',
    });
    return res.json(result);
  } catch (err) {
    console.error('[api/scan] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

app.post('/api/scan-line', async (req, res) => {
  try {
    const { note, line, request, style } = req.body || {};
    if (!line || typeof line !== 'string' || !line.trim()) {
      return res.status(400).json({ error: 'Missing "line" string in request body' });
    }
    const result = await scanLine({
      note: note || '',
      line,
      request: request || 'simpler',
      style: style || 'default',
    });
    return res.json(result);
  } catch (err) {
    console.error('[api/scan-line] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

app.post('/api/exam-summary', async (req, res) => {
  try {
    const { subject, notes, style } = req.body || {};
    if (!Array.isArray(notes) || notes.length === 0) {
      return res.status(400).json({ error: 'Missing "notes" array in request body' });
    }
    const result = await examSummary({
      subject: subject || 'General',
      notes,
      style: style || 'default',
    });
    return res.json(result);
  } catch (err) {
    console.error('[api/exam-summary] error:', err);
    return res.status(500).json({ error: err.message || 'Exam summary failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, maxTokens, modelOverride } = req.body || {};
    validateChatMessages(messages);
    const content = await chat({ messages, maxTokens, modelOverride });
    return res.json({ content });
  } catch (err) {
    const status = /chat:/.test(err?.message || '') ? 400 : 500;
    console.error('[api/chat] error:', err);
    return res.status(status).json({ error: err.message || 'Chat failed' });
  }
});

app.post('/api/chat-stream', async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    const { messages, maxTokens, modelOverride } = req.body || {};
    validateChatMessages(messages);
    const upstream = await chatStream({
      messages,
      maxTokens,
      modelOverride,
      signal: controller.signal,
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body?.getReader?.();
    if (!reader) {
      res.end();
      return;
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    if (err?.name === 'AbortError') return res.end();
    console.error('[api/chat-stream] error:', err);
    if (!res.headersSent) {
      const status = /chat:/.test(err?.message || '') ? 400 : 500;
      return res.status(status).json({ error: err.message || 'Stream failed' });
    }
    res.write(`data: ${JSON.stringify({ error: err.message || 'Stream failed' })}\n\n`);
    res.end();
  }
});

// Optional Grammarly EDU / Enterprise Writing Score API relay (avoids browser CORS blocks)
app.post('/api/grammar', async (req, res) => {
  try {
    const { text, clientId, clientSecret, token } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }
    let accessToken = typeof token === 'string' ? token.trim() : '';
    if (!accessToken) {
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Provide Grammarly Client ID & Secret or Bearer token.' });
      }
      const tokenBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: String(clientId).trim(),
        client_secret: String(clientSecret).trim(),
        scope: 'scores-api:read,scores-api:write',
      });
      const tokRes = await fetch('https://auth.grammarly.com/v4/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });
      if (!tokRes.ok) {
        const msg = await tokRes.text().catch(() => '');
        return res.status(tokRes.status).json({
          error: `Grammarly auth failed (${tokRes.status}): ${msg.slice(0, 120)}`,
        });
      }
      const tokData = await tokRes.json();
      accessToken = tokData.access_token || '';
    }
    if (!accessToken) {
      return res.status(401).json({ error: 'No Grammarly access token returned.' });
    }
    const scoreRes = await fetch('https://api.grammarly.com/ecosystem/api/v2/scores', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text.slice(0, 10000) }),
    });
    if (!scoreRes.ok) {
      const msg = await scoreRes.text().catch(() => '');
      return res.status(scoreRes.status).json({
        error: `Grammarly Writing Score API HTTP ${scoreRes.status}: ${msg.slice(0, 140)}`,
      });
    }
    const scoreData = await scoreRes.json();
    return res.json({ score: scoreData });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Grammarly relay failed' });
  }
});

// Canvas LMS (.ics Calendar Feed, RSS Announcements, or optional API) local CORS relay for Web/Desktop
app.post('/api/canvas-proxy', async (req, res) => {
  try {
    const { url, token, method, body } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing Canvas URL' });
    }
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: 'Invalid Canvas URL' });
    }
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Canvas URL must use https://' });
    }
    // Block loopback/private IPs to prevent SSRF
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) {
      return res.status(403).json({ error: 'Private network hosts are not allowed in Canvas proxy' });
    }
    const reqMethod = String(method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    if (reqMethod === 'POST') {
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(401).json({ error: 'Canvas Access Token is required for posting replies' });
      }
      if (!/^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/entries$/.test(parsed.pathname)) {
        return res.status(403).json({ error: 'Unsupported Canvas POST endpoint' });
      }
    }
    const headers = {
      Accept: 'text/calendar, application/rss+xml, application/atom+xml, application/json, text/plain, */*',
      'User-Agent': 'Notes-by-Bai/2.1',
    };
    if (token && typeof token === 'string' && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    const fetchOpts = { method: reqMethod, headers };
    if (reqMethod === 'POST') {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify({ message: String(body?.message || '') });
    }
    const upstreamCtrl = new AbortController();
    const upstreamTimer = setTimeout(() => upstreamCtrl.abort(), 35000);
    let upstream;
    try {
      upstream = await fetch(parsed.toString(), { ...fetchOpts, signal: upstreamCtrl.signal });
    } finally {
      clearTimeout(upstreamTimer);
    }
    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Canvas returned HTTP ${upstream.status}: ${text.slice(0, 140)}`,
      });
    }
    return res.json({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'text/plain',
      body: text,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Canvas proxy failed' });
  }
});

// Zero-Cloud Local Wi-Fi PC <-> Phone Sync Hub (never stores Hidden Vault or Passwords & Keys)
const LAN_SYNC_FILE = join(__dirname, '.baidrop-lan-sync.json');
function readLanBundle() {
  try {
    if (existsSync(LAN_SYNC_FILE)) {
      return JSON.parse(readFileSync(LAN_SYNC_FILE, 'utf8'));
    }
  } catch {
    // ignore corrupt cache
  }
  return { updatedAt: 0, folders: [], notes: [], plannerItems: [], classSchedule: [] };
}

app.get('/api/lan-sync', (_req, res) => {
  return res.json(readLanBundle());
});

app.post('/api/lan-sync', (req, res) => {
  try {
    const incoming = req.body || {};
    const existing = readLanBundle();

    const mergeByKey = (baseArr = [], incArr = [], keyFn) => {
      const map = new Map();
      for (const item of baseArr) {
        if (!item) continue;
        map.set(keyFn(item), item);
      }
      for (const item of incArr) {
        if (!item) continue;
        const k = keyFn(item);
        const prev = map.get(k);
        if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) {
          map.set(k, item);
        }
      }
      return [...map.values()];
    };

    // Defensive filter: never accept locked / vault folders or notes on LAN sync!
    const safeFolders = (incoming.folders || []).filter(f => f && !f.locked && !f.isSystemVault && f.mode !== 'vault');
    const safeNotes = (incoming.notes || []).filter(n => n && n.mode !== 'vault');

    const merged = {
      updatedAt: Date.now(),
      folders: mergeByKey(existing.folders, safeFolders, f => String(f.name || f.id).toLowerCase()),
      notes: mergeByKey(existing.notes, safeNotes, n => `${n.folderName || 'General'}::${n.title || ''}::${n.createdAt || 0}`),
      plannerItems: mergeByKey(existing.plannerItems, incoming.plannerItems || [], p => p.externalUid || `${p.dateKey}::${p.title}`),
      classSchedule: mergeByKey(existing.classSchedule, incoming.classSchedule || [], c => `${c.dayOfWeek}::${c.startTime}::${c.subject}`),
    };

    writeFileSync(LAN_SYNC_FILE, JSON.stringify(merged), 'utf8');
    return res.json(merged);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'LAN sync failed' });
  }
});

// Serve built frontend
const distDir = join(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  const indexHtml = join(distDir, 'index.html');
  if (existsSync(indexHtml)) return res.sendFile(indexHtml);
  return res.status(404).send('Frontend not built yet. Run: npm run build');
});

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
  console.log(`[server] AI proxy -> ${process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1'}`);
});
// Allow long-running AI requests (up to ~8 min for big notes)
server.requestTimeout = 540000;
server.headersTimeout = 550000;
