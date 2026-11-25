/**
 * cleanAiText — Sanitizes AI responses in Smart Mode so students never see
 * raw Markdown asterisks (*, **), hashtags (###), or ugly LaTeX delimiters (\boxed, $).
 */

function replaceSimpleLaTeX(text) {
  let s = String(text || '');
  // Unwrap \boxed{...} and \text{...} (iterate twice for light nesting)
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/\\boxed\{([^{}]+)\}/g, '$1');
    s = s.replace(/\\text\{([^{}]+)\}/g, '$1');
    s = s.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
    s = s.replace(/\\mathbf\{([^{}]+)\}/g, '$1');
  }
  // Common fractions & roots
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, den) => {
    const n = num.trim();
    const d = den.trim();
    const simpleN = /^[A-Za-z0-9.]+$/.test(n) ? n : `(${n})`;
    const simpleD = /^[A-Za-z0-9.]+$/.test(d) ? d : `(${d})`;
    return `${simpleN}/${simpleD}`;
  });
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner) => `√(${inner.trim()})`);
  // Common operators & symbols
  const replacements = [
    [/\\times\b/g, '×'],
    [/\\cdot\b/g, '·'],
    [/\\div\b/g, '÷'],
    [/\\pm\b/g, '±'],
    [/\\neq\b|\\ne\b/g, '≠'],
    [/\\leq\b|\\le\b/g, '≤'],
    [/\\geq\b|\\ge\b/g, '≥'],
    [/\\approx\b/g, '≈'],
    [/\\equiv\b/g, '≡'],
    [/\\implies\b|\\Rightarrow\b|\\rightarrow\b|\\to\b/g, '→'],
    [/\\iff\b|\\Leftrightarrow\b|\\leftrightarrow\b/g, '↔'],
    [/\\land\b|\\wedge\b/g, '∧'],
    [/\\lor\b|\\vee\b/g, '∨'],
    [/\\neg\b|\\lnot\b/g, '¬'],
    [/\\oplus\b/g, '⊕'],
    [/\\pi\b/g, 'π'],
    [/\\theta\b/g, 'θ'],
    [/\\Delta\b/g, 'Δ'],
    [/\\Sigma\b/g, 'Σ'],
    [/\\infty\b/g, '∞'],
    [/\\left\b|\\right\b/g, ''],
  ];
  for (const [re, glyph] of replacements) {
    s = s.replace(re, glyph);
  }
  // Strip math-mode delimiters: $$...$$, $...$, \(...\), \[...\]
  s = s.replace(/\$\$/g, '');
  s = s.replace(/\\\(|\\\)|\\\[|\\\]/g, '');
  s = s.replace(/(^|[\s(=])\$([^$\n]+?)\$(?=[\s).,;:!?]|$)/g, '$1$2');
  return s;
}

function cleanProseBlock(segment, { preserveCode = false } = {}) {
  let s = replaceSimpleLaTeX(segment);
  const lines = s.split(/\r?\n/);
  const cleanedLines = [];
  for (const rawLine of lines) {
    let line = rawLine;
    // Drop standalone horizontal rules (---, ***, ___)
    if (/^\s*[-*_]{3,}\s*$/.test(line)) continue;
    // Strip Markdown heading prefixes (#, ##, ###, etc.)
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    // Strip blockquote > markers
    line = line.replace(/^\s*>\s?/, '');
    // Convert leading unordered bullets (* item / - item) to clean dot bullets
    line = line.replace(/^(\s*)[*-]\s+/, '$1• ');
    // Strip bold/italic emphasis (**text**, __text__, *text*, _text_) without harming 5 * 6 math!
    line = line.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
    line = line.replace(/__([^_\n]+?)__/g, '$1');
    line = line.replace(/(^|[\s([{'"“])\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*(?=[\s).,;:!?'”\]}]|$)/g, '$1$2');
    line = line.replace(/(^|[\s([{'"“])_([^_\s\n](?:[^_\n]*?[^_\s\n])?)_(?=[\s).,;:!?'”\]}]|$)/g, '$1$2');
    // Unwrap inline backticks unless keeping code formatting
    if (!preserveCode) {
      line = line.replace(/`([^`\n]+?)`/g, '$1');
    }
    // Remove leftover isolated trailing ** or ##
    line = line.replace(/[*]{2,}/g, '');
    cleanedLines.push(line.replace(/[ \t]+$/g, ''));
  }
  return cleanedLines.join('\n');
}

/**
 * Clean AI output for Smart Detect drawer & note insertion.
 * Removes Markdown asterisks, hashtags, and LaTeX syntax while preserving readability.
 */
export function cleanAiOutputText(raw, { preserveCode = false } = {}) {
  const input = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!input) return '';

  // Split by fenced code blocks so code examples don't lose indentation or syntax operators
  const parts = input.split(/(```[a-zA-Z0-9+#_-]*\n[\s\S]*?```)/g);
  const processed = parts
    .map(part => {
      if (part.startsWith('```') && part.endsWith('```')) {
        if (preserveCode) return part;
        // Strip ```lang and closing ``` for plain prose notes
        return part.replace(/^```[a-zA-Z0-9+#_-]*\n?/, '').replace(/\n?```$/, '');
      }
      return cleanProseBlock(part, { preserveCode });
    })
    .join('\n');

  return processed.replace(/\n{3,}/g, '\n\n').trim();
}
