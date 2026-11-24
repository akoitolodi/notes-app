/**
 * DocumentViewerModal — Modern Offline In-App Document Reader for:
 * - PDF (.pdf): HiDPI virtualized canvas pages + zoom + page scrubber + Clean Text view
 * - PowerPoint (.pptx): Modern 16:9 Slide Deck + speaker notes + embedded images + All Slides scroll
 * - Word (.docx): Clean editorial A4 paper sheet with bold/italic/code runs, tables & images
 * - Markdown & Plain Text (.md, .txt) + legacy extracted course material fallback
 */
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  NotebookPen,
  MessageSquareText,
  Layers,
  AlignLeft,
} from 'lucide-react';
import { resolveFileBlob } from '../store/db';
import {
  detectDocKind,
  formatFileSize,
  extractPptxSlidesRich,
  extractDocxRich,
  searchDocMatches,
} from '../lib/docViewerParser';

const MarkdownContent = lazy(() => import('./ui/MarkdownContent'));

const READER_THEMES = [
  ['paper', 'Paper'],
  ['sepia', 'Sepia'],
  ['night', 'Night'],
];

const KIND_BADGE_CLASS = {
  pdf: 'doc-kind-pdf',
  pptx: 'doc-kind-pptx',
  docx: 'doc-kind-docx',
  md: 'doc-kind-text',
  txt: 'doc-kind-text',
};

function PdfPageCanvas({ pdfDoc, pageNumber, zoom, registerRef, onVisible }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [inView, setInView] = useState(pageNumber <= 2);
  const [renderedKey, setRenderedKey] = useState('');
  const [pageHeight, setPageHeight] = useState(Math.round(520 * zoom));

  useEffect(() => {
    registerRef?.(pageNumber, wrapRef.current);
    return () => registerRef?.(pageNumber, null);
  }, [pageNumber, registerRef]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      entries => {
        for (const ent of entries) {
          if (ent.isIntersecting) {
            setInView(true);
            if (ent.intersectionRatio >= 0.35) onVisible?.(pageNumber);
          }
        }
      },
      { rootMargin: '420px 0px', threshold: [0.05, 0.35] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!inView || !pdfDoc || !wrapRef.current || !canvasRef.current) return undefined;
    const key = `${pageNumber}:${zoom.toFixed(2)}`;
    if (renderedKey === key) return undefined;

    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const containerW = Math.max(260, Math.min(wrapRef.current.clientWidth || 340, 820));
        const unscaled = page.getViewport({ scale: 1 });
        const cssScale = (containerW / unscaled.width) * zoom;
        const cssViewport = page.getViewport({ scale: cssScale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.2);
        const renderViewport = page.getViewport({ scale: cssScale * dpr });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;
        setPageHeight(Math.floor(cssViewport.height));

        const ctx = canvas.getContext('2d');
        renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
        await renderTask.promise;
        if (!cancelled) setRenderedKey(key);
        page.cleanup?.();
      } catch {
        // ignore cancelled render tasks during rapid zoom/scroll
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        // ignore
      }
    };
  }, [inView, pdfDoc, pageNumber, zoom, renderedKey]);

  return (
    <div
      ref={wrapRef}
      className="doc-pdf-page-wrap"
      data-doc-jump={pageNumber}
      style={{ minHeight: pageHeight }}
    >
      <canvas ref={canvasRef} className="doc-pdf-canvas" />
      <span className="doc-pdf-page-num">Page {pageNumber}</span>
    </div>
  );
}

function RichRuns({ runs = [] }) {
  return runs.map((r, idx) => {
    let node = r.text;
    if (r.code) node = <code key={idx} className="doc-docx-code">{node}</code>;
    if (r.underline) node = <u key={idx}>{node}</u>;
    if (r.italic) node = <em key={idx}>{node}</em>;
    if (r.bold) node = <strong key={idx}>{node}</strong>;
    return <span key={idx}>{node}</span>;
  });
}

