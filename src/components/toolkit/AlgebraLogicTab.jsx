/**
 * AlgebraLogicTab — 100% offline Algebraic Solver & Discrete/Conditional Logic Calculator.
 * Sub-modes:
 *  - Algebra: 1-Var equations, Simplify/Expand/Factor, 2x2 Systems
 *  - Truth Table: NOT, AND, OR, XOR, IF..THEN (->), IFF (<->), IF..THEN..ELSE + Equivalence check
 *  - IF / ELSE Rules: Live variable + conditional decision branch evaluator
 */
import { useState, useMemo } from 'react';
import { LineChart, FilePlus2, CheckCircle2, XCircle } from 'lucide-react';
import {
  solveAlgebraDetailed,
  solveSystem2x2,
  expandAndFactorExpr,
  parseAndEvaluateLogic,
  checkLogicalEquivalence,
  evaluateConditionalRule,
} from '../../lib/algebraLogic';

const LOGIC_KEYS = [
  ['NOT ', 'NOT'],
  [' AND ', 'AND'],
  [' OR ', 'OR'],
  [' XOR ', 'XOR'],
  [' -> ', 'IF→THEN'],
  [' <-> ', 'IFF ↔'],
  ['if P then Q else R', 'IF..THEN..ELSE'],
  ['(', '('],
  [')', ')'],
];

const LOGIC_PRESETS = [
  ['if P then Q', 'Implication (P → Q)'],
  ['P iff Q', 'Biconditional (P ↔ Q)'],
  ['if P then Q else R', 'Ternary (IF P THEN Q ELSE R)'],
  ['!(P && Q) <-> (!P || !Q)', 'De Morgan Tautology'],
  ['(P && (P -> Q)) -> Q', 'Modus Ponens'],
];

const RULE_PRESETS = [
  {
    label: 'Passing Score',
    text: 'score = 78;\nattendance = 90;\nif score >= 75 and attendance >= 80 then "Passed" else "Retake"',
  },
  {
    label: 'Grade Tier',
    text: 'grade = 88;\nif grade >= 90 then "Dean List (1.25)" else if grade >= 80 then "Very Good (2.0)" else if grade >= 75 then "Passed (3.0)" else "Failed (5.0)"',
  },
  {
    label: 'Discount Calc',
    text: 'total = 1500;\nvip = true;\nif vip == true and total >= 1000 then total * 0.8 else if total >= 1000 then total * 0.9 else total',
  },
];

