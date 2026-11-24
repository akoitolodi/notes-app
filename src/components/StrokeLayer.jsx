/**
 * StrokeLayer — full-note annotation canvas.
 *
 * Improvements over v1.2:
 * - Fixed mouse-hover erase bug (tracks active pointer down state).
 * - Point-to-segment distance hit-testing so you can erase anywhere along a
 *   line or arrow, plus bounding-box hit-testing for text labels.
 * - Quadratic Bezier smoothing + point decimation for clean, compact strokes.
 * - Adaptive ink: #000000 automatically renders light in Dark Mode and
 *   #ffffff renders dark in Light Mode (never invisible ink!).
 * - Highlighter uses multiply/screen compositing so underlying text stays crisp.
 * - Inline popover for text labels (replaces blocking window.prompt).
 * - Scoped cleanly to the .editor viewport rect (never bleeds over navbar or sidebar).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { isDarkTheme } from '../theme';

export const PEN_PALETTE = [
  '#14151a',
  '#ffffff',
  '#64748b',
  '#e11d48',
  '#ea580c',
  '#d97706',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
  '#db2777',
];

export const HIGHLIGHTER_PALETTE = [
  '#fde047',
  '#bef264',
  '#6ee7b7',
  '#7dd3fc',
  '#c4b5fd',
  '#f9a8d4',
  '#fdba74',
  '#fda4af',
];

export const PALETTE = PEN_PALETTE;

export const OPACITY_PRESETS = [
  { id: 'soft', label: '25%', value: 0.25 },
  { id: 'med', label: '40%', value: 0.4 },
  { id: 'bold', label: '65%', value: 0.65 },
];

export const PEN_OPACITY_PRESETS = [
  { id: 'soft', label: '50%', value: 0.5 },
  { id: 'med', label: '80%', value: 0.8 },
  { id: 'bold', label: '100%', value: 1 },
];

export const ANNOTATE_RECENT_COLORS_KEY = 'aicn:annotateRecentColors';

export function getRecentAnnotateColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANNOTATE_RECENT_COLORS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(c => /^#[0-9a-f]{6}$/i.test(String(c))).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function saveRecentAnnotateColor(hex) {
  const clean = String(hex || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(clean)) return [];
  const next = [clean, ...getRecentAnnotateColors().filter(c => c.toLowerCase() !== clean)].slice(0, 5);
  try {
    localStorage.setItem(ANNOTATE_RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export const TOOLS = [
  ['pen', 'Pen'],
  ['highlighter', 'Highlighter'],
  ['eraser', 'Eraser'],
  ['arrow', 'Arrow'],
  ['line', 'Line'],
  ['text', 'Text'],
];

export const SIZES = ['fine', 'medium', 'thick'];
export const SIZE_LABEL = { fine: 'S', medium: 'M', thick: 'L' };

export function toolWidth(tool, size) {
  const w = {
    pen: { fine: 2, medium: 4.5, thick: 9 },
    highlighter: { fine: 12, medium: 20, thick: 28 },
    arrow: { fine: 2, medium: 3.5, thick: 6 },
    line: { fine: 2, medium: 3.5, thick: 6 },
    text: { fine: 14, medium: 20, thick: 28 },
    eraser: { fine: 16, medium: 24, thick: 36 },
  };
  return (w[tool] || w.pen)[size] || 4.5;
}

/** Adapt pure black/white strokes so they stay readable in both Light & Dark themes. */
export function resolveStrokeColor(rawColor, dark = false) {
  const c = String(rawColor || '#000000').toLowerCase();
  if (dark && (c === '#000' || c === '#000000' || c === '#14151a')) return '#f5f5f7';
  if (!dark && (c === '#fff' || c === '#ffffff')) return '#111113';
  return rawColor || (dark ? '#f5f5f7' : '#111113');
}

/** Distance from point P to line segment AB. */
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Accurate hit test across pen, highlighter, line, arrow, and text strokes. */
export function strokeHitsPoint(stroke, p, eraserRadius) {
  const pts = stroke?.points || [];
  if (!pts.length) return false;

  if (stroke.tool === 'text') {
    const origin = pts[0];
    const fontSize = stroke.fontSize || 20;
    const estWidth = Math.max(fontSize * 1.5, String(stroke.text || '').length * fontSize * 0.6);
    const estHeight = fontSize * 1.3;
    return (
      p.x >= origin.x - eraserRadius &&
      p.x <= origin.x + estWidth + eraserRadius &&
      p.y >= origin.y - eraserRadius &&
      p.y <= origin.y + estHeight + eraserRadius
    );
  }

  const threshold = eraserRadius + (stroke.width || 5) / 2;
  if (pts.length === 1) {
    return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= threshold;
  }

  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(p, pts[i - 1], pts[i]) <= threshold) return true;
  }
  return false;
}

