/**
 * bugDebugger — Offline Stack-Trace & Compiler Error Parser + "Bugs I Solved" Dexie Archive.
 *
 * Parses common Python, JavaScript/TypeScript, C/C++ (gcc/clang), Java/Kotlin, and Gradle errors
 * instantaneously offline, offers optional 1-tap AI root-cause diagnosis, and saves resolved bugs
 * locally in Dexie `bugLogs` so students never waste hours debugging the same error twice.
 */
import { db } from '../store/db';
import { aiText } from './aiCore';

/** Deterministic offline error trace parser. */
export function parseErrorTrace(rawText = '') {
  const raw = String(rawText || '').trim();
  if (!raw) {
    return {
      language: 'Unknown',
      errorType: 'Error',
      file: '',
      line: null,
      message: '',
      offlineHint: '',
    };
  }

  // 1. Python Traceback
  if (/Traceback \(most recent call last\)|File "[^"]+", line \d+/i.test(raw)) {
    const fileMatches = [...raw.matchAll(/File "([^"]+)", line (\d+)/g)];
    const lastFrame = fileMatches[fileMatches.length - 1];
    const errLine = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .reverse()
      .find(l => /^[A-Za-z_]\w*(?:Error|Exception|Warning)\s*:/.test(l));
    const em = /^([A-Za-z_]\w*(?:Error|Exception|Warning))\s*:\s*(.*)$/.exec(errLine || '');
    const errorType = em ? em[1] : 'PythonError';
    const message = em ? em[2].trim() : errLine || raw.split(/\r?\n/).pop();
    return {
      language: 'Python',
      errorType,
      file: lastFrame ? lastFrame[1] : '',
      line: lastFrame ? Number(lastFrame[2]) : null,
      message,
      offlineHint: getOfflineBugHint('Python', errorType, message),
    };
  }

  // 2. Java / Kotlin Exception
  if (/Exception in thread|^\s*at\s+[\w.$]+\([\w.]+\.(?:java|kt):\d+\)/m.test(raw)) {
    const exMatch = /([a-zA-Z0-9_$.]*(?:Exception|Error))\s*:\s*(.+)/m.exec(raw);
    const frameMatch = /\(([\w.]+\.(?:java|kt)):(\d+)\)/.exec(raw);
    const fullType = exMatch ? exMatch[1].split('.').pop() : 'JavaException';
    const isKt = frameMatch?.[1]?.endsWith('.kt');
    return {
      language: isKt ? 'Kotlin' : 'Java',
      errorType: fullType,
      file: frameMatch ? frameMatch[1] : '',
      line: frameMatch ? Number(frameMatch[2]) : null,
      message: exMatch ? exMatch[2].trim() : raw.split(/\r?\n/)[0],
      offlineHint: getOfflineBugHint(isKt ? 'Kotlin' : 'Java', fullType, exMatch?.[2] || ''),
    };
  }

  // 3. C / C++ Compiler (gcc / g++ / clang)
  const cppMatch = /([^\s:]+\.(?:c|cc|cpp|cxx|h|hpp)):(\d+)(?::\d+)?:\s*(?:fatal\s+)?error:\s*(.+)/i.exec(raw);
  if (cppMatch || /undefined reference to|segmentation fault/i.test(raw)) {
    const errorType = /undefined reference/i.test(raw)
      ? 'LinkerError'
      : /segmentation fault/i.test(raw)
        ? 'SegmentationFault'
        : 'CompilerError';
    return {
      language: 'C/C++',
      errorType,
      file: cppMatch ? cppMatch[1] : '',
      line: cppMatch ? Number(cppMatch[2]) : null,
      message: cppMatch ? cppMatch[3].trim() : raw.split(/\r?\n/)[0],
      offlineHint: getOfflineBugHint('C/C++', errorType, cppMatch?.[3] || raw),
    };
  }

  // 4. Gradle / Android Build Error
  if (/FAILURE:\s*Build failed|Execution failed for task|Gradle/i.test(raw)) {
    const taskMatch = /Execution failed for task '([^']+)'/.exec(raw);
    return {
      language: 'Gradle/Android',
      errorType: 'BuildFailed',
      file: taskMatch ? taskMatch[1] : 'build.gradle',
      line: null,
      message: (raw.split(/\r?\n/).find(l => /error:|failed|could not/i.test(l)) || raw.split(/\r?\n/)[0]).trim(),
      offlineHint: 'Check dependency versions, Java/JDK target compatibility, and clean-rebuild with ./gradlew clean.',
    };
  }

  // 5. JavaScript / TypeScript Runtime or Syntax Error
  const jsErr = /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|Error)\s*:\s*(.+)/i.exec(raw);
  const jsFrame = /at\s+(?:[^\s(]+\s+\()?([^\s():]+\.(?:js|jsx|ts|tsx|mjs)):(\d+)/.exec(raw);
  if (jsErr || jsFrame) {
    const errorType = jsErr ? jsErr[1] : 'JSError';
    const message = jsErr ? jsErr[2].trim() : raw.split(/\r?\n/)[0];
    return {
      language: jsFrame?.[1]?.match(/\.tsx?$/) ? 'TypeScript' : 'JavaScript',
      errorType,
      file: jsFrame ? jsFrame[1] : '',
      line: jsFrame ? Number(jsFrame[2]) : null,
      message,
      offlineHint: getOfflineBugHint('JavaScript', errorType, message),
    };
  }

  return {
    language: 'General',
    errorType: 'Error',
    file: '',
    line: null,
    message: raw.split(/\r?\n/)[0].slice(0, 180),
    offlineHint: 'Inspect the first file & line number printed in the trace, and verify input types/null values.',
  };
}

function getOfflineBugHint(lang, errorType, msg = '') {
  const t = `${errorType} ${msg}`.toLowerCase();
  if (t.includes('nullpointer') || t.includes('cannot read propert') || t.includes('nonetype')) {
    return 'A variable is null/undefined/None when accessed. Guard with an explicit null check or optional chaining (?.) before reading fields.';
  }
  if (t.includes('indexerror') || t.includes('outofbounds')) {
    return 'Loop or index exceeded array length. Check off-by-one bounds (< len instead of <= len) and empty collections.';
  }
  if (t.includes('keyerror')) {
    return 'Dictionary key is missing. Use dict.get(key, default) or check `if key in dict:` first.';
  }
  if (t.includes('referenceerror') || t.includes('nameerror') || t.includes('was not declared')) {
    return 'Variable, function, or import name is misspelled or out of scope. Check imports and spelling.';
  }
  if (t.includes('syntaxerror') || t.includes('expected \';\'')) {
    return 'Check the line above the reported line for a missing bracket, parenthesis, colon, quote, or semicolon.';
  }
  if (t.includes('segmentationfault')) {
    return 'Invalid memory dereference (null/dangling pointer or out-of-bounds array write). Check pointer initialization & loop bounds.';
  }
  if (t.includes('undefined reference')) {
    return 'Declaration found in header, but implementation was not linked. Ensure all .c/.cpp source files or libraries (-lm, -lpthread) are passed to gcc/g++.';
  }
  if (t.includes('indentationerror')) {
    return 'Mixed tabs and spaces or misaligned block indent in Python. Convert indentation to consistent 4 spaces.';
  }
  return `Inspect ${lang} ${errorType} around the reported line — print intermediate variable values to isolate the exact root cause.`;
}

/** Optional 1-tap AI root-cause diagnosis for a pasted stack trace. */
export async function diagnoseBugWithAI(rawTrace, parsed, signal = null) {
  return aiText({
    system:
      'You are a concise, practical senior software engineer helping a CS/IT student debug an error. Return Markdown with: 1) **Root Cause** (2 sentences), 2) **Exact Fix** (short code snippet), 3) **How to Prevent It Next Time** (1 bullet).',
    user: `Language: ${parsed.language}\nError Type: ${parsed.errorType}\nFile/Line: ${parsed.file || 'n/a'}:${parsed.line || 'n/a'}\n\nRaw Error:\n\`\`\`\n${String(rawTrace || '').slice(0, 3000)}\n\`\`\``,
    maxTokens: 900,
    signal,
  });
}

export async function saveBugLog({
  language = 'General',
  errorType = 'Error',
  file = '',
  line = null,
  rawTrace = '',
  fixSummary = '',
  tags = [],
}) {
  return db.bugLogs.add({
    language,
    errorType,
    file,
    line,
    rawTrace: String(rawTrace || '').slice(0, 4000),
    fixSummary: String(fixSummary || '').trim(),
    tags: Array.isArray(tags) ? tags : [],
    createdAt: Date.now(),
  });
}

export async function getBugLogs(search = '') {
  const all = await db.bugLogs.orderBy('createdAt').reverse().toArray().catch(() => []);
  const q = String(search || '').trim().toLowerCase();
  if (!q) return all;
  return all.filter(b =>
    `${b.language} ${b.errorType} ${b.file} ${b.rawTrace} ${b.fixSummary}`.toLowerCase().includes(q)
  );
}

export async function deleteBugLog(id) {
  return db.bugLogs.delete(id);
}