export default function AlgebraLogicTab({ onOpenGrapher, onSaveNote }) {
  const [subTab, setSubTab] = useState('algebra'); // algebra | truth | rules

  // Algebra state
  const [algMode, setAlgMode] = useState('eq1'); // eq1 | simplify | sys2
  const [eqInput, setEqInput] = useState('x^2 - 5x + 6 = 0');
  const [polyInput, setPolyInput] = useState('(x + 3)(x - 2)');
  const [polyX, setPolyX] = useState('4');
  const [sysEq1, setSysEq1] = useState('2x + y = 10');
  const [sysEq2, setSysEq2] = useState('x - y = 2');

  // Truth table state
  const [logicExpr, setLogicExpr] = useState('if P then Q else R');
  const [compareOpen, setCompareOpen] = useState(false);
  const [logicExprB, setLogicExprB] = useState('!P || Q');

  // Practical IF/ELSE rule state
  const [ruleInput, setRuleInput] = useState(RULE_PRESETS[0].text);

  const algResult = useMemo(() => {
    try {
      if (algMode === 'eq1') return { ok: true, data: solveAlgebraDetailed(eqInput) };
      if (algMode === 'simplify') return { ok: true, data: expandAndFactorExpr(polyInput, polyX) };
      return { ok: true, data: solveSystem2x2(sysEq1, sysEq2) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [algMode, eqInput, polyInput, polyX, sysEq1, sysEq2]);

  const ttResult = useMemo(() => {
    try {
      return { ok: true, data: parseAndEvaluateLogic(logicExpr) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [logicExpr]);

  const eqvResult = useMemo(() => {
    if (!compareOpen) return null;
    try {
      return { ok: true, data: checkLogicalEquivalence(logicExpr, logicExprB) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [compareOpen, logicExpr, logicExprB]);

  const ruleResult = useMemo(() => {
    try {
      return { ok: true, data: evaluateConditionalRule(ruleInput) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [ruleInput]);

  return (
    <div className="explanation-card">
      <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 12px' }}>
        {[
          ['algebra', 'Algebra'],
          ['truth', 'Truth Table'],
          ['rules', 'IF / ELSE Rules'],
        ].map(([id, lbl]) => (
          <button
            key={id}
            type="button"
            className={`view-switch-btn${subTab === id ? ' active' : ''}`}
            onClick={() => setSubTab(id)}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* 1. Algebraic Calculator */}
      {subTab === 'algebra' && (
        <>
          <div className="mode-picker-row" style={{ marginBottom: 10 }}>
            {[
              ['eq1', '1-Var Solver'],
              ['simplify', 'Simplify / Factor'],
              ['sys2', '2×2 System'],
            ].map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                className={`mode-pick-chip${algMode === id ? ' active' : ''}`}
                onClick={() => setAlgMode(id)}
              >
                {lbl}
              </button>
            ))}
          </div>

          {algMode === 'eq1' && (
            <>
              <div className="settings-label">Equation (linear, quadratic, or general)</div>
              <input
                type="text"
                className="ai-input"
                value={eqInput}
                onChange={e => setEqInput(e.target.value)}
                placeholder="e.g. 2x + 5 = 17 or x^2 - 5x + 6 = 0"
                spellCheck="false"
              />
              <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                {['2x + 5 = 17', 'x^2 - 5x + 6 = 0', '3(x - 2) = x + 8', '2x^2 + 4x - 6 = 0'].map(ex => (
                  <button
                    key={ex}
                    type="button"
                    className="tag-pill"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setEqInput(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}

          {algMode === 'simplify' && (
            <>
              <div className="settings-label">Expression in x</div>
              <input
                type="text"
                className="ai-input"
                value={polyInput}
                onChange={e => setPolyInput(e.target.value)}
                placeholder="e.g. (x + 3)(x - 2) or 3x^2 + 2x - x^2"
                spellCheck="false"
              />
              <div className="flex items-center gap-8 mt-8">
                <span className="settings-help" style={{ margin: 0 }}>Evaluate at x =</span>
                <input
                  type="number"
                  className="input-field"
                  style={{ width: 90, margin: 0 }}
                  value={polyX}
                  onChange={e => setPolyX(e.target.value)}
                />
              </div>
              <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                {['(x + 3)(x - 2)', '(2x + 1)^2', '6x^2 + 11x + 3', '3x^2 + 4x - x^2 + 5'].map(ex => (
                  <button
                    key={ex}
                    type="button"
                    className="tag-pill"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPolyInput(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}

          {algMode === 'sys2' && (
            <>
              <div className="settings-label">Equation 1 (x &amp; y)</div>
              <input
                type="text"
                className="ai-input"
                value={sysEq1}
                onChange={e => setSysEq1(e.target.value)}
                placeholder="2x + y = 10"
                spellCheck="false"
              />
              <div className="settings-label mt-10">Equation 2 (x &amp; y)</div>
              <input
                type="text"
                className="ai-input"
                value={sysEq2}
                onChange={e => setSysEq2(e.target.value)}
                placeholder="x - y = 2"
                spellCheck="false"
              />
              <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
                {[
                  ['2x + y = 10', 'x - y = 2'],
                  ['3x + 2y = 16', 'x + 4y = 12'],
                  ['2x - y = 4', '4x - 2y = 8'],
                ].map(([a, b], i) => (
                  <button
                    key={i}
                    type="button"
                    className="tag-pill"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSysEq1(a);
                      setSysEq2(b);
                    }}
                  >
                    {a} &amp; {b}
                  </button>
                ))}
              </div>
            </>
          )}

          {!algResult.ok && <div className="inline-mistake mt-12">{algResult.error}</div>}

          {algResult.ok && algMode === 'eq1' && (
            <div className="list-group settings-group mt-12" style={{ margin: '12px 0 0', padding: 12 }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>Result ({algResult.data.kind})</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--accent)' }}>
                {algResult.data.answer}
              </div>
              <div className="mt-8" style={{ fontSize: 13, lineHeight: 1.55 }}>
                {algResult.data.steps.map((st, idx) => (
                  <div key={idx}>{st}</div>
                ))}
              </div>
              <div className="flex gap-8 mt-12">
                {onOpenGrapher && algResult.data.graphExpr && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm flex-1"
                    onClick={() => onOpenGrapher(algResult.data.graphExpr)}
                  >
                    <LineChart size={14} /> Graph Equation
                  </button>
                )}
                {onSaveNote && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm flex-1"
                    onClick={() =>
                      onSaveNote(
                        `Algebra: ${eqInput}`,
                        `${eqInput}\nResult: ${algResult.data.answer}\n\nSteps:\n${algResult.data.steps.join('\n')}`
                      )
                    }
                  >
                    <FilePlus2 size={14} /> Save Note
                  </button>
                )}
              </div>
            </div>
          )}

          {algResult.ok && algMode === 'simplify' && (
            <div className="subnet-grid mt-12">
              <div className="subnet-cell">
                <div className="subnet-k">Simplified / Expanded</div>
                <div className="subnet-v">{algResult.data.simplified}</div>
              </div>
              <div className="subnet-cell">
                <div className="subnet-k">Factored Form</div>
                <div className="subnet-v">{algResult.data.factored || 'Prime / N/A'}</div>
              </div>
              <div className="subnet-cell">
                <div className="subnet-k">Degree</div>
                <div className="subnet-v">{algResult.data.degree}</div>
              </div>
              <div className="subnet-cell">
                <div className="subnet-k">Value at x = {polyX || '?'}</div>
                <div className="subnet-v">{algResult.data.evaluated ?? '—'}</div>
              </div>
            </div>
          )}

          {algResult.ok && algMode === 'sys2' && (
            <div className="list-group settings-group mt-12" style={{ margin: '12px 0 0', padding: 12 }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>2×2 Solution</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--accent)' }}>
                {algResult.data.summary}
              </div>
              <div className="mt-8" style={{ fontSize: 13, lineHeight: 1.55 }}>
                {algResult.data.steps.map((st, idx) => (
                  <div key={idx}>{st}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 2. Propositional Logic & Truth Table Calculator */}
      {subTab === 'truth' && (
        <>
          <div className="settings-label">
            Logical Expression (supports IF..THEN, ELSE, IFF, AND, OR, XOR, NOT)
          </div>
          <input
            type="text"
            className="ai-input"
            value={logicExpr}
            onChange={e => setLogicExpr(e.target.value)}
            placeholder="e.g. if P then Q else R"
            spellCheck="false"
          />

          <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
            {LOGIC_KEYS.map(([ins, lbl]) => (
              <button
                key={lbl}
                type="button"
                className="row-action-chip"
                onClick={() =>
                  setLogicExpr(cur =>
                    ins === 'if P then Q else R' ? ins : `${cur}${cur && !cur.endsWith(' ') ? '' : ''}${ins}`
                  )
                }
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
            {LOGIC_PRESETS.map(([expr, lbl]) => (
              <button
                key={expr}
                type="button"
                className="tag-pill"
                style={{ cursor: 'pointer' }}
                onClick={() => setLogicExpr(expr)}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-8 mt-10">
            <button
              type="button"
              className={`row-action-chip${compareOpen ? ' active-chip' : ''}`}
              onClick={() => setCompareOpen(v => !v)}
            >
              {compareOpen ? 'Hide Equivalence Check' : 'Compare Equivalence (≡)'}
            </button>
            {ttResult.ok && (
              <span className="mode-badge mode-study">
                {ttResult.data.classification} · {ttResult.data.trueCount}/{ttResult.data.totalRows} True
              </span>
            )}
          </div>

          {compareOpen && (
            <div className="mt-8">
              <div className="settings-label">Compare with Second Formula</div>
              <input
                type="text"
                className="ai-input"
                value={logicExprB}
                onChange={e => setLogicExprB(e.target.value)}
                placeholder="e.g. !P || Q"
                spellCheck="false"
              />
              {eqvResult?.ok ? (
                <div className="settings-help" style={{ color: eqvResult.data.equivalent ? 'var(--ok)' : '#ef4444', fontWeight: 700 }}>
                  {eqvResult.data.equivalent
                    ? '≡ Logically Equivalent across all truth rows!'
                    : `✗ Not Equivalent (Counterexample: ${Object.entries(eqvResult.data.counterexample.values)
                        .map(([k, v]) => `${k}=${v ? 'T' : 'F'}`)
                        .join(', ')})`}
                </div>
              ) : (
                eqvResult && <div className="inline-mistake mt-8">{eqvResult.error}</div>
              )}
            </div>
          )}

          {!ttResult.ok && <div className="inline-mistake mt-12">{ttResult.error}</div>}

          {ttResult.ok && (
            <>
              <div className="truth-table-wrap mt-12">
                <table className="truth-table">
                  <thead>
                    <tr>
                      {ttResult.data.variables.map(v => (
                        <th key={v}>{v}</th>
                      ))}
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ttResult.data.rows.map((row, idx) => (
                      <tr key={idx}>
                        {ttResult.data.variables.map(v => (
                          <td key={v}>
                            <span className={`truth-val ${row.values[v] ? 'is-t' : 'is-f'}`}>
                              {row.values[v] ? 'T' : 'F'}
                            </span>
                          </td>
                        ))}
                        <td>
                          <span className={`truth-val ${row.result ? 'is-t' : 'is-f'}`}>
                            {row.result ? 'T' : 'F'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ttResult.data.dnf && (
                <div className="settings-help" style={{ marginTop: 8 }}>
                  Canonical DNF: <strong>{ttResult.data.dnf}</strong>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 3. Practical IF / THEN / ELSE IF / ELSE Branch Rule Evaluator */}
      {subTab === 'rules' && (
        <>
          <div className="settings-label">
            Conditional Rule &amp; Variables (use score = 78; if ... then ... else if ... else ...)
          </div>
          <textarea
            rows={4}
            className="ai-input"
            style={{ minHeight: 92, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            value={ruleInput}
            onChange={e => setRuleInput(e.target.value)}
            spellCheck="false"
          />
          <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
            {RULE_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                className="tag-pill"
                style={{ cursor: 'pointer' }}
                onClick={() => setRuleInput(p.text)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {!ruleResult.ok && <div className="inline-mistake mt-12">{ruleResult.error}</div>}

          {ruleResult.ok && (
            <div className="list-group settings-group mt-12" style={{ margin: '12px 0 0', padding: 12 }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>Evaluated Decision Output</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>
                {ruleResult.data.matched ? String(ruleResult.data.result) : 'No branch matched'}
              </div>
              <div className="mt-8" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {ruleResult.data.trace.map((step, i) => (
                  <div key={i} className="flex items-center gap-6" style={{ fontSize: 12.5 }}>
                    {step.passed ? (
                      <CheckCircle2 size={14} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                    ) : (
                      <XCircle size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    )}
                    <span>
                      <strong>{step.branch}</strong> ({step.condition}) → {String(step.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
