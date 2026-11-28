/**
 * smartNoteDetect — Calm, 100% local Blank-Note Auto-Detection Engine.
 *
 * Inspects plain text typed in ANY Blank Note (strictly disabled in Zero-AI / Vault!)
 * and surfaces relevant 1-tap powers right above the keyboard toolbar:
 *  1. Code Recognition (even WITHOUT backticks!) -> 1-tap Run (all languages), Insert Output, Wrap Code Block
 *  2. Instant Offline Math / Algebra / Units / Scratchpad -> Insert Answer, Graph It, AI Steps
 *  3. Chemistry Molar Mass & Reactions -> Instant g/mol + Balance/Explain (AI)
 *  4. Physics Quick Solver -> Instant SI solve (F=ma, Ohm's Law, Kinematics, KE/PE) + AI Solve
 *  5. Statistics & Grade Average -> Instant Mean/Median/Sum/SD
 *  6. IPv4 CIDR Subnet Calculator -> Instant Mask/Broadcast/Usable Hosts
 *  7. Code Error / Stack Trace -> Debug Error (AI) + Save to Bug Log
 *  8. Dates & Deadlines -> 1-tap "+ Add to Calendar"
 *  9. Term: Definition Study Lists (3+ lines) -> 1-tap "Make Flashcards (Offline)"
 * 10. Filipino / Tagalog / Bisaya <-> English Translation -> 1-tap Quick Translate
 * 11. Public Google Docs/Slides Link -> 1-tap Import into Note
 * 12. Color Hex/RGB -> Live Swatch & Conversion
 */
import { detectDateInText } from './canvasSync';
import {
  detectBestMathSolution,
  solveChemistryText,
  solvePhysicsText,
  solveNumberStats,
  solveSubnetCidr,
  detectColorToken,
} from './mathSolver';
import { detectLogicNoteIntent } from './algebraLogic';

export const SMART_DETECT_KEY = 'aicn:smartNoteDetect';

export function isSmartDetectEnabled() {
  try {
    const v = localStorage.getItem(SMART_DETECT_KEY);
    return v === null ? true : v !== 'false';
  } catch {
    return true;
  }
}