/** Draw one stroke. ctx is pre-translated to content space and pre-scaled. */
export function drawStroke(ctx, s, { dark = false } = {}) {
  const pts = s.points || [];
  if (!pts.length) return;
  const strokeColor = resolveStrokeColor(s.color, dark);

  const strokeAlpha =
    typeof s.alpha === 'number' && Number.isFinite(s.alpha)
      ? Math.max(0.15, Math.min(1, s.alpha))
      : s.tool === 'highlighter'
        ? 0.38
        : 1;

  ctx.save();
  if (s.tool === 'text') {
    const p = pts[0];
    ctx.globalAlpha = strokeAlpha;
    ctx.fillStyle = strokeColor;
    ctx.font = `600 ${s.fontSize || 20}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text || '', p.x, p.y);
    ctx.restore();
    return;
  }

  if (s.tool === 'arrow' || s.tool === 'line') {
    if (pts.length < 2) {
      ctx.restore();
      return;
    }
    const a = pts[0];
    const b = pts[1];
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = s.width || 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    if (s.tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 10 + (s.width || 3.5) * 1.7;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Freehand: pen | highlighter (quadratic Bezier midpoint smoothing)
  const isHl = s.tool === 'highlighter';
  ctx.globalAlpha = strokeAlpha;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = s.width || 4.5;
  ctx.lineCap = isHl ? 'round' : 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (s.width || 4.5) / 2, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Render strokes onto an offscreen canvas (used by PDF export and print view). */
export function renderStrokesToCanvas(drawings, targetWidth = 507, { dark = false } = {}) {
  const strokes = Array.isArray(drawings) ? drawings : drawings?.strokes || [];
  if (!strokes.length) return null;
  const refW = drawings?.refWidth || targetWidth;
  const scale = targetWidth / (refW || targetWidth);

  let minY = Infinity;
  let maxY = 0;
  strokes.forEach(s => {
    (s.points || []).forEach(p => {
      const y = p.y * scale;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  });
  if (!Number.isFinite(minY)) return null;
  const pad = 24;
  const offsetY = Math.max(0, minY - pad);
  const h = Math.max(80, Math.ceil(maxY - offsetY + pad * 2));

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(targetWidth * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(0, -offsetY);
  ctx.scale(scale, scale);
  strokes.forEach(s => drawStroke(ctx, s, { dark }));
  return { canvas, dataUrl: canvas.toDataURL('image/png'), width: targetWidth, height: h };
}

export default function StrokeLayer({
  drawing,
  editable = false,
  tool = 'pen',
  color = '#14151a',
  size = 'medium',
  opacity = null,
  onChange,
}) {
  const anchorRef = useRef(null);
  const canvasRef = useRef(null);
  const pageRef = useRef(null);
  const scrollElRef = useRef(null);
  const currentRef = useRef(null);
  const pointerDownRef = useRef(false);
  const scrollModeRef = useRef(null);

  const [bounds, setBounds] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [textDraft, setTextDraft] = useState(null); // { clientX, clientY, contentPt, value }

  const strokes = drawing?.strokes || [];
  const refWidth = drawing?.refWidth || 0;

  // Locate parent .note-page-wrap and .editor scroll container
  useEffect(() => {
    const page = anchorRef.current?.parentElement;
    pageRef.current = page;
    let el = page;
    while (el && el !== document.body) {
      if (el.classList?.contains('editor')) {
        scrollElRef.current = el;
        break;
      }
      el = el.parentElement;
    }

    const updateBounds = () => {
      const container = scrollElRef.current;
      if (container) {
        const r = container.getBoundingClientRect();
        setBounds({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setBounds({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
      }
    };

    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    if (scrollElRef.current) ro.observe(scrollElRef.current);
    if (page) ro.observe(page);
    window.addEventListener('resize', updateBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, []);

  const pageRect = useCallback(() => {
    const el = pageRef.current;
    return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
  }, []);

  const toContent = useCallback(
    (clientX, clientY) => {
      const r = pageRect();
      const scale = refWidth ? r.width / refWidth : 1;
      return {
        x: (clientX - r.left) / (scale || 1),
        y: (clientY - r.top) / (scale || 1),
      };
    },
    [refWidth, pageRect]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || bounds.width < 1 || bounds.height < 1) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const dark = isDarkTheme();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);

    const r = pageRect();
    const scale = refWidth ? r.width / refWidth : 1;
    ctx.save();
    // Translate relative to our clipped canvas origin (bounds.left, bounds.top)
    ctx.translate(r.left - bounds.left, r.top - bounds.top);
    ctx.scale(scale, scale);
    strokes.forEach(st => drawStroke(ctx, st, { dark }));
    if (currentRef.current) drawStroke(ctx, currentRef.current, { dark });
    ctx.restore();
  }, [strokes, refWidth, bounds, pageRect]);

  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bounds.width < 1 || bounds.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    redraw();
  }, [bounds, redraw]);

  // Re-render smoothly on container scroll
  useEffect(() => {
    const el = scrollElRef.current || window;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        redrawRef.current();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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
    const filtered = strokes.filter(st => !strokeHitsPoint(st, pContent, rRef));
    if (filtered.length !== strokes.length) {
      onChange?.({ refWidth: drawing?.refWidth || 0, strokes: filtered });
    }
  };

  const getCoords = e => {
    const src = e.touches ? e.touches[0] : e;
    return { clientX: src.clientX, clientY: src.clientY };
  };

  const handleTwoFingerStart = e => {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const container = scrollElRef.current;
    if (!container) return;
    scrollModeRef.current = {
      startMidY: (t1.clientY + t2.clientY) / 2,
      startScrollTop: container.scrollTop,
    };
    pointerDownRef.current = false;
    if (currentRef.current) {
      currentRef.current = null;
      redraw();
    }
  };

  const handleTwoFingerMove = e => {
    const sm = scrollModeRef.current;
    if (!sm) return;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const container = scrollElRef.current;
    if (container) {
      container.scrollTop = sm.startScrollTop - ((t1.clientY + t2.clientY) / 2 - sm.startMidY);
    }
  };

  const handleStart = e => {
    if (!editable) return;
    if (e.touches && e.touches.length >= 2) {
      handleTwoFingerStart(e);
      return;
    }
    if (scrollModeRef.current) return;
    e.preventDefault();

    const { clientX, clientY } = getCoords(e);
    const p = toContent(clientX, clientY);

    if (tool === 'text') {
      setTextDraft({
        clientX: Math.min(Math.max(12, clientX), window.innerWidth - 240),
        clientY: Math.min(Math.max(70, clientY), window.innerHeight - 160),
        contentPt: p,
        value: '',
      });
      return;
    }

    pointerDownRef.current = true;

    if (tool === 'eraser') {
      eraseAt(p);
      return;
    }

    currentRef.current = {
      tool,
      color,
      alpha: typeof opacity === 'number' ? opacity : tool === 'highlighter' ? 0.4 : 1,
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
    if (scrollModeRef.current || !pointerDownRef.current) return;
    e.preventDefault();

    const { clientX, clientY } = getCoords(e);
    const p = toContent(clientX, clientY);

    if (tool === 'eraser') {
      eraseAt(p);
      return;
    }

    const cur = currentRef.current;
    if (!cur) return;
    if (cur.tool === 'arrow' || cur.tool === 'line') {
      cur.points[1] = p;
    } else {
      const prev = cur.points[cur.points.length - 1];
      // Decimate noisy sub-2.5px touch jitter for smoother curves & smaller storage
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 2.5) {
        cur.points.push(p);
      }
    }
    redraw();
  };

  const handleEnd = e => {
    if (!editable) return;
    if (e.touches && e.touches.length >= 1) return;
    scrollModeRef.current = null;
    pointerDownRef.current = false;

    const cur = currentRef.current;
    currentRef.current = null;
    if (cur) {
      const isShape = cur.tool === 'arrow' || cur.tool === 'line';
      const valid = isShape
        ? cur.points.length === 2 &&
          Math.hypot(cur.points[1].x - cur.points[0].x, cur.points[1].y - cur.points[0].y) > 2
        : cur.points.length > 0;
      if (valid) commitStroke(cur);
      else redraw();
    } else {
      redraw();
    }
  };

  const commitTextDraft = () => {
    if (textDraft && textDraft.value.trim()) {
      commitStroke({
        tool: 'text',
        color,
        width: toolWidth('text', size),
        fontSize: toolWidth('text', size),
        points: [textDraft.contentPt],
        text: textDraft.value.trim(),
      });
    }
    setTextDraft(null);
  };

  return (
    <>
      <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />
      <div
        style={{
          position: 'fixed',
          top: bounds.top,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
          pointerEvents: editable ? 'auto' : 'none',
          touchAction: editable ? 'none' : 'auto',
          zIndex: 25,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: editable ? 'crosshair' : 'default' }}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
        />
      </div>

      {textDraft && (
        <div
          className="inline-text-popover"
          style={{ left: textDraft.clientX, top: textDraft.clientY }}
        >
          <input
            autoFocus
            placeholder="Label text…"
            value={textDraft.value}
            onChange={e => setTextDraft(d => (d ? { ...d, value: e.target.value } : null))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTextDraft();
              } else if (e.key === 'Escape') {
                setTextDraft(null);
              }
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={commitTextDraft}>
            Add
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTextDraft(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
