/**
 * Local development server.
 * Serves the Vite build and relays /api/scan to the AI.
 * Run: node server.js   (port 3002; Vite proxies /api to it)
 */
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanNote } from './lib/ai.js';
import { scanLine } from './lib/scanLine.js';
import { examSummary } from './lib/examSummary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors()); // Allow all cross-origin requests
app.use(express.json({ limit: '10mb' }));

app.post('/api/scan', async (req, res) => {
  try {
    const { note, subject, changedLines } = req.body || {};
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'Missing "note" string in request body' });
    }
    const result = await scanNote({ note, subject: subject || 'General', changedLines });
    return res.json(result);
  } catch (err) {
    console.error('[api/scan] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

app.post('/api/scan-line', async (req, res) => {
  try {
    const { note, line, request } = req.body || {};
    if (!line || !line.trim()) {
      return res.status(400).json({ error: 'Missing "line" string in request body' });
    }
    const result = await scanLine({ note: note || '', line, request: request || 'simpler' });
    return res.json(result);
  } catch (err) {
    console.error('[api/scan-line] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

app.post('/api/exam-summary', async (req, res) => {
  try {
    const { subject, notes } = req.body || {};
    if (!Array.isArray(notes) || notes.length === 0) {
      return res.status(400).json({ error: 'Missing "notes" array in request body' });
    }
    const result = await examSummary({ subject: subject || 'General', notes });
    return res.json(result);
  } catch (err) {
    console.error('[api/exam-summary] error:', err);
    return res.status(500).json({ error: err.message || 'Exam summary failed' });
  }
});

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

const port = process.env.PORT || 8080;
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
  console.log(`[server] AI proxy -> ${process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1'}`);
});
// Allow long-running AI requests (up to ~8 min for big notes)
server.requestTimeout = 540000;   // 9 min
server.headersTimeout = 550000;   // slightly higher