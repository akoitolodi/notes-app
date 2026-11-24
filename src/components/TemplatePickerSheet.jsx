/**
 * TemplatePickerSheet (v2.0.0) — Phone-friendly Visual 2-Column Template Gallery
 * with category pills (Quick, School, Coding, Personal, Mine), live miniature
 * layout previews, and personal saved templates.
 */
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Columns2,
  BookOpen,
  FlaskConical,
  Zap,
  Heart,
  Bug,
  Code2,
  Database,
  Layers,
  KeyRound,
  CheckSquare,
  ClipboardList,
  Users,
  Scale,
  Trash2,
  X,
} from 'lucide-react';
import { NOTE_TEMPLATES, TEMPLATE_CATEGORIES } from '../lib/templates';
import { listCustomTemplates, deleteCustomTemplate } from '../store/db';

const ICONS = {
  file: FileText,
  columns: Columns2,
  book: BookOpen,
  flask: FlaskConical,
  zap: Zap,
  heart: Heart,
  key: KeyRound,
  bug: Bug,
  code: Code2,
  database: Database,
  layers: Layers,
  check: CheckSquare,
  clipboard: ClipboardList,
  users: Users,
  scale: Scale,
};

function buildCustomPreviewLines(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return lines.length > 0 ? lines.map(l => l.slice(0, 26)) : ['Personal saved layout'];
}

export default function TemplatePickerSheet({ onPick, onClose, title = 'Start a Note' }) {
  const [category, setCategory] = useState('quick');
  const [customTemplates, setCustomTemplates] = useState([]);

  const loadCustom = useCallback(async () => {
    setCustomTemplates(await listCustomTemplates());
  }, []);

  useEffect(() => {
    loadCustom();
  }, [loadCustom]);

  const visibleBuiltIns = NOTE_TEMPLATES.filter(t => t.category === category);

  const handleDeleteCustom = async (e, tpl) => {
    e.stopPropagation();
    await deleteCustomTemplate(tpl.id);
    loadCustom();
  };

  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet template-sheet-v2"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
          <div>
            <div className="export-title" style={{ marginBottom: 0, textAlign: 'left' }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Clean, zero-filler starters — or use + Block inside any blank note
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close templates"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Category Pills */}
        <div className="tpl-cat-tabs" role="tablist">
          {TEMPLATE_CATEGORIES.map(c => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={`mode-pick-chip${category === c.id ? ' active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
              {c.id === 'custom' && customTemplates.length > 0 ? ` (${customTemplates.length})` : ''}
            </button>
          ))}
        </div>

        {/* Visual 2-Column Gallery */}
        {category === 'custom' ? (
          customTemplates.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 12px' }}>
              <div className="empty-title" style={{ fontSize: 14.5 }}>
                No personal templates yet
              </div>
              <div className="empty-text" style={{ fontSize: 12.5 }}>
                Open any note you like → tap <strong>•••</strong> → <strong>Save as Template</strong> to reuse your own layout here!
              </div>
            </div>
          ) : (
            <div className="tpl-visual-grid">
              {customTemplates.map(tpl => (
                <div
                  key={tpl.id}
                  role="button"
                  tabIndex={0}
                  className="tpl-visual-card"
                  onClick={() => onPick({ title: tpl.title, body: tpl.body, isCustom: true, name: tpl.name })}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPick({ title: tpl.title, body: tpl.body, isCustom: true, name: tpl.name });
                    }
                  }}
                >
                  <div className="tpl-mini-page">
                    <div className="tpl-mini-accent" style={{ background: '#0a84ff' }} />
                    {buildCustomPreviewLines(tpl.body).map((line, idx) => (
                      <div key={idx} className="tpl-mini-line">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="tpl-card-footer">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="tpl-card-name">{tpl.name}</div>
                      <div className="tpl-card-desc">{tpl.description || 'Saved layout'}</div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete ${tpl.name}`}
                      style={{ color: 'var(--danger)' }}
                      onClick={e => handleDeleteCustom(e, tpl)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="tpl-visual-grid">
            {visibleBuiltIns.map(tpl => {
              const Icon = ICONS[tpl.icon] || FileText;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className="tpl-visual-card"
                  onClick={() => onPick(tpl.id)}
                >
                  <div className="tpl-mini-page">
                    <div
                      className="tpl-mini-accent"
                      style={{ background: tpl.accent || 'var(--accent)' }}
                    />
                    {(tpl.previewLines || []).map((line, idx) => (
                      <div
                        key={idx}
                        className={`tpl-mini-line${line.startsWith('#') ? ' is-head' : ''}`}
                      >
                        {line.replace(/^#\s*/, '')}
                      </div>
                    ))}
                  </div>
                  <div className="tpl-card-footer">
                    <span
                      className="tpl-card-icon-badge"
                      style={{ color: tpl.accent || 'var(--accent)' }}
                    >
                      <Icon size={15} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                      <div className="tpl-card-name">{tpl.name}</div>
                      <div className="tpl-card-desc">{tpl.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
