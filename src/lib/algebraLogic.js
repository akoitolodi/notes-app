/**
 * algebraLogic — 100% offline, zero-eval Algebraic Calculator & Discrete/Conditional Logic Engine:
 * 1. Detailed 1-Variable Linear/Quadratic Solver (steps, discriminant, vertex, factor form)
 * 2. 2x2 Linear System Solver (Cramer's rule + step breakdown)
 * 3. Single-Variable Polynomial Simplify / Expand / Factor / Evaluate
 * 4. Propositional Logic Truth Table & Equivalence Checker (NOT, AND, OR, XOR, ->, <-> / IFF, IF..THEN..ELSE)
 * 5. Practical Rule Evaluator (if <cond> then <val> else if <cond> then <val> else <val>)
 */
import { compileMathExpression, findApproxRoots } from './mathGrapher';
import { formatSmartNumber } from './mathSolver';

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function fmtCoeffTerm(coeff, deg, isFirst) {
  if (Math.abs(coeff) < 1e-10) return '';
  const sign = coeff < 0 ? '-' : isFirst ? '' : '+';
  const abs = Math.abs(coeff);
  const numStr = deg > 0 && Math.abs(abs - 1) < 1e-10 ? '' : formatSmartNumber(abs);
  const varStr = deg === 0 ? '' : deg === 1 ? 'x' : `x^${deg}`;
  const prefix = isFirst ? (coeff < 0 ? '-' : '') : ` ${sign} `;
  return `${prefix}${numStr}${varStr}`;
}

export function formatPolynomial(coeffs = []) {
  const clean = coeffs.map(c => (Math.abs(c) < 1e-10 ? 0 : c));
  let out = '';
  for (let d = clean.length - 1; d >= 0; d--) {
    if (clean[d] === 0) continue;
    out += fmtCoeffTerm(clean[d], d, out.length === 0);
  }
  return out || '0';
}

function factorIntegerQuadratic(a, b, c) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c) || a === 0) return '';
  const disc = b * b - 4 * a * c;
  if (disc < 0) return '';
  const sq = Math.round(Math.sqrt(disc));
  if (sq * sq !== disc) return '';

  // ax^2 + bx + c = (a/g) ... using root fractions (-b +/- sq) / (2a)
  const overallG = gcd(gcd(a, b), c);
  const A = a / overallG;
  const B = b / overallG;
  const C = c / overallG;
  const signPrefix = overallG === 1 ? '' : `${overallG}`;
  if (A < 0) return '';

  const D = Math.round(Math.sqrt(B * B - 4 * A * C));
  // Factor p1*x + q1 and p2*x + q2 from exact rational roots
  const mkFactor = numSigned => {
    // root = numSigned / (2*A) -> factor (den*x - num)*? wait: (x - r) = (den*x - num)
    const denRaw = 2 * A;
    const g = gcd(numSigned, denRaw);
    const num = numSigned / g;
    const den = denRaw / g;
    // (den * x - num)
    const xPart = den === 1 ? 'x' : `${den}x`;
    if (num === 0) return xPart;
    return num > 0 ? `(${xPart} - ${num})` : `(${xPart} + ${Math.abs(num)})`;
  };
  const r1Num = -B - D;
  const r2Num = -B + D;
  const f1 = mkFactor(r1Num);
  const f2 = mkFactor(r2Num);
  const wrap1 = f1.startsWith('(') ? f1 : `(${f1})`;
  const wrap2 = f2.startsWith('(') ? f2 : `(${f2})`;
  return wrap1 === wrap2 ? `${signPrefix}${wrap1}^2` : `${signPrefix}${wrap1}${wrap2}`;
}

