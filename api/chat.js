/**
 * Serverless function: /api/chat — multi-message chat / study tools / vision.
 */
import { chat, validateChatMessages } from '../lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { messages, maxTokens, modelOverride } = req.body || {};
    validateChatMessages(messages);
    const content = await chat({ messages, maxTokens, modelOverride });
    return res.status(200).json({ content });
  } catch (err) {
    const status = /chat:/.test(err?.message || '') ? 400 : 500;
    console.error('[api/chat] error:', err);
    return res.status(status).json({ error: err.message || 'Chat failed' });
  }
}
