/**
 * StrokeLayer — annotation canvas for notes.
 *
 * Architecture (v1.2.0-beta.5): the canvas is VIEWPORT-SIZED (position:fixed)
 * and re-renders on every scroll, translated by the note page's live position.
 * Strokes are stored in CONTENT space (relative to the note page), so they
 * stick to the text when scrolling, and drawing works at ANY scroll position
 * — the "can only annotate the top part" problem is structurally impossible.
 *
 * Strokes: [{ tool, color, width, fontSize?, text?, points: [{x,y}] }]
 * Tools: pen, highlighter, eraser (removes whole strokes), arrow, line, text.
 * One finger = draw · Two fingers = scroll the note.
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

/** Draw one stroke. ctx is pre-translated to content space and pre-scaled. */
function drawStroke(ctx, s) {
  const pts = s.points || [];
  if (!pts.length) return;

  if (s.tool === 'text') {
    const p = pts[0];
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.color || '#000';
    ctx.font = `${s.fontSize || 20}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text || '', p.x, p.y);
    return;
  }

  if (s.tool === 'arrow' || s.tool === 'line') {
    if (pts.length < 2) return;
    const a = pts[0], b = pts[1];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.color || '#000';
    ctx.lineWidth = s.width || 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (s.tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 10 + (s.width || 4) * 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
    return;
  }

  // freehand: pen | highlighter
  const isHl = s.tool === 'highlighter';
  ctx.globalAlpha = isHl ? 0.4 : 1;
  ctx.strokeStyle = s.color || '#000';
  ctx.lineWidth = s.width || 5;
  ctx.lineCap = isHl ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (s.width || 5) / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.color || '#000';
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
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
  const pageRef = useRef(null);     // the note-page-wrap element (content anchor)
  const scrollElRef = useRef(null); // the .editor scroll container
  const currentRef = useRef(null);  // in-progress stroke
  const scrollMode = useRef(null);  // two-finger scroll state
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const strokes = drawing?.strokes || [];
  const refWidth = drawing?.refWidth || 0;

  // Find the content anchor (parent = .note-page-wrap) and scroll container
  useEffect(() => {
    const page = wrapRef.current?.parentElement;
    pageRef.current = page;
    let el = page;
    while (el && el !== document.body) {
      if (el.classList?.contains('editor')) { scrollElRef.current = el; break; }
      el = el.parentElement;
    }
  }, []);

  const pageRect = useCallback(() => {
    const el = pageRef.current;
    return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
  }, []);

  /** client (viewport) point → content space */
  const toContent = useCallback((clientX, clientY) => {
    const r = pageRect();
    const scale = refWidth ? r.width / refWidth : 1;
    return {
      x: (clientX - r.left) / (scale || 1),
      y: (clientY - r.top) / (scale || 1),
    };
  }, [refWidth, pageRect]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w < 1) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    const r = pageRect();
    const scale = refWidth ? r.width / refWidth : 1;
    ctx.save();
    ctx.translate(r.left, r.top);
    ctx.scale(scale, scale);
    strokes.forEach(st => drawStroke(ctx, st));
    if (currentRef.current) drawStroke(ctx, currentRef.current);
    ctx.restore();
  }, [strokes, refWidth, dims, pageRect]);

  // Keep the latest redraw reachable from non-reactive listeners (scroll)
  const redrawRef = useRef(redraw);
  useEffect(() => { redrawRef.current = redraw; }, [redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  // Size the canvas to the viewport (fixed overlay)
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
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
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

  // Re-render on scroll so strokes stay glued to the text
  useEffect(() => {
    const el = scrollElRef.current || window;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; redrawRef.current(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ---------- Two-finger scroll while drawing ----------
  const handleTwoFingerStart = e => {
    const t1 = e.touches[0], t2 = e.touches[1];
    const midY = (t1.clientY + t2.clientY) / 2;
    const container = scrollElRef.current;
    if (!container) return;
    scrollMode.current = { startMidY: midY, startScrollTop: container.scrollTop };
    if (currentRef.current) { currentRef.current = null; redraw(); }
  };

  const handleTwoFingerMove = e => {
    const sm = scrollMode.current;
    if (!sm) return;
    const t1 = e.touches[0], t2 = e.touches[1];
    const midY = (t1.clientY + t2.clientY) / 2;
    const container = scrollElRef.current;
    if (container) container.scrollTop = sm.startScrollTop - (midY - sm.startMidY);
  };

  const commitStroke = stroke => {
    const r = pageRect();
    onChange?.({
      refWidth: drawing?.refWidth || Math.round(r.width) || 0,
      strokes: [...strokes, stroke],
    });
  };

  const eraseAt = pContent => {
    const r = pageRect();
    const scale = refWidth ? r.width / refWidth : 1;
    const rRef = toolWidth('eraser', size) / 2 / (scale || 1);
    const filtered = strokes.filter(st =>
      !(st.points || []).some(pt =>
        Math.hypot(pt.x - pContent.x, pt.y - pContent.y) < rRef + (st.width || 5) / 2
      )
    );
    if (filtered.length !== strokes.length) {
      onChange?.({ refWidth: drawing?.refWidth || 0, strokes: filtered });
    }
  };

  const handleStart = e => {
    if (!editable) return;
    if (e.touches && e.touches.length >= 2) {
      handleTwoFingerStart(e);
      return;
    }
    if (scrollMode.current) return;
    e.preventDefault();
    if (tool === 'text') {
      const p = toContent(e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
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
      eraseAt(toContent(e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY));
      return;
    }
    const p = toContent(e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
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
    if (e.touches && e.touches.length >= 2) {
      handleTwoFingerMove(e);
      return;
    }
    if (scrollMode.current) return;
    e.preventDefault();
    const p = toContent(e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
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

  const handleEnd = e => {
    if (!editable) return;
    if (e.touches && e.touches.length >= 2) return;
    if (e.touches && e.touches.length === 1) return; // finger still down after scroll
    scrollMode.current = null;
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
        position: 'fixed',
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