/** 1. Detailed 1-Variable Algebra Solver */
export function solveAlgebraDetailed(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 120 || !s.includes('=')) {
    throw new Error('Enter an equation containing "=" (e.g. 2x + 5 = 17 or x^2 - 5x + 6 = 0).');
  }
  if (/[<>!]=|==/.test(s)) {
    throw new Error('Enter an algebraic "=" equation, not a comparison.');
  }
  const parts = s.split('=');
  if (parts.length !== 2) throw new Error('Equation must have exactly one "=" sign.');
  const lhsRaw = parts[0].trim();
  const rhsRaw = parts[1].trim();
  if (!lhsRaw || !rhsRaw) throw new Error('Both sides of "=" must be non-empty.');

  const strippedFns = `${lhsRaw} ${rhsRaw}`.replace(
    /\b(?:sin|cos|tan|asin|acos|atan|sqrt|abs|log|ln|exp|floor|ceil|round|pi|e)\b/gi,
    ' '
  );
  const varMatches = strippedFns.match(/[a-zA-Z]+/g) || [];
  const uniqueVars = [...new Set(varMatches)];
  if (uniqueVars.length !== 1 || uniqueVars[0].length !== 1) {
    throw new Error('Use a single 1-letter variable (e.g. x, n, t). For two variables use 2x2 System.');
  }
  const v = uniqueVars[0];
  const toX = expr =>
    v === 'x' ? expr : expr.replace(new RegExp(`(?<![a-zA-Z])${v}(?![a-zA-Z])`, 'g'), 'x');

  const fL = compileMathExpression(toX(lhsRaw));
  const fR = compileMathExpression(toX(rhsRaw));
  const g = x => fL(x) - fR(x);
  const graphExpr = toX(`${lhsRaw} - (${rhsRaw})`);

  const g0 = g(0);
  const g1 = g(1);
  const gm1 = g(-1);
  const g2 = g(2);
  const gm2 = g(-2);

  const a = (g1 - 2 * g0 + gm1) / 2;
  const b = (g1 - gm1) / 2;
  const c = g0;
  const fitsQuad =
    Math.abs(a * 4 + b * 2 + c - g2) < 1e-6 && Math.abs(a * 4 - b * 2 + c - gm2) < 1e-6;

  // Linear case
  if (fitsQuad && Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) {
      const identity = Math.abs(c) < 1e-9;
      return {
        kind: identity ? 'identity' : 'none',
        varName: v,
        answer: identity ? `All real numbers (${v} ∈ ℝ)` : 'No solution',
        steps: [
          `Subtract right side from left side: ${formatSmartNumber(c)} = 0`,
          identity ? '0 = 0 is always true for every value.' : 'Contradiction: no value satisfies the equation.',
        ],
        insertText: identity ? '→ All real numbers' : '→ No solution',
        graphExpr,
      };
    }
    const root = -c / b;
    const ans = `${v} = ${formatSmartNumber(root)}`;
    return {
      kind: 'linear',
      varName: v,
      roots: [root],
      answer: ans,
      steps: [
        `1. Move all terms left: ${formatPolynomial([c, b]).replace(/x/g, v)} = 0`,
        `2. Isolate ${v}: ${formatSmartNumber(b)}${v} = ${formatSmartNumber(-c)}`,
        `3. Divide by ${formatSmartNumber(b)}: ${ans}`,
      ],
      insertText: `→ ${ans}`,
      graphExpr,
    };
  }

  // Quadratic case
  if (fitsQuad && Math.abs(a) > 1e-9) {
    const disc = b * b - 4 * a * c;
    const vx = -b / (2 * a);
    const vy = a * vx * vx + b * vx + c;
    const std = `${formatPolynomial([c, b, a]).replace(/x/g, v)} = 0`;
    const factored = factorIntegerQuadratic(a, b, c).replace(/x/g, v);

    if (disc > 1e-10) {
      const sq = Math.sqrt(disc);
      const r1 = (-b - sq) / (2 * a);
      const r2 = (-b + sq) / (2 * a);
      const sorted = [r1, r2].sort((u, m) => u - m);
      const ans = `${v} = ${formatSmartNumber(sorted[0])}, ${v} = ${formatSmartNumber(sorted[1])}`;
      const steps = [
        `1. Standard form: ${std} (a=${formatSmartNumber(a)}, b=${formatSmartNumber(b)}, c=${formatSmartNumber(c)})`,
        factored ? `2. Factor form: ${factored} = 0` : `2. Discriminant Δ = b² - 4ac = ${formatSmartNumber(disc)} (> 0, 2 real roots)`,
        `3. Roots: ${ans}`,
        `4. Vertex: (${formatSmartNumber(vx)}, ${formatSmartNumber(vy)})`,
      ];
      return {
        kind: 'quadratic',
        varName: v,
        discriminant: disc,
        roots: sorted,
        factored,
        vertex: [vx, vy],
        answer: ans,
        steps,
        insertText: `→ ${ans}`,
        graphExpr,
      };
    }

    if (Math.abs(disc) <= 1e-10) {
      const r = -b / (2 * a);
      const ans = `${v} = ${formatSmartNumber(r)} (double root)`;
      return {
        kind: 'quadratic',
        varName: v,
        discriminant: 0,
        roots: [r],
        factored,
        vertex: [vx, vy],
        answer: ans,
        steps: [
          `1. Standard form: ${std}`,
          `2. Discriminant Δ = 0 (exactly 1 repeated root)`,
          `3. ${v} = -b / (2a) = ${formatSmartNumber(r)}`,
        ],
        insertText: `→ ${v} = ${formatSmartNumber(r)}`,
        graphExpr,
      };
    }

    const real = -b / (2 * a);
    const imag = Math.sqrt(-disc) / Math.abs(2 * a);
    const realStr = Math.abs(real) < 1e-10 ? '' : `${formatSmartNumber(real)} `;
    const ans = `${v} = ${realStr}± ${formatSmartNumber(imag)}i`;
    return {
      kind: 'quadratic',
      varName: v,
      discriminant: disc,
      roots: [],
      vertex: [vx, vy],
      answer: ans,
      steps: [
        `1. Standard form: ${std}`,
        `2. Discriminant Δ = ${formatSmartNumber(disc)} (< 0, complex conjugate roots)`,
        `3. ${ans}`,
      ],
      insertText: `→ ${ans}`,
      graphExpr,
    };
  }

  // Higher-degree numeric roots
  const roots = findApproxRoots(g, -100, 100, 1400);
  if (roots.length === 0) {
    throw new Error('No real roots found in [-100, 100]. Try tapping Graph to inspect.');
  }
  const ans = `${v} ≈ ${roots.slice(0, 6).map(r => formatSmartNumber(r)).join(', ')}`;
  return {
    kind: 'numeric',
    varName: v,
    roots,
    answer: ans,
    steps: [
      `1. Rewrite as f(${v}) = (${lhsRaw}) - (${rhsRaw}) = 0`,
      `2. Numeric sign-change scan found root(s): ${ans}`,
    ],
    insertText: `→ ${ans}`,
    graphExpr,
  };
}

