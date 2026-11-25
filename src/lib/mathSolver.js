/**
 * mathSolver — 100% offline, zero-eval instant solver for Blank Notes:
 * - Arithmetic & scientific expressions (25 * 14 + 8, sqrt(144) + 2^5, sin(pi/2))
 * - Percentages (25% of 480, 42/50 as %, 500 - 20%)
 * - Algebraic 1-variable equations (2x + 5 = 17, x^2 - 5x + 6 = 0, 3(n-2) = 15)
 * - Multi-line variable scratchpad (quiz = 45; exam = 88; quiz*0.3 + exam*0.7)
 * - Unit & number-base conversions (100 km to miles, 37 C to F, 255 to hex, 0b10110 to dec)
 * - Chemistry molar mass calculator (H2O, H2SO4, Ca(OH)2, C6H12O6) + reaction detection
 * - Physics quick solver (F=ma, v=d/t, V=IR, P=VI, KE, PE, kinematics)
 * - Statistics & grade average (mean, median, min, max, sum, std dev)
 * - IPv4 CIDR subnet calculator (192.168.1.0/24 -> mask, broadcast, usable hosts)
 * - Color converter (#0a84ff <-> rgb <-> hsl)
 */
import { compileMathExpression, findApproxRoots } from './mathGrapher';

export function formatSmartNumber(n) {
  if (!Number.isFinite(n)) return '';
  const cleaned = Math.abs(n) < 1e-11 ? 0 : n;
  if (Number.isInteger(cleaned)) return String(cleaned);
  const rounded = Number(cleaned.toFixed(6));
  return String(rounded);
}

