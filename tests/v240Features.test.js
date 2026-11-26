import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractPreCodeText, cleanHtmlToMarkdown } from '../src/lib/richEditorCodec';
import {
  PROVIDERS,
  isModelFree,
  isReasoningModelId,
  fetchLiveModelsForProvider,
  getModelCatalogForProvider,
  MODE_KEY,
  PROVIDER_KEY,
  MODEL_KEY,
  BASEURL_KEY,
  setKeyForProvider,
} from '../src/lib/aiConfig';
import { explainSnippetFast } from '../src/lib/aiDirect';
import { aiText } from '../src/lib/aiCore';
import {
  base64ToAudioBlob,
  hasNativeAndroidRecorder,
  startLectureAudioRecording,
} from '../src/lib/lectureRecorder';
import { createDictationSession } from '../src/lib/voiceDictation';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

function txt(nodeValue) {
  return { nodeType: 3, nodeValue };
}
function el(tagName, childNodes = [], { dataset = {}, classList = [] } = {}) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes,
    children: childNodes.filter(c => c.nodeType === 1),
    dataset,
    classList: { contains: cls => classList.includes(cls) },
  };
}

describe('v2.4.0 Code Wrap Newlines, Free/Reasoning Models, DeepSeek, Fast Selection Explain & Native Voice', () => {
  const origFetch = globalThis.fetch;
  const origWindow = globalThis.window;

  beforeEach(() => {
    memStore.clear();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = origWindow;
    }
  });

  it('extractPreCodeText preserves exact newlines and quotes across div/p/br nodes without doubling lines', () => {
    // 1. Android WebView <div> lines inside <pre><code>
    const preDivs = el(
      'pre',
      [
        el('code', [
          el('div', [txt('#include <stdio.h>')]),
          el('div', [txt('int main() {')]),
          el('div', [txt(`printf("Hello 'world'");`)]),
          el('div', [txt('}')]),
        ]),
      ],
      { dataset: { lang: 'c' } }
    );
    const extracted = extractPreCodeText(preDivs);
    expect(extracted).toBe('#include <stdio.h>\nint main() {\nprintf("Hello \'world\'");\n}');

    // 2. Intentional blank line (<div><br></div>) stays single blank line
    const preWithBlank = el('pre', [
      el('code', [
        el('div', [txt('#include <stdio.h>')]),
        el('div', [el('br')]),
        el('div', [txt('int main() { return 0; }')]),
      ]),
    ]);
    expect(extractPreCodeText(preWithBlank)).toBe('#include <stdio.h>\n\nint main() { return 0; }');

    // 3. <br> separated lines and quotes inside cleanHtmlToMarkdown
    const root = el('div', [
      el(
        'pre',
        [
          el('code', [
            txt('#include <stdio.h>'),
            el('br'),
            txt(`printf("it's ok");`),
          ]),
        ],
        { dataset: { lang: 'c' } }
      ),
    ]);
    expect(cleanHtmlToMarkdown(root)).toBe('```c\n#include <stdio.h>\nprintf("it\'s ok");\n```');

    // 4. Empty / null input safety
    expect(extractPreCodeText(null)).toBe('');
    expect(extractPreCodeText(el('pre', []))).toBe('');
  });

  it('registers DeepSeek, SambaNova, GitHub Models & HuggingFace and classifies Free vs Paid + Reasoning models', async () => {
    expect(PROVIDERS.deepseek.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(PROVIDERS.deepseek.defaultModel).toBe('deepseek-chat');
    expect(PROVIDERS.deepseek.reasonModel).toBe('deepseek-reasoner');
    expect(PROVIDERS.sambanova.free).toBe(true);
    expect(PROVIDERS.github.free).toBe(true);
    expect(PROVIDERS.huggingface.free).toBe(true);
    expect(PROVIDERS.mistral.reasonModel).toBe('magistral-small-latest');

    // Free vs Paid classification
    expect(isModelFree('openrouter', 'deepseek/deepseek-r1:free')).toBe(true);
    expect(isModelFree('openrouter', 'openai/gpt-4o', { pricing: { prompt: '0.005', completion: '0.015' } })).toBe(false);
    expect(isModelFree('openrouter', 'custom/zero-cost', { pricing: { prompt: '0', completion: '0' } })).toBe(true);
    expect(isModelFree('mistral', 'mistral-small-latest')).toBe(true);
    expect(isModelFree('mistral', 'magistral-small-latest')).toBe(true);
    expect(isModelFree('mistral', 'mistral-large-latest')).toBe(false);
    expect(isModelFree('deepseek', 'deepseek-chat')).toBe(false);

    // Reasoning model classification
    expect(isReasoningModelId('deepseek-reasoner')).toBe(true);
    expect(isReasoningModelId('deepseek/deepseek-r1:free')).toBe(true);
    expect(isReasoningModelId('qwen/qwen3-32b')).toBe(true);
    expect(isReasoningModelId('magistral-small-latest')).toBe(true);
    expect(isReasoningModelId('o4-mini')).toBe(true);
    expect(isReasoningModelId('llama-3.3-70b-versatile')).toBe(false);

    // Live model fetch sorts FREE models first & caches pricing/reasoning metadata
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'anthropic/claude-opus-paid', pricing: { prompt: '0.015', completion: '0.075' } },
          { id: 'meta-llama/llama-3.3-70b:free', pricing: { prompt: '0', completion: '0' } },
          { id: 'deepseek/deepseek-r1:free', pricing: { prompt: '0', completion: '0' } },
        ],
      }),
    });
    const fetched = await fetchLiveModelsForProvider('openrouter', { key: 'sk-test' });
    const catalog = getModelCatalogForProvider('openrouter');
    expect(fetched.indexOf('meta-llama/llama-3.3-70b:free')).toBeLessThan(
      fetched.indexOf('anthropic/claude-opus-paid')
    );
    const paidEntry = catalog.find(c => c.id === 'anthropic/claude-opus-paid');
    const freeReasonEntry = catalog.find(c => c.id === 'deepseek/deepseek-r1:free');
    expect(paidEntry?.free).toBe(false);
    expect(freeReasonEntry?.free).toBe(true);
    expect(freeReasonEntry?.reasoning).toBe(true);
  });

  it('gives clear HTTP 402 guidance and fails over to backup provider on billing error', async () => {
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'mistral');
    localStorage.setItem(BASEURL_KEY, PROVIDERS.mistral.baseUrl);
    localStorage.setItem(MODEL_KEY, 'mistral-large-latest');
    setKeyForProvider('mistral', 'mistral-key');
    setKeyForProvider('groq', 'groq-backup-key');

    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async url => {
      calls += 1;
      if (String(url).includes('mistral.ai')) {
        return {
          ok: false,
          status: 402,
          text: async () => '{"type":"billing_no_api_budget_configured"}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Backup succeeded!' } }],
        }),
      };
    });

    const out = await aiText({ system: 's', user: 'hi', maxTokens: 40 });
    expect(out).toBe('Backup succeeded!');
    expect(calls).toBe(2);

    // Without backup key, HTTP 402 error message advises picking a FREE model
    setKeyForProvider('groq', '');
    await expect(aiText({ system: 's', user: 'hi', maxTokens: 40 })).rejects.toThrow(/HTTP 402.*FREE model/i);
  });

  it('explainSnippetFast sends compact local context window for partial selection & cleans output', async () => {
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'groq');
    localStorage.setItem(BASEURL_KEY, PROVIDERS.groq.baseUrl);
    localStorage.setItem(MODEL_KEY, 'llama-3.3-70b-versatile');
    setKeyForProvider('groq', 'groq-test');

    let capturedBody = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  explanation: '**Mutex** prevents race conditions by allowing one thread at a time.',
                  terms: [{ term: '**Mutex**', meaning: 'Mutual exclusion lock' }],
                }),
              },
            },
          ],
        }),
      };
    });

    const hugeNote = `${'A'.repeat(3000)}\nOperating systems use a mutex lock to guard critical sections.\n${'B'.repeat(3000)}`;
    const res = await explainSnippetFast({
      note: hugeNote,
      targetText: 'mutex lock',
      subject: 'OS',
      isPartial: true,
    });

    expect(res.explanation).not.toContain('**');
    expect(res.explanation).toContain('Mutex prevents race conditions');
    expect(res.terms[0].term).toBe('Mutex');
    expect(res.terms[0].definition).toBe('Mutual exclusion lock');
    const userMsg = capturedBody.messages.find(m => m.role === 'user').content;
    expect(userMsg).toContain('Selected phrase to explain ONLY');
    expect(userMsg.length).toBeLessThan(1200);

    // Edge case: empty target throws cleanly
    await expect(explainSnippetFast({ note: hugeNote, targetText: '   ' })).rejects.toThrow();
  });

  it('uses native Android BaiNativeRecorder when available and flushes trailing interim dictation on stop/pause', async () => {
    // 1. base64ToAudioBlob edge cases
    expect(base64ToAudioBlob('').size).toBe(0);
    const sampleBlob = base64ToAudioBlob(btoa('hello-m4a'), 'audio/mp4');
    expect(sampleBlob.size).toBe(9);
    expect(sampleBlob.type).toBe('audio/mp4');

    // 2. Native Android recorder bridge lifecycle (start -> flushChunk -> stop)
    let cancelled = false;
    globalThis.window = {
      BaiNativeRecorder: {
        start: () => {
          setTimeout(() => globalThis.window.__baiRecorderCallback?.('started', ''), 0);
        },
        flushChunk: () => btoa('chunk-1-audio'),
        stop: () => btoa('final-audio-tail'),
        cancel: () => {
          cancelled = true;
        },
      },
    };
    expect(hasNativeAndroidRecorder()).toBe(true);
    const rec = await startLectureAudioRecording();
    expect(rec.isNative).toBe(true);
    const c1 = rec.flushChunk();
    expect(c1.size).toBe('chunk-1-audio'.length);
    const tail = await rec.stop();
    expect(tail.size).toBe('final-audio-tail'.length);
    rec.cancel();
    expect(cancelled).toBe(true);

    // 3. Native Android speech dictation flushes pending interim words on pause & stop
    const finals = [];
    const interims = [];
    globalThis.window = {
      BaiNativeSpeech: {
        isAvailable: () => true,
        start: () => {},
        stop: () => {},
      },
    };
    const sess = createDictationSession({
      lang: 'en-US',
      onFinal: t => finals.push(t),
      onInterim: t => interims.push(t),
    });
    await sess.start();
    globalThis.window.__baiSpeechCallback('interim', 'teacher said exam is on friday');
    sess.pause();
    expect(finals).toEqual(['teacher said exam is on friday']);

    sess.resume();
    globalThis.window.__baiSpeechCallback('interim', 'chapter four pointers');
    sess.stop();
    expect(finals).toEqual(['teacher said exam is on friday', 'chapter four pointers']);
  });

  it('verifies AndroidManifest.xml and MainActivity.java native audio recorder & continuous speech fixes', () => {
    const manifest = fs.readFileSync(
      path.resolve('android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    expect(manifest).toContain('android.permission.RECORD_AUDIO');
    expect(manifest).toContain('android.permission.MODIFY_AUDIO_SETTINGS');

    const mainJava = fs.readFileSync(
      path.resolve('android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    expect(mainJava).toContain('BaiNativeRecorder');
    expect(mainJava).toContain('REQ_RECORDER_AUDIO');
    expect(mainJava).toContain('flushPendingSpeechPartial');
    expect(mainJava).toContain('EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS');
  });
});