/** Parse linear combination of x, y, constant from one side of a 2x2 equation (zero eval!) */
function parseLinearSideXY(raw) {
  const s = String(raw || '').trim();
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const n = parseFloat(s.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`Bad number "${s.slice(i, j)}"`);
      toks.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (ch === 'x' || ch === 'X' || ch === 'y' || ch === 'Y') {
      toks.push({ t: 'var', v: ch.toLowerCase() });
      i++;
      continue;
    }
    throw new Error(`Unsupported symbol "${ch}" in 2x2 system (use x and y).`);
  }

  // Insert implicit '*' between num/var/')' and var/'('
  const exp = [];
  for (let k = 0; k < toks.length; k++) {
    exp.push(toks[k]);
    const a = toks[k];
    const b = toks[k + 1];
    if (!b) continue;
    const lhsVal = a.t === 'num' || a.t === 'var' || (a.t === 'op' && a.v === ')');
    const rhsVal = b.t === 'var' || (b.t === 'op' && b.v === '(');
    if (lhsVal && rhsVal) exp.push({ t: 'op', v: '*' });
  }

  let pos = 0;
  const peek = () => exp[pos];
  const take = () => exp[pos++];

  const addLin = (u, w, sign = 1) => ({
    x: u.x + sign * w.x,
    y: u.y + sign * w.y,
    c: u.c + sign * w.c,
  });
  const mulLin = (u, w) => {
    const uIsConst = Math.abs(u.x) < 1e-10 && Math.abs(u.y) < 1e-10;
    const wIsConst = Math.abs(w.x) < 1e-10 && Math.abs(w.y) < 1e-10;
    if (uIsConst) return { x: u.c * w.x, y: u.c * w.y, c: u.c * w.c };
    if (wIsConst) return { x: w.c * u.x, y: w.c * u.y, c: w.c * u.c };
    throw new Error('2x2 Solver handles linear terms (cannot multiply x and y together).');
  };

  function parseSum() {
    let left = parseProd();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      left = addLin(left, parseProd(), op === '+' ? 1 : -1);
    }
    return left;
  }

  function parseProd() {
    let left = parseUnary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = take().v;
      const right = parseUnary();
      if (op === '*') {
        left = mulLin(left, right);
      } else {
        if (Math.abs(right.x) > 1e-10 || Math.abs(right.y) > 1e-10 || Math.abs(right.c) < 1e-12) {
          throw new Error('Can only divide linear terms by a non-zero number.');
        }
        left = { x: left.x / right.c, y: left.y / right.c, c: left.c / right.c };
      }
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      const sub = parseUnary();
      return op === '-' ? { x: -sub.x, y: -sub.y, c: -sub.c } : sub;
    }
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of equation.');
    if (tk.t === 'num') {
      take();
      return { x: 0, y: 0, c: tk.v };
    }
    if (tk.t === 'var') {
      take();
      return tk.v === 'x' ? { x: 1, y: 0, c: 0 } : { x: 0, y: 1, c: 0 };
    }
    if (tk.t === 'op' && tk.v === '(') {
      take();
      const inner = parseSum();
      if (take()?.v !== ')') throw new Error('Missing closing parenthesis.');
      return inner;
    }
    throw new Error('Invalid linear expression.');
  }

  const res = parseSum();
  if (pos < exp.length) throw new Error('Unexpected trailing input in equation.');
  return res;
}

