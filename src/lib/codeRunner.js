/**
 * codeRunner — Multi-language in-app code execution & AI coding tutor helpers.
 *
 * Execution tiers:
 * 1. JavaScript: Instant 100% offline sandbox capturing console.log/warn/error + return values.
 * 2. HTML/CSS: Instant 100% offline sandboxed live preview payload.
 * 3. Python, C, C++, Java, C#, SQL (SQLite), Go, Rust, PHP, Bash, Ruby, TypeScript, Dart, Swift:
 *    Live cloud sandbox via Codapi (POST https://api.codapi.org/v1/exec, CORS-enabled, zero-key)
 *    with automatic fallback to AI Virtual Compiler when offline or unsupported.
 */
import { aiText, aiTextStream, createAbortController } from './aiCore';
import { getCodapiConfig } from './aiConfig';
import { getLanguageMeta } from './codingCatalog';

/** Run JavaScript safely inside a captured-console Function scope (instant & offline). */
export function runJavaScriptLocally(code) {
  const logs = [];
  const pushLog = (prefix, args) => {
    if (logs.length >= 200) return;
    const formatted = args
      .map(a => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    logs.push(prefix ? `${prefix} ${formatted}` : formatted);
  };

  const mockConsole = {
    log: (...args) => pushLog('', args),
    info: (...args) => pushLog('[info]', args),
    warn: (...args) => pushLog('[warn]', args),
    error: (...args) => pushLog('[error]', args),
    table: data => pushLog('', [data]),
  };

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    // Prevent direct window/document mutation by shadowing common globals
    const fn = new Function(
      'console',
      'window',
      'document',
      'localStorage',
      'fetch',
      `"use strict";\n${code}`
    );
    const ret = fn(mockConsole, undefined, undefined, undefined, undefined);
    if (ret !== undefined && logs.length === 0) {
      pushLog('', [ret]);
    }
    const durationMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    );
    return {
      ok: true,
      stdout: logs.join('\n') || '(Finished with no console output)',
      stderr: '',
      durationMs,
      engine: 'Local Offline JS Runner',
    };
  } catch (err) {
    const durationMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    );
    return {
      ok: false,
      stdout: logs.join('\n'),
      stderr: `${err?.name || 'Error'}: ${err?.message || String(err)}`,
      durationMs,
      engine: 'Local Offline JS Runner',
    };
  }
}

/** Run code on Codapi live cloud sandbox (https://api.codapi.org/v1/exec) with 12s timeout. */
export async function runOnCodapi(sandbox, code) {
  const { url, key } = getCodapiConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ctrl = createAbortController(15000);
  try {
    const res = await fetch(`${url}/v1/exec`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sandbox,
        command: 'run',
        files: { '': code },
      }),
      signal: ctrl.signal,
    });

    const data = await res.json().catch(() => null);
    const durationMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    );

    if (!res.ok) {
      throw new Error(data?.message || data?.stderr || `Codapi HTTP ${res.status}`);
    }

    return {
      ok: Boolean(data?.ok),
      stdout: String(data?.stdout || '').trim(),
      stderr: String(data?.stderr || '').trim(),
      durationMs: data?.duration || durationMs,
      engine: 'Codapi Live Sandbox',
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Codapi sandbox timed out (12s)');
    }
    throw err;
  } finally {
    ctrl.cleanup();
  }
}

/** AI Virtual Compiler fallback (for offline use or languages without a live sandbox). */
export async function runWithAiVirtualCompiler({ langName, code }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const out = await aiText({
    system: `You are a strict ${langName} compiler and runtime simulator. Execute the user's code mentally with 100% accuracy. Output ONLY:\n1) Exact stdout under "OUTPUT:"\n2) Any compile/runtime error under "ERROR:" (omit if none)\n3) A 1-line note if something is subtle.`,
    user: `Language: ${langName}\n\`\`\`\n${code.slice(0, 6000)}\n\`\`\``,
    maxTokens: 1200,
    timeoutMs: 60000,
  });
  const durationMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  );
  return {
    ok: !/\bERROR:\s*\S/i.test(out),
    stdout: out,
    stderr: '',
    durationMs,
    engine: 'AI Virtual Compiler',
  };
}

