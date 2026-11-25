/**
 * mathGrapher — Safe 100% offline 2D math expression parser & evaluator.
 * Zero eval() / zero new Function(). Uses a strict tokenizer + recursive-descent parser.
 *
 * Supports: + - * / ^ ( ), unary +/-, implicit multiplication (2x, 3sin(x), (x+1)(x-1)),
 * variable x, constants pi & e, and functions:
 * sin, cos, tan, asin, acos, atan, sqrt, abs, log (base 10), ln, exp, floor, ceil, round.
 */

const FUNCS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: x => (Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10),
  ln: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const CONSTS = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(raw) {
  const s = String(raw || '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/');
  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Number (integer or decimal)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      let j = i;
      let dotCount = 0;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) {
        if (s[j] === '.') dotCount += 1;
        j += 1;
      }
      if (dotCount > 1) throw new Error('Invalid number');
      tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }

    // Identifier (function name, constant, or variable x)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let j = i;
      while (j < s.length && ((s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z'))) {
        j += 1;
      }
      const name = s.slice(i, j).toLowerCase();
      if (FUNCS[name]) {
        tokens.push({ type: 'fn', value: name });
      } else if (CONSTS[name] !== undefined) {
        tokens.push({ type: 'num', value: CONSTS[name] });
      } else if (name === 'x') {
        tokens.push({ type: 'var', value: 'x' });
      } else {
        throw new Error(`Unknown identifier "${name}"`);
      }
      i = j;
      continue;
    }

    if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : 'op', value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character "${ch}"`);
  }

  // Insert implicit multiplication tokens: e.g. 2x -> 2*x, 3sin(x) -> 3*sin(x), (x+1)(x-1) -> (x+1)*(x-1)
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    const prev = out[out.length - 1];
    if (prev) {
      const prevEndsAtom = prev.type === 'num' || prev.type === 'var' || prev.type === 'rparen';
      const curStartsAtom = cur.type === 'var' || cur.type === 'fn' || cur.type === 'lparen' || cur.type === 'num';
      if (prevEndsAtom && curStartsAtom) {
        out.push({ type: 'op', value: '*' });
      }
    }
    out.push(cur);
  }
  return out;
}

/** Compile a math expression string into a safe reusable evaluator function `f(x)`. */
export function compileMathExpression(expr) {
  const clean = String(expr || '').trim();
  if (!clean) throw new Error('Empty expression');
  // Allow optional "y = " or "f(x) = " prefix
  const stripped = clean.replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
  const tokens = tokenize(stripped);
  if (tokens.length === 0) throw new Error('Empty expression');

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      const l = left;
      const r = right;
      left = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x);
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek()?.type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = consume().value;
      const right = parseUnary();
      const l = left;
      const r = right;
      left = op === '*' ? x => l(x) * r(x) : x => l(x) / r(x);
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const inner = parseUnary();
      return op === '-' ? x => -inner(x) : inner;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek()?.type === 'op' && peek().value === '^') {
      consume();
      const exp = parseUnary(); // right-associative, supports 2^-x
      return x => Math.pow(base(x), exp(x));
    }
    return base;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression');

    if (tok.type === 'num') {
      consume();
      const v = tok.value;
      return () => v;
    }
    if (tok.type === 'var') {
      consume();
      return x => x;
    }
    if (tok.type === 'fn') {
      const fnName = consume().value;
      const fn = FUNCS[fnName];
      let arg;
      if (peek()?.type === 'lparen') {
        consume();
        arg = parseExpr();
        if (peek()?.type !== 'rparen') throw new Error('Missing closing parenthesis');
        consume();
      } else {
        arg = parseUnary();
      }
      return x => fn(arg(x));
    }
    if (tok.type === 'lparen') {
      consume();
      const inner = parseExpr();
      if (peek()?.type !== 'rparen') throw new Error('Missing closing parenthesis');
      consume();
      return inner;
    }
    throw new Error(`Unexpected token "${tok.value}"`);
  }

  const fn = parseExpr();
  if (pos < tokens.length) throw new Error(`Unexpected token "${tokens[pos].value}"`);
  return fn;
}

export function evaluateExpression(expr, x = 0) {
  try {
    const fn = compileMathExpression(expr);
    const y = fn(Number(x));
    return Number.isFinite(y) ? y : NaN;
  } catch {
    return NaN;
  }
}

/** Central finite-difference numerical derivative f'(x). */
export function numericalDerivative(expr, x = 0, h = 1e-5) {
  try {
    const fn = compileMathExpression(expr);
    const x0 = Number(x);
    const y1 = fn(x0 + h);
    const y0 = fn(x0 - h);
    if (!Number.isFinite(y1) || !Number.isFinite(y0)) return NaN;
    return (y1 - y0) / (2 * h);
  } catch {
    return NaN;
  }
}

/** Find approximate real roots (x-intercepts) on [xMin, xMax] via sign-change bisection. */
export function findApproxRoots(expr, xMin = -10, xMax = 10, samples = 300) {
  let fn;
  try {
    fn = compileMathExpression(expr);
  } catch {
    return [];
  }
  const roots = [];
  const dx = (xMax - xMin) / samples;
  let prevX = xMin;
  let prevY = fn(prevX);

  for (let i = 1; i <= samples; i++) {
    const curX = xMin + i * dx;
    const curY = fn(curX);
    if (Number.isFinite(prevY) && Number.isFinite(curY)) {
      if (Math.abs(curY) < 1e-7) {
        roots.push(Math.round(curX * 1000) / 1000);
      } else if (prevY * curY < 0 && Math.abs(curY - prevY) < 50) {
        // Bisect to 3 decimal places
        let lo = prevX;
        let hi = curX;
        let fLo = prevY;
        for (let iter = 0; iter < 18; iter++) {
          const mid = (lo + hi) / 2;
          const fMid = fn(mid);
          if (!Number.isFinite(fMid)) break;
          if (fLo * fMid <= 0) {
            hi = mid;
          } else {
            lo = mid;
            fLo = fMid;
          }
        }
        const r = Math.round(((lo + hi) / 2) * 1000) / 1000;
        if (!roots.some(e => Math.abs(e - r) < 0.02)) roots.push(r);
      }
    }
    prevX = curX;
    prevY = curY;
  }
  return roots.slice(0, 8);
}
