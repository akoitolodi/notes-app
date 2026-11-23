/**
 * Serverless function: /api/scan-line — per-line re-scan (simpler/example).
 */
import { scanLine } from '../lib/scanLine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/scan-line] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}
