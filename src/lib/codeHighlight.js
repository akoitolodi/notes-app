/**
 * Lightweight, zero-dependency, XSS-safe syntax highlighter + Read Mode
 * line grouper for fenced code blocks (```lang ... ```) and GFM Markdown tables.
 */

const KEYWORDS = {
  js: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
    'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'class', 'extends',
    'import', 'export', 'default', 'from', 'async', 'await', 'true', 'false', 'null', 'undefined',
    'this', 'super', 'typeof', 'instanceof', 'in', 'of', 'interface', 'type', 'enum', 'implements',
  ]),
  py: new Set([
    'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass',
    'try', 'except', 'finally', 'raise', 'import', 'from', 'as', 'with', 'lambda', 'yield',
    'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'async', 'await', 'global', 'nonlocal',
  ]),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'ON', 'AS',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP',
    'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'NOT', 'NULL', 'AND', 'OR', 'ORDER',
    'BY', 'GROUP', 'HAVING', 'LIMIT', 'DISTINCT', 'UNION', 'ALL', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'on', 'as', 'insert', 'into',
    'values', 'update', 'set', 'delete', 'create', 'table', 'alter', 'drop', 'primary', 'key',
    'not', 'null', 'and', 'or', 'order', 'by', 'group', 'having', 'limit', 'distinct',
  ]),
  c: new Set([
    'int', 'float', 'double', 'char', 'void', 'bool', 'boolean', 'long', 'short', 'unsigned',
    'signed', 'struct', 'class', 'public', 'private', 'protected', 'static', 'final', 'const',
    'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
    'try', 'catch', 'throw', 'throws', 'import', 'package', 'include', 'using', 'namespace',
    'true', 'false', 'null', 'nullptr', 'this', 'super', 'extends', 'implements', 'interface',
    'echo', 'function', 'foreach', 'string', 'var',
  ]),
  sh: new Set([
    'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function',
    'export', 'local', 'echo', 'cd', 'ls', 'grep', 'sed', 'awk', 'sudo', 'chmod', 'chown',
    'git', 'npm', 'node', 'python', 'docker', 'curl',
  ]),
};

function resolveLangGroup(lang) {
  const l = String(lang || '').toLowerCase().trim();
  if (['py', 'python'].includes(l)) return 'py';
  if (['sql', 'mysql', 'postgres', 'postgresql', 'sqlite'].includes(l)) return 'sql';
  if (['c', 'cpp', 'c++', 'java', 'cs', 'csharp', 'php', 'go', 'rust', 'kotlin', 'swift'].includes(l)) return 'c';
  if (['sh', 'bash', 'zsh', 'shell', 'powershell', 'ps1'].includes(l)) return 'sh';
  if (['json'].includes(l)) return 'json';
  return 'js';
}

/**
 * Tokenize source code safely into [{ type, text }] tokens (never outputs raw HTML).
 */
export function tokenizeCode(code, lang = '') {
  const src = String(code || '');
  const group = resolveLangGroup(lang);
  const kwSet = KEYWORDS[group] || KEYWORDS.js;

  const tokens = [];
  const tokenRe =
    group === 'py' || group === 'sh'
      ? /(#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g
      : group === 'sql'
        ? /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\\.|[^"\\])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g
        : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b)/g;

  let last = 0;
  let m;
  while ((m = tokenRe.exec(src)) !== null) {
    if (m.index > last) {
      tokens.push({ type: 'plain', text: src.slice(last, m.index) });
    }
    const val = m[0];
    let type = 'plain';
    if (
      val.startsWith('//') ||
      val.startsWith('/*') ||
      val.startsWith('--') ||
      (val.startsWith('#') && (group === 'py' || group === 'sh'))
    ) {
      type = 'cmt';
    } else if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) {
      type = 'str';
    } else if (/^(?:0x[0-9a-fA-F]+|\d)/.test(val)) {
      type = 'num';
    } else if (group !== 'json' && kwSet.has(val)) {
      type = 'kw';
    } else if (group === 'json' && (val === 'true' || val === 'false' || val === 'null')) {
      type = 'kw';
    } else if (src[m.index + val.length] === '(') {
      type = 'fn';
    }
    tokens.push({ type, text: val });
    last = m.index + val.length;
  }
  if (last < src.length) {
    tokens.push({ type: 'plain', text: src.slice(last) });
  }
  return tokens;
}

/** Check if a line is a GFM table divider row like | --- | :---: | ---: | */
export function isTableDividerRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length >= 2 && cells.every(c => /^:?-{3,}:?$/.test(c));
}

/** Split a Markdown table row into trimmed cell strings. */
export function splitTableRow(line) {
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

/**
 * Group a note's lines into render segments for Read Mode while preserving exact
 * 0-based line indexes for regular lines so AI line-explanations remain 100% mapped.
 *
 * Returns an array of:
 * - { type: 'code', lang, code, startLine, endLine }
 * - { type: 'table', headers, rows, startLine, endLine }
 * - { type: 'line', index, text }
 */
export function groupNoteLines(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    // 1. Multi-line fenced code block (```lang ... ```)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
      const startLine = i;
      const codeLines = [];
      let closed = false;
      i += 1;
      while (i < lines.length) {
        if ((lines[i] ?? '').trim().startsWith('```')) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (closed || codeLines.length > 0) {
        out.push({
          type: 'code',
          lang,
          code: codeLines.join('\n'),
          startLine,
          endLine: i - 1,
        });
        continue;
      }
      // Single lone ``` line fallback
      out.push({ type: 'line', index: startLine, text: raw });
      continue;
    }

    // 2. GFM Markdown table (header row + |---|---| divider + >=1 body rows)
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableDividerRow(lines[i + 1])
    ) {
      const headers = splitTableRow(raw);
      if (headers.length >= 2) {
        const startLine = i;
        i += 2; // skip header & divider
        const rows = [];
        while (i < lines.length && (lines[i] ?? '').trim().includes('|')) {
          const rowText = (lines[i] ?? '').trim();
          if (!rowText) break;
          rows.push(splitTableRow(rowText));
          i += 1;
        }
        out.push({
          type: 'table',
          headers,
          rows,
          startLine,
          endLine: i - 1,
        });
        continue;
      }
    }

    // 3. Regular line (keeps existing line-by-line AI explanations & tap-to-inspect!)
    out.push({ type: 'line', index: i, text: raw });
    i += 1;
  }

  return out;
}
