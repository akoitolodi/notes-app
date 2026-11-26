/**
 * CleanRichEditor — Apple-Notes-style visual editor with ZERO raw Markdown symbols
 * (no ##, **, - [ ], ```, or |---| clutter when opening templates or typing!).
 *
 * Syncs cleanly to canonical Markdown via richEditorCodec.js without ever
 * resetting cursor position during typing.
 */
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { markdownToCleanHtml, cleanHtmlToMarkdown, escapeHtml } from '../../lib/richEditorCodec';
import { useDialog } from '../ui/DialogProvider';

const CleanRichEditor = forwardRef(function CleanRichEditor(
  { value = '', onChange, placeholder = 'Start writing…', onWikiDetect = null },
  ref
) {
  const { prompt } = useDialog();
  const elRef = useRef(null);
  const lastMdRef = useRef(null);

  // Hydrate visual DOM ONLY when `value` changes externally (template, undo/redo, AI polish, mic)
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (lastMdRef.current === value) return;
    el.innerHTML = markdownToCleanHtml(value);
    lastMdRef.current = value;
  }, [value]);

  const emitChange = () => {
    const el = elRef.current;
    if (!el) return;
    const md = cleanHtmlToMarkdown(el);
    lastMdRef.current = md;
    onChange?.(md);
  };

  const detectWikiInSelection = () => {
    if (!onWikiDetect) return;
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) {
      onWikiDetect(null);
      return;
    }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) {
      onWikiDetect(null);
      return;
    }
    const before = (node.nodeValue || '').slice(0, sel.anchorOffset);
    const m = /\[\[([^[\]\n]*)$/.exec(before);
    if (!m) {
      onWikiDetect(null);
      return;
    }
    onWikiDetect({ query: m[1].toLowerCase(), isCleanMode: true });
  };

  const focusEnd = () => {
    const el = elRef.current;
    if (!el) return;
    el.focus();
  };

  const insertHtmlAtCursor = html => {
    focusEnd();
    try {
      document.execCommand('insertHTML', false, html);
    } catch {
      if (elRef.current) elRef.current.insertAdjacentHTML('beforeend', html);
    }
    emitChange();
  };

  useImperativeHandle(ref, () => ({
    focus: focusEnd,

    toggleBold() {
      focusEnd();
      document.execCommand('bold', false);
      emitChange();
    },

    insertHeading() {
      focusEnd();
      const sel = window.getSelection?.();
      const anchorEl =
        sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      const inH2 = anchorEl?.closest?.('h2');
      document.execCommand('formatBlock', false, inH2 ? 'p' : 'h2');
      emitChange();
    },

    insertBullet() {
      focusEnd();
      document.execCommand('insertUnorderedList', false);
      emitChange();
    },

    insertChecklist() {
      insertHtmlAtCursor(
        '<div class="ce-check" data-checked="0"><span class="ce-check-box" contenteditable="false"></span><span class="ce-check-text">Task item</span></div><p class="ce-p"><br></p>'
      );
    },

    insertCode() {
      focusEnd();
      const sel = window.getSelection?.();
      const selected = sel ? sel.toString() : '';
      if (selected.includes('\n')) {
        insertHtmlAtCursor(
          `<pre class="ce-pre" data-lang=""><code>${escapeHtml(selected)}</code></pre><p class="ce-p"><br></p>`
        );
      } else {
        insertHtmlAtCursor(`<code class="ce-code">${escapeHtml(selected || 'code')}</code>&nbsp;`);
      }
    },

    async insertMath() {
      const tex = await prompt({
        title: 'Insert Math Equation (LaTeX)',
        placeholder: 'e.g. E = mc^2 or \\frac{a}{b}',
        defaultValue: 'E = mc^2',
        confirmLabel: 'Insert',
      });
      if (!tex) return;
      const rendered = markdownToCleanHtml(`$${tex.trim()}$`).replace(/^<p class="ce-p">|<\/p>$/g, '');
      insertHtmlAtCursor(`${rendered}&nbsp;`);
    },

    insertWikiTitle(targetTitle) {
      const sel = window.getSelection?.();
      if (sel?.rangeCount && sel.anchorNode?.nodeType === 3) {
        const node = sel.anchorNode;
        const before = (node.nodeValue || '').slice(0, sel.anchorOffset);
        const m = /\[\[([^[\]\n]*)$/.exec(before);
        if (m) {
          const range = document.createRange();
          range.setStart(node, sel.anchorOffset - m[0].length);
          range.setEnd(node, sel.anchorOffset);
          sel.removeAllRanges();
          sel.addRange(range);
          insertHtmlAtCursor(
            `<span class="ce-wikilink" data-wiki="${escapeHtml(targetTitle)}">${escapeHtml(targetTitle)}</span>&nbsp;`
          );
          onWikiDetect?.(null);
          return;
        }
      }
      insertHtmlAtCursor(
        `<span class="ce-wikilink" data-wiki="${escapeHtml(targetTitle)}">${escapeHtml(targetTitle)}</span>&nbsp;`
      );
      onWikiDetect?.(null);
    },
  }));

  const handleClick = async e => {
    // 1. Toggle checklist item directly in Clean Edit mode
    const box = e.target?.closest?.('.ce-check-box');
    if (box) {
      e.preventDefault();
      e.stopPropagation();
      const row = box.closest('.ce-check');
      if (row) {
        const next = row.dataset.checked === '1' ? '0' : '1';
        row.dataset.checked = next;
        box.textContent = next === '1' ? '✓' : '';
        emitChange();
      }
      return;
    }

    // 2. Tap any rendered KaTeX math chip to edit its equation cleanly
    const mathEl = e.target?.closest?.('[data-tex]');
    if (mathEl) {
      e.preventDefault();
      e.stopPropagation();
      const currentTex = mathEl.dataset.tex || '';
      const isDisplay = mathEl.dataset.display === '1';
      const updated = await prompt({
        title: 'Edit Equation (LaTeX)',
        defaultValue: currentTex,
        placeholder: 'e.g. F = m \\cdot a',
        confirmLabel: 'Update',
      });
      if (updated === null) return;
      const clean = updated.trim();
      if (!clean) {
        mathEl.remove();
      } else {
        const freshHtml = markdownToCleanHtml(isDisplay ? `$$${clean}$$` : `$${clean}$`);
        const tmp = document.createElement('div');
        tmp.innerHTML = freshHtml;
        const replacement = tmp.querySelector('[data-tex]');
        if (replacement) mathEl.replaceWith(replacement);
      }
      emitChange();
    }
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') {
      const sel = window.getSelection?.();
      const node = sel?.anchorNode;
      const anchorEl = node?.nodeType === 1 ? node : node?.parentElement;

      // Keep newlines intact inside <pre> code blocks on Enter (exit block on Shift+Enter)
      const preEl = anchorEl?.closest?.('pre');
      if (preEl) {
        e.preventDefault();
        if (e.shiftKey) {
          const p = document.createElement('p');
          p.className = 'ce-p';
          p.innerHTML = '<br>';
          preEl.after(p);
          const r = document.createRange();
          r.setStart(p, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } else if (sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const nl = document.createTextNode('\n');
          range.insertNode(nl);
          range.setStartAfter(nl);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        emitChange();
        return;
      }

      // Pressing Enter inside a checklist row cleanly starts a new checklist or exits if empty
      const row = anchorEl?.closest?.('.ce-check');
      if (row) {
        e.preventDefault();
        const textEl = row.querySelector('.ce-check-text');
        const txt = (textEl?.textContent || '').trim();
        if (!txt) {
          const p = document.createElement('p');
          p.className = 'ce-p';
          p.innerHTML = '<br>';
          row.replaceWith(p);
          const range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          const nextRow = document.createElement('div');
          nextRow.className = 'ce-check';
          nextRow.dataset.checked = '0';
          nextRow.innerHTML =
            '<span class="ce-check-box" contenteditable="false"></span><span class="ce-check-text"><br></span>';
          row.after(nextRow);
          const nextText = nextRow.querySelector('.ce-check-text');
          const range = document.createRange();
          range.setStart(nextText, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        emitChange();
      }
    }
  };

  const handlePaste = e => {
    const sel = window.getSelection?.();
    const node = sel?.anchorNode;
    const anchorEl = node?.nodeType === 1 ? node : node?.parentElement;
    if (anchorEl?.closest?.('pre')) {
      const plain = e.clipboardData?.getData?.('text/plain');
      if (typeof plain === 'string') {
        e.preventDefault();
        const normalized = plain.replace(/\r\n?/g, '\n');
        if (sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const txt = document.createTextNode(normalized);
          range.insertNode(txt);
          range.setStartAfter(txt);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          emitChange();
        }
      }
    }
  };

  const isEmpty = !String(value || '').trim();

  return (
    <div
      ref={elRef}
      className={`clean-editor-surface${isEmpty ? ' is-empty' : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Note body"
      data-placeholder={placeholder}
      onInput={() => {
        emitChange();
        detectWikiInSelection();
      }}
      onKeyUp={detectWikiInSelection}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onClick={handleClick}
    />
  );
});

export default CleanRichEditor;
