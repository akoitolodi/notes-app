import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PROVIDERS,
  MODE_KEY,
  PROVIDER_KEY,
  MODEL_KEY,
  BASEURL_KEY,
  FALLBACK_KEY,
  SMART_ROUTING_KEY,
  getProviderId,
  getDirectConfig,
  setKeyForProvider,
  setSmartRoutingEnabled,
} from '../src/lib/aiConfig';
import {
  selectCandidatesForTask,
  recordRouteOutcome,
  clearRouteTelemetry,
} from '../src/lib/aiRouter';
import { aiText, aiTextStream } from '../src/lib/aiCore';
import { detectRawCode } from '../src/lib/smartNoteDetect';
import {
  evaluateFormulaSafe,
  normalizeSyllabusData,
  scoreSourceRelevance,
} from '../src/lib/syllabusEngine';
import {
  db,
  ensureSeeded,
  createFolder,
  createNote,
  getHomeSummary,
  saveSyllabus,
  updateSyllabusTopicState,
  getSyllabusTopicCache,
  putSyllabusTopicCache,
} from '../src/store/db';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('v2.5.0 Free-Only Cleanup, BAI-Route Task Router, Full-Block Code Wrap & Syllabus Studio', () => {
  beforeEach(async () => {
    memStore.clear();
    clearRouteTelemetry();
    vi.restoreAllMocks();
    await db.folders.clear();
    await db.notes.clear();
    await db.syllabi.clear();
    await db.syllabusTopicCache.clear();
    await ensureSeeded();
  });

  it('removes paid-only presets (openai, deepseek), keeps custom, and migrates legacy provider selection safely', () => {
    expect(PROVIDERS.openai).toBeUndefined();
    expect(PROVIDERS.deepseek).toBeUndefined();
    expect(PROVIDERS.custom).toBeDefined();

    // Legacy user had 'deepseek' selected while also holding a 'gemini' key -> auto-migrates to 'gemini'
    localStorage.setItem(PROVIDER_KEY, 'deepseek');
    setKeyForProvider('gemini', 'AIza_free_key');
    expect(getProviderId()).toBe('gemini');
    expect(getDirectConfig().baseUrl).toContain('generativelanguage.googleapis.com');
  });

  it('BAI-Route picks task-appropriate models on a single key, spreads load/cooldowns, and respects manual pin toggle', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'groq');
    localStorage.setItem(BASEURL_KEY, PROVIDERS.groq.baseUrl);
    localStorage.setItem(MODEL_KEY, 'llama-3.3-70b-versatile');
    setKeyForProvider('groq', 'gsk_main');
    setKeyForProvider('gemini', 'AIza_second');

    // Fast task chooses fastModel first; code task chooses codeModel; vision picks visionModel
    const fastCands = selectCandidatesForTask({ task: 'fast' });
    expect(fastCands[0].model).toBe('llama-3.1-8b-instant');

    const codeCands = selectCandidatesForTask({ task: 'code' });
    expect(codeCands[0].model).toBe('qwen/qwen3-32b');

    const visionCands = selectCandidatesForTask({ task: 'vision' });
    expect(visionCands.some(c => /scout|gemini-2\.5-flash/i.test(c.model))).toBe(true);

    // 429 cooldown pushes groq fast model behind gemini backup
    recordRouteOutcome({ providerId: 'groq', modelId: 'llama-3.1-8b-instant', ok: false, httpStatus: 429 });
    const after429 = selectCandidatesForTask({ task: 'fast' });
    expect(after429[0].providerId).toBe('gemini');

    // Manual pin (Smart Routing OFF) strictly honors primary configured model
    setSmartRoutingEnabled(false);
    expect(localStorage.getItem(SMART_ROUTING_KEY)).toBe('false');
    const pinned = selectCandidatesForTask({ task: 'fast' });
    expect(pinned[0].providerId).toBe('groq');
    expect(pinned[0].model).toBe('llama-3.3-70b-versatile');
  });

  it('Deep Think Balanced Cascade auto-switches from stalled/unavailable reasoning model to backup & fast reasoning-boosted fallback', async () => {
    localStorage.setItem(MODE_KEY, 'direct');
    localStorage.setItem(PROVIDER_KEY, 'groq');
    localStorage.setItem(BASEURL_KEY, PROVIDERS.groq.baseUrl);
    localStorage.setItem(MODEL_KEY, 'llama-3.3-70b-versatile');
    localStorage.setItem(FALLBACK_KEY, 'true');
    setKeyForProvider('groq', 'gsk_only');

    const calledModels = [];
    const systemPrompts = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, opts) => {
        const body = JSON.parse(opts.body);
        calledModels.push(body.model);
        systemPrompts.push(body.messages[0]?.content || '');

        // Fail all reasoning models (503) so Balanced Cascade gracefully degrades to fast model with reasoning boost
        if (/qwen3|r1/i.test(body.model)) {
          return {
            ok: false,
            status: 503,
            text: async () => 'overloaded',
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: 'Verified step-by-step fallback answer.' } }],
          }),
        };
      })
    );

    const switches = [];
    const ans = await aiText({
      system: 'Solve carefully.',
      user: 'Prove n^2 + n is even.',
      useReasoning: true,
      task: 'reasoning',
      onRouteSwitch: info => switches.push(info),
    });

    expect(ans).toBe('Verified step-by-step fallback answer.');
    expect(calledModels[0]).toBe('qwen/qwen3-32b');
    expect(calledModels[calledModels.length - 1]).toBe('llama-3.3-70b-versatile');
    expect(switches.some(s => s.degraded === true)).toBe(true);
    expect(systemPrompts[systemPrompts.length - 1]).toContain('step-by-step');

    // Also verify streaming Deep Think auto-switch
    const streamTokens = [];
    const streamed = await aiTextStream({
      system: 'Solve carefully.',
      user: 'Explain Big-O.',
      useReasoning: true,
      task: 'reasoning',
      onToken: t => streamTokens.push(t),
    });
    expect(streamed).toBe('Verified step-by-step fallback answer.');
    expect(streamTokens.length).toBeGreaterThan(0);
  });

  it('Smart Full-Block Boundary Engine captures entire multi-function unfenced programs and respects explicit selection', () => {
    const fullPython = [
      'import math',
      'def helper(x):',
      '    val = x * 2',
      '',
      '    # compute adjustment',
      '    if val > 10:',
      '        return val - 1',
      '    else:',
      '        return val + 1',
      '',
      'def main():',
      '    items = [3, 7, 9]',
      '    total = 0',
      '    for n in items:',
      '        total += helper(n)',
      '    print(total)',
      '',
      'main()',
    ].join('\n');

    const detected = detectRawCode(fullPython);
    expect(detected).not.toBeNull();
    expect(detected.langId).toBe('python');
    expect(detected.startLine).toBe(0);
    expect(detected.endLine).toBe(17);
    expect(detected.code).toContain('import math');
    expect(detected.code).toContain('def helper(x):');
    expect(detected.code).toContain('main()');

    // Mixed prose + full C++ program with blank lines & plain variable assignments
    const mixedNote = [
      'Lecture 4 Notes: Arrays and Loops',
      'Remember to initialize accumulators before summing.',
      '',
      '#include <iostream>',
      'using namespace std;',
      '',
      'int sumArray(int arr[], int n) {',
      '    int total = 0;',
      '',
      '    for (int i = 0; i < n; i++) {',
      '        total += arr[i];',
      '    }',
      '    return total;',
      '}',
      '',
      'int main() {',
      '    int nums[] = {1, 2, 3};',
      '    cout << sumArray(nums, 3);',
      '    return 0;',
      '}',
    ].join('\n');

    const cppHit = detectRawCode(mixedNote);
    expect(cppHit).not.toBeNull();
    expect(cppHit.langId).toBe('cpp');
    expect(cppHit.code).toContain('#include <iostream>');
    expect(cppHit.code).toContain('int main()');

    // Explicit highlighted selection overrides full-block detection
    const selHit = detectRawCode(mixedNote, {
      selection: { text: 'int total = 0;\ncout << total;', start: 100, end: 129 },
    });
    expect(selHit?.isSelection).toBe(true);
    expect(selHit?.code).toBe('int total = 0;\ncout << total;');
  });

  it('Syllabus Engine evaluates formulas safely, filters homonyms accurately, and persists Dexie v9 syllabi + vault-safe recentNotes', async () => {
    // 1. Pure safe formula evaluator (EOQ = sqrt((2 * D * S) / H))
    expect(evaluateFormulaSafe('sqrt((2 * d * s) / h)', { d: 1200, s: 50, h: 3 })).toBe(200);
    expect(evaluateFormulaSafe('100 / 0', {})).toBeNull();

    // 2. Homonym filter rejects botanical tree when studying CS Data Structures
    const csSyl = normalizeSyllabusData({
      code: 'CS 201',
      name: 'Data Structures & Algorithms',
      domain: 'computer-science',
      topics: [
        {
          week: 4,
          module: 'Module 2',
          title: 'Binary Search Trees',
          learningObjectives: ['Implement tree traversal and node insertion'],
          domainKeywords: ['node', 'binary', 'traversal', 'algorithm', 'pointer'],
        },
      ],
    });
    const topic = csSyl.topics[0];

    const botanyScore = scoreSourceRelevance(
      {
        title: 'Tree',
        content: 'In botany, a tree is a perennial woody plant with an elongated stem or trunk.',
      },
      csSyl,
      topic
    );
    const csScore = scoreSourceRelevance(
      {
        title: 'Binary search tree',
        content: 'In computer science, a binary search tree is a rooted node-based data structure supporting fast traversal.',
      },
      csSyl,
      topic
    );
    expect(botanyScore).toBeLessThan(1.5);
    expect(csScore).toBeGreaterThan(5);

    // 3. Dexie v9 syllabi + topic cache CRUD
    const saved = await saveSyllabus(csSyl);
    expect(saved.id).toBeGreaterThan(0);
    const updated = await updateSyllabusTopicState(saved.id, topic.slug, {
      masteryState: 'practiced',
      practicalDone: true,
    });
    expect(updated.topics[0].masteryState).toBe('practiced');

    await putSyllabusTopicCache(`syl:${saved.id}:${topic.slug}`, saved.id, {
      lessonMd: '# Binary Search Trees',
    });
    const cached = await getSyllabusTopicCache(`syl:${saved.id}:${topic.slug}`);
    expect(cached?.lessonMd).toBe('# Binary Search Trees');

    // 4. Vault isolation on getHomeSummary().recentNotes
    const publicFid = await createFolder('Algorithms', { mode: 'study', locked: false });
    const secretFid = await createFolder('Private Diary', { mode: 'vault', locked: true });
    await createNote(publicFid, 'BST Traversal', 'In-order traversal visits left, root, right.');
    await createNote(secretFid, 'Secret PIN Note', 'Top secret 9999');

    const home = await getHomeSummary();
    expect(home.recentNotes.some(n => n.title === 'BST Traversal')).toBe(true);
    expect(home.recentNotes.some(n => n.title === 'Secret PIN Note')).toBe(false);
  });
});
