import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isThinkingModel,
  computeEffectiveMaxTokens,
  extractUsableText,
  aiText,
} from '../src/lib/aiCore.js';
import { MODE_KEY, PROVIDER_KEY, KEYS_KEY, MODEL_KEY, BASEURL_KEY, FALLBACK_KEY } from '../src/lib/aiConfig.js';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('aiCore Zero-Empty-Response & Thinking Budget Resilience', () => {
  beforeEach(() => {
    memStore.clear();
    vi.restoreAllMocks();
  });

  it('detects thinking/reasoning models and boosts max_tokens headroom', () => {
    expect(isThinkingModel('deepseek/deepseek-r1:free')).toBe(true);
    expect(isThinkingModel('nvidia/nemotron-3.5-super-vl-120b-a12b')).toBe(true);
    expect(isThinkingModel('gemini-2.5-pro')).toBe(true);
    expect(isThinkingModel('qwen/qwen3-32b')).toBe(true);
    expect(isThinkingModel('llama-3.1-8b-instant')).toBe(false);

    // Non-thinking model preserves small requested budget
    expect(computeEffectiveMaxTokens('llama-3.1-8b-instant', 550, false, false)).toBe(550);
    // Thinking model automatically boosts small budget to at least 4096
    expect(computeEffectiveMaxTokens('deepseek/deepseek-r1:free', 550, false, false)).toBe(4096);
    // Retry boost doubles / guarantees at least 8192
    expect(computeEffectiveMaxTokens('deepseek/deepseek-r1:free', 550, true, true)).toBe(8192);
  });

  it('extracts visible text cleanly and recovers final answer from reasoning_content only when fallback enabled', () => {
    expect(extractUsableText('<think>internal steps</think>Final visible answer')).toBe('Final visible answer');
    // Unclosed <think> yields empty on first pass so caller triggers retry with larger budget
    expect(extractUsableText('<think>still thinking without closing', '')).toBe('');
    // Last-resort fallback extracts the concluding answer cleanly
    expect(
      extractUsableText('', 'Step 1: analyze.\nFinal Answer: O(n log n) average time complexity.', {
        allowReasoningFallback: true,
      })
    ).toBe('O(n log n) average time complexity.');
  });

  it('automatically retries with boosted tokens and fails over when primary returns empty content', async () => {
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'groq');
    localStorage.setItem(BASEURL_KEY, 'https://api.groq.com/openai/v1');
    localStorage.setItem(MODEL_KEY, 'qwen/qwen3-32b');
    localStorage.setItem(FALLBACK_KEY, 'true');
    localStorage.setItem(KEYS_KEY, JSON.stringify({ groq: 'gsk_primary', gemini: 'AIza_backup' }));

    const seenBudgets = [];
    const fetchMock = vi.fn(async (url, opts) => {
      const payload = JSON.parse(opts.body);
      seenBudgets.push({ url, max_tokens: payload.max_tokens });
      // Primary returns empty content twice (simulated mid-thought truncation)
      if (url.includes('groq.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '', reasoning_content: 'thinking...' } }],
          }),
        };
      }
      // Backup Gemini succeeds cleanly
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Recovered from backup provider!' } }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await aiText({ system: 'sys', user: 'hello', maxTokens: 550 });
    expect(out).toBe('Recovered from backup provider!');
    // Attempt 1 boosted to 4096, attempt 2 boosted to 8192, then failed over to Gemini
    expect(seenBudgets[0].max_tokens).toBe(4096);
    expect(seenBudgets[1].max_tokens).toBe(8192);
    expect(seenBudgets[2].url).toContain('generativelanguage.googleapis.com');
  });
});