/** 1. Percentage expressions: "25% of 480", "42 / 50 as %", "500 - 20%" */
export function solvePercentageLine(raw) {
  const s = String(raw || '').trim().replace(/=\s*$/, '').trim();
  if (!s || s.length > 90) return null;

  // "25% of 480"
  let m = /^(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)$/i.exec(s);
  if (m) {
    const pct = parseFloat(m[1]);
    const base = parseFloat(m[2]);
    const ans = (pct / 100) * base;
    return {
      label: `${m[1]}% of ${m[2]}`,
      answer: formatSmartNumber(ans),
      insertText: `= ${formatSmartNumber(ans)}`,
      kind: 'percentage',
    };
  }

  // "42 / 50 as %" or "42 out of 50 %"
  m = /^(-?\d+(?:\.\d+)?)\s*(?:\/|out\s+of)\s*(-?\d+(?:\.\d+)?)\s*(?:as\s*%|to\s*%|in\s*%|%)$/i.exec(s);
  if (m) {
    const num = parseFloat(m[1]);
    const den = parseFloat(m[2]);
    if (den === 0) return null;
    const pct = (num / den) * 100;
    return {
      label: `${m[1]} / ${m[2]}`,
      answer: `${formatSmartNumber(pct)}%`,
      insertText: `= ${formatSmartNumber(pct)}%`,
      kind: 'percentage',
    };
  }

  // "500 - 20%" or "120 + 15%"
  m = /^(-?\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*%$/i.exec(s);
  if (m) {
    const base = parseFloat(m[1]);
    const op = m[2];
    const pct = parseFloat(m[3]);
    const delta = (pct / 100) * base;
    const ans = op === '+' ? base + delta : base - delta;
    return {
      label: s,
      answer: formatSmartNumber(ans),
      insertText: `= ${formatSmartNumber(ans)}`,
      kind: 'percentage',
    };
  }

  return null;
}

/** 2. Unit & Number-Base Conversions */
const LENGTH_TO_M = {
  mm: 0.001, millimeter: 0.001, millimeters: 0.001,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01,
  m: 1, meter: 1, meters: 1, metre: 1, metres: 1,
  km: 1000, kilometer: 1000, kilometers: 1000,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
  mi: 1609.344, mile: 1609.344, miles: 1609.344,
};

const MASS_TO_G = {
  mg: 0.001, g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.349523, ounce: 28.349523, ounces: 28.349523,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
};

const DATA_TO_BYTES = {
  b: 1, byte: 1, bytes: 1,
  kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
};

const SPEED_TO_MS = {
  'm/s': 1, mps: 1,
  'km/h': 1 / 3.6, kph: 1 / 3.6, kmh: 1 / 3.6,
  mph: 0.44704,
};

const TIME_TO_S = {
  ms: 0.001, s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
};

const ANGLE_TO_DEG = {
  deg: 1, degree: 1, degrees: 1,
  rad: 180 / Math.PI, radian: 180 / Math.PI, radians: 180 / Math.PI,
};

export function solveUnitOrBase(raw) {
  const s = String(raw || '').trim().replace(/=\s*$/, '').trim();
  if (!s || s.length > 90) return null;

  // Number base conversions: "255 to hex", "0xFF to dec", "0b10110 to dec", "10110 bin to dec"
  const baseMatch = /^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)(?:\s+(bin|binary|hex|oct|octal|dec|decimal))?\s+(?:to|in|->|=>)\s+(bin|binary|hex|hexadecimal|oct|octal|dec|decimal)$/i.exec(s);
  if (baseMatch) {
    const rawNum = baseMatch[1].toLowerCase();
    const srcHint = (baseMatch[2] || '').toLowerCase();
    const dst = baseMatch[3].toLowerCase();

    let n = NaN;
    if (rawNum.startsWith('0x') || srcHint === 'hex') {
      n = parseInt(rawNum.replace(/^0x/, ''), 16);
    } else if (rawNum.startsWith('0b') || srcHint === 'bin' || srcHint === 'binary') {
      n = parseInt(rawNum.replace(/^0b/, ''), 2);
    } else if (rawNum.startsWith('0o') || srcHint === 'oct' || srcHint === 'octal') {
      n = parseInt(rawNum.replace(/^0o/, ''), 8);
    } else {
      n = parseInt(rawNum, 10);
    }

    if (Number.isSafeInteger(n) && n >= 0) {
      let out = '';
      if (dst.startsWith('hex')) out = `0x${n.toString(16).toUpperCase()}`;
      else if (dst.startsWith('bin')) out = `0b${n.toString(2)}`;
      else if (dst.startsWith('oct')) out = `0o${n.toString(8)}`;
      else out = String(n);
      return {
        label: s,
        answer: out,
        insertText: `= ${out}`,
        kind: 'base',
      };
    }
  }

  // Unit conversion: "100 km to miles", "37 C to F", "2048 MB in GB"
  const unitMatch = /^(-?\d+(?:\.\d+)?)\s*°?\s*([a-zA-Z/]+)\s+(?:to|in|->|=>)\s+°?\s*([a-zA-Z/]+)$/i.exec(s);
  if (!unitMatch) return null;
  const val = parseFloat(unitMatch[1]);
  const fromRaw = unitMatch[2].toLowerCase();
  const toRaw = unitMatch[3].toLowerCase();
  if (fromRaw === toRaw) return null;

  // Temperature
  const tempMap = { c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
  if (tempMap[fromRaw] && tempMap[toRaw]) {
    const f = tempMap[fromRaw];
    const t = tempMap[toRaw];
    let celsius = val;
    if (f === 'f') celsius = ((val - 32) * 5) / 9;
    else if (f === 'k') celsius = val - 273.15;
    let res = celsius;
    if (t === 'f') res = (celsius * 9) / 5 + 32;
    else if (t === 'k') res = celsius + 273.15;
    const unitLabel = t === 'k' ? 'K' : `°${t.toUpperCase()}`;
    return {
      label: s,
      answer: `${formatSmartNumber(res)} ${unitLabel}`,
      insertText: `= ${formatSmartNumber(res)} ${unitLabel}`,
      kind: 'unit',
    };
  }

  const tables = [LENGTH_TO_M, MASS_TO_G, DATA_TO_BYTES, SPEED_TO_MS, TIME_TO_S, ANGLE_TO_DEG];
  for (const tbl of tables) {
    if (tbl[fromRaw] !== undefined && tbl[toRaw] !== undefined) {
      const res = (val * tbl[fromRaw]) / tbl[toRaw];
      return {
        label: s,
        answer: `${formatSmartNumber(res)} ${unitMatch[3]}`,
        insertText: `= ${formatSmartNumber(res)} ${unitMatch[3]}`,
        kind: 'unit',
      };
    }
  }
  return null;
}

/** 3. Algebraic 1-Variable Equation Solver (Linear, Quadratic, & Numeric Root Fallback) */
export function solveAlgebraEquation(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 100 || !s.includes('=')) return null;
  // Skip variable assignment ("x = 5" or "quiz = 45"), comparison ("==" / "<=" / ">="), or function definition ("y = 2x+1")
  if (/[<>!]=|==/.test(s)) return null;
  const parts = s.split('=');
  if (parts.length !== 2) return null;
  const lhsRaw = parts[0].trim();
  const rhsRaw = parts[1].trim();
  if (!lhsRaw || !rhsRaw) return null;
  if (/^(?:y|f\s*\(\s*x\s*\))$/i.test(lhsRaw)) return null;

  // Identify single algebraic unknown variable (excluding known function names & constants pi, e)
  const strippedFns = `${lhsRaw} ${rhsRaw}`
    .replace(/\b(?:sin|cos|tan|asin|acos|atan|sqrt|abs|log|ln|exp|floor|ceil|round|pi|e)\b/gi, ' ');
  const varMatches = strippedFns.match(/[a-zA-Z]+/g) || [];
  const uniqueVars = [...new Set(varMatches)];
  if (uniqueVars.length !== 1 || uniqueVars[0].length !== 1) return null;
  const varName = uniqueVars[0];
  // Pure assignment like "x = 12" (LHS is just variable and RHS has no variable) -> skip
  if (lhsRaw === varName && !new RegExp(`\\b${varName}\\b`).test(rhsRaw)) return null;

  // Replace single-letter variable with x for mathGrapher compiler
  const toX = expr =>
    varName === 'x'
      ? expr
      : expr.replace(
          new RegExp(`(?<![a-zA-Z])${varName}(?![a-zA-Z])`, 'g'),
          'x'
        );

  let fLhs;
  let fRhs;
  try {
    fLhs = compileMathExpression(toX(lhsRaw));
    fRhs = compileMathExpression(toX(rhsRaw));
  } catch {
    return null;
  }

  const g = x => fLhs(x) - fRhs(x);
  const g0 = g(0);
  const g1 = g(1);
  const gm1 = g(-1);
  const g2 = g(2);
  const gm2 = g(-2);
  if (![g0, g1, gm1, g2, gm2].every(Number.isFinite)) return null;

  const d2 = g1 - 2 * g0 + gm1;
  const d3 = g2 - 3 * g1 + 3 * g0 - gm1;

  // Case A: Linear equation a*x + b = 0
  if (Math.abs(d2) < 1e-8 && Math.abs(d3) < 1e-8) {
    const a = g1 - g0;
    const b = g0;
    if (Math.abs(a) < 1e-10) {
      const msg = Math.abs(b) < 1e-9 ? 'All real numbers (identity)' : 'No solution';
      return {
        label: s,
        answer: msg,
        insertText: `→ ${msg}`,
        graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
        kind: 'equation',
      };
    }
    const root = -b / a;
    if (Math.abs(g(root)) < 1e-6) {
      const ans = `${varName} = ${formatSmartNumber(root)}`;
      return {
        label: s,
        answer: ans,
        insertText: `→ ${ans}`,
        graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
        kind: 'equation',
      };
    }
  }

  // Case B: Quadratic equation a*x^2 + b*x + c = 0
  if (Math.abs(d3) < 1e-7) {
    const a = d2 / 2;
    const b = (g1 - gm1) / 2;
    const c = g0;
    const check2 = a * 4 + b * 2 + c;
    const checkM2 = a * 4 - b * 2 + c;
    if (Math.abs(a) > 1e-9 && Math.abs(check2 - g2) < 1e-6 && Math.abs(checkM2 - gm2) < 1e-6) {
      const disc = b * b - 4 * a * c;
      if (disc > 1e-10) {
        const sq = Math.sqrt(disc);
        const r1 = (-b - sq) / (2 * a);
        const r2 = (-b + sq) / (2 * a);
        const sorted = [r1, r2].sort((u, v) => u - v);
        const ans = `${varName} = ${formatSmartNumber(sorted[0])}, ${varName} = ${formatSmartNumber(sorted[1])}`;
        return {
          label: s,
          answer: ans,
          insertText: `→ ${ans}`,
          graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
          kind: 'quadratic',
        };
      }
      if (Math.abs(disc) <= 1e-10) {
        const r = -b / (2 * a);
        const ans = `${varName} = ${formatSmartNumber(r)} (double root)`;
        return {
          label: s,
          answer: ans,
          insertText: `→ ${varName} = ${formatSmartNumber(r)}`,
          graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
          kind: 'quadratic',
        };
      }
      // Complex conjugate roots
      const real = -b / (2 * a);
      const imag = Math.sqrt(-disc) / Math.abs(2 * a);
      const realStr = Math.abs(real) < 1e-10 ? '' : `${formatSmartNumber(real)} `;
      const ans = `${varName} = ${realStr}± ${formatSmartNumber(imag)}i`;
      return {
        label: s,
        answer: ans,
        insertText: `→ ${ans}`,
        graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
        kind: 'quadratic',
      };
    }
  }

  // Case C: Higher-degree / transcendental numeric roots on [-100, 100]
  try {
    const roots = findApproxRoots(g, -100, 100, 1200);
    if (roots.length > 0) {
      const fmt = roots.slice(0, 4).map(r => formatSmartNumber(r)).join(', ');
      const ans = `${varName} ≈ ${fmt}`;
      return {
        label: s,
        answer: ans,
        insertText: `→ ${ans}`,
        graphExpr: toX(`${lhsRaw} - (${rhsRaw})`),
        kind: 'equation',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/** 4. Pure Arithmetic / Scientific Expression (zero eval!) */
export function solveArithmeticLine(raw) {
  let s = String(raw || '').trim().replace(/=\s*$/, '').trim();
  if (!s || s.length < 3 || s.length > 100) return null;

  // Strip optional list prefix ("1) 45 - 12") or prose label ("Total: 150 + 250")
  const listStripped = s.replace(/^\d+[.)]\s+/, '').trim();
  if (listStripped !== s && /[+\-−–—*/^×÷]|plus|minus|times|divided/i.test(listStripped)) {
    s = listStripped;
  } else {
    const labelMatch = /^[A-Za-z][A-Za-z0-9\s_-]{0,24}\s*[:=]\s*(.+)$/.exec(s);
    if (labelMatch) {
      const rhs = labelMatch[1].trim();
      if (rhs && /[+\-−–—*/^×÷]|plus|minus|times|divided/i.test(rhs)) {
        s = rhs;
      }
    }
  }

  // Skip real dates (YYYY-MM-DD or MM/DD/YYYY) — NEVER block simple division like "10/2" or "8/4"!
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return null;

  // Normalize word operators & casual 'x' multiplication between numbers BEFORE algebra var check
  let normalized = s
    .replace(/\b(\d+(?:\.\d+)?)\s+(?:plus|added\s+to)\s+(\d+(?:\.\d+)?)\b/gi, '$1 + $2')
    .replace(/\b(\d+(?:\.\d+)?)\s+minus\s+(\d+(?:\.\d+)?)\b/gi, '$1 - $2')
    .replace(/\b(\d+(?:\.\d+)?)\s+(?:times|multiplied\s+by)\s+(\d+(?:\.\d+)?)\b/gi, '$1 * $2')
    .replace(/\b(\d+(?:\.\d+)?)\s+(?:divided\s+by|over)\s+(\d+(?:\.\d+)?)\b/gi, '$1 / $2')
    .replace(/(\d(?:\.\d+)?|\))\s*[xX]\s*(?=\d|\()/g, '$1 * ');

  if (!/[+\-−–—*/^×÷·]|(?:sin|cos|tan|sqrt|abs|log|ln|exp|floor|ceil|round)\s*\(/i.test(normalized)) {
    return null;
  }
  // Reject algebraic variable x (handled as graphable function or equation)
  if (/(?<![a-zA-Z])x(?![a-zA-Z])/i.test(normalized.replace(/\bexp\b/gi, ''))) return null;

  try {
    const fn = compileMathExpression(normalized);
    const val = fn(0);
    if (!Number.isFinite(val)) return null;
    const ans = formatSmartNumber(val);
    if (ans === s || ans === normalized) return null;
    return {
      label: s,
      answer: ans,
      insertText: `= ${ans}`,
      kind: 'arithmetic',
    };
  } catch {
    return null;
  }
}

/** 5. Multi-line Variable Scratchpad (Soulver-style: a = 45; b = 88; a*0.3 + b*0.7) */
export function solveVariableScratchpad(lines = []) {
  const env = Object.create(null);
  let lastResult = null;
  const assignRe = /^([a-zA-Z_][a-zA-Z0-9_]{0,15})\s*=\s*(-?\d+(?:\.\d+)?)$/;

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    const am = assignRe.exec(line);
    if (am) {
      const name = am[1];
      if (!/^(?:pi|e|sin|cos|tan|sqrt|log|ln|abs|exp|x)$/i.test(name)) {
        env[name] = parseFloat(am[2]);
      }
      continue;
    }

    const keys = Object.keys(env);
    if (keys.length === 0) continue;
    const cleanExpr = line.replace(/=\s*$/, '').trim();
    if (!/[+\-*/^×÷]/.test(cleanExpr)) continue;

    // Check if line uses at least one defined variable
    let usedVar = false;
    let substituted = cleanExpr;
    for (const k of keys.sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?<![a-zA-Z0-9_])${k}(?![a-zA-Z0-9_])`, 'g');
      if (re.test(substituted)) {
        usedVar = true;
        substituted = substituted.replace(re, `(${env[k]})`);
      }
    }
    if (!usedVar) continue;

    try {
      const fn = compileMathExpression(substituted);
      const val = fn(0);
      if (Number.isFinite(val)) {
        const ans = formatSmartNumber(val);
        lastResult = {
          label: cleanExpr,
          answer: ans,
          insertText: `= ${ans}`,
          kind: 'scratchpad',
        };
      }
    } catch {
      // ignore non-math lines
    }
  }
  return lastResult;
}

/** 6. Graphable function detector ("y = x^2 - 4x + 3", "f(x) = sin(x)") */
export function detectGraphableFunction(raw) {
  const s = String(raw || '').trim();
  if (!/^(?:y|f\s*\(\s*x\s*\))\s*=\s*.+/i.test(s)) return null;
  const rhs = s.replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '').trim();
  if (!rhs || !/(?<![a-zA-Z])x(?![a-zA-Z])/i.test(rhs.replace(/\bexp\b/gi, ''))) return null;
  try {
    const fn = compileMathExpression(rhs);
    if (!Number.isFinite(fn(1)) && !Number.isFinite(fn(0.5))) return null;
    return {
      label: s,
      expr: rhs,
      answer: `f(0) = ${formatSmartNumber(fn(0))}`,
      graphExpr: rhs,
      kind: 'function',
    };
  } catch {
    return null;
  }
}

/** 7. Chemistry Molar Mass & Reaction Solver (100% offline!) */
const ATOMIC_WEIGHTS = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996,
  Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
  As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Ag: 107.868, Cd: 112.414,
  Sn: 118.71, Sb: 121.76, I: 126.904, Xe: 131.293, Cs: 132.905, Ba: 137.327, Pt: 195.084,
  Au: 196.967, Hg: 200.592, Pb: 207.2, U: 238.029,
};

const COMMON_NON_CHEM_WORDS = new Set([
  'In', 'As', 'At', 'No', 'He', 'Be', 'Am', 'Si', 'Co', 'Pa', 'Po', 'La', 'Ge', 'CS', 'IT',
  'OK', 'OS', 'AI', 'UI', 'UX', 'IP', 'PC', 'IS', 'OF', 'OR', 'IF', 'ON', 'TO', 'BY', 'SO',
  'HI', 'UP', 'MY', 'US', 'WE', 'DO', 'GO', 'NO', 'AM', 'PM', 'PIN', 'BIN', 'SIN', 'COS', 'TAN',
  'LOG', 'SQL', 'CSS', 'PHP', 'API', 'URL', 'PDF', 'PPT', 'DOC', 'JSON', 'HTML', 'HTTP', 'HTTPS',
  'CANVAS', 'NOTE', 'NOTES', 'CLASS', 'CODE', 'MATH', 'PHYS', 'CHEM',
]);

export function parseChemicalFormula(formula) {
  const s = String(formula || '').trim();
  if (!s || s.length < 2 || s.length > 32 || !/^[A-Za-z0-9()]+$/.test(s)) return null;
  if (COMMON_NON_CHEM_WORDS.has(s) || COMMON_NON_CHEM_WORDS.has(s.toUpperCase())) return null;

  let i = 0;
  function parseGroup() {
    const counts = Object.create(null);
    let tokens = 0;
    while (i < s.length) {
      if (s[i] === '(') {
        i += 1;
        const inner = parseGroup();
        if (!inner || s[i] !== ')') return null;
        i += 1;
        let numStr = '';
        while (i < s.length && s[i] >= '0' && s[i] <= '9') numStr += s[i++];
        const mult = numStr ? parseInt(numStr, 10) : 1;
        for (const [el, cnt] of Object.entries(inner)) {
          counts[el] = (counts[el] || 0) + cnt * mult;
        }
        tokens += 1;
      } else if (s[i] === ')') {
        break;
      } else if (s[i] >= 'A' && s[i] <= 'Z') {
        let el = s[i++];
        if (i < s.length && s[i] >= 'a' && s[i] <= 'z') el += s[i++];
        if (ATOMIC_WEIGHTS[el] === undefined) return null;
        let numStr = '';
        while (i < s.length && s[i] >= '0' && s[i] <= '9') numStr += s[i++];
        const cnt = numStr ? parseInt(numStr, 10) : 1;
        if (cnt > 500) return null;
        counts[el] = (counts[el] || 0) + cnt;
        tokens += 1;
      } else {
        return null;
      }
    }
    return tokens > 0 ? counts : null;
  }

  const counts = parseGroup();
  if (!counts || i !== s.length) return null;

  const elements = Object.keys(counts);
  const hasDigitOrParen = /[0-9()]/.test(s);
  // Strict anti-false-positive guard: require a digit/paren OR >= 2 elements with at least one lowercase or well-known compound
  if (!hasDigitOrParen) {
    if (elements.length < 2) return null;
    const hasLowercaseElement = elements.some(e => e.length === 2);
    if (!hasLowercaseElement && !['HCl', 'HF', 'HI', 'HBr', 'CO', 'NO', 'OH', 'CN', 'NH'].includes(s)) {
      return null;
    }
    // Reject normal TitleCase English words like "In" or "No" or "Co" or "BiO" unless valid 2+ element formula with known chemistry pattern
    if (/^[A-Z][a-z]+$/.test(s)) return null;
  }

  let mass = 0;
  for (const [el, cnt] of Object.entries(counts)) {
    mass += ATOMIC_WEIGHTS[el] * cnt;
  }
  const breakdown = Object.entries(counts)
    .map(([el, cnt]) => `${el}${cnt > 1 ? `×${cnt}` : ''}`)
    .join(' + ');

  return {
    formula: s,
    molarMass: Number(mass.toFixed(3)),
    breakdown,
    counts,
  };
}

export function solveChemistryText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  // Check for chemical reaction line: "H2 + O2 -> H2O" or "NaOH + HCl → NaCl + H2O"
  const lines = raw.split(/\r?\n/);
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    const line = lines[idx].trim();
    if (/(?:->|=>|→)/.test(line)) {
      const tokens = line.split(/[^A-Za-z0-9()]+/).filter(Boolean);
      const validCompounds = tokens.map(parseChemicalFormula).filter(Boolean);
      if (validCompounds.length >= 2) {
        return {
          kind: 'reaction',
          reaction: line,
          compounds: validCompounds,
          answer: validCompounds
            .slice(0, 3)
            .map(c => `${c.formula}: ${c.molarMass} g/mol`)
            .join(' · '),
        };
      }
    }
  }

  // Otherwise check last 10 lines for a standalone or mentioned chemical formula
  const recentLines = lines.slice(-10).reverse();
  for (const line of recentLines) {
    const tokens = line.split(/[^A-Za-z0-9()]+/).filter(Boolean);
    for (const tok of tokens) {
      const parsed = parseChemicalFormula(tok);
      if (parsed) {
        return {
          kind: 'molar_mass',
          formula: parsed.formula,
          molarMass: parsed.molarMass,
          breakdown: parsed.breakdown,
          answer: `${parsed.formula} = ${parsed.molarMass} g/mol`,
          insertText: `${parsed.formula} molar mass = ${parsed.molarMass} g/mol (${parsed.breakdown})`,
        };
      }
    }
  }
  return null;
}

/** 8. Physics Quick Solver (F = ma, v = d/t, V = I*R, P = V*I, KE, PE, Kinematics) */
export function solvePhysicsText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  // Extract labeled quantities with optional units: e.g. "m = 5 kg", "a = 3 m/s^2", "V = 12V", "R = 4 ohm"
  const vals = Object.create(null);
  const re = /\b(m|a|F|d|s|t|v|v0|u|V|I|R|P|h|g)\s*=\s*(-?\d+(?:\.\d+)?)\s*(kg|g|m\/s\^2|m\/s2|m\/s|km\/h|m|km|cm|s|min|hr|N|V|A|ohm|Ω|W|J)?\b/g;
  let m;
  let hasPhysicsUnit = false;
  while ((m = re.exec(raw)) !== null) {
    const sym = m[1];
    let val = parseFloat(m[2]);
    const unit = (m[3] || '').toLowerCase();
    if (unit) hasPhysicsUnit = true;
    // Normalize common units to SI
    if (sym === 'm' && unit === 'g') val /= 1000;
    if ((sym === 'd' || sym === 'h' || sym === 's') && unit === 'km') val *= 1000;
    if ((sym === 'd' || sym === 'h' || sym === 's') && unit === 'cm') val /= 100;
    if (sym === 't' && unit === 'min') val *= 60;
    if (sym === 't' && unit === 'hr') val *= 3600;
    if ((sym === 'v' || sym === 'v0' || sym === 'u') && unit === 'km/h') val /= 3.6;
    vals[sym] = val;
  }

  const results = [];
  // Only solve offline if at least one physics unit OR >= 2 physics variables with known physics keywords/units
  const hasPhysicsContext =
    hasPhysicsUnit ||
    /\b(?:force|mass|accel|velocity|speed|ohm|volt|amp|current|resistance|power|kinetic|potential|gravity|newton|joule|watt|kinematics)\b/i.test(raw);

  if (hasPhysicsContext) {
    // Newton's 2nd Law: F = m * a
    if (vals.m !== undefined && vals.a !== undefined && vals.F === undefined) {
      results.push(`F = m·a = ${formatSmartNumber(vals.m * vals.a)} N`);
    } else if (vals.F !== undefined && vals.m !== undefined && vals.m !== 0 && vals.a === undefined) {
      results.push(`a = F/m = ${formatSmartNumber(vals.F / vals.m)} m/s²`);
    } else if (vals.F !== undefined && vals.a !== undefined && vals.a !== 0 && vals.m === undefined) {
      results.push(`m = F/a = ${formatSmartNumber(vals.F / vals.a)} kg`);
    }

    // Ohm's Law & Electrical Power: V = I * R, P = V * I
    if (vals.V !== undefined && vals.R !== undefined && vals.R !== 0 && vals.I === undefined) {
      const I = vals.V / vals.R;
      results.push(`I = V/R = ${formatSmartNumber(I)} A, P = ${formatSmartNumber(vals.V * I)} W`);
    } else if (vals.I !== undefined && vals.R !== undefined && vals.V === undefined) {
      const V = vals.I * vals.R;
      results.push(`V = I·R = ${formatSmartNumber(V)} V, P = ${formatSmartNumber(V * vals.I)} W`);
    } else if (vals.V !== undefined && vals.I !== undefined && vals.I !== 0 && vals.R === undefined) {
      results.push(`R = V/I = ${formatSmartNumber(vals.V / vals.I)} Ω, P = ${formatSmartNumber(vals.V * vals.I)} W`);
    }

    // Kinematics / Speed
    if (vals.d !== undefined && vals.t !== undefined && vals.t !== 0 && vals.v === undefined && vals.a === undefined) {
      results.push(`v = d/t = ${formatSmartNumber(vals.d / vals.t)} m/s`);
    } else if (vals.v !== undefined && vals.t !== undefined && vals.d === undefined && vals.a === undefined) {
      results.push(`d = v·t = ${formatSmartNumber(vals.v * vals.t)} m`);
    } else if (vals.a !== undefined && vals.t !== undefined) {
      const v0 = vals.v0 ?? vals.u ?? 0;
      const vf = v0 + vals.a * vals.t;
      const dist = v0 * vals.t + 0.5 * vals.a * vals.t * vals.t;
      results.push(`vf = ${formatSmartNumber(vf)} m/s, d = ${formatSmartNumber(dist)} m`);
    }

    // Kinetic & Potential Energy
    if (vals.m !== undefined && vals.v !== undefined) {
      results.push(`KE = ½mv² = ${formatSmartNumber(0.5 * vals.m * vals.v * vals.v)} J`);
    }
    if (vals.m !== undefined && vals.h !== undefined) {
      const g = vals.g ?? 9.81;
      results.push(`PE = mgh = ${formatSmartNumber(vals.m * g * vals.h)} J`);
    }
  }

  if (results.length > 0) {
    return {
      kind: 'physics_solved',
      answer: results.slice(0, 2).join(' · '),
      insertText: results.join('\n'),
    };
  }

  // Fallback: detect recognized physics formula strings for 1-tap AI solve
  const formulaMatch = /\b(F\s*=\s*m\s*\*?\s*a|E\s*=\s*m\s*c\^?2|P\s*V\s*=\s*n\s*R\s*T|V\s*=\s*I\s*\*?\s*R|KE\s*=\s*(?:1\/2|0\.5)\s*m\s*v\^?2|PE\s*=\s*m\s*g\s*h)\b/i.exec(raw);
  if (formulaMatch) {
    return {
      kind: 'physics_formula',
      formula: formulaMatch[1],
      answer: `Physics formula: ${formulaMatch[1]}`,
    };
  }
  return null;
}

/** 9. Statistics & Grade Average Detector (3+ numbers in a comma/space list) */
export function solveNumberStats(text) {
  const lines = String(text || '').split(/\r?\n/).reverse();
  for (const rawLine of lines.slice(0, 8)) {
    const line = rawLine.trim();
    if (!line || line.length > 180) continue;
    // Strip optional label like "scores: " or "grades = "
    const cleaned = line.replace(/^(?:scores|grades|data|nums|numbers|values|quiz|quizzes)\s*[:=]\s*/i, '');
    // Require comma-separated numbers like "85, 90, 78, 92"
    if (!/,/.test(cleaned)) continue;
    const parts = cleaned.split(/\s*,\s*/).filter(Boolean);
    if (parts.length < 3 || parts.length > 40) continue;
    if (!parts.every(p => /^-?\d+(?:\.\d+)?$/.test(p))) continue;

    const nums = parts.map(Number);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const variance = nums.reduce((acc, x) => acc + (x - mean) ** 2, 0) / nums.length;
    const sd = Math.sqrt(variance);

    const summary = `Avg: ${formatSmartNumber(mean)} · Med: ${formatSmartNumber(median)} · Sum: ${formatSmartNumber(sum)}`;
    const insertText = `Stats (n=${nums.length}): Mean = ${formatSmartNumber(mean)}, Median = ${formatSmartNumber(median)}, Min = ${sorted[0]}, Max = ${sorted[sorted.length - 1]}, Sum = ${formatSmartNumber(sum)}, SD = ${formatSmartNumber(sd)}`;

    return {
      count: nums.length,
      mean,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      sum,
      sd,
      answer: summary,
      insertText,
    };
  }
  return null;
}

/** 10. IPv4 CIDR Subnet Calculator (100% offline — IT/Networking goldmine!) */
export function solveSubnetCidr(text) {
  const m = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\/(3[0-2]|[12]?\d)\b/.exec(
    String(text || '')
  );
  if (!m) return null;
  const cidr = m[0];
  const [ipStr, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const octets = ipStr.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return null;

  const ipInt = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  const maskInt = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const netInt = (ipInt & maskInt) >>> 0;
  const bcastInt = (netInt | (~maskInt >>> 0)) >>> 0;

  const intToIp = x => `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
  const totalHosts = 2 ** (32 - prefix);
  const usableHosts = prefix >= 31 ? totalHosts : Math.max(0, totalHosts - 2);
  const firstHost = prefix >= 31 ? intToIp(netInt) : intToIp((netInt + 1) >>> 0);
  const lastHost = prefix >= 31 ? intToIp(bcastInt) : intToIp((bcastInt - 1) >>> 0);

  const network = intToIp(netInt);
  const broadcast = intToIp(bcastInt);
  const mask = intToIp(maskInt);

  return {
    cidr,
    network,
    broadcast,
    mask,
    firstHost,
    lastHost,
    usableHosts,
    answer: `Mask ${mask} · ${usableHosts.toLocaleString()} hosts (${firstHost}–${lastHost})`,
    insertText: `Subnet ${cidr}\n- Network: ${network}\n- Mask: ${mask}\n- Broadcast: ${broadcast}\n- Usable Hosts (${usableHosts.toLocaleString()}): ${firstHost} – ${lastHost}`,
  };
}

/** 11. Color Hex / RGB Detector */
export function detectColorToken(text) {
  const s = String(text || '');
  const hexMatch = /(?<![A-Za-z0-9])#([0-9a-fA-F]{6})\b/.exec(s);
  if (hexMatch) {
    const hex = `#${hexMatch[1].toLowerCase()}`;
    const r = parseInt(hexMatch[1].slice(0, 2), 16);
    const g = parseInt(hexMatch[1].slice(2, 4), 16);
    const b = parseInt(hexMatch[1].slice(4, 6), 16);
    return {
      hex,
      rgb: `rgb(${r}, ${g}, ${b})`,
      answer: `${hex} · rgb(${r}, ${g}, ${b})`,
      insertText: `${hex} = rgb(${r}, ${g}, ${b})`,
    };
  }
  const rgbMatch = /\brgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i.exec(s);
  if (rgbMatch) {
    const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    if (r <= 255 && g <= 255 && b <= 255) {
      const toHex = n => n.toString(16).padStart(2, '0');
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      return {
        hex,
        rgb: `rgb(${r}, ${g}, ${b})`,
        answer: `${hex} · rgb(${r}, ${g}, ${b})`,
        insertText: `rgb(${r}, ${g}, ${b}) = ${hex}`,
      };
    }
  }
  return null;
}

/**
 * Unified math entry point for a note body: inspects the latest relevant lines
 * and returns the cleanest instant offline math solution (or null if none).
 */
export function detectBestMathSolution(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  // Check multi-line variable scratchpad first if variables are declared
  const scratch = solveVariableScratchpad(lines.slice(-15));
  if (scratch) return scratch;

  // Scan from bottom up (most recently typed line gets top priority!)
  const recent = lines.slice(-8).reverse();
  for (const line of recent) {
    // Strip leading bullet/checkbox markers cleanly
    const clean = line.replace(/^[-*•]\s*(?:\[[ xX]\]\s*)?/, '').trim();
    if (!clean) continue;

    const unit = solveUnitOrBase(clean);
    if (unit) return unit;

    const pct = solvePercentageLine(clean);
    if (pct) return pct;

    const eq = solveAlgebraEquation(clean);
    if (eq) return eq;

    const fn = detectGraphableFunction(clean);
    if (fn) return fn;

    const arith = solveArithmeticLine(clean);
    if (arith) return arith;
  }

  return null;
}
