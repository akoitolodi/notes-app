/**
 * quantMethods — 100% offline MS 102 Quantitative Methods calculation engines:
 * 1. Decision Theory (Maximax, Maximin, Laplace, Minimax Regret, EMV & EVPI)
 * 2. 2-Variable Linear Programming (Corner-Point Feasible Region Solver)
 * 3. PERT / CPM Project Scheduling (Forward/Backward Pass, Slack, Critical Path, Variance)
 * 4. Inventory Control (EOQ, Orders/Year, Total Cost, Reorder Point)
 */

function roundClean(n, digits = 4) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * 1. Decision Matrix Solver
 * @param {Array<{ name: string, payoffs: number[] }>} alternatives
 * @param {string[]} states
 * @param {number[]} probabilities (optional, sums near 1 for EMV & EVPI)
 */
export function solveDecisionTable(alternatives = [], states = [], probabilities = []) {
  const cleanAlts = (alternatives || [])
    .map((a, idx) => ({
      name: String(a?.name || `Alt ${idx + 1}`).trim() || `Alt ${idx + 1}`,
      payoffs: Array.isArray(a?.payoffs) ? a.payoffs.map(Number) : [],
    }))
    .filter(a => a.payoffs.length > 0 && a.payoffs.every(Number.isFinite));

  if (cleanAlts.length === 0) {
    throw new Error('Add at least 1 decision alternative with numeric payoffs.');
  }
  const numStates = Math.min(...cleanAlts.map(a => a.payoffs.length));
  const stateNames = Array.from({ length: numStates }, (_, j) =>
    String(states[j] || `State ${j + 1}`).trim() || `State ${j + 1}`
  );

  const rowMetrics = cleanAlts.map(a => {
    const row = a.payoffs.slice(0, numStates);
    const max = Math.max(...row);
    const min = Math.min(...row);
    const avg = row.reduce((acc, v) => acc + v, 0) / numStates;
    return { name: a.name, row, max, min, laplace: roundClean(avg, 2) };
  });

  // Maximax (Optimistic) & Maximin (Pessimistic) & Laplace
  const maximax = rowMetrics.reduce((best, r) => (r.max > best.max ? r : best), rowMetrics[0]);
  const maximin = rowMetrics.reduce((best, r) => (r.min > best.min ? r : best), rowMetrics[0]);
  const laplace = rowMetrics.reduce((best, r) => (r.laplace > best.laplace ? r : best), rowMetrics[0]);

  // Minimax Regret (Opportunity Loss table)
  const colMax = Array.from({ length: numStates }, (_, j) =>
    Math.max(...rowMetrics.map(r => r.row[j]))
  );
  const regretRows = rowMetrics.map(r => {
    const regrets = r.row.map((val, j) => roundClean(colMax[j] - val, 2));
    return {
      name: r.name,
      regrets,
      maxRegret: Math.max(...regrets),
    };
  });
  const minimaxRegret = regretRows.reduce(
    (best, r) => (r.maxRegret < best.maxRegret ? r : best),
    regretRows[0]
  );

  // EMV + EVwPI + EVPI when probabilities match numStates and sum ~ 1
  let emv = null;
  let evpi = null;
  let evWpi = null;
  const parsedProbs = (probabilities || []).slice(0, numStates).map(Number);
  const probSum = parsedProbs.reduce((acc, p) => acc + (Number.isFinite(p) ? p : 0), 0);
  const probsValid =
    parsedProbs.length === numStates &&
    parsedProbs.every(p => Number.isFinite(p) && p >= 0) &&
    Math.abs(probSum - 1) <= 0.02;

  if (probsValid) {
    const emvRows = rowMetrics.map(r => ({
      name: r.name,
      emv: roundClean(r.row.reduce((acc, val, j) => acc + val * parsedProbs[j], 0), 2),
    }));
    const bestEmv = emvRows.reduce((best, r) => (r.emv > best.emv ? r : best), emvRows[0]);
    evWpi = roundClean(
      colMax.reduce((acc, bestInCol, j) => acc + bestInCol * parsedProbs[j], 0),
      2
    );
    evpi = roundClean(evWpi - bestEmv.emv, 2);
    emv = { best: bestEmv, rows: emvRows };
  }

  return {
    stateNames,
    rows: rowMetrics,
    maximax: { name: maximax.name, value: maximax.max },
    maximin: { name: maximin.name, value: maximin.min },
    laplace: { name: laplace.name, value: laplace.laplace },
    regretTable: regretRows,
    minimaxRegret: { name: minimaxRegret.name, value: minimaxRegret.maxRegret },
    emv,
    evWpi,
    evpi,
  };
}

