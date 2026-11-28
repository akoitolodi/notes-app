/**
 * SchoolCalendarImportSheet.jsx — Automatic Multi-Term School Calendar Maker
 * & Mid-Semester Revision Diff Importer (v2.6.0).
 */
import { useState, useRef } from 'react';
import {
  X,
  Calendar,
  FileUp,
  Image as ImageIcon,
  Sparkles,
  Check,
  RefreshCw,
  ArrowRight,
  Plus,
  Minus,
} from 'lucide-react';
import {
  SCHOOL_CALENDAR_TERMS,
  detectActiveTermForDate,
  extractSchoolCalendarFromInput,
  diffSchoolCalendarEvents,
  applyCalendarDiffSelection,
  saveAndSyncSchoolCalendar,
} from '../../lib/schoolCalendar';
import { useDialog } from '../ui/DialogProvider';

export default function SchoolCalendarImportSheet({
  existingCalendar = null,
  onClose,
  onApplied,
}) {
  const { toast } = useDialog();
  const fileRef = useRef(null);
  const imgRef = useRef(null);

  const [mode, setMode] = useState(existingCalendar ? 'revise' : 'new'); // 'new' | 'revise'
  const [inputKind, setInputKind] = useState('file'); // 'file' | 'text'
  const [selectedFile, setSelectedFile] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Preview state after parsing
  const [preview, setPreview] = useState(null); // { schoolName, academicYear, startYear, endYear, activeTerm, includeGradExams, events[], diff?, isPartialPatch }
  const [selectedEventKeys, setSelectedEventKeys] = useState(new Set());
  const [diffState, setDiffState] = useState(null);
  const [revisionNote, setRevisionNote] = useState('');

  const handleAnalyze = async (overrideFile = null) => {
    const fileToUse = overrideFile || selectedFile;
    if (inputKind === 'file' && !fileToUse && !pastedText.trim()) {
      toast('Choose a calendar photo/PDF or paste calendar text first', { type: 'error' });
      return;
    }
    if (inputKind === 'text' && !pastedText.trim()) {
      toast('Paste the official calendar or revision memo first', { type: 'error' });
      return;
    }

    setParsing(true);
    setErrorMsg('');
    try {
      const res = await extractSchoolCalendarFromInput({
        file: fileToUse,
        text: pastedText,
        mode,
        existingCalendar,
      });

      if (mode === 'revise' && existingCalendar) {
        const diff = diffSchoolCalendarEvents(
          existingCalendar.events || [],
          res.isPartialPatch ? res.patches : res.events,
          { isPartialPatch: res.isPartialPatch }
        );
        setDiffState(diff);
        setPreview({
          schoolName: res.schoolName || existingCalendar.schoolName,
          academicYear: res.academicYear || existingCalendar.academicYear,
          startYear: res.startYear || existingCalendar.startYear,
          endYear: res.endYear || existingCalendar.endYear,
          activeTerm: existingCalendar.activeTerm || 'second',
          includeGradExams: Boolean(existingCalendar.includeGradExams),
          events: res.events || [],
          isPartialPatch: res.isPartialPatch,
        });
        const movedCount = diff.moved.length;
        const addCount = diff.added.length;
        const remCount = diff.removed.length;
        setRevisionNote(
          [
            movedCount ? `${movedCount} moved` : '',
            addCount ? `${addCount} added` : '',
            remCount ? `${remCount} removed` : '',
          ]
            .filter(Boolean)
            .join(', ') || 'Mid-semester revision'
        );
      } else {
        setDiffState(null);
        setPreview({
          schoolName: res.schoolName || 'Academic Calendar',
          academicYear: res.academicYear || '',
          startYear: res.startYear,
          endYear: res.endYear,
          activeTerm: res.activeTerm || detectActiveTermForDate(res.events),
          includeGradExams: false,
          events: res.events || [],
          isPartialPatch: false,
        });
        setSelectedEventKeys(new Set((res.events || []).map(e => e.eventKey)));
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to read calendar');
    } finally {
      setParsing(false);
    }
  };

  const toggleDiffItem = (bucket, id) => {
    setDiffState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [bucket]: prev[bucket].map(item =>
          item.id === id ? { ...item, checked: !item.checked } : item
        ),
      };
    });
  };

  const handleApply = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      if (mode === 'revise' && existingCalendar && diffState) {
        const mergedEvents = applyCalendarDiffSelection(existingCalendar.events || [], diffState);
        const nextVer = (existingCalendar.version || 1) + 1;
        const changedCount =
          diffState.moved.filter(x => x.checked).length +
          diffState.added.filter(x => x.checked).length +
          diffState.removed.filter(x => x.checked).length;
        const revisions = [
          ...(existingCalendar.revisions || []),
          {
            version: nextVer,
            date: new Date().toISOString().slice(0, 10),
            summary: revisionNote || `Revision v${nextVer}`,
            changedCount,
          },
        ];
        const saved = await saveAndSyncSchoolCalendar({
          ...existingCalendar,
          schoolName: preview.schoolName || existingCalendar.schoolName,
          academicYear: preview.academicYear || existingCalendar.academicYear,
          activeTerm: preview.activeTerm,
          includeGradExams: preview.includeGradExams,
          version: nextVer,
          revisions,
          events: mergedEvents,
        });
        toast(`Applied v${nextVer} revision (${changedCount} updates)!`, { type: 'success' });
        onApplied?.(saved);
      } else {
        const chosen = (preview.events || []).filter(e => selectedEventKeys.has(e.eventKey));
        const saved = await saveAndSyncSchoolCalendar({
          schoolName: preview.schoolName,
          academicYear: preview.academicYear,
          startYear: preview.startYear,
          endYear: preview.endYear,
          activeTerm: preview.activeTerm,
          includeGradExams: preview.includeGradExams,
          version: 1,
          revisions: [
            {
              version: 1,
              date: new Date().toISOString().slice(0, 10),
              summary: 'Initial calendar import',
              changedCount: chosen.length,
            },
          ],
          events: chosen,
        });
        toast(`Saved ${chosen.length} school calendar dates!`, { type: 'success' });
        onApplied?.(saved);
      }
      onClose?.();
    } catch (err) {
      toast(err?.message || 'Could not save calendar', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const termCounts = SCHOOL_CALENDAR_TERMS.map(t => ({
    ...t,
    count: (preview?.events || []).filter(e => e.term === t.id).length,
  }));

  return (
    <div className="export-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="School Calendar Maker">
      <div
        className="export-sheet"
        style={{ maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-8">
            <Calendar size={18} style={{ color: 'var(--accent-ink)' }} />
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {mode === 'revise' ? 'Revise School Calendar' : 'Auto-Make School Calendar'}
            </span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {existingCalendar && (
          <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 10px' }}>
            <button
              type="button"
              className={`view-switch-btn${mode === 'revise' ? ' active' : ''}`}
              onClick={() => {
                setMode('revise');
                setPreview(null);
                setDiffState(null);
              }}
            >
              <RefreshCw size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              Revise Current (v{existingCalendar.version || 1})
            </button>
            <button
              type="button"
              className={`view-switch-btn${mode === 'new' ? ' active' : ''}`}
              onClick={() => {
                setMode('new');
                setPreview(null);
                setDiffState(null);
              }}
            >
              Replace Full Calendar
            </button>
          </div>
        )}

        {!preview ? (
          <div>
            <p className="settings-help" style={{ marginTop: 0 }}>
              {mode === 'revise'
                ? 'Upload a revised calendar photo/PDF OR paste a short announcement memo (e.g. "Midterms moved to Feb 8-13; Feb 25 no classes") — your personal tasks stay untouched.'
                : 'Upload your school’s Academic Calendar photo/PDF or paste text. Multi-term dates (1st Sem, 2nd Sem, Summer) and cross-year months are detected automatically.'}
            </p>

            <div className="view-switcher view-switcher-inline" style={{ margin: '8px 0 10px' }}>
              <button
                type="button"
                className={`view-switch-btn${inputKind === 'file' ? ' active' : ''}`}
                onClick={() => setInputKind('file')}
              >
                Photo / PDF File
              </button>
              <button
                type="button"
                className={`view-switch-btn${inputKind === 'text' ? ' active' : ''}`}
                onClick={() => setInputKind('text')}
              >
                {mode === 'revise' ? 'Paste Revision Memo' : 'Paste Calendar Text'}
              </button>
            </div>

            {inputKind === 'file' ? (
              <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
                <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => imgRef.current?.click()}
                  >
                    <ImageIcon size={14} /> Upload Photo
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => fileRef.current?.click()}
                  >
                    <FileUp size={14} /> Upload PDF / Doc
                  </button>
                </div>
                <input
                  ref={imgRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      handleAnalyze(f);
                    }
                    e.target.value = '';
                  }}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,application/pdf"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      handleAnalyze(f);
                    }
                    e.target.value = '';
                  }}
                />
                {selectedFile && (
                  <div className="settings-help" style={{ marginTop: 8, marginBottom: 0 }}>
                    Selected: <strong>{selectedFile.name}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <textarea
                  className="input-field"
                  rows={5}
                  placeholder={
                    mode === 'revise'
                      ? 'Example:\nMidterm Examination moved to Feb 8-13\nFeb 26 classes suspended\nCancel Faculty Sports Fest'
                      : 'Paste the calendar text here (First Semester / Second Semester / Summer)...'
                  }
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                />
              </div>
            )}

            {errorMsg && (
              <div className="sticky-alert-banner" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={parsing}
              onClick={() => handleAnalyze(null)}
            >
              {parsing ? (
                <>
                  <span className="spinner" /> Reading Official Calendar…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> {mode === 'revise' ? 'Detect Changes (Diff)' : 'Extract Calendar Dates'}
                </>
              )}
            </button>
          </div>
        ) : diffState ? (
          /* Revision Diff Preview */
          <div>
            <div className="settings-help" style={{ marginTop: 0 }}>
              Review detected changes for <strong>{preview.schoolName}</strong> ({preview.academicYear}). Uncheck anything you want to skip.
            </div>

            {diffState.moved.length === 0 &&
            diffState.added.length === 0 &&
            diffState.removed.length === 0 ? (
              <div className="list-group settings-group" style={{ textAlign: 'center', margin: '0 0 10px' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>No date differences detected</div>
                <div className="settings-help" style={{ marginBottom: 0 }}>
                  Everything matches your existing v{existingCalendar?.version || 1} calendar.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {diffState.moved.map(m => (
                  <label key={m.id} className="school-cal-diff-card is-moved">
                    <input
                      type="checkbox"
                      checked={m.checked}
                      onChange={() => toggleDiffItem('moved', m.id)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-6" style={{ fontWeight: 700, fontSize: 13 }}>
                        <span className="diff-tag is-moved">MOVED</span>
                        <span>{m.next.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ textDecoration: 'line-through' }}>
                          {m.prev.startDate}{m.prev.endDate !== m.prev.startDate ? `–${m.prev.endDate}` : ''}
                        </span>
                        <ArrowRight size={11} />
                        <strong>
                          {m.next.startDate}{m.next.endDate !== m.next.startDate ? `–${m.next.endDate}` : ''}
                        </strong>
                      </div>
                    </div>
                  </label>
                ))}

                {diffState.added.map(a => (
                  <label key={a.id} className="school-cal-diff-card is-added">
                    <input
                      type="checkbox"
                      checked={a.checked}
                      onChange={() => toggleDiffItem('added', a.id)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-6" style={{ fontWeight: 700, fontSize: 13 }}>
                        <span className="diff-tag is-added"><Plus size={10} /> ADDED</span>
                        <span>{a.event.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {a.event.startDate}{a.event.endDate !== a.event.startDate ? `–${a.event.endDate}` : ''} · {a.event.term}
                      </div>
                    </div>
                  </label>
                ))}

                {diffState.removed.map(r => (
                  <label key={r.id} className="school-cal-diff-card is-removed">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggleDiffItem('removed', r.id)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-6" style={{ fontWeight: 700, fontSize: 13 }}>
                        <span className="diff-tag is-removed"><Minus size={10} /> REMOVED</span>
                        <span style={{ textDecoration: 'line-through' }}>{r.event.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Was {r.event.startDate}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-8">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setPreview(null);
                  setDiffState(null);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                disabled={saving}
                onClick={handleApply}
              >
                <Check size={14} /> {saving ? 'Applying…' : `Apply Revision (v${(existingCalendar?.version || 1) + 1})`}
              </button>
            </div>
          </div>
        ) : (
          /* New Full Calendar Preview */
          <div>
            <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>{preview.schoolName}</div>
              <div className="settings-help" style={{ margin: '2px 0 8px' }}>
                AY {preview.academicYear || 'Current'} · {preview.events.length} total dates detected
              </div>

              <div className="pattern-mini-label" style={{ marginBottom: 4 }}>Active Semester</div>
              <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                {termCounts.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`row-action-chip${preview.activeTerm === t.id ? ' active-chip' : ''}`}
                    onClick={() => setPreview(p => ({ ...p, activeTerm: t.id }))}
                  >
                    {t.label} ({t.count})
                  </button>
                ))}
              </div>

              <label className="ios-switch-row" style={{ paddingTop: 4 }}>
                <span style={{ fontSize: 12.5 }}>Include Graduate-only exams</span>
                <span className="ios-switch">
                  <input
                    type="checkbox"
                    checked={preview.includeGradExams}
                    onChange={e => setPreview(p => ({ ...p, includeGradExams: e.target.checked }))}
                  />
                  <span className="ios-switch-track" />
                </span>
              </label>
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
              {preview.events
                .filter(e => e.term === preview.activeTerm && (preview.includeGradExams || e.audience !== 'grad'))
                .map(ev => {
                  const checked = selectedEventKeys.has(ev.eventKey);
                  return (
                    <label key={`${ev.eventKey}-${ev.startDate}`} className="gec-match-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedEventKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(ev.eventKey)) next.delete(ev.eventKey);
                            else next.add(ev.eventKey);
                            return next;
                          });
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {ev.startDate}{ev.endDate !== ev.startDate ? ` → ${ev.endDate}` : ''} · {ev.kind}
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>

            <div className="flex gap-8">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPreview(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                disabled={saving || selectedEventKeys.size === 0}
                onClick={handleApply}
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save & Sync to Planner'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