export function setSmartDetectEnabled(enabled) {
  try {
    localStorage.setItem(SMART_DETECT_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

const FENCE_LANG_ALIASES = {
  js: 'javascript',
  javascript: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
  python3: 'python',
  html: 'html',
  htm: 'html',
  css: 'html',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cc: 'cpp',
  java: 'java',
  cs: 'csharp',
  csharp: 'csharp',
  'c#': 'csharp',
  sql: 'sql',
  sqlite: 'sql',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  rb: 'ruby',
  ruby: 'ruby',
};

const LANG_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML / CSS',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  csharp: 'C#',
  sql: 'SQL',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  bash: 'Bash',
  ruby: 'Ruby',
};

/**
 * Smart Full-Block Boundary Engine + Language Fingerprint Detector (works WITHOUT ``` backticks!).
 * Respects explicit user text selection first, then detects full programs across blank lines,
 * comments, unclosed delimiters ({} / () / [] / HTML tags), and mixed prose+code notes.
 */
export function detectRawCode(body, { selection = null } = {}) {
  const text = String(body || '');
  if (!text.trim()) return null;

  // 0. Explicit text selection priority: if user highlighted code, Run/Wrap targets the exact selection
  const selText = String(selection?.text || '').replace(/\r\n?/g, '\n').trim();
  if (selText && selText.length >= 4) {
    const selLines = selText.split('\n');
    const hasCodeLine = selLines.some(l => isLikelyCodeLine(l));
    const selLang = inferLanguageFromSnippet(selText);
    if (selLang || (hasCodeLine && selLines.length >= 1)) {
      const langId = selLang || 'javascript';
      return {
        langId,
        langName: LANG_LABELS[langId] || langId,
        code: selText,
        isFenced: false,
        isSelection: true,
        selectionStart: typeof selection?.start === 'number' ? selection.start : null,
        selectionEnd: typeof selection?.end === 'number' ? selection.end : null,
        lineCount: selLines.length,
      };
    }
  }

  // 1. Check explicit fenced code blocks, and ALSO inspect any trailing unfenced code after the last fence
  const fenceRe = /```([a-zA-Z0-9+#_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let lastFence = null;
  let fm;
  while ((fm = fenceRe.exec(text)) !== null) {
    const rawLang = (fm[1] || '').toLowerCase().trim();
    const code = (fm[2] || '').trim();
    if (code) {
      lastFence = {
        rawLang,
        code,
        start: fm.index,
        end: fm.index + fm[0].length,
      };
    }
  }

  // If there is unfenced code AFTER the last closed fence, detect that new block instead of ignoring it
  const scanSource = lastFence ? text.slice(lastFence.end) : text;
  const lineOffset = lastFence ? text.slice(0, lastFence.end).split(/\r?\n/).length - 1 : 0;

  if (scanSource.trim()) {
    const unfenced = detectUnfencedFullBlock(scanSource, lineOffset);
    if (unfenced) return unfenced;
  }

  if (lastFence) {
    const inferred =
      FENCE_LANG_ALIASES[lastFence.rawLang] || inferLanguageFromSnippet(lastFence.code) || 'javascript';
    return {
      langId: inferred,
      langName: LANG_LABELS[inferred] || inferred,
      code: lastFence.code,
      isFenced: true,
      lineCount: lastFence.code.split(/\r?\n/).length,
    };
  }

  return null;
}

function classifyCodeLine(rawLine) {
  const s = String(rawLine || '').trim();
  if (!s) return 'blank';
  if (/^#{1,6}\s+|^-\s*\[[ xX]\]|^https?:\/\//i.test(s)) return 'prose';
  if (isStrongCodeLine(rawLine)) return 'strong';
  if (isWeakCodeLine(rawLine)) return 'weak';
  return 'prose';
}

function deltaDelimiters(rawLine) {
  const s = String(rawLine || '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '');
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
    else if (ch === '(') parens += 1;
    else if (ch === ')') parens -= 1;
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets -= 1;
  }
  return { braces, parens, brackets };
}

function detectUnfencedFullBlock(rawText, lineOffset = 0) {
  const lines = String(rawText || '').split(/\r?\n/);
  const kinds = lines.map(classifyCodeLine);

  const nonBlankIndices = [];
  let strongCount = 0;
  let codeishCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] === 'blank') continue;
    nonBlankIndices.push(i);
    if (kinds[i] === 'strong') strongCount += 1;
    if (kinds[i] === 'strong' || kinds[i] === 'weak') codeishCount += 1;
  }

  if (strongCount === 0 || nonBlankIndices.length === 0) return null;

  // Global density fast-path: if >= 60% of the note (ignoring an optional single title line at top)
  // is code, capture the ENTIRE program from first code line to last code line!
  const firstNonBlank = nonBlankIndices[0];
  const afterTitleNonBlank =
    kinds[firstNonBlank] === 'prose' && nonBlankIndices.length > 2
      ? nonBlankIndices.slice(1)
      : nonBlankIndices;
  const codeAfterTitle = afterTitleNonBlank.filter(
    i => kinds[i] === 'strong' || kinds[i] === 'weak'
  ).length;
  const density = afterTitleNonBlank.length > 0 ? codeAfterTitle / afterTitleNonBlank.length : 0;

  let startIdx = -1;
  let endIdx = -1;

  if (density >= 0.6) {
    const firstCodeIdx = afterTitleNonBlank.find(i => kinds[i] === 'strong' || kinds[i] === 'weak');
    const lastCodeIdx = [...afterTitleNonBlank]
      .reverse()
      .find(i => kinds[i] === 'strong' || kinds[i] === 'weak');
    if (firstCodeIdx !== undefined && lastCodeIdx !== undefined && firstCodeIdx <= lastCodeIdx) {
      startIdx = firstCodeIdx;
      endIdx = lastCodeIdx;
    }
  }

  // Otherwise, expand around the most recent code region bridging blank lines, comments, and unclosed delimiters
  if (startIdx === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (kinds[i] === 'strong') {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) return null;

    // Expand downward to include trailing weak code lines (closing braces, HTML closing tags, etc.)
    for (let i = endIdx + 1; i < lines.length; i++) {
      if (kinds[i] === 'strong' || kinds[i] === 'weak') {
        endIdx = i;
      } else if (kinds[i] === 'blank') {
        // Peek ahead up to 2 lines for more code
        const nextNonBlank = lines.slice(i + 1, i + 4).findIndex((_, idx) => kinds[i + 1 + idx] !== 'blank');
        if (nextNonBlank !== -1 && (kinds[i + 1 + nextNonBlank] === 'strong' || kinds[i + 1 + nextNonBlank] === 'weak')) {
          continue;
        }
        break;
      } else {
        break;
      }
    }

    // Track structural balance upward so we never cut a function, class, or HTML tag in half
    startIdx = endIdx;
    let balance = { braces: 0, parens: 0, brackets: 0 };
    const addBalance = idx => {
      const d = deltaDelimiters(lines[idx]);
      balance.braces += d.braces;
      balance.parens += d.parens;
      balance.brackets += d.brackets;
    };
    addBalance(endIdx);

    for (let i = endIdx - 1; i >= 0; i--) {
      const k = kinds[i];
      const imbalanced = balance.braces < 0 || balance.parens < 0 || balance.brackets < 0;

      if (k === 'strong' || k === 'weak') {
        startIdx = i;
        addBalance(i);
        continue;
      }

      if (k === 'blank') {
        // Bridge up to 3 blank lines if code continues above (or always while delimiter balance is open)
        let look = i - 1;
        let blanks = 1;
        while (look >= 0 && kinds[look] === 'blank' && blanks < 4) {
          blanks += 1;
          look -= 1;
        }
        if (look >= 0 && (imbalanced || kinds[look] === 'strong' || kinds[look] === 'weak')) {
          continue;
        }
        break;
      }

      // Prose line: only cross it if delimiters are clearly still unclosed above
      if (imbalanced) {
        startIdx = i;
        addBalance(i);
        continue;
      }
      break;
    }
  }

  // Trim leading/trailing blank lines
  while (startIdx <= endIdx && kinds[startIdx] === 'blank') startIdx += 1;
  while (endIdx >= startIdx && kinds[endIdx] === 'blank') endIdx -= 1;
  if (startIdx > endIdx) return null;

  const segment = lines.slice(startIdx, endIdx + 1).join('\n').trim();
  if (!segment) return null;

  const inferred = inferLanguageFromSnippet(segment);
  if (!inferred) return null;

  return {
    langId: inferred,
    langName: LANG_LABELS[inferred] || inferred,
    code: segment,
    isFenced: false,
    startLine: startIdx + lineOffset,
    endLine: endIdx + lineOffset,
    lineCount: endIdx - startIdx + 1,
  };
}

function isStrongCodeLine(rawLine) {
  const s = String(rawLine || '').trim();
  if (!s) return false;
  if (/^#{1,6}\s+|^-\s*\[[ xX]\]|^https?:\/\//i.test(s)) return false;

  const patterns = [
    /\bconsole\.(?:log|warn|error|table|info)\s*\(/,
    /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*=/,
    /^(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][\w$]*\s*\(/,
    /=>\s*\{|\)\s*=>\s*/,
    /^\s*print\s*\(.+\)\s*$/,
    /^\s*(?:async\s+)?def\s+[a-zA-Z_]\w*\s*\(.*\)\s*(?:->\s*[^:]+)?:\s*$/,
    /^\s*class\s+[a-zA-Z_]\w*(?:\s*\([^)]*\)|\s+extends\s+\w+|\s+implements\s+[\w,\s]+)?\s*[:{]?\s*$/,
    /^\s*(?:for|while|if|elif|except\b.*|with\b.*)\s*.+:\s*$/,
    /^\s*(?:else|try|finally)\s*:\s*$/,
    /^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.*,\s{}]+\s*;?\s*$/,
    /^#(?:include|define|pragma|ifdef|ifndef|endif)\b/,
    /^\s*(?:using\s+namespace\s+\w+|namespace\s+\w+|typedef\s+|struct\s+\w+|enum\s+\w+|template\s*<)/,
    /\b(?:std::)?(?:cout|cin|cerr)\s*(?:<<|>>)/,
    /\b(?:printf|scanf|fprintf|sprintf|malloc|calloc|free|strlen|strcpy)\s*\(/,
    /^\s*(?:public|private|protected|static|final|abstract|override|virtual|inline|constexpr)?\s*(?:static\s+)?(?:void|int|double|float|long|short|byte|boolean|bool|char|String|string|auto|var|vec<[^>]+>|vector<[^>]+>)\s+\**[a-zA-Z_]\w*(?:\s*[=(;\[]|\s*$)/,
    /^\s*(?:public|private|protected)?\s*(?:class|interface|record|enum)\s+\w+/,
    /\bSystem\.out\.print(?:ln|f)?\s*\(/,
    /\bConsole\.(?:WriteLine|Write|ReadLine)\s*\(/,
    /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|WITH\s+\w+\s+AS)\b/i,
    /^\s*(?:FROM|WHERE|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|VALUES|SET)\b/i,
    /^<!DOCTYPE\s+html>/i,
    /^<\/?(?:html|head|body|meta|link|title|div|span|p|h[1-6]|button|input|textarea|select|option|form|label|style|script|ul|ol|li|table|thead|tbody|tr|th|td|section|main|header|footer|nav|article|a|img|canvas|svg)\b[^>]*>/i,
    /^\s*(?:package\s+\w+|func\s+\w+\s*\(|fmt\.Print)/,
    /^\s*(?:fn\s+\w+\s*\(|println!\s*\(|let\s+mut\s+)/,
    /^<\?php\b|\becho\s+["'$]/,
    /^\s*(?:for|while|if|else\s+if|switch|catch)\s*\([^)]*\)\s*\{?/,
    /^\s*(?:else|try|do|finally)\s*\{/,
    /^\s*return(?:\s+[^;]+)?;\s*$/,
    /^\s*(?:break|continue|pass)\s*;?\s*$/,
    /^\s*@[a-zA-Z_]\w*(?:\([^)]*\))?\s*$/,
    /^\s*(?:[.#]?[a-zA-Z_-][\w-]*|body|html|\*)\s*\{\s*$/,
    /^\s*[a-z-]+:\s*[^;]+;\s*$/,
  ];
  return patterns.some(re => re.test(s));
}

function isWeakCodeLine(rawLine) {
  const s = String(rawLine || '').trim();
  if (!s) return false;
  if (/^#{1,6}\s+|^-\s*\[[ xX]\]|^https?:\/\//i.test(s)) return false;

  const weakPatterns = [
    /^\s*(?:[\]}]+|[\]}]+;|[)\]]+[;,]?)\s*$/,
    /^\s*(?:\/\/|\/\*|\*\/|\*|<!--|-->|--\s|#(?![#!\s]*\s*\[))/,
    /^\s*[a-zA-Z_$][\w$.\[\]]*\s*(?:[+\-*/%&|^]?=|\+\+|--)\s*[^=]/,
    /^\s*[a-zA-Z_$][\w$.]*\s*\([^)]*\)\s*;?\s*$/,
    /^\s*(?:case\s+[^:]+|default)\s*:/,
    /^\s{2,}\S/,
    /^\t+\S/,
    /;\s*$/,
  ];
  return weakPatterns.some(re => re.test(rawLine));
}

function isLikelyCodeLine(rawLine) {
  return isStrongCodeLine(rawLine) || isWeakCodeLine(rawLine);
}

export function inferLanguageFromSnippet(snippet) {
  const s = String(snippet || '').trim();
  if (!s) return null;

  const scores = {
    html: 0,
    cpp: 0,
    c: 0,
    java: 0,
    csharp: 0,
    sql: 0,
    go: 0,
    rust: 0,
    php: 0,
    python: 0,
    javascript: 0,
  };

  if (/<\/?(?:html|div|button|style|h[1-6]|p|span|table|script|body)\b[^>]*>/i.test(s)) scores.html += 5;
  if (/#include\s*<iostream>|\bstd::|\bcout\s*<<|\bcin\s*>>|\busing\s+namespace\s+std\b/.test(s)) scores.cpp += 6;
  if (/#include\s*<stdio\.h>|\bprintf\s*\(|\bscanf\s*\(/.test(s)) scores.c += 5;
  if (/\bpublic\s+class\s+\w+|\bSystem\.out\.print(?:ln)?\s*\(|\bpublic\s+static\s+void\s+main\b/.test(s)) scores.java += 6;
  if (/\bConsole\.Write(?:Line)?\s*\(|\busing\s+System;/.test(s)) scores.csharp += 6;
  if (/^\s*(?:SELECT|CREATE\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/im.test(s) && /\b(?:FROM|TABLE|INTO|WHERE|VALUES)\b/i.test(s)) scores.sql += 6;
  if (/\bpackage\s+main\b|\bfmt\.Print|\bfunc\s+main\s*\(/.test(s)) scores.go += 6;
  if (/\bfn\s+main\s*\(|\bprintln!\s*\(/.test(s)) scores.rust += 6;
  if (/<\?php\b|\$[a-zA-Z_]\w*\s*=/.test(s)) scores.php += 5;

  if (/\bprint\s*\(/.test(s) && !/\bprintf\s*\(|\bSystem\.out\.print/.test(s)) scores.python += 4;
  if (/^\s*def\s+\w+\s*\(.*\)\s*:/m.test(s)) scores.python += 5;
  if (/^\s*(?:for|while|if|elif)\s+.+:\s*$/m.test(s)) scores.python += 3;
  if (/\brange\s*\(/.test(s)) scores.python += 2;
  if (/^\s*(?:from\s+\w+\s+)?import\s+\w+/m.test(s) && !/;\s*$/.test(s)) scores.python += 2;

  if (/\bconsole\.(?:log|warn|error|table|info)\s*\(/.test(s)) scores.javascript += 5;
  if (/\b(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*=/.test(s)) scores.javascript += 3;
  if (/\bfunction\s+\w*\s*\(|=>/.test(s)) scores.javascript += 3;
  if (/\bfor\s*\(\s*(?:let|var)\b/.test(s)) scores.javascript += 3;

  let bestLang = null;
  let bestScore = 0;
  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      bestLang = lang;
    }
  }
  return bestScore >= 3 ? bestLang : null;
}

/** Detect code stack traces / runtime errors pasted into a blank note. */
export function detectErrorTrace(body) {
  const s = String(body || '');
  const m =
    /(?:Traceback \(most recent call last\)[\s\S]{0,240}|(?:TypeError|ReferenceError|SyntaxError|RangeError|ValueError|IndexError|KeyError|AttributeError|ZeroDivisionError|NullPointerException|ArrayIndexOutOfBoundsException|ClassNotFoundException|Segmentation fault|UnhandledPromiseRejection|Error:\s+ENOENT|fatal error:[^\n]+|error CS\d{4}:[^\n]+)[^\n]*)/i.exec(
      s
    );
  if (!m) return null;
  const firstLine = m[0].split(/\r?\n/).find(l => l.trim()) || m[0];
  return {
    snippet: m[0].slice(0, 400),
    title: firstLine.trim().slice(0, 72),
  };
}

/** Detect a deadline / scheduled class event typed inside a blank note. */
export function detectNoteDeadline(body) {
  const lines = String(body || '').split(/\r?\n/).reverse();
  const cueRe = /\b(?:due|deadline|submit|submission|pass|exam|midterm|final|quiz|test|defense|presentation|meeting|report|lab|project|assignment)\b/i;

  for (const rawLine of lines.slice(0, 12)) {
    const line = rawLine.trim();
    if (!line || line.length > 160 || !cueRe.test(line)) continue;
    const dateKey = detectDateInText(line);
    if (dateKey) {
      const cleanTitle = line
        .replace(/^[-*•]\s*(?:\[[ xX]\]\s*)?/, '')
        .replace(/^#{1,6}\s+/, '')
        .trim()
        .slice(0, 72);
      const isExam = /\b(?:exam|midterm|final|quiz|test|practical)\b/i.test(line);
      return {
        dateKey,
        title: cleanTitle,
        type: isExam ? 'exam' : 'assignment',
      };
    }
  }
  return null;
}

/** Detect 3+ Term: Definition lines to generate offline flashcards with zero AI calls! */
export function detectStudyTerms(body) {
  const lines = String(body || '').split(/\r?\n/);
  const cards = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*•]\s*/, '').trim();
    if (!line || line.length < 8 || line.length > 260) continue;
    if (/^https?:\/\//i.test(line) || /^```/.test(line)) continue;
    if (isLikelyCodeLine(line)) continue;

    // Match "**Term:** definition" or "Term: definition" or "Term - definition"
    const m = /^(?:\*\*([^*]{2,64})\*\*|([A-Za-z0-9][A-Za-z0-9\s/()'-]{1,56}))\s*(?::|—|–|\s-\s)\s*(.{5,200})$/.exec(
      line
    );
    if (!m) continue;
    const q = (m[1] || m[2] || '').trim();
    const a = (m[3] || '').trim();
    if (!q || !a) continue;
    // Skip timestamps or pure key=value metadata like "Course: IPT" with very short values
    if (/^\d{1,2}$/.test(q) || a.length < 6) continue;
    if (/^(?:date|course|posted|link|time|room|author|http|https)$/i.test(q)) continue;
    cards.push({ q, a });
  }
  if (cards.length < 3) return null;
  return {
    count: cards.length,
    cards: cards.slice(0, 40),
  };
}

/** Detect Filipino / Tagalog / Cebuano-Bisaya text or explicit "translate:" prompt. */
const FILIPINO_MARKERS = new Set([
  'ang', 'mga', 'pero', 'kasi', 'dahil', 'paano', 'bakit', 'hindi', 'yung', 'dito', 'doon',
  'niya', 'namin', 'natin', 'nila', 'wala', 'meron', 'mayroon', 'kapag', 'kung', 'pwede',
  'puwede', 'kailangan', 'dapat', 'sobra', 'talaga', 'parang', 'tapos', 'ngayon', 'bukas',
  'kahapon', 'araw', 'buhay', 'trabaho', 'klase', 'guro', 'estudyante', 'sagot', 'tanong',
  'unsa', 'ngano', 'dili', 'kanang', 'maayo', 'kay', 'asa', 'kinsa', 'kanus', 'diri', 'didto',
  'nako', 'namo', 'nila', 'walay', 'naa', 'gyud', 'jud', 'kaayo', 'salamat', 'palihug',
]);

export function detectTranslateIntent(body) {
  const s = String(body || '').trim();
  if (!s) return null;

  // Explicit prefix: "translate: ..." or "translate to filipino: ..." or "translate to english: ..."
  const explicit = /^(?:translate|isalin)(?:\s+to\s+(english|filipino|tagalog|cebuano|bisaya))?\s*:\s*([\s\S]{3,1200})/im.exec(
    s
  );
  if (explicit) {
    const targetLang = explicit[1]
      ? explicit[1][0].toUpperCase() + explicit[1].slice(1).toLowerCase()
      : 'English';
    return {
      targetLang,
      text: explicit[2].trim(),
      label: `Translate to ${targetLang}`,
    };
  }

  // Natural Filipino / Tagalog / Bisaya detection (require >= 3 distinct markers so English never false-triggers)
  const words = s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 5) return null;

  const matched = new Set();
  for (const w of words) {
    if (FILIPINO_MARKERS.has(w)) matched.add(w);
  }
  if (matched.size >= 3) {
    return {
      targetLang: 'English',
      text: s.slice(0, 1500),
      label: 'Filipino/Bisaya → English',
    };
  }
  return null;
}

/** Detect pasted public Google Docs / Google Slides link. */
export function detectGoogleDocLink(body) {
  const m = /https:\/\/docs\.google\.com\/(document|presentation)\/d\/([a-zA-Z0-9_-]+)/i.exec(
    String(body || '')
  );
  if (!m) return null;
  return {
    url: m[0],
    kind: m[1].toLowerCase() === 'presentation' ? 'Google Slides' : 'Google Doc',
  };
}

/**
 * Main Blank-Note Auto-Detector.
 * Strictly returns [] when `isZeroAi` is true or `enabled` is false!
 */
export function detectBlankNoteIntents(body, { isZeroAi = false, enabled = true, selection = null } = {}) {
  if (isZeroAi || !enabled) return [];
  const text = String(body || '');
  if (text.trim().length < 3) return [];

  const detections = [];

  // 1. Code Detection (highest priority for CS/IT students)
  const codeHit = detectRawCode(text, { selection });
  if (codeHit) {
    const lineLabel = codeHit.lineCount ? ` (${codeHit.lineCount}L)` : '';
    detections.push({
      id: `code:${codeHit.langId}`,
      kind: 'code',
      badge: codeHit.langName,
      title: `${codeHit.langName} code${codeHit.isSelection ? ' · Selection' : ''}`,
      summary: codeHit.isFenced
        ? `Ready to run${lineLabel}`
        : codeHit.isSelection
          ? `Run or wrap selected${lineLabel}`
          : `Run or wrap full block${lineLabel}`,
      meta: codeHit,
    });
  }

  // 2. Code Error / Stack Trace
  const errHit = detectErrorTrace(text);
  if (errHit) {
    detections.push({
      id: 'error',
      kind: 'error',
      badge: 'Error',
      title: errHit.title,
      summary: 'Debug with AI or save to Bug Log',
      meta: errHit,
    });
  }

  // 3. Instant Offline Math / Algebra / Units / Scratchpad
  // Allow math detection even if code appeared earlier in the note, as long as user's latest line isn't inside that code segment
  const mathHit = detectBestMathSolution(text);
  const nonEmptyLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lastLineText = nonEmptyLines[nonEmptyLines.length - 1] || '';
  const codeEndsAtBottom =
    codeHit &&
    !codeHit.isFenced &&
    typeof codeHit.endLine === 'number' &&
    codeHit.code.split(/\r?\n/).pop()?.trim() === lastLineText;
  if (mathHit && (!codeHit || !codeEndsAtBottom)) {
    detections.push({
      id: `math:${mathHit.kind}`,
      kind: 'math',
      badge: mathHit.kind === 'unit' || mathHit.kind === 'base' ? 'Convert' : 'Math',
      title: `${mathHit.label} → ${mathHit.answer}`,
      summary: mathHit.answer,
      insertText: mathHit.insertText || '',
      meta: mathHit,
    });
  }

  // 4. Chemistry Molar Mass / Reaction
  if (!codeHit) {
    const chemHit = solveChemistryText(text);
    if (chemHit) {
      detections.push({
        id: `chem:${chemHit.kind}`,
        kind: 'chemistry',
        badge: 'Chem',
        title: chemHit.kind === 'reaction' ? 'Chemical Equation' : chemHit.answer,
        summary: chemHit.kind === 'reaction' ? chemHit.answer : chemHit.breakdown,
        insertText: chemHit.insertText || '',
        meta: chemHit,
      });
    }
  }

  // 5. Physics Quick Solver
  if (!codeHit) {
    const physHit = solvePhysicsText(text);
    if (physHit) {
      detections.push({
        id: `phys:${physHit.kind}`,
        kind: 'physics',
        badge: 'Physics',
        title: physHit.answer,
        summary: physHit.kind === 'physics_solved' ? 'Instant SI Physics Solve' : 'Tap to solve with AI',
        insertText: physHit.insertText || '',
        meta: physHit,
      });
    }
  }

  // 6. IPv4 CIDR Subnet Calculator (can appear alongside code or notes!)
  const subnetHit = solveSubnetCidr(text);
  if (subnetHit) {
    detections.push({
      id: `subnet:${subnetHit.cidr}`,
      kind: 'subnet',
      badge: 'Subnet',
      title: subnetHit.cidr,
      summary: subnetHit.answer,
      insertText: subnetHit.insertText,
      meta: subnetHit,
    });
  }

  // 6b. Discrete & Conditional Logic (if/then/else/iff)
  const logicHit = detectLogicNoteIntent(text);
  if (logicHit) {
    detections.push({
      id: `logic:${logicHit.kind}`,
      kind: 'logic',
      badge: 'Logic',
      title: `${logicHit.label} → ${logicHit.answer}`,
      summary: logicHit.summary,
      insertText: logicHit.insertText,
      meta: logicHit,
    });
  }

  // 7. Statistics & Grade Average
  if (!codeHit) {
    const statsHit = solveNumberStats(text);
    if (statsHit) {
      detections.push({
        id: 'stats',
        kind: 'stats',
        badge: `Stats (${statsHit.count})`,
        title: statsHit.answer,
        summary: `Min ${statsHit.min} · Max ${statsHit.max}`,
        insertText: statsHit.insertText,
        meta: statsHit,
      });
    }
  }

  // 8. Dates & Deadlines
  const deadlineHit = detectNoteDeadline(text);
  if (deadlineHit) {
    detections.push({
      id: `deadline:${deadlineHit.dateKey}`,
      kind: 'deadline',
      badge: 'Deadline',
      title: `${deadlineHit.title} (${deadlineHit.dateKey})`,
      summary: 'Add straight to School Calendar',
      meta: deadlineHit,
    });
  }

  // 9. Offline Flashcards from Term: Definition lines
  const termHit = detectStudyTerms(text);
  if (termHit) {
    detections.push({
      id: `flashcards:${termHit.count}`,
      kind: 'flashcards',
      badge: `${termHit.count} Terms`,
      title: `${termHit.count} Term/Definition pairs`,
      summary: 'Make offline flashcards',
      meta: termHit,
    });
  }

  // 10. Public Google Docs / Slides Link
  const gdocHit = detectGoogleDocLink(text);
  if (gdocHit) {
    detections.push({
      id: 'gdoc',
      kind: 'gdoc',
      badge: gdocHit.kind,
      title: `${gdocHit.kind} link detected`,
      summary: 'Import document text straight into this note',
      meta: gdocHit,
    });
  }

  // 11. Filipino / Tagalog / Bisaya <-> English Translator
  const transHit = detectTranslateIntent(text);
  if (transHit) {
    detections.push({
      id: `translate:${transHit.targetLang}`,
      kind: 'translate',
      badge: 'Translate',
      title: transHit.label,
      summary: '1-tap translation via AI',
      meta: transHit,
    });
  }

  // 12. Color Swatch Token
  const colorHit = detectColorToken(text);
  if (colorHit && detections.length < 3) {
    detections.push({
      id: `color:${colorHit.hex}`,
      kind: 'color',
      badge: 'Color',
      title: colorHit.answer,
      summary: 'Color swatch & RGB conversion',
      insertText: colorHit.insertText,
      meta: colorHit,
    });
  }

  return detections.slice(0, 3);
}
