/**
 * Serverless function: /api/exam-summary — generate a study pack from a folder.
 */
import { examSummary } from '../lib/examSummary.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
    return res.status(200).json(result);
  } catch (err) {
    console.error('[api/exam-summary] error:', err);
    return res.status(500).json({ error: err.message || 'Exam summary failed' });
  }
}
