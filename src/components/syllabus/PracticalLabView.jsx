/**
 * PracticalLabView — Hybrid 3-Tier Hands-On Practical Engine for Syllabus Topics:
 *  - Tier 1: Auto-wired native labs (Code Runner, 2D Grapher, Algebra/Logic, NetLab, AlgoVisualizer)
 *  - Tier 2: AI-generated declarative Formula Calculators (live safe math) & Case Simulators
 *  - Tier 3: On-demand sandboxed HTML/CSS/JS custom interactive simulator (<iframe sandbox="allow-scripts">)
 */
import { useState, useMemo, lazy, Suspense } from 'react';
import {
  Play,
  Sparkles,
  Wrench,
  CheckCircle2,
  Calculator,
  Lightbulb,
  RotateCw,
  Code2,
} from 'lucide-react';
import { executeCode } from '../../lib/codeRunner';
import {
  evaluateFormulaSafe,
  generatePracticalLabSpec,
  evaluatePracticalAttempt,
  buildCustomInteractiveToolHtml,
} from '../../lib/syllabusEngine';
import MarkdownContent from '../ui/MarkdownContent';
import { useDialog } from '../ui/DialogProvider';

const MathGrapherTab = lazy(() => import('../toolkit/MathGrapherTab'));
const AlgebraLogicTab = lazy(() => import('../toolkit/AlgebraLogicTab'));
const NetworkingLabTab = lazy(() => import('../toolkit/NetworkingLabTab'));
const AlgoVisualizer = lazy(() => import('../AlgoVisualizer'));

