import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanAiOutputText } from '../src/lib/cleanAiText';
import {
  solveAlgebraDetailed,
  solveSystem2x2,
  expandAndFactorExpr,
  parseAndEvaluateLogic,
  checkLogicalEquivalence,
  evaluateConditionalRule,
  detectLogicNoteIntent,
} from '../src/lib/algebraLogic';
import { detectBlankNoteIntents } from '../src/lib/smartNoteDetect';
import {
  T568A,
  T568B,
  DEFAULT_FIREWALL_RULES,
  evaluateRj45Cable,
  simulatePatchAndPing,
  evaluateFirewallPacket,
} from '../src/lib/networkingLab';
import {
  solveDecisionTable,
  solveLinearProgramming2D,
  solvePertCpm,
  solveEoqInventory,
} from '../src/lib/quantMethods';
import {
  getAllSubjects,
  addCustomSubject,
  markSubjectTopicDone,
  getSubjectProgress,
} from '../src/lib/subjectCatalog';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('v2.3.0 Clean AI Text, Algebra/Logic Engine, Net Lab & MS 102 Quant Studio', () => {
  beforeEach(() => {
    memStore.clear();
  });

  it('strips raw markdown asterisks, hashtags & LaTeX from Smart Mode AI answers while preserving arithmetic/code', () => {
    const dirty =
      '### Step-by-Step Solution\n' +
      '**Step 1:** Multiply $5 \\times 6$ = 30.\n' +
      '*Note:* Divide $\\frac{10}{2} = \\boxed{5}$.\n' +
      '- Root check: $\\sqrt{16} = 4$\n' +
      '---';
    const clean = cleanAiOutputText(dirty);
    expect(clean).not.toContain('**');
    expect(clean).not.toContain('###');
    expect(clean).not.toContain('\\boxed');
    expect(clean).not.toContain('$');
    expect(clean).toContain('5 × 6 = 30');
    expect(clean).toContain('10/2 = 5');
    expect(clean).toContain('√(16) = 4');
    expect(clean).toContain('• Root check:');

    // Preserves arithmetic expressions like "5 * 6" inside prose & keeps fenced code when preserveCode=true
    const withCode = '**Fix:** Update\n```js\nconst a = 5 * 6;\n```';
    const cleanedDebug = cleanAiOutputText(withCode, { preserveCode: true });
    expect(cleanedDebug).toContain('Fix: Update');
    expect(cleanedDebug).toContain('const a = 5 * 6;');
  });

  it('solves 1-var algebra, simplifies/factors polynomials & solves 2x2 systems offline', () => {
    const eq1 = solveAlgebraDetailed('2x + 5 = 17');
    expect(eq1.kind).toBe('linear');
    expect(eq1.answer).toBe('x = 6');
    expect(eq1.steps).toHaveLength(3);

    const quad = solveAlgebraDetailed('x^2 - 5x + 6 = 0');
    expect(quad.kind).toBe('quadratic');
    expect(quad.roots).toEqual([2, 3]);
    expect(quad.factored).toBe('(x - 2)(x - 3)');

    const sys = solveSystem2x2('2x + y = 10', 'x - y = 2');
    expect(sys.status).toBe('unique');
    expect(sys.x).toBeCloseTo(4);
    expect(sys.y).toBeCloseTo(2);

    const poly = expandAndFactorExpr('(x + 3)(x - 2)', 4);
    expect(poly.simplified).toBe('x^2 + x - 6');
    expect(poly.factored).toBe('(x + 3)(x - 2)');
    expect(poly.evaluated).toBe('14');
  });

  it('evaluates propositional logic (IF/THEN, ELSE, IFF), equivalence & practical IF/ELSE rules', () => {
    const imp = parseAndEvaluateLogic('if P then Q');
    expect(imp.variables).toEqual(['P', 'Q']);
    expect(imp.trueCount).toBe(3);
    expect(imp.classification).toBe('Contingency');

    const iff = parseAndEvaluateLogic('P iff Q');
    expect(iff.rows.filter(r => r.result)).toHaveLength(2); // TT and FF

    const ite = parseAndEvaluateLogic('if P then Q else R');
    expect(ite.variables).toEqual(['P', 'Q', 'R']);
    expect(ite.totalRows).toBe(8);
    expect(ite.trueCount).toBe(4);

    // De Morgan's Law & Contrapositive equivalences
    expect(checkLogicalEquivalence('!(P && Q)', '!P || !Q').equivalent).toBe(true);
    expect(checkLogicalEquivalence('P -> Q', '!Q -> !P').equivalent).toBe(true);
    expect(checkLogicalEquivalence('P -> Q', 'Q -> P').equivalent).toBe(false);

    // Chained IF / ELSE IF / ELSE conditional rule
    const rule = evaluateConditionalRule(
      'score = 82; attendance = 90; if score >= 90 then "A" else if score >= 75 and attendance >= 80 then "Pass" else "Fail"'
    );
    expect(rule.matched).toBe(true);
    expect(rule.result).toBe('Pass');
    expect(rule.trace).toHaveLength(3);
    expect(rule.trace[1].passed).toBe(true);

    // Blank Note auto-detection integration
    const noteIntent = detectLogicNoteIntent('if P then Q');
    expect(noteIntent?.kind).toBe('truth_table');
    const intents = detectBlankNoteIntents('score = 80; if score >= 75 then "Pass" else "Fail"', {
      isZeroAi: false,
      enabled: true,
    });
    expect(intents.some(d => d.kind === 'logic' && d.meta.answer === 'Pass')).toBe(true);
  });

  it('simulates RJ45 T568A/B/Crossover crimping, LED faults, Patch & Ping & Firewall ACL', () => {
    expect(evaluateRj45Cable(T568B, T568B)).toMatchObject({ ok: true, status: 'straight-t568b', cableType: 'straight' });
    expect(evaluateRj45Cable(T568A, T568A)).toMatchObject({ ok: true, status: 'straight-t568a', cableType: 'straight' });
    expect(evaluateRj45Cable(T568A, T568B)).toMatchObject({ ok: true, status: 'crossover', cableType: 'crossover' });

    const openCable = evaluateRj45Cable(T568B, ['WO', 'O', null, 'B', 'WB', 'G', 'WBr', 'Br']);
    expect(openCable.ok).toBe(false);
    expect(openCable.status).toBe('open');
    expect(openCable.pinMap[2]).toBeNull();

    const miswireCable = evaluateRj45Cable(T568B, ['WO', 'O', 'WG', 'WB', 'B', 'G', 'WBr', 'Br']);
    expect(miswireCable.ok).toBe(false);
    expect(miswireCable.status).toBe('miswire');

    const splitPair = evaluateRj45Cable(
      ['WO', 'O', 'B', 'WG', 'WB', 'G', 'WBr', 'Br'],
      ['WO', 'O', 'B', 'WG', 'WB', 'G', 'WBr', 'Br']
    );
    expect(splitPair.ok).toBe(false);
    expect(splitPair.isSplitPair).toBe(true);

    // Patch & Ping checks
    expect(
      simulatePatchAndPing({ leftDevice: 'pc1', rightDevice: 'switch', cableType: 'straight', leftIp: '192.168.1.10/24', rightIp: '192.168.1.20/24' })
    ).toMatchObject({ linkUp: true, pingSuccess: true });

    expect(
      simulatePatchAndPing({ leftDevice: 'pc1', rightDevice: 'pc2', cableType: 'straight', autoMdix: false })
    ).toMatchObject({ linkUp: false, pingSuccess: false });

    expect(
      simulatePatchAndPing({ leftDevice: 'pc1', rightDevice: 'pc2', cableType: 'crossover', leftIp: '192.168.1.10/24', rightIp: '10.0.0.5/24' })
    ).toMatchObject({ linkUp: true, sameSubnet: false, pingSuccess: false });

    // Firewall ACL checks
    expect(evaluateFirewallPacket({ protocol: 'TCP', port: 443 }, DEFAULT_FIREWALL_RULES).decision).toBe('ALLOW');
    expect(evaluateFirewallPacket({ protocol: 'TCP', port: 21 }, DEFAULT_FIREWALL_RULES).decision).toBe('DENY');
    expect(evaluateFirewallPacket({ protocol: 'TCP', port: 3389 }, DEFAULT_FIREWALL_RULES).decision).toBe('DENY'); // Implicit deny
  });

  it('computes MS 102 Quantitative Methods (Decision Matrix/EMV, 2-Var LP, PERT/CPM, EOQ) & custom subjects', () => {
    const dec = solveDecisionTable(
      [
        { name: 'Large', payoffs: [200000, -180000] },
        { name: 'Small', payoffs: [100000, -20000] },
        { name: 'Nothing', payoffs: [0, 0] },
      ],
      ['Favorable', 'Unfavorable'],
      [0.5, 0.5]
    );
    expect(dec.maximax.name).toBe('Large');
    expect(dec.maximin.name).toBe('Nothing');
    expect(dec.emv.best).toEqual({ name: 'Small', emv: 40000 });
    expect(dec.evpi).toBe(60000);

    const lp = solveLinearProgramming2D({
      objectiveType: 'max',
      c1: 40,
      c2: 30,
      constraints: [
        { a1: 2, a2: 1, op: '<=', b: 100 },
        { a1: 1, a2: 1, op: '<=', b: 80 },
      ],
    });
    expect(lp.feasible).toBe(true);
    expect(lp.optimalPoint).toEqual({ x: 20, y: 60, z: 2600 });

    const pert = solvePertCpm([
      { id: 'A', duration: 3, predecessors: [] },
      { id: 'B', duration: 4, predecessors: ['A'] },
      { id: 'C', duration: 2, predecessors: ['A'] },
      { id: 'D', duration: 5, predecessors: ['B', 'C'] },
    ]);
    expect(pert.projectDuration).toBe(12);
    expect(pert.criticalPath).toEqual(['A', 'B', 'D']);

    const eoq = solveEoqInventory({ demandD: 1200, orderingCostS: 50, holdingCostH: 3, leadTimeDays: 5, workingDays: 300 });
    expect(eoq.eoq).toBe(200);
    expect(eoq.ordersPerYear).toBe(6);
    expect(eoq.reorderPoint).toBe(20);

    // Custom open-source subject generator persistence
    const added = addCustomSubject({ code: 'IAS 101', name: 'Info Assurance', topics: ['CIA Triad', 'RBAC'] });
    expect(getAllSubjects().some(s => s.id === added.id)).toBe(true);
    markSubjectTopicDone(added.id, added.topics[0].slug);
    expect(getSubjectProgress()[added.id]).toContain(added.topics[0].slug);
  });
});
