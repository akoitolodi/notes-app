/**
 * StrokeLayer — full-page annotation overlay.
 * A transparent canvas that covers its (position:relative) parent and renders
 * strokes scaled to the stored reference width, so drawings survive font-size
 * changes and rotation.
 *
 * Strokes: [{ tool, color, width, fontSize?, text?, points: [{x,y}] }]
 * Coordinates are stored in "reference space" (refWidth). The layer converts
 * pointer input from live CSS pixels into reference space, so everything
 * scales proportionally.
 *
 * Tools: pen, highlighter, eraser (removes whole strokes), arrow, line, text.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export const PALETTE = [
  '#000000', '#8e8e93', '#ff3b30', '#ff9500',
  '#ffcc00', '#34c759', '#00c7be', '#007aff',
  '#5856d6', '#af52de', '#ff2d55', '#a2845e',
];

export const TOOLS = [
  ['pen', '✏️', 'Pen'],
  ['highlighter', '🖍', 'Highlighter'],
  ['eraser', '🧽', 'Eraser'],
  ['arrow', '➔', 'Arrow'],
  ['line', '╱', 'Line'],
  ['text', 'T', 'Text'],
];

export const SIZES = ['fine', 'medium', 'thick'];
export const SIZE_LABEL = { fine: 'S', medium: 'M', thick: 'L' };

export function toolWidth(tool, size) {
  const w = {
    pen: { fine: 2, medium: 5, thick: 10 },
    highlighter: { fine: 10, medium: 18, thick: 26 },
    arrow: { fine: 2, medium: 4, thick: 7 },
    line: { fine: 2, medium: 4, thick: 7 },
    text: { fine: 14, medium: 20, thick: 28 },
    eraser: { fine: 16, medium: 24, thick: 36 },
  };
  return (w[tool] || w.pen)[size] || 5;
}

/** Draw one stroke into ctx. scale converts reference space → canvas space. */
function drawStroke(ctx, s, scale) {
  const pts = s.points || [];
  if (!pts.length) return;

  if (s.tool === 'text') {
    const p = pts[0];
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.color || '#000';
    ctx.font = `${(s.fontSize || 20) * scale}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text || '', p.x * scale, p.y * scale);
    return;
  }

  if (s.tool === 'arrow' || s.tool === 'line') {
    if (pts.length < 2) return;
    const a = pts[0], b = pts[1];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.color || '#000';
    ctx.lineWidth = (s.width || 4) * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x * scale, a.y * scale);
    ctx.lineTo(b.x * scale, b.y * scale);
    ctx.stroke();
    if (s.tool === 'arrow') {
      const ang = Math.atan2((b.y - a.y), (b.x - a.x));
      const head = 10 * scale + (s.width || 4) * scale * 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x * scale, b.y * scale);
      ctx.lineTo(b.x * scale - head * Math.cos(ang - Math.PI / 7), b.y * scale - head * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(b.x * scale, b.y * scale);
      ctx.lineTo(b.x * scale - head * Math.cos(ang + Math.PI / 7), b.y * scale - head * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
    return;
  }

  // freehand: pen | highlighter
  const isHl = s.tool === 'highlighter';
  ctx.globalAlpha = isHl ? 0.4 : 1;
  ctx.strokeStyle = s.color || '#000';
  ctx.lineWidth = (s.width || 5) * scale;
  ctx.lineCap = isHl ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * scale, pts[0].y * scale, (s.width || 5) * scale / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.color || '#000';
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
  ctx.stroke();
}

export default function StrokeLayer({
  drawing,            // { refWidth, strokes }
  editable = false,   // false → display only, taps pass through
  tool = 'pen',
  color = '#000000',
  size = 'medium',
  onChange,           // (doc { refWidth, strokes }) => void
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const currentRef = useRef(null); // in-progress stroke
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const strokes = drawing?.strokes || [];
  const refWidth = drawing?.refWidth || 0;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w < 1) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    const scale = refWidth ? dims.w / refWidth : 1;
    strokes.forEach(st => drawStroke(ctx, st, scale));
    if (currentRef.current) drawStroke(ctx, currentRef.current, scale);
  }, [strokes, refWidth, dims]);

  useEffect(() => { redraw(); }, [redraw]);

  // Size the canvas to its parent (the annotation wrapper)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const r = wrap.getBoundingClientRect();
      setDims(prev =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height }
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(dims.w * dpr));
    canvas.height = Math.max(1, Math.round(dims.h * dpr));
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims]);

  // Initialize refWidth on first edit — capture the wrapper width so strokes scale correctly
  useEffect(() => {
    if (!editable || refWidth !== 0) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    if (r.width > 0) {
      onChange?.({ refWidth: Math.round(r.width), strokes });
    }
  }, [editable, refWidth, strokes]);

  const getRefPoint = e => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const scale = refWidth ? rect.width / refWidth : 1;
    return {
      x: (t.clientX - rect.left) / (scale || 1),
      y: (t.clientY - rect.top) / (scale || 1),
    };
  };

  const commitStroke = stroke => {
    const canvas = canvasRef.current;
    const rectW = canvas ? canvas.getBoundingClientRect().width : 0;
    onChange?.({
      refWidth: drawing?.refWidth || Math.round(rectW) || 0,
      strokes: [...strokes, stroke],
    });
  };

  const eraseAt = pRef => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = refWidth ? rect.width / refWidth : 1;
    const rRef = toolWidth('eraser', size) / 2 / (scale || 1);
    const filtered = strokes.filter(st =>
      !(st.points || []).some(pt =>
        Math.hypot(pt.x - pRef.x, pt.y - pRef.y) < rRef + (st.width || 5) / 2
      )
    );
    if (filtered.length !== strokes.length) {
      onChange?.({ refWidth: drawing?.refWidth || 0, strokes: filtered });
    }
  };

  const handleStart = e => {
    if (!editable) return;
    e.preventDefault();
    if (tool === 'text') {
      const p = getRefPoint(e);
      let text = null;
      try { text = window.prompt('Text label'); } catch { text = null; }
      if (text && text.trim()) {
        commitStroke({
          tool: 'text',
          color,
          width: toolWidth('text', size),
          fontSize: toolWidth('text', size),
          points: [p],
          text: text.trim(),
        });
      }
      return;
    }
    if (tool === 'eraser') {
      eraseAt(getRefPoint(e));
      return;
    }
    const p = getRefPoint(e);
    currentRef.current = {
      tool,
      color,
      width: toolWidth(tool, size),
      fontSize: toolWidth('text', size),
      points: tool === 'arrow' || tool === 'line' ? [p, p] : [p],
    };
    redraw();
  };

  const handleMove = e => {
    if (!editable) return;
    e.preventDefault();
    const p = getRefPoint(e);
    if (tool === 'eraser') {
      eraseAt(p);
      return;
    }
    const cur = currentRef.current;
    if (!cur) return;
    if (cur.tool === 'arrow' || cur.tool === 'line') {
      cur.points[1] = p;
    } else {
      cur.points.push(p);
    }
    redraw();
  };

  const handleEnd = () => {
    if (!editable) return;
    const cur = currentRef.current;
    currentRef.current = null;
    if (cur) {
      const isShape = cur.tool === 'arrow' || cur.tool === 'line';
      const valid = isShape
        ? cur.points.length === 2 && Math.hypot(cur.points[1].x - cur.points[0].x, cur.points[1].y - cur.points[0].y) > 2
        : cur.points.length > 0;
      if (valid) commitStroke(cur);
      else redraw();
    } else {
      redraw();
    }
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: editable ? 'auto' : 'none',
        touchAction: editable ? 'none' : 'auto',
        zIndex: 5,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
      />
    </div>
  );
}