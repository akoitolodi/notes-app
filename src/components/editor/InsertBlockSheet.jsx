/**
 * InsertBlockSheet — Lightweight 1-tap mid-note block inserter opened from "+ Block"
 * in the editor toolbar so Blank Note users can drop in a checklist, 2-col table,
 * runnable code block, math scratchpad, callout, or flashcard Q&A pair anytime.
 */
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  Table2,
  Code2,
  Sigma,
  Zap,
  Layers,
  BookOpen,
  X,
} from 'lucide-react';
import { INSERT_BLOCKS, getInsertBlockSnippet } from '../../lib/templates';

const BLOCK_ICONS = {
  check: CheckSquare,
  table: Table2,
  code: Code2,
  sigma: Sigma,
  zap: Zap,
  layers: Layers,
  book: BookOpen,
};

export default function InsertBlockSheet({ onInsert, onClose }) {
  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet template-sheet-v2"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Insert Block"
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
          <div>
            <div className="export-title" style={{ marginBottom: 0, textAlign: 'left' }}>
              Insert Block
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Drop a clean building block right into your note
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="insert-block-grid">
          {INSERT_BLOCKS.map(block => {
            const Icon = BLOCK_ICONS[block.icon] || Code2;
            return (
              <button
                key={block.id}
                type="button"
                className="insert-block-card"
                onClick={() => {
                  const snippet = getInsertBlockSnippet(block.id);
                  onInsert?.(snippet, block.name);
                  onClose?.();
                }}
              >
                <span className="insert-block-icon">
                  <Icon size={17} />
                </span>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div className="tpl-card-name">{block.name}</div>
                  <div className="tpl-card-desc">{block.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