function detectDefaultReaderTheme() {
  if (typeof document === 'undefined') return 'paper';
  const root = document.documentElement;
  if (root.dataset.theme === 'dark' || root.dataset.oled === 'true') return 'night';
  if (!root.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'night';
  }
  return 'paper';
}

export default function DocumentViewerModal({ doc, onClose, onSaveAsNote = null }) {
  const kind = useMemo(
    () => doc?.kind || detectDocKind(doc?.fileName || doc?.title || '', doc?.mime || ''),
    [doc]
  );

  const [readerTheme, setReaderTheme] = useState(detectDefaultReaderTheme); // paper | sepia | night
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [textMode, setTextMode] = useState(false); // PDF Pages vs Clean Text; PPTX Deck vs All Slides

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCursor, setSearchCursor] = useState(0);

  // PDF state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfTextPages, setPdfTextPages] = useState([]);
  const pageRefs = useRef(new Map());

  // PPTX state
  const [slides, setSlides] = useState([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const slideRefs = useRef(new Map());
  const touchStartX = useRef(null);

  // DOCX state
  const [docxBlocks, setDocxBlocks] = useState([]);
  const [docxScale, setDocxScale] = useState(1);
  const blockRefs = useRef(new Map());

  // Text / fallback Markdown state
  const [plainText, setPlainText] = useState('');
  const [extractedFallback, setExtractedFallback] = useState(doc?.extractedText || '');

  // Track created Object URLs & pdfDoc for strict zero-leak cleanup
  const objectUrlsRef = useRef([]);
  const pdfInstanceRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const cleanupDocResources = useCallback(() => {
    for (const u of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    objectUrlsRef.current = [];
    try {
      pdfInstanceRef.current?.destroy?.();
    } catch {
      // ignore
    }
    pdfInstanceRef.current = null;
  }, []);

  const makeObjectUrl = useCallback((bytes, mime) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      cleanupDocResources();
    };
  }, [cleanupDocResources]);

  // Load document content (Blob from direct file/attachment OR fallback extractedText)
  useEffect(() => {
    let alive = true;
    cleanupDocResources();
    setLoading(true);
    setError('');
    setPdfDoc(null);
    setSlides([]);
    setDocxBlocks([]);
    setPlainText('');
    setExtractedFallback(doc?.extractedText || '');

    (async () => {
      try {
        let blob = doc?.file || doc?.blob || null;
        if (!blob && doc?.attachmentId) {
          blob = await resolveFileBlob({ id: doc.attachmentId, storedInDb: true });
        }

        if (!blob) {
          if (doc?.extractedText) {
            if (!alive) return;
            setPlainText(doc.extractedText);
            setLoading(false);
            return;
          }
          throw new Error('Original file is not stored on this device.');
        }

        if (kind === 'pdf') {
          const buf = await blob.arrayBuffer();
          const pdfjsLib = await import('pdfjs-dist');
          if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
            try {
              const workerMod = await import('pdfjs-dist/build/pdf.worker.min.js?url');
              if (workerMod?.default) pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
            } catch {
              // fallback without worker if restricted
            }
          }
          const loaded = await pdfjsLib.getDocument({
            data: new Uint8Array(buf),
            disableWorker: typeof window === 'undefined' || !pdfjsLib.GlobalWorkerOptions?.workerSrc,
            useSystemFonts: true,
          }).promise;
          if (!alive) {
            loaded.destroy?.();
            return;
          }
          pdfInstanceRef.current = loaded;
          setPdfDoc(loaded);
          setPdfNumPages(loaded.numPages || 1);
          setPdfPage(1);
          setLoading(false);
          return;
        }

        if (kind === 'pptx') {
          const buf = await blob.arrayBuffer();
          const parsed = await extractPptxSlidesRich(buf);
          if (!alive) return;
          const hydrated = parsed.slides.map(s => ({
            ...s,
            imageUrls: (s.images || []).map(img => ({
              name: img.name,
              url: makeObjectUrl(img.bytes, img.mime),
            })),
          }));
          setSlides(hydrated);
          setSlideIdx(0);
          setLoading(false);
          return;
        }

        if (kind === 'docx') {
          const buf = await blob.arrayBuffer();
          const parsed = await extractDocxRich(buf);
          if (!alive) return;
          const hydrated = parsed.blocks.map(b =>
            b.type === 'image'
              ? { ...b, url: makeObjectUrl(b.bytes, b.mime) }
              : b
          );
          setDocxBlocks(hydrated);
          setLoading(false);
          return;
        }

        // md | txt | unknown text
        const txt = await blob.text();
        if (!alive) return;
        setPlainText(txt);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        if (doc?.extractedText) {
          setPlainText(doc.extractedText);
          setLoading(false);
        } else {
          setError(e?.message || 'Unable to open this file.');
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [doc, kind, makeObjectUrl, cleanupDocResources]);

  // Lazily extract PDF text index only when Clean Text or Search is opened
  useEffect(() => {
    if (kind !== 'pdf' || !pdfDoc || (!textMode && !searchOpen) || pdfTextPages.length > 0) return;
    let cancelled = false;
    (async () => {
      const cap = Math.min(pdfNumPages || pdfDoc.numPages || 0, 80);
      const out = [];
      for (let p = 1; p <= cap; p++) {
        if (cancelled) return;
        try {
          const page = await pdfDoc.getPage(p);
          const content = await page.getTextContent();
          const str = (content.items || []).map(it => it.str || '').join(' ').replace(/\s+/g, ' ').trim();
          out.push({ pageNum: p, text: str });
          page.cleanup?.();
        } catch {
          out.push({ pageNum: p, text: '' });
        }
      }
      if (!cancelled) setPdfTextPages(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, pdfDoc, pdfNumPages, textMode, searchOpen, pdfTextPages.length]);

  const registerPageRef = useCallback((pageNumber, el) => {
    if (el) pageRefs.current.set(pageNumber, el);
    else pageRefs.current.delete(pageNumber);
  }, []);

  const jumpToPdfPage = useCallback(
    target => {
      const clamped = Math.max(1, Math.min(pdfNumPages || 1, Number(target) || 1));
      setPdfPage(clamped);
      const el = pageRefs.current.get(clamped);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    },
    [pdfNumPages]
  );

  // Search items across active document type
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    if (kind === 'pdf') {
      return searchDocMatches(
        pdfTextPages.map(p => ({ index: p.pageNum, label: `Page ${p.pageNum}`, text: p.text })),
        searchQuery
      );
    }
    if (kind === 'pptx' && slides.length > 0) {
      return searchDocMatches(
        slides.map((s, idx) => ({
          index: idx,
          label: `Slide ${s.num}`,
          text: `${s.title} ${s.bullets.join(' ')} ${s.notes.join(' ')}`,
        })),
        searchQuery
      );
    }
    if (kind === 'docx' && docxBlocks.length > 0) {
      return searchDocMatches(
        docxBlocks
          .map((b, idx) => {
            let text = '';
            if (b.runs) text = b.runs.map(r => r.text).join('');
            else if (b.items) text = b.items.map(r => r.map(x => x.text).join('')).join(' ');
            else if (b.rows) text = b.rows.map(r => r.join(' ')).join(' ');
            return { index: idx, label: `Section ${idx + 1}`, text };
          })
          .filter(x => x.text),
        searchQuery
      );
    }
    const textLines = (plainText || extractedFallback || '').split('\n');
    return searchDocMatches(
      textLines.map((ln, idx) => ({ index: idx, label: `Line ${idx + 1}`, text: ln })),
      searchQuery
    );
  }, [searchQuery, kind, pdfTextPages, slides, docxBlocks, plainText, extractedFallback]);

  const jumpToMatch = useCallback(
    matchObj => {
      if (!matchObj) return;
      if (kind === 'pdf') {
        jumpToPdfPage(matchObj.index);
      } else if (kind === 'pptx' && slides.length > 0) {
        setSlideIdx(matchObj.index);
        if (textMode) {
          slideRefs.current.get(matchObj.index)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
      } else if (kind === 'docx' && docxBlocks.length > 0) {
        blockRefs.current.get(matchObj.index)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }
    },
    [kind, slides.length, docxBlocks.length, textMode, jumpToPdfPage]
  );

  const cycleSearch = dir => {
    if (searchMatches.length === 0) return;
    const next = (searchCursor + dir + searchMatches.length) % searchMatches.length;
    setSearchCursor(next);
    jumpToMatch(searchMatches[next]);
  };

  useEffect(() => {
    setSearchCursor(0);
  }, [searchQuery]);

  const activeCounter = useMemo(() => {
    if (kind === 'pdf' && pdfNumPages > 0) return `Page ${pdfPage} / ${pdfNumPages}`;
    if (kind === 'pptx' && slides.length > 0) return `Slide ${slideIdx + 1} / ${slides.length}`;
    if (kind === 'docx' && docxBlocks.length > 0) return `${docxBlocks.length} blocks`;
    return formatFileSize(doc?.size || doc?.fileSize) || kind.toUpperCase();
  }, [kind, pdfPage, pdfNumPages, slides.length, slideIdx, docxBlocks.length, doc]);

  const currentSlide = slides[slideIdx] || null;
  const fallbackMarkdown = plainText || extractedFallback;

  const content = (
    <div className="doc-viewer-shell" data-reader-theme={readerTheme} role="dialog" aria-modal="true" aria-label={doc?.title || 'Document Viewer'}>
      {/* Modern Top Chrome Header */}
      <header className="doc-viewer-header">
        <button type="button" className="doc-viewer-close" onClick={onClose} aria-label="Close document viewer">
          <X size={18} />
        </button>

        <div className="doc-viewer-title-wrap">
          <div className="doc-viewer-title-row">
            <span className={`doc-kind-pill ${KIND_BADGE_CLASS[kind] || 'doc-kind-text'}`}>
              {kind.toUpperCase()}
            </span>
            <span className="doc-viewer-title">{doc?.title || doc?.fileName || 'Document'}</span>
          </div>
          <div className="doc-viewer-sub">{activeCounter}</div>
        </div>

        <div className="doc-viewer-actions">
          {(kind === 'pdf' || (kind === 'pptx' && slides.length > 0)) && (
            <button
              type="button"
              className={`doc-viewer-icon-btn${textMode ? ' active' : ''}`}
              onClick={() => setTextMode(v => !v)}
              title={
                kind === 'pdf'
                  ? textMode ? 'Switch to Page Canvas' : 'Clean Text View'
                  : textMode ? 'Single Slide Deck' : 'Scroll All Slides'
              }
              aria-label="Toggle reader layout"
            >
              {kind === 'pptx' ? <Layers size={16} /> : <AlignLeft size={16} />}
            </button>
          )}
          <button
            type="button"
            className={`doc-viewer-icon-btn${searchOpen ? ' active' : ''}`}
            onClick={() => setSearchOpen(v => !v)}
            title="Search inside document"
            aria-label="Search inside document"
          >
            <Search size={16} />
          </button>
          <div className="doc-reader-theme-pills" role="group" aria-label="Reader background theme">
            {READER_THEMES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`doc-theme-dot doc-dot-${id}${readerTheme === id ? ' active' : ''}`}
                title={`${label} reader theme`}
                aria-label={`${label} reader theme`}
                onClick={() => setReaderTheme(id)}
              />
            ))}
          </div>
          {onSaveAsNote && (
            <button
              type="button"
              className="btn btn-primary btn-sm doc-viewer-save-btn"
              onClick={() => onSaveAsNote(doc, fallbackMarkdown)}
              title="Save as study note"
            >
              <NotebookPen size={14} /> Save Note
            </button>
          )}
        </div>
      </header>

      {/* Expandable Search Strip */}
      {searchOpen && (
        <div className="doc-viewer-searchbar">
          <Search size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <input
            type="search"
            className="doc-viewer-search-input"
            placeholder="Find text inside document…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery.trim() && (
            <span className="doc-viewer-match-count">
              {searchMatches.length === 0 ? '0 hits' : `${searchCursor + 1}/${searchMatches.length}`}
            </span>
          )}
          <button type="button" className="doc-viewer-icon-btn" onClick={() => cycleSearch(-1)} disabled={searchMatches.length === 0} aria-label="Previous match">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="doc-viewer-icon-btn" onClick={() => cycleSearch(1)} disabled={searchMatches.length === 0} aria-label="Next match">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Main Scrollable Reader Stage */}
      <div ref={bodyScrollRef} className="doc-viewer-stage">
        {loading && (
          <div className="doc-viewer-empty">
            <span className="spinner" /> Opening {kind.toUpperCase()} document…
          </div>
        )}

        {!loading && error && (
          <div className="doc-viewer-empty">
            <FileText size={32} style={{ opacity: 0.5 }} />
            <div style={{ fontWeight: 700, fontSize: 15 }}>Could Not Open Document</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 320, textAlign: 'center' }}>{error}</div>
          </div>
        )}

        {/* PDF Canvas View */}
        {!loading && !error && kind === 'pdf' && pdfDoc && !textMode && (
          <div className="doc-pdf-stack">
            {Array.from({ length: pdfNumPages }, (_, idx) => (
              <PdfPageCanvas
                key={idx + 1}
                pdfDoc={pdfDoc}
                pageNumber={idx + 1}
                zoom={pdfZoom}
                registerRef={registerPageRef}
                onVisible={setPdfPage}
              />
            ))}
          </div>
        )}

        {/* PDF Clean Text View */}
        {!loading && !error && kind === 'pdf' && textMode && (
          <div className="doc-paper-sheet">
            {pdfTextPages.length === 0 ? (
              <div className="doc-viewer-empty">
                <span className="spinner" /> Extracting clean text…
              </div>
            ) : (
              pdfTextPages.map(p => (
                <section key={p.pageNum} className="doc-clean-page-block">
                  <div className="doc-clean-page-label">Page {p.pageNum}</div>
                  <p className="doc-clean-page-body">{p.text || '(No selectable text on this page)'}</p>
                </section>
              ))
            )}
          </div>
        )}

        {/* PPTX Deck View (Single Interactive 16:9 Slide) */}
        {!loading && !error && kind === 'pptx' && currentSlide && !textMode && (
          <div
            className="doc-pptx-stage"
            onTouchStart={e => {
              touchStartX.current = e.touches?.[0]?.clientX ?? null;
            }}
            onTouchEnd={e => {
              const endX = e.changedTouches?.[0]?.clientX ?? null;
              if (touchStartX.current !== null && endX !== null) {
                const dx = endX - touchStartX.current;
                if (dx < -48 && slideIdx < slides.length - 1) setSlideIdx(i => i + 1);
                if (dx > 48 && slideIdx > 0) setSlideIdx(i => i - 1);
              }
              touchStartX.current = null;
            }}
          >
            <article className="doc-slide-card">
              <div className="doc-slide-meta">
                <span>SLIDE {currentSlide.num}</span>
                <span>{slides.length} TOTAL</span>
              </div>
              <h2 className="doc-slide-title">{currentSlide.title}</h2>
              {currentSlide.imageUrls?.length > 0 && (
                <div className="doc-slide-media-grid">
                  {currentSlide.imageUrls.map((im, i) => (
                    <img key={i} src={im.url} alt={im.name} className="doc-slide-img" />
                  ))}
                </div>
              )}
              {currentSlide.bullets.length > 0 && (
                <ul className="doc-slide-bullets">
                  {currentSlide.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </article>

            {currentSlide.notes.length > 0 && (
              <div className="doc-slide-notes-card">
                <button
                  type="button"
                  className="doc-slide-notes-toggle"
                  onClick={() => setNotesOpen(v => !v)}
                >
                  <MessageSquareText size={14} /> Speaker Notes ({currentSlide.notes.length})
                </button>
                {notesOpen && (
                  <div className="doc-slide-notes-body">
                    {currentSlide.notes.map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PPTX All-Slides Vertical Stack */}
        {!loading && !error && kind === 'pptx' && slides.length > 0 && textMode && (
          <div className="doc-pptx-all">
            {slides.map((s, idx) => (
              <article
                key={s.num}
                ref={el => {
                  if (el) slideRefs.current.set(idx, el);
                  else slideRefs.current.delete(idx);
                }}
                className="doc-slide-card doc-slide-card-compact"
              >
                <div className="doc-slide-meta">
                  <span>SLIDE {s.num}</span>
                </div>
                <h2 className="doc-slide-title">{s.title}</h2>
                {s.imageUrls?.length > 0 && (
                  <div className="doc-slide-media-grid">
                    {s.imageUrls.map((im, i) => (
                      <img key={i} src={im.url} alt={im.name} className="doc-slide-img" />
                    ))}
                  </div>
                )}
                {s.bullets.length > 0 && (
                  <ul className="doc-slide-bullets">
                    {s.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                {s.notes.length > 0 && (
                  <div className="doc-slide-notes-inline">
                    <strong>Notes:</strong> {s.notes.join(' ')}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {/* DOCX Modern A4 Paper Reader */}
        {!loading && !error && kind === 'docx' && docxBlocks.length > 0 && (
          <div className="doc-paper-sheet" style={{ fontSize: `${Math.round(15 * docxScale)}px` }}>
            {docxBlocks.map((b, idx) => {
              const setRef = el => {
                if (el) blockRefs.current.set(idx, el);
                else blockRefs.current.delete(idx);
              };
              if (b.type === 'heading') {
                const Tag = `h${Math.min(4, Math.max(1, b.level || 2))}`;
                return (
                  <Tag key={idx} ref={setRef} className={`doc-docx-h doc-docx-h${b.level || 2}`}>
                    <RichRuns runs={b.runs} />
                  </Tag>
                );
              }
              if (b.type === 'list') {
                const ListTag = b.ordered ? 'ol' : 'ul';
                return (
                  <ListTag key={idx} ref={setRef} className="doc-docx-list">
                    {b.items.map((runs, li) => (
                      <li key={li}>
                        <RichRuns runs={runs} />
                      </li>
                    ))}
                  </ListTag>
                );
              }
              if (b.type === 'table') {
                return (
                  <div key={idx} ref={setRef} className="doc-docx-table-wrap">
                    <table className="doc-docx-table">
                      <thead>
                        <tr>
                          {b.rows[0].map((c, ci) => (
                            <th key={ci}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.slice(1).map((row, ri) => (
                          <tr key={ri}>
                            {b.rows[0].map((_, ci) => (
                              <td key={ci}>{row[ci] || ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (b.type === 'image') {
                return (
                  <figure key={idx} ref={setRef} className="doc-docx-figure">
                    <img src={b.url} alt={b.name} className="doc-docx-img" />
                  </figure>
                );
              }
              return (
                <p key={idx} ref={setRef} className="doc-docx-p">
                  <RichRuns runs={b.runs} />
                </p>
              );
            })}
          </div>
        )}

        {/* Markdown / Text / Legacy Course Material Fallback */}
        {!loading &&
          !error &&
          !(kind === 'pdf' && (pdfDoc || textMode)) &&
          !(kind === 'pptx' && slides.length > 0) &&
          !(kind === 'docx' && docxBlocks.length > 0) && (
            <div className="doc-paper-sheet">
              {kind === 'txt' && !extractedFallback ? (
                <pre className="doc-plain-pre">{fallbackMarkdown}</pre>
              ) : (
                <Suspense fallback={<div className="scan-indicator"><span className="spinner" /> Formatting…</div>}>
                  <MarkdownContent text={fallbackMarkdown || '*(Empty document)*'} />
                </Suspense>
              )}
            </div>
          )}
      </div>

      {/* Floating Bottom Controls */}
      {!loading && !error && kind === 'pdf' && pdfDoc && !textMode && (
        <div className="doc-viewer-bottom-bar">
          <div className="doc-ctrl-group">
            <button
              type="button"
              className="doc-viewer-icon-btn"
              onClick={() => setPdfZoom(z => Math.max(0.65, Number((z - 0.15).toFixed(2))))}
              aria-label="Zoom out"
            >
              <ZoomOut size={15} />
            </button>
            <span className="doc-ctrl-val">{Math.round(pdfZoom * 100)}%</span>
            <button
              type="button"
              className="doc-viewer-icon-btn"
              onClick={() => setPdfZoom(z => Math.min(2.4, Number((z + 0.15).toFixed(2))))}
              aria-label="Zoom in"
            >
              <ZoomIn size={15} />
            </button>
          </div>

          <div className="doc-ctrl-group" style={{ flex: 1, maxWidth: 260 }}>
            <button type="button" className="doc-viewer-icon-btn" onClick={() => jumpToPdfPage(pdfPage - 1)} disabled={pdfPage <= 1} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <input
              type="range"
              min={1}
              max={Math.max(1, pdfNumPages)}
              value={pdfPage}
              onChange={e => jumpToPdfPage(e.target.value)}
              className="doc-page-scrubber"
              aria-label="Jump to page"
            />
            <button type="button" className="doc-viewer-icon-btn" onClick={() => jumpToPdfPage(pdfPage + 1)} disabled={pdfPage >= pdfNumPages} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {!loading && !error && kind === 'pptx' && slides.length > 0 && !textMode && (
        <div className="doc-viewer-bottom-bar">
          <button type="button" className="doc-viewer-icon-btn" onClick={() => setSlideIdx(i => Math.max(0, i - 1))} disabled={slideIdx <= 0} aria-label="Previous slide">
            <ChevronLeft size={17} />
          </button>
          <div className="doc-slide-strip">
            {slides.map((s, idx) => (
              <button
                key={s.num}
                type="button"
                className={`doc-slide-pill${idx === slideIdx ? ' active' : ''}`}
                onClick={() => setSlideIdx(idx)}
              >
                {s.num}
              </button>
            ))}
          </div>
          <button type="button" className="doc-viewer-icon-btn" onClick={() => setSlideIdx(i => Math.min(slides.length - 1, i + 1))} disabled={slideIdx >= slides.length - 1} aria-label="Next slide">
            <ChevronRight size={17} />
          </button>
        </div>
      )}

      {!loading && !error && kind === 'docx' && docxBlocks.length > 0 && (
        <div className="doc-viewer-bottom-bar" style={{ justifyContent: 'center' }}>
          <div className="doc-ctrl-group">
            <button
              type="button"
              className="doc-viewer-icon-btn"
              onClick={() => setDocxScale(s => Math.max(0.85, Number((s - 0.1).toFixed(2))))}
              aria-label="Decrease document font size"
            >
              A-
            </button>
            <span className="doc-ctrl-val">{Math.round(docxScale * 100)}%</span>
            <button
              type="button"
              className="doc-viewer-icon-btn"
              onClick={() => setDocxScale(s => Math.min(1.5, Number((s + 0.1).toFixed(2))))}
              aria-label="Increase document font size"
            >
              A+
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