/** 2. Solve a 2x2 System of Linear Equations using Cramer's Rule */
export function solveSystem2x2(eq1Raw, eq2Raw) {
  const parseEq = raw => {
    const parts = String(raw || '').split('=');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      throw new Error('Each equation must contain "=" (e.g. 2x + y = 10).');
    }
    const l = parseLinearSideXY(parts[0]);
    const r = parseLinearSideXY(parts[1]);
    // (l.x - r.x)x + (l.y - r.y)y = r.c - l.c
    return { a: l.x - r.x, b: l.y - r.y, c: r.c - l.c };
  };

  const e1 = parseEq(eq1Raw);
  const e2 = parseEq(eq2Raw);
  const D = e1.a * e2.b - e2.a * e1.b;
  const Dx = e1.c * e2.b - e2.c * e1.b;
  const Dy = e1.a * e2.c - e2.a * e1.c;

  const fmtLine = e =>
    `${formatSmartNumber(e.a)}x ${e.b >= 0 ? '+' : '-'} ${formatSmartNumber(Math.abs(e.b))}y = ${formatSmartNumber(e.c)}`;

  if (Math.abs(D) < 1e-9) {
    const inf = Math.abs(Dx) < 1e-9 && Math.abs(Dy) < 1e-9;
    return {
      status: inf ? 'infinite' : 'none',
      x: null,
      y: null,
      summary: inf ? 'Infinite solutions (coincident lines)' : 'No solution (parallel lines)',
      steps: [
        `Standardized: (1) ${fmtLine(e1)} | (2) ${fmtLine(e2)}`,
        `Determinant D = (${formatSmartNumber(e1.a)})(${formatSmartNumber(e2.b)}) - (${formatSmartNumber(e2.a)})(${formatSmartNumber(e1.b)}) = 0`,
        inf ? 'Dx = 0 and Dy = 0 → Infinitely many solutions.' : 'Dx or Dy is non-zero → Parallel lines never intersect.',
      ],
    };
  }

  const x = Dx / D;
  const y = Dy / D;
  const fx = formatSmartNumber(x);
  const fy = formatSmartNumber(y);
  return {
    status: 'unique',
    x,
    y,
    summary: `x = ${fx}, y = ${fy}`,
    steps: [
      `1. Standard form: (1) ${fmtLine(e1)}   (2) ${fmtLine(e2)}`,
      `2. Determinant D = ${formatSmartNumber(D)}, Dx = ${formatSmartNumber(Dx)}, Dy = ${formatSmartNumber(Dy)}`,
      `3. x = Dx / D = ${fx},  y = Dy / D = ${fy}`,
    ],
  };
}

/** 3. Single-Variable Polynomial Simplify / Expand / Factor / Evaluate (zero eval!) */
export function expandAndFactorExpr(rawExpr, xEval = null) {
  const s = String(rawExpr || '').trim();
  if (!s) throw new Error('Enter an algebraic expression in x (e.g. (x + 3)(x - 2) or 3x^2 + 2x - x^2).');

  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ('+-*^()'.includes(ch)) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === 'x' || ch === 'X') {
      toks.push({ t: 'x' });
      i++;
      continue;
    }
    throw new Error(`Unsupported character "${ch}". Use variable x, numbers, +, -, *, ^, and ( ).`);
  }

  const exp = [];
  for (let k = 0; k < toks.length; k++) {
    exp.push(toks[k]);
    const a = toks[k];
    const b = toks[k + 1];
    if (!b) continue;
    const lhsVal = a.t === 'num' || a.t === 'x' || (a.t === 'op' && a.v === ')');
    const rhsVal = b.t === 'x' || (b.t === 'op' && b.v === '(');
    if (lhsVal && rhsVal) exp.push({ t: 'op', v: '*' });
  }

  const addPoly = (p, q, sign = 1) => {
    const n = Math.max(p.length, q.length);
    const out = Array(n).fill(0);
    for (let d = 0; d < n; d++) out[d] = (p[d] || 0) + sign * (q[d] || 0);
    return out;
  };
  const mulPoly = (p, q) => {
    const out = Array(Math.max(1, p.length + q.length - 1)).fill(0);
    for (let d1 = 0; d1 < p.length; d1++) {
      for (let d2 = 0; d2 < q.length; d2++) {
        out[d1 + d2] += p[d1] * q[d2];
      }
    }
    return out;
  };
  const powPoly = (p, nRaw) => {
    if (nRaw.length > 1 || !Number.isInteger(nRaw[0]) || nRaw[0] < 0 || nRaw[0] > 6) {
      throw new Error('Exponents must be integers from 0 to 6.');
    }
    let res = [1];
    for (let k = 0; k < nRaw[0]; k++) res = mulPoly(res, p);
    return res;
  };

  let pos = 0;
  const peek = () => exp[pos];
  const take = () => exp[pos++];

  function parseSum() {
    let left = parseProd();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      left = addPoly(left, parseProd(), op === '+' ? 1 : -1);
    }
    return left;
  }
  function parseProd() {
    let left = parsePow();
    while (peek()?.t === 'op' && peek().v === '*') {
      take();
      left = mulPoly(left, parsePow());
    }
    return left;
  }
  function parsePow() {
    let base = parseUnary();
    while (peek()?.t === 'op' && peek().v === '^') {
      take();
      base = powPoly(base, parseUnary());
    }
    return base;
  }
  function parseUnary() {
    if (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      const sub = parseUnary();
      return op === '-' ? sub.map(c => -c) : sub;
    }
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of expression.');
    if (tk.t === 'num') {
      take();
      return [tk.v];
    }
    if (tk.t === 'x') {
      take();
      return [0, 1];
    }
    if (tk.t === 'op' && tk.v === '(') {
      take();
      const inner = parseSum();
      if (take()?.v !== ')') throw new Error('Missing ")".');
      return inner;
    }
    throw new Error('Invalid algebraic syntax.');
  }

  const coeffs = parseSum();
  if (pos < exp.length) throw new Error('Unexpected trailing tokens.');
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < 1e-10) coeffs.pop();
  const degree = coeffs.length - 1;
  const simplified = formatPolynomial(coeffs);
  const factored =
    degree === 2
      ? factorIntegerQuadratic(coeffs[2], coeffs[1] || 0, coeffs[0] || 0)
      : '';
  const evalNum = Number(xEval);
  const evaluated =
    xEval !== null && xEval !== '' && Number.isFinite(evalNum)
      ? coeffs.reduce((acc, c, d) => acc + c * evalNum ** d, 0)
      : null;

  return {
    coeffs,
    degree,
    simplified,
    factored: factored || null,
    evaluated: evaluated !== null ? formatSmartNumber(evaluated) : null,
  };
}

