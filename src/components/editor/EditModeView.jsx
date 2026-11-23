/**
 * EditModeView — focused writing view with:
 * - Debounced auto-save status indicator ("Saved" / "Saving…")
 * - Clear separation: "Done" (instant offline save → Read) vs "Explain" (AI scan + Cancel)
 * - Floating mobile formatting & attachment bar (Checklist, Heading, Bold, Bullet,
 *   Code, LaTeX Math $…$, Camera, Gallery, OCR Scan)
 * - Working Undo/Redo with disabled states + Ctrl/Cmd+S shortcut
 */
import { useEffect } from 'react';
import {
  ChevronLeft,
  Undo2,
  Redo2,
  Sparkles,
  Check,
  X,
  CheckSquare,
  Heading2,
  Bold,
  List,
  Code,
  Sigma,
  Camera,
  Image as ImageIcon,
  ScanText,
} from 'lucide-react';
import ImageStrip, { pickImage, compressImage } from '../ImageManager';

export default function EditModeView({
  title,
  onTitleChange,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  textareaRef,
  images,
  onAddImage,
  onRemoveImage,
  onAppendText,
  onOcrScan,
  ocrBusy,
  isScanning,
  onCancelScan,
  scanError,
  saveState, // 'saved' | 'saving' | 'dirty'
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBackToList,
  onSaveOnly,
  onSaveAndExplain,
}) {
  // Auto-grow textarea to content height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(320, el.scrollHeight)}px`;
  }, [body, textareaRef]);

  // Keyboard shortcuts: Ctrl/Cmd+S saves instantly, Ctrl/Cmd+Shift+S runs AI Explain
  useEffect(() => {
    const onKeyDown = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) onSaveAndExplain();
        else onSaveOnly();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSaveOnly, onSaveAndExplain]);

  const insertFormat = (before, after = '', placeholder = '') => {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange((body ? body + '\n' : '') + before + placeholder + after);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || placeholder;
    const next = body.slice(0, start) + before + selected + after + body.slice(end);
    onBodyChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + selected.length;
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const insertLinePrefix = prefix => {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange((body ? body + '\n' : '') + prefix);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    onBodyChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + prefix.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handlePhotoPick = async source => {
    const picked = await pickImage(source);
    if (!picked?.dataUrl) return;
    const finalUrl = picked.alreadyCompressed
      ? picked.dataUrl
      : await compressImage(picked.dataUrl);
    onAddImage(finalUrl);
  };

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="screen screen-paper">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBackToList}
          aria-label="Back to notes list"
        >
          <ChevronLeft size={20} /> Notes
        </button>

        <div className="flex items-center gap-6">
          <button
            type="button"
            className="navbar-btn"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className="navbar-btn"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={18} />
          </button>

          {isScanning ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onCancelScan}
            >
              <X size={15} /> Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onSaveOnly}
                title="Save without running AI (Ctrl+S)"
              >
                Done
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onSaveAndExplain}
                title="Save and explain with AI (Ctrl+Shift+S)"
              >
                <Sparkles size={14} /> Explain
              </button>
            </>
          )}
        </div>
      </header>

      <div className="editor">
        {isScanning && (
          <div className="scan-indicator" style={{ paddingLeft: 0 }}>
            <span className="spinner" /> Explaining your notes with AI…
          </div>
        )}
        {scanError && (
          <div className="inline-mistake" style={{ marginBottom: 10 }}>
            {scanError}
          </div>
        )}

        <div className="editor-meta-bar">
          <span className={`save-status${saveState === 'saved' ? ' saved' : ''}`}>
            {saveState === 'saving' ? (
              <>
                <span className="spinner" style={{ width: 11, height: 11 }} /> Saving…
              </>
            ) : saveState === 'dirty' ? (
              'Unsaved edits'
            ) : (
              <>
                <Check size={13} /> Saved offline
              </>
            )}
          </span>
          <span>
            {words} {words === 1 ? 'word' : 'words'} · {body.length} chars
          </span>
        </div>

        <input
          type="text"
          className="editor-title"
          placeholder="Title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          aria-label="Note title"
        />
        <input
          type="text"
          className="editor-subject"
          placeholder="Subject (e.g. Biology, Calculus)"
          value={subject}
          onChange={e => onSubjectChange(e.target.value)}
          aria-label="Subject"
        />

        <ImageStrip
          images={images}
          onAdd={onAddImage}
          onRemove={onRemoveImage}
          onAppendText={onAppendText}
          noteContext={body}
          subject={subject}
          showAdd={false}
        />

        <textarea
          ref={textareaRef}
          className="editor-body"
          placeholder="Start typing… Supports Markdown (# headings, **bold**), - [ ] checklists, #tags, and $LaTeX$ math."
          value={body}
          onChange={e => onBodyChange(e.target.value)}
          aria-label="Note body"
          autoFocus
        />
      </div>

      {/* Mobile-friendly Formatting & Attachment Bar */}
      <div className="format-toolbar" role="toolbar" aria-label="Formatting and media">
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertLinePrefix('- [ ] ')}
          title="Checklist"
          aria-label="Insert checklist item"
        >
          <CheckSquare size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertLinePrefix('## ')}
          title="Heading"
          aria-label="Insert heading"
        >
          <Heading2 size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertFormat('**', '**', 'bold')}
          title="Bold"
          aria-label="Bold"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertLinePrefix('- ')}
          title="Bullet point"
          aria-label="Insert bullet"
        >
          <List size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertFormat('`', '`', 'code')}
          title="Inline code"
          aria-label="Insert code"
        >
          <Code size={16} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => insertFormat('$', '$', 'E = mc^2')}
          title="LaTeX Math"
          aria-label="Insert math equation"
        >
          <Sigma size={16} />
        </button>

        <span className="fmt-sep" />

        <button
          type="button"
          className="fmt-btn"
          onClick={() => handlePhotoPick('camera')}
          title="Take photo"
          aria-label="Take photo"
        >
          <Camera size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          onClick={() => handlePhotoPick('library')}
          title="Add from gallery"
          aria-label="Add image from gallery"
        >
          <ImageIcon size={17} />
        </button>
        <button
          type="button"
          className="fmt-btn"
          disabled={ocrBusy}
          onClick={onOcrScan}
          title="Scan text from photo (OCR)"
          aria-label="Scan text from photo"
        >
          {ocrBusy ? (
            <span className="spinner" style={{ width: 15, height: 15 }} />
          ) : (
            <ScanText size={17} />
          )}
          <span>OCR</span>
        </button>
      </div>
    </div>
  );
}
