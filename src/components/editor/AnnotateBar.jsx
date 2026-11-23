/**
 * AnnotateBar — fixed bottom drawing toolbar with crisp SVG icons, stroke
 * Undo/Redo/Clear All, sizes, adaptive palette, and Done button.
 */
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
import { PALETTE, SIZES, SIZE_LABEL } from '../StrokeLayer';

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
  canUndo,
  canRedo,
  hasStrokes,
  onUndo,
  onRedo,
  onClear,
  onDone,
}) {
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

      <div className="tool-group">
        {PALETTE.map(c => (
          <button
            key={c}
            type="button"
            className={`color-swatch${color.toLowerCase() === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => onColor(c)}
            aria-label={`Color ${c}`}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={e => onColor(e.target.value)}
          title="Custom color"
          aria-label="Custom color"
          className="color-input"
        />
      </div>

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
