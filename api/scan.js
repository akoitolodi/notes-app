/**
 * Serverless function entrypoint (Vercel / Cloudflare Workers style).
 * Deploy this as a single function; the frontend calls it, never the AI directly.
 *
 * Local dev: proxied from Vite to node server.js (same handler).
 */
import { scanNote } from '../../lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { note, subject, changedLines } = req.body || {};
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'Missing "note" string in request body' });
    }
    const result = await scanNote({ note, subject: subject || 'General', changedLines });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/scan] error:', err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}