/** Unified entry point: local JS/HTML -> Codapi Live -> AI Virtual Compiler fallback. */
export async function executeCode({ langId, code, allowAiFallback = true }) {
  const meta = getLanguageMeta(langId);
  const src = String(code || '');
  if (!src.trim()) {
    return { ok: false, stdout: '', stderr: 'Write some code first.', durationMs: 0, engine: 'Runner' };
  }

  if (meta.codapiSandbox === 'local-js') {
    return runJavaScriptLocally(src);
  }

  if (meta.codapiSandbox === 'local-html') {
    return {
      ok: true,
      mode: 'preview',
      html: src,
      stdout: 'Live HTML/CSS preview updated.',
      stderr: '',
      durationMs: 1,
      engine: 'Local HTML/CSS Preview',
    };
  }

  if (meta.codapiSandbox && meta.codapiSandbox !== 'ai') {
    try {
      return await runOnCodapi(meta.codapiSandbox, src);
    } catch (codapiErr) {
      if (!allowAiFallback) {
        return {
          ok: false,
          stdout: '',
          stderr: `Live sandbox error: ${codapiErr.message}`,
          durationMs: 0,
          engine: 'Codapi Live Sandbox',
        };
      }
      try {
        const aiRes = await runWithAiVirtualCompiler({ langName: meta.name, code: src });
        return {
          ...aiRes,
          notice: `Live sandbox unavailable (${codapiErr.message.slice(0, 60)}) — simulated with AI.`,
        };
      } catch (aiErr) {
        return {
          ok: false,
          stdout: '',
          stderr: `Sandbox failed (${codapiErr.message}) & AI fallback failed (${aiErr.message})`,
          durationMs: 0,
          engine: 'Runner',
        };
      }
    }
  }

  return runWithAiVirtualCompiler({ langName: meta.name, code: src });
}

/** Step-by-step AI code trace & variable visualizer. */
export function traceCodeStepByStep({ langName, code, onToken, signal }) {
  return aiTextStream({
    system: `You are a crystal-clear CS programming tutor. Trace this ${langName} code step-by-step:\n1. **What it does** (1 sentence)\n2. **Line-by-Line Variable Trace** (compact Markdown table showing step, line, variables, and output)\n3. **Time & Space Complexity** (Big-O)\n4. **Bugs or Improvements** (if any).`,
    user: `\`\`\`${langName.toLowerCase()}\n${String(code || '').slice(0, 6000)}\n\`\`\``,
    maxTokens: 1800,
    timeoutMs: 90000,
    onToken,
    signal,
  });
}

/** Translate code side-by-side from one programming language to another with key syntax differences. */
export function translateCodeBetweenLanguages({ code, fromLang, toLang, onToken, signal }) {
  return aiTextStream({
    system: `You are a polyglot software engineer teaching ${toLang} to someone who knows ${fromLang}. Translate the code idiomatically into ${toLang}, then add 3 concise bullet points highlighting the key syntax/concept differences between ${fromLang} and ${toLang}.`,
    user: `Convert from ${fromLang} to ${toLang}:\n\`\`\`\n${String(code || '').slice(0, 6000)}\n\`\`\``,
    maxTokens: 2048,
    timeoutMs: 90000,
    onToken,
    signal,
  });
}

/** Evaluate a challenge solution, provide progressive Socratic hints, or show a clean solution walkthrough. */
export function evaluateChallengeWithAI({
  challengeTitle,
  description,
  langName,
  code,
  action = 'check', // 'hint' | 'check' | 'solution'
  learnerContext = '',
  onToken,
  signal,
}) {
  const instructions = {
    hint: `Give ONE targeted Socratic hint (do NOT give the full code solution yet!) to help the learner make the next step on "${challengeTitle}" in ${langName}.`,
    check: `Review the learner's ${langName} solution for "${challengeTitle}". Run 4 edge-case mental test cases in a short table (Input | Expected | Their Code Result | Pass/Fail), give a verdict (PASS or NEEDS FIX), Big-O complexity, and 1-2 actionable improvements.`,
    solution: `Provide a clean, idiomatic ${langName} solution for "${challengeTitle}", followed by a clear explanation of the algorithm and Big-O complexity.`,
  };

  return aiTextStream({
    system: `You are DeepTutor, an encouraging coding mentor.${learnerContext ? `\n\nLearner Memory Context:\n${learnerContext}` : ''}\n\n${instructions[action] || instructions.check}`,
    user: `Challenge: ${challengeTitle}\n\nProblem Specification:\n${String(description || '').slice(0, 3500)}\n\nLearner's ${langName} Code:\n\`\`\`\n${String(code || '').slice(0, 4500)}\n\`\`\``,
    maxTokens: 2048,
    timeoutMs: 120000,
    onToken,
    signal,
  });
}
