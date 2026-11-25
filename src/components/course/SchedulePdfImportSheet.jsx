/**
 * SchedulePdfImportSheet — Lazy-loaded modal that turns a university Class Schedule / COR PDF
 * (or pasted schedule text) into Courses, Visual Timetable blocks, Study Load, Note folders,
 * and optional 15-min before-class notifications.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  FileUp,
  Sparkles,
  Check,
  Calendar,
  AlertCircle,
  ClipboardPaste,
} from 'lucide-react';
import {
  extractScheduleFromPdfBuffer,
  parseScheduleLines,
  parseScheduleWithAI,
  commitImportedSchedule,
} from '../../lib/schedulePdfParser';
import { formatTimeRange12h, groupDaysLabel } from '../../lib/scheduleView';
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
} from '../../lib/notifications';
import { useDialog } from '../ui/DialogProvider';

export default function SchedulePdfImportSheet({ initialFile = null, onImported, onClose }) {
  const { toast } = useDialog();
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'paste'
  const [fileName, setFileName] = useState(initialFile?.name || '');
  const [pasteText, setPasteText] = useState('');
  const [rawText, setRawText] = useState('');
  const [semester, setSemester] = useState('');
  const [declaredUnits, setDeclaredUnits] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [createFolders, setCreateFolders] = useState(true);
  const [enableReminders, setEnableReminders] = useState(
    () => Boolean(getNotificationSettings().classReminders15m)
  );

  const fileInputRef = useRef(null);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyParsedResult = parsed => {
    setSemester(parsed.semester || '');
    setDeclaredUnits(parsed.declaredTotalUnits ?? null);
    setRows(
      (parsed.courses || []).map((c, idx) => ({
        ...c,
        _rowId: `sched-row-${idx}-${Date.now()}`,
        selected: true,
      }))
    );
  };

  const processPdfFile = async file => {
    if (!file) return;
    setFileName(file.name || 'Schedule.pdf');
    setBusy(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const res = await extractScheduleFromPdfBuffer(buf);
      setRawText(res.rawText || '');
      applyParsedResult(res);
      if ((res.courses || []).length === 0) {
        setError(
          'No structured table rows detected offline (scanned image PDF?). Try Paste Text or tap "Parse with AI".'
        );
      }
    } catch (err) {
      setError(err?.message || 'Could not read that PDF.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialFile) {
      processPdfFile(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handleParsePaste = () => {
    const txt = pasteText.trim();
    if (!txt) {
      setError('Paste your class schedule rows first.');
      return;
    }
    setError('');
    setRawText(txt);
    const res = parseScheduleLines(txt.split(/\r?\n/));
    applyParsedResult(res);
    if ((res.courses || []).length === 0) {
      setError('Could not detect course times offline — try tapping "Parse with AI".');
    }
  };

  const handleAiParse = async () => {
    const txt = (inputMode === 'paste' ? pasteText : rawText) || rawText || pasteText;
    if (!txt.trim()) {
      setError('Select a schedule PDF or paste schedule text first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await parseScheduleWithAI(txt);
      applyParsedResult(res);
      if ((res.courses || []).length === 0) {
        setError('AI could not find class schedules in that text.');
      }
    } catch (err) {
      setError(err?.message || 'AI schedule parsing failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (rowId, patch) => {
    setRows(prev => prev.map(r => (r._rowId === rowId ? { ...r, ...patch } : r)));
  };

  const selectedRows = rows.filter(r => r.selected);
  const selectedSlots = selectedRows.reduce((n, r) => n + (r.meetings?.length || 0), 0);
  const selectedUnits =
    Math.round(selectedRows.reduce((n, r) => n + (Number(r.units) || 0), 0) * 100) / 100;

  const handleConfirmImport = async () => {
    if (selectedRows.length === 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      if (enableReminders) {
        await requestNotificationPermission().catch(() => {});
        saveNotificationSettings({ classReminders15m: true });
      }
      const res = await commitImportedSchedule({
        courses: selectedRows,
        createFolders,
      });
      toast(
        `Imported ${res.created + res.updated} course${res.created + res.updated === 1 ? '' : 's'} & ${res.slots} class slots!`,
        { type: 'success' }
      );
      onImported?.(res);
    } catch (err) {
      setError(err?.message || 'Failed to save schedule.');
      setSaving(false);
    }
  };

  const modal = (
    <div className="export-overlay" onClick={onClose}>
      <div
        className="export-sheet sched-import-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import Class Schedule PDF"
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
          <div className="export-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Calendar size={17} style={{ color: 'var(--accent)' }} /> Import Class Schedule PDF
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="view-switcher" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={`view-switch-btn${inputMode === 'file' ? ' active' : ''}`}
            onClick={() => setInputMode('file')}
          >
            <FileUp size={13} /> Schedule PDF
          </button>
          <button
            type="button"
            className={`view-switch-btn${inputMode === 'paste' ? ' active' : ''}`}
            onClick={() => setInputMode('paste')}
          >
            <ClipboardPaste size={13} /> Paste Text
          </button>
        </div>

        {inputMode === 'file' ? (
          <>
            <button
              type="button"
              className={`import-dropzone${fileName ? ' has-file' : ''}`}
              disabled={busy || saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="import-dropzone-icon">
                <FileUp size={20} />
              </span>
              <div className="import-dropzone-title">
                {fileName || 'Choose Class Schedule / COR PDF'}
              </div>
              <div className="import-dropzone-sub">
                Extracts subject codes, sections, units, days, times &amp; rooms 100% offline
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) processPdfFile(f);
              }}
            />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="ai-input"
              style={{ marginTop: 0, minHeight: 110, fontSize: 12.5 }}
              placeholder="Paste rows from your Student Class Schedule PDF or portal (e.g. IPT 101A C 3.00 04:30PM-05:30PM TTh IT 3)…"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            <div className="flex gap-8">
              <button
                type="button"
                className="btn btn-secondary btn-sm flex-1"
                disabled={busy}
                onClick={handleParsePaste}
              >
                <Check size={14} /> Parse Schedule Offline
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !pasteText.trim()}
                onClick={handleAiParse}
              >
                <Sparkles size={14} /> Parse with AI
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="scan-indicator" style={{ marginTop: 10 }}>
            <span className="spinner" /> Reading schedule layout…
          </div>
        )}

        {error && (
          <div className="inline-mistake" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="flex items-start gap-6">
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
            {(rawText || pasteText) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={handleAiParse}
                style={{ alignSelf: 'flex-start' }}
              >
                <Sparkles size={13} /> Try Parse with AI
              </button>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="sched-import-preview">
            <div className="sched-import-summary">
              <span>
                <strong>{selectedRows.length}</strong> courses ·{' '}
                <strong>{selectedSlots}</strong> class slots ·{' '}
                <strong>{selectedUnits}</strong> units
                {declaredUnits ? ` (PDF total: ${declaredUnits})` : ''}
              </span>
              {semester && <span className="mode-badge mode-study">{semester}</span>}
            </div>

            <div className="sched-import-list">
              {rows.map(r => (
                <div
                  key={r._rowId}
                  className={`sched-import-row${r.selected ? '' : ' is-dim'}`}
                >
                  <div className="sched-import-row-head">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      onChange={e => updateRow(r._rowId, { selected: e.target.checked })}
                      aria-label={`Include ${r.code}`}
                    />
                    <input
                      className="input-field sched-code-input"
                      value={r.code}
                      aria-label="Course code"
                      onChange={e =>
                        updateRow(r._rowId, {
                          code: e.target.value,
                          name: e.target.value,
                        })
                      }
                    />
                    <input
                      className="input-field sched-sec-input"
                      value={r.section || ''}
                      placeholder="Sec"
                      aria-label="Section"
                      onChange={e => updateRow(r._rowId, { section: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="12"
                      className="input-field sched-units-input"
                      value={r.units}
                      aria-label="Units"
                      onChange={e => updateRow(r._rowId, { units: e.target.value })}
                    />
                  </div>
                  <div className="sched-import-slots">
                    {(r.meetings || []).map((m, mi) => (
                      <span key={mi} className="sched-slot-chip">
                        <strong>{m.kind}</strong> · {groupDaysLabel(m.days)}{' '}
                        {formatTimeRange12h(m.startTime, m.endTime)}
                        {m.room ? ` · ${m.room}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="sched-import-options">
              <label className="sched-opt-check">
                <input
                  type="checkbox"
                  checked={createFolders}
                  onChange={e => setCreateFolders(e.target.checked)}
                />
                <span>Create matching subject Note folders</span>
              </label>
              <label className="sched-opt-check">
                <input
                  type="checkbox"
                  checked={enableReminders}
                  onChange={e => setEnableReminders(e.target.checked)}
                />
                <span>Remind me 15 min before each class</span>
              </label>
            </div>
          </div>
        )}

        <div className="flex gap-8" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={selectedRows.length === 0 || saving || busy}
            onClick={handleConfirmImport}
          >
            <Check size={16} /> {saving ? 'Saving…' : `Import ${selectedRows.length || ''} Courses`}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
}
