/**
 * FileAttachmentStrip — Modern tappable cards for attached PDF, PPTX, DOCX, MD & TXT documents.
 */
import { Eye, X } from 'lucide-react';
import { detectDocKind, formatFileSize } from '../lib/docViewerParser';

const KIND_CLASS = {
  pdf: 'doc-kind-pdf',
  pptx: 'doc-kind-pptx',
  docx: 'doc-kind-docx',
  md: 'doc-kind-text',
  txt: 'doc-kind-text',
};

export default function FileAttachmentStrip({ files = [], onOpenFile, onRemoveFile = null }) {
  if (!Array.isArray(files) || files.length === 0) return null;

  return (
    <div className="doc-attach-list" role="list" aria-label="Attached documents">
      {files.map(fileMeta => {
        const kind = fileMeta.kind || detectDocKind(fileMeta.name, fileMeta.mime);
        const sizeLabel = formatFileSize(fileMeta.size);
        const pagesLabel = fileMeta.pageCount
          ? `${fileMeta.pageCount} ${kind === 'pptx' ? 'slides' : 'pages'}`
          : '';
        const metaText = [pagesLabel, sizeLabel].filter(Boolean).join(' · ') || 'Tap to view offline';

        return (
          <div key={fileMeta.id} className="doc-attach-card" role="listitem">
            <button
              type="button"
              className="doc-attach-open"
              onClick={() => onOpenFile?.(fileMeta)}
            >
              <span className={`doc-kind-pill ${KIND_CLASS[kind] || 'doc-kind-text'}`}>
                {(kind || 'file').toUpperCase()}
              </span>
              <span className="doc-attach-info">
                <span className="doc-attach-name">{fileMeta.name || 'Document'}</span>
                <span className="doc-attach-meta">{metaText}</span>
              </span>
              <span className="doc-attach-cta">
                <Eye size={12} /> View
              </span>
            </button>
            {onRemoveFile && (
              <button
                type="button"
                className="doc-attach-rm"
                aria-label={`Remove ${fileMeta.name || 'document'}`}
                onClick={() => onRemoveFile(fileMeta.id)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