/** 4. Propositional Logic & IF/THEN/ELSE/IFF Truth Table Engine */
const LOGIC_KEYWORDS = new Set([
  'IF', 'THEN', 'ELSE', 'AND', 'OR', 'XOR', 'XNOR', 'NXOR', 'NOT', 'IMPLIES', 'IFF', 'ONLY',
  'TRUE', 'FALSE', 'T', 'F',
]);

function tokenizeLogic(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Enter a logical expression (e.g. P -> Q, P iff Q, if P then Q else R).');
  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (s.slice(i, i + 3) === '<->' || s.slice(i, i + 3) === '<=>') {
      tokens.push({ t: 'IFF', v: '<->' });
      i += 3;
      continue;
    }
    if (s.slice(i, i + 2) === '->' || s.slice(i, i + 2) === '=>') {
      tokens.push({ t: 'IMPLIES', v: '->' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 2) === '&&') {
      tokens.push({ t: 'AND', v: 'AND' });
      i += 2;
      continue;
    }
    if (s.slice(i, i + 2) === '||') {
      tokens.push({ t: 'OR', v: 'OR' });
      i += 2;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ t: ch, v: ch });
      i++;
      continue;
    }
    if (ch === '!' || ch === '~' || ch === '¬') {
      tokens.push({ t: 'NOT', v: 'NOT' });
      i++;
      continue;
    }
    if (ch === '&' || ch === '∧') {
      tokens.push({ t: 'AND', v: 'AND' });
      i++;
      continue;
    }
    if (ch === '|' || ch === '∨') {
      tokens.push({ t: 'OR', v: 'OR' });
      i++;
      continue;
    }
    if (ch === '^' || ch === '⊕') {
      tokens.push({ t: 'XOR', v: 'XOR' });
      i++;
      continue;
    }
    if (ch === '→') {
      tokens.push({ t: 'IMPLIES', v: '->' });
      i++;
      continue;
    }
    if (ch === '↔') {
      tokens.push({ t: 'IFF', v: '<->' });
      i++;
      continue;
    }
    if (ch === '1' || ch === '0') {
      tokens.push({ t: 'BOOL', v: ch === '1' });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const up = word.toUpperCase();

      // Match multi-word "if and only if"
      if (up === 'IF') {
        const rest = s.slice(j);
        const iffMatch = /^\s+and\s+only\s+if\b/i.exec(rest);
        if (iffMatch) {
          tokens.push({ t: 'IFF', v: 'IFF' });
          i = j + iffMatch[0].length;
          continue;
        }
        tokens.push({ t: 'IF', v: 'IF' });
        i = j;
        continue;
      }

      if (up === 'THEN' || up === 'ELSE' || up === 'AND' || up === 'OR' || up === 'XOR' || up === 'NOT' || up === 'IMPLIES' || up === 'IFF') {
        tokens.push({ t: up, v: up });
      } else if (up === 'XNOR' || up === 'NXOR') {
        tokens.push({ t: 'IFF', v: 'XNOR' });
      } else if (up === 'TRUE' || up === 'T') {
        tokens.push({ t: 'BOOL', v: true });
      } else if (up === 'FALSE' || up === 'F') {
        tokens.push({ t: 'BOOL', v: false });
      } else {
        tokens.push({ t: 'VAR', v: word });
      }
      i = j;
      continue;
    }
    throw new Error(`Unexpected symbol "${ch}" in logic formula.`);
  }
  return tokens;
}

