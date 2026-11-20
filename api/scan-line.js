/**
 * Serverless function: /api/scan-line — per-line re-scan (simpler/example).
 * Separate file so file-based routing (Vercel) maps it correctly.
 */
import { scanLine } from '../../lib/scanLine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { note, line, request } = req.body || {};
    if (!line || !line.trim()) {
      return res.status(400).json({ error: 'Missing "line" string in request body' });
    }
    const result = await scanLine({ note: note || '', line, request: request || 'simpler' });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/scan-line] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}