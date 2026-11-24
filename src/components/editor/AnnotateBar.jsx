/**
 * AnnotateBar — adaptive bottom drawing toolbar with separate curated Studio Ink
 * & Pastel Highlighter palettes, opacity presets, saved custom colors, sizes, Undo/Redo/Clear.
 */
import { useState } from 'react';
import {
  Pen,
  Highlighter,
  Eraser,
  ArrowUpRight,
  Minus,
  Type,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';
import {
  PEN_PALETTE,
  HIGHLIGHTER_PALETTE,
  OPACITY_PRESETS,
  PEN_OPACITY_PRESETS,
  SIZES,
  SIZE_LABEL,
  getRecentAnnotateColors,
  saveRecentAnnotateColor,
} from '../StrokeLayer';

const TOOL_ITEMS = [
  ['pen', Pen, 'Pen'],
  ['highlighter', Highlighter, 'Highlighter'],
  ['eraser', Eraser, 'Eraser'],
  ['arrow', ArrowUpRight, 'Arrow'],
  ['line', Minus, 'Line'],
  ['text', Type, 'Text label'],
];

export default function AnnotateBar({
  tool,
  onTool,
  size,
  onSize,
  color,
  onColor,
  opacity,
  onOpacity,
  canUndo,
  canRedo,
  hasStrokes,
  onUndo,
  onRedo,
  onClear,
  onDone,
}) {
  const [recentColors, setRecentColors] = useState(() => getRecentAnnotateColors());

  const isHighlighter = tool === 'highlighter';
  const isEraser = tool === 'eraser';
  const swatches = isHighlighter ? HIGHLIGHTER_PALETTE : PEN_PALETTE;
  const opacityOptions = isHighlighter ? OPACITY_PRESETS : PEN_OPACITY_PRESETS;
  const activeAlpha = typeof opacity === 'number' ? opacity : isHighlighter ? 0.4 : 1;

  const pickColor = hex => {
    onColor(hex);
    if (!swatches.some(s => s.toLowerCase() === String(hex).toLowerCase())) {
      setRecentColors(saveRecentAnnotateColor(hex));
    }
  };

  return (
    <div className="annotate-bar" role="toolbar" aria-label="Annotation tools">
      <div className="tool-group">
        {TOOL_ITEMS.map(([id, IconComp, label]) => (
          <button
            key={id}
            type="button"
            className={`tool-btn${tool === id ? ' active' : ''}`}
            onClick={() => onTool(id)}
            aria-label={label}
            title={label}
          >
            <IconComp size={17} />
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button
          type="button"
          className="tool-btn"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo stroke"
          title="Undo stroke"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo stroke"
          title="Redo stroke"
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onClear}
          disabled={!hasStrokes}
          aria-label="Clear all drawings"
          title="Clear all drawings"
          style={{ color: hasStrokes ? 'var(--bad)' : undefined }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="tool-group">
        {SIZES.map(s => (
          <button
            key={s}
            type="button"
            className={`size-btn${size === s ? ' active' : ''}`}
            onClick={() => onSize(s)}
            aria-label={`Size ${SIZE_LABEL[s]}`}
          >
            {SIZE_LABEL[s]}
          </button>
        ))}
      </div>

      {!isEraser && onOpacity && (
        <div className="tool-group" aria-label="Stroke opacity">
          {opacityOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`size-btn annotate-alpha-btn${Math.abs(activeAlpha - opt.value) < 0.04 ? ' active' : ''}`}
              onClick={() => onOpacity(opt.value)}
              title={`Opacity ${opt.label}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {!isEraser && (
        <div className="tool-group">
          <span
            className="annotate-active-pill"
            title={isHighlighter ? 'Highlighter color' : 'Ink color'}
          >
            <span
              className="annotate-active-dot"
              style={{ background: color, opacity: isHighlighter ? Math.max(0.45, activeAlpha) : activeAlpha }}
            />
            <span className="annotate-mode-tag">{isHighlighter ? 'HL' : 'Ink'}</span>
          </span>
          {swatches.map(c => (
            <button
              key={c}
              type="button"
              className={`color-swatch${color.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => pickColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
          {recentColors
            .filter(rc => !swatches.some(s => s.toLowerCase() === rc.toLowerCase()))
            .map(rc => (
              <button
                key={`recent-${rc}`}
                type="button"
                className={`color-swatch${color.toLowerCase() === rc.toLowerCase() ? ' active' : ''}`}
                style={{ background: rc }}
                onClick={() => pickColor(rc)}
                title="Recent custom color"
                aria-label={`Recent color ${rc}`}
              />
            ))}
          <input
            type="color"
            value={color}
            onChange={e => pickColor(e.target.value)}
            title="Pick custom hex color"
            aria-label="Custom color"
            className="color-input"
          />
        </div>
      )}

      <span className="annotate-hint">2 fingers = scroll</span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginLeft: 'auto' }}
        onClick={onDone}
      >
        Done
      </button>
    </div>
  );
}