function compileLogicAst(raw) {
  const tokens = tokenizeLogic(raw);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const varsSet = new Set();

  function parseTernary() {
    if (peek()?.t === 'IF') {
      take();
      const cond = parseIff();
      if (take()?.t !== 'THEN') {
        throw new Error('Expected "THEN" after "IF <condition>".');
      }
      const thenNode = parseIff();
      if (peek()?.t === 'ELSE') {
        take();
        const elseNode = parseTernary();
        return { kind: 'ITE', cond, thenNode, elseNode };
      }
      // Without ELSE, "if A then B" is standard logical implication A -> B
      return { kind: 'IMPLIES', left: cond, right: thenNode };
    }
    return parseIff();
  }

  function parseIff() {
    let left = parseImplies();
    while (peek()?.t === 'IFF') {
      take();
      left = { kind: 'IFF', left, right: parseImplies() };
    }
    return left;
  }

  function parseImplies() {
    const left = parseOr();
    if (peek()?.t === 'IMPLIES') {
      take();
      return { kind: 'IMPLIES', left, right: parseImplies() };
    }
    return left;
  }

  function parseOr() {
    let left = parseXor();
    while (peek()?.t === 'OR') {
      take();
      left = { kind: 'OR', left, right: parseXor() };
    }
    return left;
  }

  function parseXor() {
    let left = parseAnd();
    while (peek()?.t === 'XOR') {
      take();
      left = { kind: 'XOR', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseUnary();
    while (peek()?.t === 'AND') {
      take();
      left = { kind: 'AND', left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.t === 'NOT') {
      take();
      return { kind: 'NOT', node: parseUnary() };
    }
    return parseAtom();
  }

  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error('Incomplete logical expression.');
    if (tk.t === 'BOOL') {
      take();
      return { kind: 'BOOL', val: tk.v };
    }
    if (tk.t === 'VAR') {
      take();
      varsSet.add(tk.v);
      return { kind: 'VAR', name: tk.v };
    }
    if (tk.t === '(') {
      take();
      const inner = parseTernary();
      if (take()?.t !== ')') throw new Error('Missing closing ")".');
      return inner;
    }
    throw new Error(`Unexpected token "${tk.v}".`);
  }

  const ast = parseTernary();
  if (pos < tokens.length) {
    throw new Error(`Unexpected "${tokens[pos].v}" in expression.`);
  }
  const variables = [...varsSet].sort((a, b) => a.localeCompare(b));
  if (variables.length > 4) {
    throw new Error('Truth tables support up to 4 variables (16 rows) cleanly.');
  }

  const evalAst = (node, env) => {
    switch (node.kind) {
      case 'BOOL':
        return node.val;
      case 'VAR':
        return Boolean(env[node.name]);
      case 'NOT':
        return !evalAst(node.node, env);
      case 'AND':
        return evalAst(node.left, env) && evalAst(node.right, env);
      case 'OR':
        return evalAst(node.left, env) || evalAst(node.right, env);
      case 'XOR':
        return evalAst(node.left, env) !== evalAst(node.right, env);
      case 'IMPLIES':
        return !evalAst(node.left, env) || evalAst(node.right, env);
      case 'IFF':
        return evalAst(node.left, env) === evalAst(node.right, env);
      case 'ITE':
        return evalAst(node.cond, env)
          ? evalAst(node.thenNode, env)
          : evalAst(node.elseNode, env);
      default:
        return false;
    }
  };

  return { ast, variables, evalAst };
}

export function parseAndEvaluateLogic(raw) {
  const compiled = compileLogicAst(raw);
  const { ast, variables, evalAst } = compiled;
  const n = variables.length;
  const totalRows = 1 << n;
  const rows = [];
  let trueCount = 0;

  for (let mask = totalRows - 1; mask >= 0; mask--) {
    const values = {};
    for (let bit = 0; bit < n; bit++) {
      const varName = variables[bit];
      values[varName] = Boolean((mask >> (n - 1 - bit)) & 1);
    }
    const result = evalAst(ast, values);
    if (result) trueCount += 1;
    rows.push({ values, result });
  }

  const classification =
    trueCount === totalRows
      ? 'Tautology'
      : trueCount === 0
        ? 'Contradiction'
        : 'Contingency';

  const dnf =
    trueCount > 0 && trueCount < totalRows && n > 0
      ? rows
          .filter(r => r.result)
          .map(r => variables.map(v => (r.values[v] ? v : `¬${v}`)).join('∧'))
          .map(clause => (variables.length > 1 ? `(${clause})` : clause))
          .join(' ∨ ')
      : '';

  return {
    expression: String(raw || '').trim(),
    variables,
    rows,
    trueCount,
    totalRows,
    classification,
    dnf,
  };
}

export function checkLogicalEquivalence(exprA, exprB) {
  const cA = compileLogicAst(exprA);
  const cB = compileLogicAst(exprB);
  const variables = [...new Set([...cA.variables, ...cB.variables])].sort((a, b) =>
    a.localeCompare(b)
  );
  if (variables.length > 4) {
    throw new Error('Equivalence check supports up to 4 combined variables.');
  }
  const n = variables.length;
  const totalRows = 1 << n;
  let counterexample = null;

  for (let mask = totalRows - 1; mask >= 0; mask--) {
    const values = {};
    for (let bit = 0; bit < n; bit++) {
      values[variables[bit]] = Boolean((mask >> (n - 1 - bit)) & 1);
    }
    const rA = cA.evalAst(cA.ast, values);
    const rB = cB.evalAst(cB.ast, values);
    if (rA !== rB && !counterexample) {
      counterexample = { values, left: rA, right: rB };
    }
  }

  return {
    equivalent: counterexample === null,
    variables,
    counterexample,
  };
}

/** 5. Practical Rule / Decision Evaluator: if <cond> then <val> else if <cond> then <val> else <val> */
function evalScalarValue(rawVal, vars) {
  const s = String(rawVal || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/^(true|yes)$/i.test(s)) return true;
  if (/^(false|no)$/i.test(s)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  if (Object.prototype.hasOwnProperty.call(vars, s)) return vars[s];
  // Safe arithmetic value using variables (no eval)
  let substituted = s;
  for (const [k, v] of Object.entries(vars).sort((a, b) => b[0].length - a[0].length)) {
    if (typeof v === 'number') {
      substituted = substituted.replace(new RegExp(`(?<![A-Za-z0-9_])${k}(?![A-Za-z0-9_])`, 'g'), String(v));
    }
  }
  try {
    const fn = compileMathExpression(substituted);
    const num = fn(0);
    if (Number.isFinite(num)) return Math.round(num * 10000) / 10000;
  } catch {
    // fallback plain string
  }
  return s;
}

function evalSimpleComparison(clause, vars) {
  const s = clause.trim();
  const cmp = /^(.+?)\s*(>=|<=|!=|==|=|>|<)\s*(.+)$/.exec(s);
  if (cmp) {
    const l = evalScalarValue(cmp[1], vars);
    const op = cmp[2];
    const r = evalScalarValue(cmp[3], vars);
    switch (op) {
      case '>=': return Number(l) >= Number(r);
      case '<=': return Number(l) <= Number(r);
      case '>': return Number(l) > Number(r);
      case '<': return Number(l) < Number(r);
      case '!=': return String(l) !== String(r);
      case '==':
      case '=':
        return typeof l === 'number' && typeof r === 'number'
          ? Math.abs(l - r) < 1e-9
          : String(l).toLowerCase() === String(r).toLowerCase();
      default:
        return false;
    }
  }
  const v = evalScalarValue(s, vars);
  return Boolean(v);
}

function evalRuleCondition(condStr, vars) {
  // Split boolean OR clauses first, then AND clauses (safe & deterministic)
  const orParts = String(condStr || '').split(/\s+(?:or|\|\|)\s+/i);
  for (const orPart of orParts) {
    const andParts = orPart.split(/\s+(?:and|&&)\s+/i);
    let allTrue = true;
    for (let rawTerm of andParts) {
      let term = rawTerm.trim();
      let negate = false;
      while (/^(?:not\s+|!)/i.test(term)) {
        negate = !negate;
        term = term.replace(/^(?:not\s+|!)/i, '').trim();
      }
      if (term.startsWith('(') && term.endsWith(')')) {
        const inner = evalRuleCondition(term.slice(1, -1), vars);
        if ((negate ? !inner : inner) === false) {
          allTrue = false;
          break;
        }
      } else {
        const val = evalSimpleComparison(term, vars);
        if ((negate ? !val : val) === false) {
          allTrue = false;
          break;
        }
      }
    }
    if (allTrue) return true;
  }
  return false;
}

export function evaluateConditionalRule(ruleText, overrideVars = {}) {
  const vars = { ...overrideVars };
  const raw = String(ruleText || '').replace(/\r?\n/g, ' ').trim();
  if (!raw) throw new Error('Enter an IF ... THEN ... ELSE rule.');

  // Extract leading assignments like "score = 82; attendance = 90;"
  const ifPos = raw.search(/\bif\b/i);
  if (ifPos === -1) {
    throw new Error('Rule must start with "if <condition> then <result> ...".');
  }
  const prefix = raw.slice(0, ifPos);
  for (const chunk of prefix.split(';')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(chunk);
    if (m && !Object.prototype.hasOwnProperty.call(overrideVars, m[1])) {
      vars[m[1]] = evalScalarValue(m[2], vars);
    }
  }

  let body = raw.slice(ifPos).replace(/;\s*$/, '').trim();
  // Normalize "elseif" / "elif" -> "else if"
  body = body.replace(/\b(?:elseif|elif)\b/gi, 'else if');

  const branchRe =
    /(?:^if\s+|\s+else\s+if\s+)(.+?)\s+then\s+(.+?)(?=\s+else\s+if\b|\s+else\b|$)/gi;
  const trace = [];
  let lastEnd = 0;
  let match;
  let matched = false;
  let result = null;

  while ((match = branchRe.exec(body)) !== null) {
    lastEnd = match.index + match[0].length;
    const cond = match[1].trim();
    const outRaw = match[2].trim();
    const passed = evalRuleCondition(cond, vars);
    const value = evalScalarValue(outRaw, vars);
    trace.push({ branch: trace.length === 0 ? 'IF' : 'ELSE IF', condition: cond, passed, value });
    if (!matched && passed) {
      matched = true;
      result = value;
    }
  }

  const tail = body.slice(lastEnd).trim();
  const elseMatch = /^else\s+(.+)$/i.exec(tail);
  if (elseMatch) {
    const elseVal = evalScalarValue(elseMatch[1].trim(), vars);
    trace.push({ branch: 'ELSE', condition: 'otherwise', passed: !matched, value: elseVal });
    if (!matched) {
      matched = true;
      result = elseVal;
    }
  }

  if (trace.length === 0) {
    throw new Error('Could not parse rule. Example: score = 80; if score >= 75 then "Pass" else "Fail"');
  }

  return { ok: matched, matched, result, vars, trace };
}

/** 6. Blank Note Smart Detection hook for Logic formulas & IF/THEN/ELSE rules */
export function detectLogicNoteIntent(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // Avoid triggering on multi-line imperative code blocks
  if (/\b(?:function|const|let|var|return|class|import|def\s+\w+|printf|cout)\b|[{};]{2}/.test(s)) {
    return null;
  }

  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';

  // Case A: Practical conditional rule on bottom lines (e.g. "score = 80\nif score >= 75 then Pass else Fail")
  const hasRuleKeyword = /\bif\b[\s\S]+\bthen\b/i.test(last) || (lines.length <= 4 && /\bif\b[\s\S]+\bthen\b[\s\S]+\belse\b/i.test(s));
  const looksLikeRule =
    hasRuleKeyword &&
    (/[<>=!]/.test(last.includes('then') ? last : s) || /["']/.test(last) || /\belse\s+if\b/i.test(s));

  if (looksLikeRule) {
    try {
      const candidate = lines.length <= 4 && /\bif\b/i.test(s) ? lines.join('; ') : last;
      const evalRes = evaluateConditionalRule(candidate);
      if (evalRes.matched) {
        return {
          kind: 'rule',
          label: last,
          answer: String(evalRes.result),
          summary: `${evalRes.trace.length} branch${evalRes.trace.length === 1 ? '' : 'es'} evaluated`,
          insertText: `→ ${evalRes.result}`,
          rawFormula: candidate,
        };
      }
    } catch {
      // Fall through to propositional logic check if rule has symbolic vars only
    }
  }

  // Case B: Propositional logic formula on last line
  const hasLogicOp =
    /(<->|<=>|->|=>|&&|\|\||[∧∨¬⊕→↔])/.test(last) ||
    /\b(?:iff|if\s+and\s+only\s+if|xor|implies)\b/i.test(last) ||
    /\bif\s+[A-Za-z0-9_()\s!&|^∧∨¬]+\s+then\s+/i.test(last);

  if (!hasLogicOp || last.length > 90) return null;
  try {
    const tt = parseAndEvaluateLogic(last);
    if (tt.variables.length === 0 && !/(->|<->|iff|\bthen\b|[∧∨¬⊕→↔])/i.test(last)) return null;
    const summaryRows = `${tt.classification} · ${tt.trueCount}/${tt.totalRows} True (${tt.variables.join(', ') || 'const'})`;
    const tableMd =
      tt.rows.length <= 8
        ? `\n${tt.variables.join(' | ')} | Out\n` +
          tt.rows
            .map(r => `${tt.variables.map(v => (r.values[v] ? 'T' : 'F')).join(' | ')} | ${r.result ? 'T' : 'F'}`)
            .join('\n')
        : '';
    return {
      kind: 'truth_table',
      label: last,
      answer: tt.classification,
      summary: summaryRows,
      insertText: `→ ${tt.classification} (${tt.trueCount}/${tt.totalRows} True)${tableMd}`,
      truthTable: tt,
    };
  } catch {
    return null;
  }
}
