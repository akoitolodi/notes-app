/**
 * Serverless function: /api/scan — full-note AI scan.
 */
import { scanNote } from '../lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/scan] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}
