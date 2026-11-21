/**
 * DrawingCanvas — touch drawing overlay with pen, highlighter, eraser tools.
 * Strokes stored as [{ tool, color, width, points: [{x, y}] }] and persisted
 * to the note's drawings[] field on change.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const TOOLS = {
  pen: { color: '#000000', width: 2, opacity: 1 },
  highlighter: { color: '#ffcc00', width: 14, opacity: 0.4 },
  eraser: { color: '#ffffff', width: 20, opacity: 1 },
};

const TOOL_COLORS = {
  pen: ['#000000', '#ff375f', '#0a84ff', '#34c759'],
  highlighter: ['#ffcc00', '#ff9f0a', '#34c759', '#0a84ff'],
};

export default function DrawingCanvas({
  strokes = [],
  onChange,
  readOnly = false,
  height = 400,
  bgColor = 'transparent',
}) {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(TOOLS.pen.color);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef(null);
  const currentStroke = useRef(null);

  // Redraw all strokes whenever strokes array or tool changes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw all strokes
    strokes.forEach(stroke => {
      const t = TOOLS[stroke.tool] || TOOLS.pen;
      ctx.strokeStyle = stroke.color || t.color;
      ctx.lineWidth = stroke.width || t.width;
      ctx.globalAlpha = stroke.tool === 'highlighter' ? t.opacity : 1;
      ctx.lineCap = stroke.tool === 'highlighter' ? 'square' : 'round';
      ctx.lineJoin = 'round';

      const pts = stroke.points || [];
      if (pts.length === 0) return;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, (stroke.width || t.width) / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }, [strokes, bgColor]);

  useEffect(() => { redraw(); }, [redraw]);

  // Set canvas physical size to match CSS size (crisp on high-DPI)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      canvas.getContext('2d').scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw]);

  const getPoint = e => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    };
  };

  const handleStart = e => {
    if (readOnly) return;
    e.preventDefault();
    const p = getPoint(e);
    setIsDrawing(true);

    if (tool === 'eraser') {
      // Eraser: remove strokes that intersect the eraser point
      const eraseRadius = TOOLS.eraser.width / 2;
      const filtered = strokes.filter(stroke =>
        !stroke.points.some(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < eraseRadius)
      );
      if (filtered.length !== strokes.length) onChange?.(filtered);
      return;
    }

    currentStroke.current = {
      tool,
      color,
      width: TOOLS[tool].width,
      points: [p],
    };
  };

  const handleMove = e => {
    if (!isDrawing || readOnly) return;
    e.preventDefault();
    const p = getPoint(e);

    if (tool === 'eraser') {
      const eraseRadius = TOOLS.eraser.width / 2;
      const filtered = strokes.filter(stroke =>
        !stroke.points.some(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < eraseRadius)
      );
      if (filtered.length !== strokes.length) onChange?.(filtered);
      return;
    }

    if (currentStroke.current) {
      currentStroke.current.points.push(p);
      // Live draw the current stroke
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const pts = currentStroke.current.points;
      ctx.strokeStyle = currentStroke.current.color;
      ctx.lineWidth = currentStroke.current.width;
      ctx.globalAlpha = tool === 'highlighter' ? TOOLS.highlighter.opacity : 1;
      ctx.lineCap = tool === 'highlighter' ? 'square' : 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2]?.x ?? p.x, pts[pts.length - 2]?.y ?? p.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  const handleEnd = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.current && currentStroke.current.points.length > 0) {
      onChange?.([...strokes, currentStroke.current]);
    }
    currentStroke.current = null;
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    onChange?.(strokes.slice(0, -1));
  };

  const handleClear = () => {
    onChange?.([]);
  };

  return (
    <div className="drawing-canvas-wrap" style={{ position: 'relative', width: '100%' }}>
      {!readOnly && (
        <div className="drawing-toolbar" style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.keys(TOOLS).map(t => (
            <button
              key={t}
              className={`drawing-tool-btn${tool === t ? ' active' : ''}`}
              onClick={() => { setTool(t); setColor(TOOLS[t].color); }}
              aria-label={t}
            >
              {t === 'pen' ? '✏️' : t === 'highlighter' ? '🖍' : '🧽'}
            </button>
          ))}
          {TOOL_COLORS[tool] && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
              {TOOL_COLORS[tool].map(c => (
                <button
                  key={c}
                  className={`drawing-color-swatch${color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
          )}
          <button className="drawing-tool-btn" onClick={handleUndo} aria-label="Undo" style={{ marginLeft: 'auto' }}>↺</button>
          <button className="drawing-tool-btn" onClick={handleClear} aria-label="Clear">🗑</button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          touchAction: readOnly ? 'auto' : 'none',
          border: '1px solid var(--divider)',
          borderRadius: 10,
          background: bgColor === 'transparent' ? 'var(--bg-elevated)' : bgColor,
          display: 'block',
        }}
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