export default function PracticalLabView({
  syllabus,
  topic,
  verifiedSources = [],
  cachedLabSpec = null,
  cachedWidgetHtml = '',
  onCacheUpdate,
  onPracticed,
}) {
  const { toast } = useDialog();
  const [labSpec, setLabSpec] = useState(cachedLabSpec);
  const [loadingSpec, setLoadingSpec] = useState(false);

  // Tier 1 code sandbox state
  const [codeText, setCodeText] = useState(
    () => cachedLabSpec?.starterCode || topic?.starterTask || ''
  );
  const [codeOutput, setCodeOutput] = useState(null);
  const [runningCode, setRunningCode] = useState(false);

  // Tier 2 formula inputs & user practical response
  const [formulaVals, setFormulaVals] = useState(() => {
    const init = {};
    for (const inp of cachedLabSpec?.inputs || []) {
      init[inp.id] = Number(inp.defaultValue ?? 0);
    }
    return init;
  });
  const [attemptText, setAttemptText] = useState('');
  const [grading, setGrading] = useState(false);
  const [gradeResult, setGradeResult] = useState(null);

  // Tier 3 custom sandboxed interactive HTML widget
  const [widgetHtml, setWidgetHtml] = useState(cachedWidgetHtml || '');
  const [buildingWidget, setBuildingWidget] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const computedOutputs = useMemo(() => {
    if (!labSpec || labSpec.mode !== 'formula-calc') return [];
    return (labSpec.outputs || []).map(out => ({
      ...out,
      value: evaluateFormulaSafe(out.formulaExpr, formulaVals),
    }));
  }, [labSpec, formulaVals]);

  const handleGenerateLab = async () => {
    if (loadingSpec) return;
    setLoadingSpec(true);
    try {
      const spec = await generatePracticalLabSpec({ syllabus, topic, verifiedSources });
      setLabSpec(spec);
      if (spec.starterCode) setCodeText(spec.starterCode);
      const init = {};
      for (const inp of spec.inputs || []) {
        init[inp.id] = Number(inp.defaultValue ?? 0);
      }
      setFormulaVals(init);
      onCacheUpdate?.({ labSpec: spec });
    } catch (err) {
      toast(err.message || 'Could not generate practical lab', { type: 'error' });
    } finally {
      setLoadingSpec(false);
    }
  };

  const handleRunCode = async () => {
    if (runningCode || !codeText.trim()) return;
    setRunningCode(true);
    try {
      const res = await executeCode({
        langId: topic.labLanguage || 'javascript',
        code: codeText,
        allowAiFallback: true,
      });
      setCodeOutput(res);
    } catch (err) {
      setCodeOutput({ ok: false, stdout: '', stderr: err.message || 'Execution failed' });
    } finally {
      setRunningCode(false);
    }
  };

  const handleGradePractical = async () => {
    const workSummary =
      labSpec?.mode === 'native-code'
        ? `Code:\n${codeText}\n\nOutput:\n${codeOutput?.stdout || codeOutput?.stderr || '(not run)'}\n\nNotes:\n${attemptText}`
        : labSpec?.mode === 'formula-calc'
          ? `Inputs: ${JSON.stringify(formulaVals)}\nComputed: ${JSON.stringify(computedOutputs.map(o => ({ label: o.label, val: o.value })))}\nStudent Answer:\n${attemptText}`
          : attemptText;

    if (!workSummary.trim() || grading) {
      toast('Complete or write your practical solution first.');
      return;
    }
    setGrading(true);
    try {
      const res = await evaluatePracticalAttempt({
        syllabus,
        topic,
        labSpec,
        userWork: workSummary,
      });
      setGradeResult(res);
      if (res.passed) {
        onPracticed?.(res.practicalSummary);
        toast('Practical Lab passed — topic marked Practiced!', { type: 'success' });
      }
    } catch (err) {
      toast(err.message || 'Could not grade practical attempt', { type: 'error' });
    } finally {
      setGrading(false);
    }
  };

  const handleBuildCustomWidget = async () => {
    if (buildingWidget) return;
    setBuildingWidget(true);
    try {
      const html = await buildCustomInteractiveToolHtml({ syllabus, topic });
      setWidgetHtml(html);
      onCacheUpdate?.({ widgetHtml: html });
      toast('Custom interactive simulator built & cached offline!', { type: 'success' });
    } catch (err) {
      toast(err.message || 'Could not build interactive tool', { type: 'error' });
    } finally {
      setBuildingWidget(false);
    }
  };

  const mode = labSpec?.mode || topic.labType || 'formula-calc';

  return (
    <div className="practical-lab-wrap">
      <div className="practical-goal-banner">
        <div className="practical-goal-eyebrow">
          <Wrench size={13} /> Hands-On Practical Goal
        </div>
        <div className="practical-goal-text">{topic.practicalGoal}</div>
      </div>

      {!labSpec && (
        <div className="explanation-card" style={{ textAlign: 'center', padding: '18px 14px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
            Launch Hands-On Practical Lab
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Generates an interactive exercise, live calculator/code sandbox, or simulator tailored to{' '}
            <strong>{topic.title}</strong>.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loadingSpec}
            onClick={handleGenerateLab}
          >
            {loadingSpec ? (
              <>
                <span className="spinner" style={{ width: 13, height: 13 }} /> Building Lab…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Build Practical Exercise
              </>
            )}
          </button>
        </div>
      )}

      {labSpec && (
        <div className="explanation-card">
          <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 750 }}>{labSpec.title}</div>
            <button
              type="button"
              className="row-action-chip"
              disabled={loadingSpec}
              onClick={handleGenerateLab}
              title="Regenerate practical exercise"
            >
              <RotateCw size={12} className={loadingSpec ? 'spin-icon' : ''} /> New Exercise
            </button>
          </div>

          {(labSpec.instructions || labSpec.description || labSpec.scenario) && (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 10 }}>
              <MarkdownContent text={labSpec.instructions || labSpec.description || labSpec.scenario} />
            </div>
          )}

          {labSpec.artifact && (
            <pre className="smart-output-pre" style={{ marginBottom: 10, maxHeight: 160 }}>
              {labSpec.artifact}
            </pre>
          )}

          {Array.isArray(labSpec.tasks) && labSpec.tasks.length > 0 && (
            <div className="practical-tasks-box">
              <div className="settings-label" style={{ margin: '0 0 4px' }}>Steps to Complete</div>
              {labSpec.tasks.map((tk, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 3 }}>
                  {i + 1}. {tk}
                </div>
              ))}
            </div>
          )}

          {/* Tier 1A: Code Sandbox */}
          {mode === 'native-code' && (
            <div className="mt-10">
              <div className="flex items-center justify-between gap-6" style={{ marginBottom: 6 }}>
                <span className="mode-badge mode-code">
                  <Code2 size={11} /> {(topic.labLanguage || 'javascript').toUpperCase()}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={runningCode}
                  onClick={handleRunCode}
                >
                  <Play size={13} /> {runningCode ? 'Running…' : 'Run Code'}
                </button>
              </div>
              <textarea
                className="ai-input"
                rows={7}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.45 }}
                value={codeText}
                onChange={e => setCodeText(e.target.value)}
                spellCheck="false"
              />
              {codeOutput && (
                <div className={`smart-output-drawer mt-8${!codeOutput.ok ? ' is-error' : ''}`}>
                  {codeOutput.html ? (
                    <iframe
                      title="HTML Preview"
                      sandbox="allow-scripts"
                      srcDoc={codeOutput.html}
                      className="smart-html-preview"
                    />
                  ) : (
                    <pre className="smart-output-pre">
                      {codeOutput.ok
                        ? codeOutput.stdout || '(Finished with no output)'
                        : [codeOutput.stdout, codeOutput.stderr].filter(Boolean).join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tier 1B: Embedded Native Labs */}
          {mode === 'native-math' && (
            <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading 2D Grapher…</div>}>
              <MathGrapherTab initialExpr={labSpec.starterCode || ''} />
            </Suspense>
          )}
          {mode === 'native-logic' && (
            <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading Algebra &amp; Logic Lab…</div>}>
              <AlgebraLogicTab />
            </Suspense>
          )}
          {mode === 'native-net' && (
            <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading Networking Lab…</div>}>
              <NetworkingLabTab />
            </Suspense>
          )}
          {mode === 'native-algo' && (
            <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Loading Algo Visualizer…</div>}>
              <AlgoVisualizer />
            </Suspense>
          )}

          {/* Tier 2: Declarative Interactive Formula Calculator */}
          {mode === 'formula-calc' && Array.isArray(labSpec.inputs) && labSpec.inputs.length > 0 && (
            <div className="practical-calc-box mt-10">
              <div className="flex items-center gap-6" style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                <Calculator size={14} /> Interactive Model Inputs
              </div>
              <div className="practical-inputs-grid">
                {labSpec.inputs.map(inp => (
                  <label key={inp.id} className="practical-input-cell">
                    <span className="practical-input-lbl">
                      {inp.label} {inp.unit ? `(${inp.unit})` : ''}
                    </span>
                    <input
                      type="number"
                      className="input-field"
                      step={inp.step || 'any'}
                      value={formulaVals[inp.id] ?? 0}
                      onChange={e =>
                        setFormulaVals(prev => ({ ...prev, [inp.id]: Number(e.target.value) }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="practical-outputs-list mt-10">
                {computedOutputs.map((out, idx) => (
                  <div key={idx} className="practical-output-row">
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{out.label}</div>
                      {out.explanation && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {out.explanation}
                        </div>
                      )}
                    </div>
                    <div className="practical-output-val">
                      {out.value !== null ? out.value : '—'} {out.unit || ''}
                    </div>
                  </div>
                ))}
              </div>
              {labSpec.challenge?.prompt && (
                <div className="settings-tip mt-8" style={{ fontWeight: 600, color: 'var(--text)' }}>
                  Challenge: {labSpec.challenge.prompt}
                </div>
              )}
            </div>
          )}

          {/* Hint toggle */}
          {(labSpec.hint || labSpec.challenge?.hint) && (
            <div className="mt-8">
              <button
                type="button"
                className="row-action-chip"
                onClick={() => setShowHint(h => !h)}
              >
                <Lightbulb size={12} /> {showHint ? 'Hide Hint' : 'Show Hint'}
              </button>
              {showHint && (
                <div className="settings-tip mt-6">
                  {labSpec.hint || labSpec.challenge?.hint}
                </div>
              )}
            </div>
          )}

          {/* Submit Practical Work for AI Mentor Verification */}
          <div className="mt-12">
            <div className="settings-label" style={{ marginBottom: 4 }}>
              Your Practical Solution / Takeaways
            </div>
            <textarea
              className="ai-input"
              rows={3}
              value={attemptText}
              onChange={e => setAttemptText(e.target.value)}
              placeholder={
                mode === 'native-code'
                  ? 'Optional notes on what your code produced or edge cases tested…'
                  : 'Write your calculated result, reasoning, or applied solution…'
              }
            />
            <div className="flex gap-8 mt-8" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={grading}
                onClick={handleGradePractical}
              >
                {grading ? (
                  <>
                    <span className="spinner" style={{ width: 12, height: 12 }} /> Checking Work…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Check Practical Work
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onPracticed?.(`Completed hands-on lab: ${labSpec.title}`);
                  toast('Marked Practiced — proceed to Mastery Gate!', { type: 'success' });
                }}
              >
                Mark Practiced
              </button>
            </div>
          </div>

          {gradeResult && (
            <div className="practical-grade-card mt-10">
              <div style={{ fontSize: 13.5, fontWeight: 750 }}>
                Practical Score: {gradeResult.score}/100 ·{' '}
                <span style={{ color: gradeResult.passed ? 'var(--ok)' : 'var(--accent-ink)' }}>
                  {gradeResult.passed ? 'Passed' : 'Needs Tweaking'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>{gradeResult.strengths}</div>
              {gradeResult.fixes.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  • {gradeResult.fixes.join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tier 3: On-Demand Custom Interactive HTML/JS Simulator (Sandboxed) */}
      <div className="explanation-card mt-10">
        <div className="flex items-center justify-between gap-8">
          <div>
            <div style={{ fontSize: 14, fontWeight: 750 }}>Custom Interactive Simulator</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Builds a dedicated visual mini-tool for this topic &amp; caches it offline.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={buildingWidget}
            onClick={handleBuildCustomWidget}
          >
            <Wrench size={13} /> {buildingWidget ? 'Building…' : widgetHtml ? 'Rebuild' : 'Build Tool'}
          </button>
        </div>

        {widgetHtml && (
          <iframe
            title={`${topic.title} Interactive Simulator`}
            sandbox="allow-scripts"
            srcDoc={widgetHtml}
            className="practical-widget-frame mt-10"
          />
        )}
      </div>
    </div>
  );
}
