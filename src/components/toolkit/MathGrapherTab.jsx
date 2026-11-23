/**
 * MathGrapherTab — 100% Offline 2D Math Function Grapher.
 * Plots up to 3 equations simultaneously, computes f(x), f'(x), and approximate roots,
 * and inserts a crisp PNG snapshot straight into a new note with 1 tap!
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, FilePlus2, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  compileMathExpression,
  evaluateExpression,
  numericalDerivative,
  findApproxRoots,
} from '../../lib/mathGrapher';
import { db, createNote, saveImageAttachment, logStudyActivity } from '../../store/db';
import { isDarkTheme } from '../../theme';
import { useDialog } from '../ui/DialogProvider';

const COLORS = ['#0a84ff', '#ff375f', '#28b44c'];
const PRESETS = [
  ['sin(x)', 'cos(x)', ''],
  ['x^2 - 4', '2x', ''],
  ['exp(-x^2 / 4) * cos(3x)', 'sqrt(abs(x))', ''],
  ['ln(x)', 'x - 1', ''],
];

export default function MathGrapherTab({ onOpenNote }) {
  const { toast } = useDialog();
  const [eqs, setEqs] = useState(['sin(x)', 'x^2 - 4', '']);
  const [xCenter, setXCenter] = useState(0);
  const [yCenter, setYCenter] = useState(0);
  const [xHalfSpan, setXHalfSpan] = useState(8);
  const [evalX, setEvalX] = useState('1');
  const canvasRef = useRef(null);

  const compiled = useMemo(
    () =>
      eqs.map(raw => {
        const clean = String(raw || '').trim();
        if (!clean) return { raw: '', fn: null, err: '' };
        try {
          return { raw: clean, fn: compileMathExpression(clean), err: '' };
        } catch (err) {
          return { raw: clean, fn: null, err: err.message };
        }
      }),
    [eqs]
  );

  // Render crisp retina-ready 2D Cartesian coordinate plane & curves
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 340;
    const H = 250;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const dark = isDarkTheme();
    const bg = dark ? '#111114' : '#ffffff';
    const gridCol = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const axisCol = dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)';
    const textCol = dark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.55)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const xMin = xCenter - xHalfSpan;
    const xMax = xCenter + xHalfSpan;
    const yHalfSpan = xHalfSpan * (H / W);
    const yMin = yCenter - yHalfSpan;
    const yMax = yCenter + yHalfSpan;

    const toPxX = x => ((x - xMin) / (xMax - xMin)) * W;
    const toPxY = y => H - ((y - yMin) / (yMax - yMin)) * H;

    // Nice grid step
    const rawStep = (xMax - xMin) / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const norm = rawStep / mag;
    const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;

    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = textCol;

    const startX = Math.ceil(xMin / step) * step;
    for (let gx = startX; gx <= xMax; gx += step) {
      const px = toPxX(gx);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
      if (Math.abs(gx) > step * 0.1) {
        const labelY = Math.max(12, Math.min(H - 6, toPxY(0) + 12));
        ctx.fillText(String(Math.round(gx * 100) / 100), px + 2, labelY);
      }
    }

    const startY = Math.ceil(yMin / step) * step;
    for (let gy = startY; gy <= yMax; gy += step) {
      const py = toPxY(gy);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
      ctx.stroke();
      if (Math.abs(gy) > step * 0.1) {
        const labelX = Math.max(4, Math.min(W - 26, toPxX(0) + 4));
        ctx.fillText(String(Math.round(gy * 100) / 100), labelX, py - 2);
      }
    }

    // X and Y axes
    ctx.strokeStyle = axisCol;
    ctx.lineWidth = 1.4;
    if (yMin <= 0 && yMax >= 0) {
      const y0 = toPxY(0);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(W, y0);
      ctx.stroke();
    }
    if (xMin <= 0 && xMax >= 0) {
      const x0 = toPxX(0);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, H);
      ctx.stroke();
    }

    // Plot curves
    compiled.forEach((item, idx) => {
      if (!item.fn) return;
      ctx.strokeStyle = COLORS[idx];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let penDown = false;
      let prevPy = null;
      const samples = Math.max(240, Math.round(W * 1.5));
      for (let s = 0; s <= samples; s++) {
        const px = (s / samples) * W;
        const x = xMin + (s / samples) * (xMax - xMin);
        const y = item.fn(x);
        if (!Number.isFinite(y) || Math.abs(y) > 1e5) {
          penDown = false;
          prevPy = null;
          continue;
        }
        const py = toPxY(y);
        // Break line cleanly across vertical asymptotes (e.g. tan(x), 1/x)
        if (prevPy !== null && Math.abs(py - prevPy) > H * 0.75) {
          penDown = false;
        }
        if (!penDown) {
          ctx.moveTo(px, py);
          penDown = true;
        } else {
          ctx.lineTo(px, py);
        }
        prevPy = py;
      }
      ctx.stroke();
    });

    // Plot marker for evaluated x on f1(x)
    const xVal = Number(evalX);
    if (Number.isFinite(xVal) && compiled[0]?.fn) {
      const yVal = compiled[0].fn(xVal);
      if (Number.isFinite(yVal) && xVal >= xMin && xVal <= xMax && yVal >= yMin && yVal <= yMax) {
        ctx.fillStyle = COLORS[0];
        ctx.beginPath();
        ctx.arc(toPxX(xVal), toPxY(yVal), 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [compiled, xCenter, yCenter, xHalfSpan, evalX]);

  const evalSummary = useMemo(() => {
    const xNum = Number(evalX);
    if (!Number.isFinite(xNum)) return [];
    return compiled
      .map((c, idx) => {
        if (!c.raw || c.err) return null;
        const fx = evaluateExpression(c.raw, xNum);
        const dfx = numericalDerivative(c.raw, xNum);
        const roots = findApproxRoots(c.raw, xCenter - xHalfSpan, xCenter + xHalfSpan);
        return {
          idx,
          raw: c.raw,
          fx: Number.isFinite(fx) ? Math.round(fx * 10000) / 10000 : 'undef',
          dfx: Number.isFinite(dfx) ? Math.round(dfx * 1000) / 1000 : 'undef',
          roots,
        };
      })
      .filter(Boolean);
  }, [compiled, evalX, xCenter, xHalfSpan]);

  const handleSaveGraphAsNote = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const folders = await db.folders.toArray();
      const target =
        folders.find(f => !f.locked && !f.isSystemVault && f.mode !== 'vault' && /math|calc|phys/i.test(f.name)) ||
        folders.find(f => !f.locked && !f.isSystemVault && f.mode !== 'vault') ||
        folders[0];
      const activeEqs = eqs.filter(s => s.trim());
      const title = `Graph: ${activeEqs.join(', ').slice(0, 48) || '2D Plot'}`;
      const bodyLines = [
        '## Plotted Functions',
        ...activeEqs.map((q, i) => `- $f_${i + 1}(x) = ${q}$`),
        '',
        `Window: $x \\in [${(xCenter - xHalfSpan).toFixed(1)}, ${(xCenter + xHalfSpan).toFixed(1)}]$`,
      ];
      if (evalSummary.length > 0) {
        bodyLines.push('', `## Evaluation at $x = ${evalX}$`);
        evalSummary.forEach(ev => {
          bodyLines.push(
            `- \`${ev.raw}\`: $f(${evalX}) = ${ev.fx}$, $f'(${evalX}) \\approx ${ev.dfx}$` +
              (ev.roots.length ? ` · Roots: ${ev.roots.join(', ')}` : '')
          );
        });
      }
      const created = await createNote(target?.id ?? null, title, bodyLines.join('\n'), target?.name || 'Math');
      const imgEntry = await saveImageAttachment(created.id, dataUrl, title);
      await db.notes.update(created.id, { images: [imgEntry] });
      const fresh = await db.notes.get(created.id);
      await logStudyActivity('notes', 1);
      toast('Saved graph snapshot into a new note!', { type: 'success' });
      onOpenNote?.(fresh, target || { id: '__all__', name: 'All Notes' });
    } catch (err) {
      toast(`Could not save graph: ${err.message}`, { type: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
          <span className="settings-label" style={{ margin: 0 }}>
            2D Function Grapher (Offline)
          </span>
          <div className="flex gap-6">
            <button type="button" className="icon-btn" title="Pan left" onClick={() => setXCenter(c => c - xHalfSpan * 0.35)}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="icon-btn" title="Pan right" onClick={() => setXCenter(c => c + xHalfSpan * 0.35)}>
              <ArrowRight size={15} />
            </button>
            <button type="button" className="icon-btn" title="Zoom in" onClick={() => setXHalfSpan(s => Math.max(1, s * 0.7))}>
              <ZoomIn size={16} />
            </button>
            <button type="button" className="icon-btn" title="Zoom out" onClick={() => setXHalfSpan(s => Math.min(80, s * 1.4))}>
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Reset view"
              onClick={() => {
                setXCenter(0);
                setYCenter(0);
                setXHalfSpan(8);
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="math-graph-canvas"
          aria-label="2D Math Function Graph"
        />

        {/* Quick presets */}
        <div className="flex gap-6 mt-10" style={{ flexWrap: 'wrap' }}>
          {['Trig', 'Parabola', 'Damped', 'Log'].map((lbl, idx) => (
            <button
              key={lbl}
              type="button"
              className="row-action-chip"
              onClick={() => setEqs(PRESETS[idx])}
            >
              {lbl}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={handleSaveGraphAsNote}
          >
            <FilePlus2 size={13} /> Save Graph to Note
          </button>
        </div>
      </div>

      {/* Up to 3 Equations */}
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div className="settings-label">Equations (supports sin, cos, tan, sqrt, abs, ln, log, exp, ^, pi, e)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {eqs.map((eq, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: COLORS[idx],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, opacity: 0.7 }}>
                f{idx + 1}(x)=
              </span>
              <input
                className="input-field"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={idx === 2 ? 'Optional 3rd equation (e.g. 0.5x + 1)' : 'e.g. sin(x)'}
                value={eq}
                onChange={e =>
                  setEqs(prev => prev.map((v, i) => (i === idx ? e.target.value : v)))
                }
              />
            </div>
          ))}
        </div>
        {compiled.some(c => c.err) && (
          <div className="inline-mistake mt-8">
            {compiled
              .map((c, i) => (c.err ? `f${i + 1}: ${c.err}` : ''))
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>

      {/* Live Evaluator f(x), f'(x) & Roots */}
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
          <span className="settings-label" style={{ margin: 0 }}>
            Evaluate at x =
          </span>
          <input
            type="number"
            step="0.5"
            className="input-field"
            style={{ width: 92, padding: '4px 8px' }}
            value={evalX}
            onChange={e => setEvalX(e.target.value)}
          />
        </div>
        {evalSummary.map(ev => (
          <div
            key={ev.idx}
            style={{
              fontSize: 13,
              padding: '6px 0',
              borderTop: ev.idx > 0 ? '1px solid var(--sep)' : 'none',
            }}
          >
            <strong style={{ color: COLORS[ev.idx], fontFamily: 'var(--font-mono)' }}>
              f{ev.idx + 1}({evalX}) = {ev.fx}
            </strong>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              · slope f&apos;({evalX}) ≈ {ev.dfx}
              {ev.roots.length > 0 ? ` · roots: ${ev.roots.join(', ')}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
