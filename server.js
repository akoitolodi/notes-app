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
import { existsSync, readFileSync } from 'node:fs';
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