/**
 * 2. 2-Variable Linear Programming Solver (Graphical Corner-Point Method)
 * Constraints: { a1, a2, op: '<=' | '>=' | '=', b } plus implicit x >= 0, y >= 0
 */
export function solveLinearProgramming2D({
  objectiveType = 'max',
  c1 = 0,
  c2 = 0,
  constraints = [],
}) {
  const cX = Number(c1);
  const cY = Number(c2);
  if (!Number.isFinite(cX) || !Number.isFinite(cY)) {
    throw new Error('Objective coefficients c1 and c2 must be numeric.');
  }

  // Convert all user constraints + x >= 0, y >= 0 into boundary lines (A*x + B*y = C)
  const normCons = (constraints || [])
    .map(con => ({
      a1: Number(con.a1),
      a2: Number(con.a2),
      op: con.op === '>=' ? '>=' : con.op === '=' ? '=' : '<=',
      b: Number(con.b),
    }))
    .filter(c => Number.isFinite(c.a1) && Number.isFinite(c.a2) && Number.isFinite(c.b) && (c.a1 !== 0 || c.a2 !== 0));

  const boundaryLines = [
    { a1: 1, a2: 0, b: 0 }, // x = 0
    { a1: 0, a2: 1, b: 0 }, // y = 0
    ...normCons.map(c => ({ a1: c.a1, a2: c.a2, b: c.b })),
  ];

  const eps = 1e-7;
  const isFeasible = (x, y) => {
    if (x < -eps || y < -eps) return false;
    for (const c of normCons) {
      const lhs = c.a1 * x + c.a2 * y;
      if (c.op === '<=' && lhs > c.b + eps) return false;
      if (c.op === '>=' && lhs < c.b - eps) return false;
      if (c.op === '=' && Math.abs(lhs - c.b) > eps) return false;
    }
    return true;
  };

  const candidates = [];
  for (let i = 0; i < boundaryLines.length; i++) {
    for (let j = i + 1; j < boundaryLines.length; j++) {
      const l1 = boundaryLines[i];
      const l2 = boundaryLines[j];
      const det = l1.a1 * l2.a2 - l2.a1 * l1.a2;
      if (Math.abs(det) < 1e-9) continue;
      const x = (l1.b * l2.a2 - l2.b * l1.a2) / det;
      const y = (l1.a1 * l2.b - l2.a1 * l1.b) / det;
      const cx = Math.abs(x) < eps ? 0 : x;
      const cy = Math.abs(y) < eps ? 0 : y;
      if (!isFeasible(cx, cy)) continue;
      if (!candidates.some(p => Math.abs(p.x - cx) < 1e-5 && Math.abs(p.y - cy) < 1e-5)) {
        const z = cX * cx + cY * cy;
        candidates.push({
          x: roundClean(cx, 4),
          y: roundClean(cy, 4),
          z: roundClean(z, 4),
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { feasible: false, optimalPoint: null, vertices: [], message: 'No feasible region found.' };
  }

  const isMax = objectiveType !== 'min';
  let optimalPoint = candidates[0];
  for (const pt of candidates) {
    if (isMax ? pt.z > optimalPoint.z : pt.z < optimalPoint.z) {
      optimalPoint = pt;
    }
  }

  return {
    feasible: true,
    objectiveType: isMax ? 'max' : 'min',
    optimalPoint,
    vertices: candidates.sort((a, b) => a.x - b.x || a.y - b.y),
  };
}

/**
 * 3. PERT / CPM Project Scheduling Calculator
 * Each task: { id: string, predecessors?: string[], duration?: number, o?: number, m?: number, p?: number }
 */
export function solvePertCpm(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('Provide at least one project activity.');
  }

  const map = new Map();
  const list = tasks.map(t => {
    const id = String(t.id || '').trim().toUpperCase();
    if (!id) throw new Error('Every activity must have a short ID (e.g. A, B, C).');
    let dur = Number(t.duration);
    let variance = 0;
    if (!Number.isFinite(dur) && [t.o, t.m, t.p].every(v => Number.isFinite(Number(v)))) {
      const o = Number(t.o);
      const m = Number(t.m);
      const p = Number(t.p);
      dur = (o + 4 * m + p) / 6;
      variance = ((p - o) / 6) ** 2;
    }
    if (!Number.isFinite(dur) || dur < 0) {
      throw new Error(`Invalid duration for activity ${id}.`);
    }
    const preds = Array.isArray(t.predecessors)
      ? t.predecessors.map(x => String(x || '').trim().toUpperCase()).filter(Boolean)
      : String(t.predecessors || '')
          .split(/[\s,;]+/)
          .map(x => x.trim().toUpperCase())
          .filter(x => x && x !== '-' && x !== 'NONE');

    const node = {
      id,
      duration: roundClean(dur, 4),
      variance: roundClean(variance, 4),
      predecessors: preds,
      successors: [],
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      slack: 0,
      isCritical: false,
    };
    map.set(id, node);
    return node;
  });

  // Wire successors & topological sort (Kahn)
  const inDegree = new Map();
  for (const node of list) {
    inDegree.set(node.id, 0);
  }
  for (const node of list) {
    for (const pid of node.predecessors) {
      const pNode = map.get(pid);
      if (!pNode) throw new Error(`Unknown predecessor "${pid}" referenced by ${node.id}.`);
      pNode.successors.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
    }
  }

  const queue = list.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const topo = [];
  while (queue.length > 0) {
    const curId = queue.shift();
    topo.push(map.get(curId));
    for (const sid of map.get(curId).successors) {
      const nextDeg = inDegree.get(sid) - 1;
      inDegree.set(sid, nextDeg);
      if (nextDeg === 0) queue.push(sid);
    }
  }
  if (topo.length !== list.length) {
    throw new Error('Cycle detected in activity dependencies.');
  }

  // Forward pass (ES / EF)
  let projectDuration = 0;
  for (const node of topo) {
    node.es =
      node.predecessors.length === 0
        ? 0
        : roundClean(Math.max(...node.predecessors.map(pid => map.get(pid).ef)), 4);
    node.ef = roundClean(node.es + node.duration, 4);
    if (node.ef > projectDuration) projectDuration = node.ef;
  }

  // Backward pass (LS / LF)
  for (let i = topo.length - 1; i >= 0; i--) {
    const node = topo[i];
    node.lf =
      node.successors.length === 0
        ? projectDuration
        : roundClean(Math.min(...node.successors.map(sid => map.get(sid).ls)), 4);
    node.ls = roundClean(node.lf - node.duration, 4);
    node.slack = roundClean(node.ls - node.es, 4);
    node.isCritical = Math.abs(node.slack) < 1e-6;
  }

  const criticalNodes = topo.filter(n => n.isCritical);
  const criticalVariance = roundClean(
    criticalNodes.reduce((acc, n) => acc + n.variance, 0),
    4
  );

  return {
    projectDuration: roundClean(projectDuration, 4),
    criticalPath: criticalNodes.map(n => n.id),
    criticalStdDev: roundClean(Math.sqrt(criticalVariance), 4),
    tasks: list.map(({ id, duration, predecessors, es, ef, ls, lf, slack, isCritical }) => ({
      id,
      duration,
      predecessors,
      es,
      ef,
      ls,
      lf,
      slack,
      isCritical,
    })),
  };
}

/**
 * 4. Economic Order Quantity (EOQ) & Reorder Point Calculator
 */
export function solveEoqInventory({
  demandD,
  orderingCostS,
  holdingCostH,
  leadTimeDays = 0,
  workingDays = 365,
}) {
  const D = Number(demandD);
  const S = Number(orderingCostS);
  const H = Number(holdingCostH);
  const L = Math.max(0, Number(leadTimeDays) || 0);
  const W = Math.max(1, Number(workingDays) || 365);

  if (!Number.isFinite(D) || D <= 0 || !Number.isFinite(S) || S <= 0 || !Number.isFinite(H) || H <= 0) {
    throw new Error('Demand (D), Ordering Cost (S), and Holding Cost (H) must be positive numbers.');
  }

  const eoq = Math.sqrt((2 * D * S) / H);
  const ordersPerYear = D / eoq;
  const cycleDays = W / ordersPerYear;
  const totalOrderingCost = (D / eoq) * S;
  const totalHoldingCost = (eoq / 2) * H;
  const totalInventoryCost = totalOrderingCost + totalHoldingCost;
  const dailyDemand = D / W;
  const reorderPoint = dailyDemand * L;

  return {
    eoq: roundClean(eoq, 2),
    ordersPerYear: roundClean(ordersPerYear, 2),
    cycleDays: roundClean(cycleDays, 2),
    totalOrderingCost: roundClean(totalOrderingCost, 2),
    totalHoldingCost: roundClean(totalHoldingCost, 2),
    totalInventoryCost: roundClean(totalInventoryCost, 2),
    reorderPoint: roundClean(reorderPoint, 2),
  };
}
