/**
 * Local development server.
 * Serves the Vite build and relays /api/scan to the AI.
 * Run: node server.js   (port 3002; Vite proxies /api to it)
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanNote } from './lib/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));

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

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] AI proxy -> ${process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:3001/v1'}`);
});