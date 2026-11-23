/**
 * TemplatePickerSheet — clean bottom-sheet picker to start a note from
 * Blank, Cornell Notes, Lecture Outline, Formula Sheet, Lab Report, or Exam Cheat Sheet.
 */
import { createPortal } from 'react-dom';
import {
  FileText,
  Columns2,
  BookOpen,
  Sigma,
  FlaskConical,
  Zap,
  Heart,
  Compass,
  Bug,
  Code2,
  Database,
  Layers,
  X,
} from 'lucide-react';
import { NOTE_TEMPLATES } from '../lib/templates';
import { isDevToolkitEnabled } from '../lib/aiConfig';

const ICONS = {
  file: FileText,
  columns: Columns2,
  book: BookOpen,
  sigma: Sigma,
  flask: FlaskConical,
  zap: Zap,
  heart: Heart,
  compass: Compass,
  bug: Bug,
  code: Code2,
  database: Database,
  layers: Layers,
};

export default function TemplatePickerSheet({ onPick, onClose, title = 'New Note from Template' }) {
  const showTech = isDevToolkitEnabled();
  const generalTemplates = NOTE_TEMPLATES.filter(t => t.category !== 'tech');
  const techTemplates = showTech ? NOTE_TEMPLATES.filter(t => t.category === 'tech') : [];

  const renderCard = tpl => {
    const Icon = ICONS[tpl.icon] || FileText;
    return (
      <button
        key={tpl.id}
        type="button"
        className="template-card"
        onClick={() => onPick(tpl.id)}
      >
        <span className="template-card-icon">
          <Icon size={18} />
        </span>
        <div className="template-card-body">
          <div className="template-card-name">{tpl.name}</div>
          <div className="template-card-desc">{tpl.description}</div>
        </div>
      </button>
    );
  };

  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet template-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <div className="export-title" style={{ marginBottom: 0, textAlign: 'left' }}>
            {title}
          </div>
          <button
            type="button"
            className="navbar-btn"
            aria-label="Close templates"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="template-grid">
          <div className="settings-label" style={{ marginBottom: 2 }}>General, Study &amp; Reflection</div>
          {generalTemplates.map(renderCard)}

          {techTemplates.length > 0 && (
            <>
              <div className="settings-label" style={{ marginTop: 10, marginBottom: 2 }}>
                Tech &amp; Coding (Optional Add-on)
              </div>
              {techTemplates.map(renderCard)}
            </>
          )}
        </div>

        <button
          type="button"
          className="export-btn cancel"
          style={{ marginTop: 12 }}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
