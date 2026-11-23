/**
 * BugLogTab — "Bugs I Solved" Stack-Trace Debugger & Personal Debugging Archive.
 *
 * 1. Paste any Python / JS / TS / C++ / Java / Gradle error trace -> instant offline parsing + hint.
 * 2. Optional 1-tap AI Root-Cause Diagnosis.
 * 3. Save resolved bugs + fixes into Dexie `bugLogs` and search them offline forever.
 */
import { useState, useEffect, useCallback } from 'react';
import { Bug, Sparkles, Save, Trash2, Search } from 'lucide-react';
import {
  parseErrorTrace,
  diagnoseBugWithAI,
  saveBugLog,
  getBugLogs,
  deleteBugLog,
} from '../../lib/bugDebugger';
import { logStudyActivity } from '../../store/db';
import MarkdownContent from '../ui/MarkdownContent';
import { useDialog } from '../ui/DialogProvider';

const SAMPLE_TRACE = `Traceback (most recent call last):
  File "main.py", line 24, in compute_avg
    return sum(scores) / len(scores)
ZeroDivisionError: division by zero`;

export default function BugLogTab() {
  const { toast } = useDialog();
  const [rawTrace, setRawTrace] = useState('');
  const [fixSummary, setFixSummary] = useState('');
  const [aiDiag, setAiDiag] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState([]);

  const parsed = rawTrace.trim() ? parseErrorTrace(rawTrace) : null;

  const refreshLogs = useCallback(async () => {
    setLogs(await getBugLogs(search));
  }, [search]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  const handleDiagnoseAI = async () => {
    if (!rawTrace.trim() || aiBusy) return;
    setAiBusy(true);
    setAiDiag('');
    try {
      const out = await diagnoseBugWithAI(rawTrace, parsed || parseErrorTrace(rawTrace));
      setAiDiag(out);
    } catch (err) {
      toast(`AI diagnosis failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveBug = async () => {
    if (!rawTrace.trim()) {
      toast('Paste an error or stack trace first', { type: 'error' });
      return;
    }
    const p = parsed || parseErrorTrace(rawTrace);
    await saveBugLog({
      language: p.language,
      errorType: p.errorType,
      file: p.file,
      line: p.line,
      rawTrace,
      fixSummary: fixSummary.trim() || p.offlineHint,
    });
    await logStudyActivity('coding', 1);
    setRawTrace('');
    setFixSummary('');
    setAiDiag('');
    toast(`Saved ${p.language} ${p.errorType} to Bugs I Solved!`, { type: 'success' });
    refreshLogs();
  };

  const handleDelete = async id => {
    await deleteBugLog(id);
    toast('Deleted bug entry');
    refreshLogs();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
          <span className="settings-label flex items-center gap-6" style={{ margin: 0 }}>
            <Bug size={14} /> Stack-Trace Debugger
          </span>
          <button
            type="button"
            className="row-action-chip"
            onClick={() => setRawTrace(SAMPLE_TRACE)}
          >
            Load Sample Error
          </button>
        </div>

        <textarea
          className="input-field"
          rows={4}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          placeholder="Paste a Python traceback, JS TypeError, C++ gcc error, Java exception, or Gradle failure…"
          value={rawTrace}
          onChange={e => {
            setRawTrace(e.target.value);
            setAiDiag('');
          }}
        />

        {parsed && (
          <div className="announcement-preview-box" style={{ marginTop: 10 }}>
            <div className="flex items-center gap-6" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="mode-badge mode-code">{parsed.language}</span>
              <span className="mode-badge mode-vault">{parsed.errorType}</span>
              {parsed.file && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {parsed.file}
                  {parsed.line ? `:${parsed.line}` : ''}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{parsed.message}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              <strong>Offline Hint:</strong> {parsed.offlineHint}
            </div>
          </div>
        )}

        <input
          className="input-field mt-10"
          placeholder="How did you fix it? (saved to your searchable Bug Log)"
          value={fixSummary}
          onChange={e => setFixSummary(e.target.value)}
        />

        <div className="flex gap-8 mt-10" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveBug}>
            <Save size={14} /> Save to Bugs I Solved
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!rawTrace.trim() || aiBusy}
            onClick={handleDiagnoseAI}
          >
            <Sparkles size={14} /> {aiBusy ? 'Diagnosing…' : 'AI Root-Cause Fix'}
          </button>
        </div>

        {aiDiag && (
          <div className="explanation-card" style={{ marginTop: 10, marginBottom: 0 }}>
            <MarkdownContent text={aiDiag} />
          </div>
        )}
      </div>

      {/* Saved Bugs Archive */}
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
          <span className="settings-label" style={{ margin: 0 }}>
            Bugs I Solved ({logs.length})
          </span>
        </div>

        <div className="search-input-wrap" style={{ marginBottom: 10 }}>
          <span className="search-icon">
            <Search size={15} />
          </span>
          <input
            className="search-input"
            placeholder="Search saved bugs by error, language, or fix…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {logs.length === 0 ? (
          <div className="settings-help" style={{ margin: 0 }}>
            No bugs archived yet. Next time you fix a tricky error, save it here so you never spend 2 hours debugging it
            again!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {logs.map(b => (
              <div
                key={b.id}
                style={{
                  padding: '9px 11px',
                  borderRadius: 10,
                  background: 'var(--fill)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-6" style={{ flexWrap: 'wrap', marginBottom: 3 }}>
                    <span className="mode-badge mode-code">{b.language}</span>
                    <strong style={{ fontSize: 13 }}>{b.errorType}</strong>
                    {b.file && (
                      <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                        {b.file}
                        {b.line ? `:${b.line}` : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>{b.fixSummary}</div>
                </div>
                <button
                  type="button"
                  className="row-icon-btn"
                  aria-label="Delete bug entry"
                  onClick={() => handleDelete(b.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
