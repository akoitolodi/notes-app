/**
 * ExamSummaryScreen — folder-level exam study pack:
 * - Detects stale cache when notes in the folder have changed since last build
 * - 4 tabs: Summary (Markdown + KaTeX), Cards (Flip Deck), Quiz (Scored),
 *   and Predicted Exam Questions (wires up predictExamQuestions!)
 * - Exports the entire Study Pack as a PDF
 * - Safe AbortController cleanup on unmount
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  RotateCw,
  FileDown,
  AlertTriangle,
  Sparkles,
  Eye,
  EyeOff,
  FileSpreadsheet,
} from 'lucide-react';
import { getNotesInFolder, db } from '../store/db';
import { examSummary } from '../api/examSummary';
import { predictExamQuestions } from '../lib/aiFeatures';
import { FlashcardDeck, QuizSection } from './study/StudyWidgets';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

function PredictedQuestionCard({ item, index }) {
  const [open, setOpen] = useState(false);
  const diffColor =
    item.difficulty === 'hard'
      ? 'var(--bad)'
      : item.difficulty === 'easy'
        ? 'var(--ok)'
        : 'var(--mistake-ink)';
  const diffBg =
    item.difficulty === 'hard'
      ? 'var(--bad-bg)'
      : item.difficulty === 'easy'
        ? 'var(--ok-bg)'
        : 'var(--mistake-bg)';

  return (
    <div className="explanation-card">
      <div className="flex justify-between items-center gap-8" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          QUESTION {index + 1}
        </span>
        {item.difficulty && (
          <span
            className="tag-pill"
            style={{ background: diffBg, color: diffColor, textTransform: 'capitalize' }}
          >
            {item.difficulty}
          </span>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, marginBottom: 10 }}>
        {item.question}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm w-full"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <EyeOff size={15} /> : <Eye size={15} />}
        {open ? 'Hide model answer' : 'Show model answer'}
      </button>
      {open && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '0.5px solid var(--divider)',
          }}
        >
          <MarkdownContent text={item.answer} />
        </div>
      )}
    </div>
  );
}

export default function ExamSummaryScreen({ folder, onBack, onOpenExamPaper = null }) {
  const { toast } = useDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [predicted, setPredicted] = useState([]);
  const [predictBusy, setPredictBusy] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [tab, setTab] = useState('summary'); // summary | cards | quiz | predicted
  const [exporting, setExporting] = useState(false);

  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const getCappedFolderNotes = useCallback(async () => {
    const notes = await getNotesInFolder(folder.id);
    const usable = notes.filter(n => (n.body || '').trim().length > 0);
    // Keep total prompt bounded (~18k chars) so free-tier providers don't hit 413/429
    const perNoteCap = usable.length > 0 ? Math.max(800, Math.min(2500, Math.floor(18000 / usable.length))) : 2500;
    const capped = usable.map(n => ({
      title: n.title || 'Untitled',
      body: (n.body || '').slice(0, perNoteCap),
      updatedAt: n.updatedAt || 0,
    }));
    const latestEdit = capped.reduce((max, n) => Math.max(max, n.updatedAt), 0);
    return { capped, latestEdit };
  }, [folder.id]);

  const generate = useCallback(
    async (force = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      if (force) setResult(null);
      setFromCache(false);
      setIsStale(false);

      try {
        const { capped, latestEdit } = await getCappedFolderNotes();

        if (!force) {
          const cached = await db.examCache.get(folder.id);
          if (cached?.result && mountedRef.current) {
            setResult(cached.result);
            setPredicted(cached.predicted || []);
            setFromCache(true);
            setIsStale(latestEdit > (cached.at || 0));
            setLoading(false);
            return;
          }
        }

        if (capped.length === 0) {
          throw new Error('This folder has no notes with text content yet.');
        }

        const data = await examSummary(folder.name, capped, { signal: controller.signal });
        if (!mountedRef.current) return;
        setResult(data);
        setPredicted([]);
        setIsStale(false);
        await db.examCache.put({
          folderId: folder.id,
          result: data,
          predicted: [],
          at: Date.now(),
        });
      } catch (err) {
        if (!mountedRef.current || err?.isCancelled) return;
        setError(err.message);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [folder.id, folder.name, getCappedFolderNotes]
  );

  useEffect(() => {
    generate(false);
  }, [generate]);

  const handlePredictExam = async () => {
    if (predictBusy) return;
    setPredictBusy(true);
    try {
      const { capped } = await getCappedFolderNotes();
      if (!capped.length) {
        toast('Add notes to this folder first');
        return;
      }
      const items = await predictExamQuestions({ notes: capped, subject: folder.name, count: 6 });
      if (!mountedRef.current) return;
      setPredicted(items);
      const cached = await db.examCache.get(folder.id);
      if (cached) {
        await db.examCache.put({ ...cached, predicted: items });
      }
    } catch (err) {
      toast(`Exam predictor failed: ${err.message}`, { type: 'error' });
    } finally {
      if (mountedRef.current) setPredictBusy(false);
    }
  };

  const handleExportPDF = async () => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      const { buildExamSummaryPDF, saveNotePDF } = await import('../lib/pdf');
      const doc = await buildExamSummaryPDF({
        folderName: folder.name,
        summary: result.summary,
        flashcards: result.flashcards || [],
        quiz: result.quiz || [],
        predicted,
      });
      const how = await saveNotePDF(doc, `${folder.name}-exam-pack`);
      toast(how === 'shared' ? 'Study pack PDF ready to share' : 'Study pack PDF downloaded', {
        type: 'success',
      });
    } catch (err) {
      toast(`PDF export failed: ${err.message}`, { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const flashcards = result?.flashcards || [];
  const quiz = result?.quiz || [];

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeft size={20} /> Back
        </button>
        <span className="navbar-title">Exam Summary</span>
        <div className="flex items-center gap-6">
          {result && (
            <button
              type="button"
              className="navbar-btn"
              onClick={handleExportPDF}
              disabled={exporting}
              aria-label="Export study pack PDF"
              title="Export study pack PDF"
            >
              <FileDown size={19} />
            </button>
          )}
          <button
            type="button"
            className="navbar-btn"
            onClick={() => generate(true)}
            disabled={loading}
            aria-label="Rebuild study pack"
            title="Rebuild study pack"
          >
            <RotateCw size={18} />
          </button>
        </div>
      </header>

      <div className="large-title">{folder.name}</div>

      {onOpenExamPaper && (
        <div style={{ margin: '0 var(--gutter) 12px' }}>
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => onOpenExamPaper({ sourceFolder: folder })}
          >
            <FileSpreadsheet size={16} /> Build Answerable &amp; Printable Bond-Paper Exam
          </button>
        </div>
      )}

      {isStale && !loading && (
        <div className="banner-stale">
          <span className="flex items-center gap-6">
            <AlertTriangle size={15} /> Notes changed since this pack was built.
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => generate(true)}
          >
            Rebuild
          </button>
        </div>
      )}

      {fromCache && !isStale && !loading && (
        <div className="scan-indicator" style={{ paddingTop: 2, paddingBottom: 4 }}>
          Saved study pack — tap refresh anytime to rebuild.
        </div>
      )}

      {loading && (
        <div className="scan-indicator">
          <span className="spinner" /> Building your exam study pack…
        </div>
      )}

      {error && (
        <div className="inline-mistake" style={{ margin: '8px var(--gutter)' }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="view-switcher">
            {[
              ['summary', 'Summary'],
              ['cards', `Cards (${flashcards.length})`],
              ['quiz', `Quiz (${quiz.length})`],
              ['predicted', `Predict${predicted.length ? ` (${predicted.length})` : ''}`],
            ].map(([t, label]) => (
              <button
                key={t}
                type="button"
                className={`view-switch-btn${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="editor">
            {tab === 'summary' && (
              <div className="explanation-card">
                <MarkdownContent text={result.summary || 'No summary generated.'} />
              </div>
            )}

            {tab === 'cards' && <FlashcardDeck cards={flashcards} />}

            {tab === 'quiz' && <QuizSection quiz={quiz} />}

            {tab === 'predicted' && (
              <div>
                {predictBusy ? (
                  <div className="explanation-card">
                    <div className="scan-indicator" style={{ padding: '8px 0' }}>
                      <span className="spinner" /> Predicting likely exam questions…
                    </div>
                  </div>
                ) : predicted.length === 0 ? (
                  <div className="explanation-card">
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                      Likely Exam Questions
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                      Analyzes all notes in {folder.name} to predict high-probability exam questions with model answers.
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      onClick={handlePredictExam}
                    >
                      <Sparkles size={16} /> Predict exam questions
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
                      <span className="settings-label">
                        Predicted questions ({predicted.length})
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handlePredictExam}
                        disabled={predictBusy}
                      >
                        <RotateCw size={13} /> Regenerate
                      </button>
                    </div>
                    {predicted.map((item, idx) => (
                      <PredictedQuestionCard key={idx} item={item} index={idx} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
