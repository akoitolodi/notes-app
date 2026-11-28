/**
 * GecScheduleImportSheet.jsx — Official GEC Schedule & Set A / Set B F2F vs Virtual Auto-Matcher (v2.6.0).
 * Supports 1 combined upload OR 2 separate uploads (F2F/Virtual Matrix + Master Official GEC Room Schedule),
 * automatically compares against the student's enrolled courses, and integrates into Timetable & Calendar.
 */
import { useState, useRef } from 'react';
import {
  X,
  Sparkles,
  Image as ImageIcon,
  FileUp,
  Check,
  ChevronDown,
  ChevronUp,
  CalendarClock,
} from 'lucide-react';
import {
  extractGecFromInput,
  matchGecToEnrolled,
  commitGecSchedule,
} from '../../lib/gecSchedule';
import { groupDaysLabel, formatTimeRange12h } from '../../lib/scheduleView';
import { useDialog } from '../ui/DialogProvider';

export default function GecScheduleImportSheet({
  courses = [],
  scheduleRows = [],
  existingGec = null,
  onClose,
  onApplied,
}) {
  const { toast } = useDialog();
  const matrixImgRef = useRef(null);
  const matrixFileRef = useRef(null);
  const masterImgRef = useRef(null);
  const masterFileRef = useRef(null);

  const [matrixFile, setMatrixFile] = useState(null);
  const [matrixText, setMatrixText] = useState('');
  const [showMaster, setShowMaster] = useState(false);
  const [masterFile, setMasterFile] = useState(null);
  const [masterText, setMasterText] = useState('');

  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Step 2 Preview state
  const [parsed, setParsed] = useState(null); // { termLabel, sets, periods, masterClasses }
  const [matchedCourses, setMatchedCourses] = useState([]);
  const [unmatchedMaster, setUnmatchedMaster] = useState([]);
  const [adoptedSlots, setAdoptedSlots] = useState([]);
  const [showSkipped, setShowSkipped] = useState(false);

  const handleAnalyze = async () => {
    if (!matrixFile && !matrixText.trim() && !masterFile && !masterText.trim()) {
      toast('Upload your GEC F2F/Virtual schedule image/PDF or paste its text first', { type: 'error' });
      return;
    }

    setParsing(true);
    setErrorMsg('');
    try {
      const res = await extractGecFromInput({
        matrixFile,
        matrixText,
        masterFile,
        masterText,
      });

      const matchRes = matchGecToEnrolled({
        sets: res.sets,
        masterClasses: res.masterClasses,
        enrolledCourses: courses,
        scheduleRows,
      });

      // Prepare adoptable Master GEC slots linked to matched enrolled courses
      const slots = [];
      for (const mc of matchRes.matchedCourses) {
        if (!mc.candidateSlots?.length) continue;
        mc.candidateSlots.forEach((cand, idx) => {
          slots.push({
            id: `${mc.key}-${idx}`,
            checked: mc.candidateSlots.length === 1, // auto-check single unambiguous match
            courseId: mc.courseId,
            targetCode: mc.code,
            targetName: mc.name,
            code: cand.code,
            name: cand.name,
            section: cand.section || '',
            instructor: cand.instructor || '',
            meetings: cand.meetings || [],
          });
        });
      }

      setParsed(res);
      setMatchedCourses(matchRes.matchedCourses);
      setUnmatchedMaster(matchRes.unmatchedMasterClasses || []);
      setAdoptedSlots(slots);
    } catch (err) {
      setErrorMsg(err?.message || 'Could not extract GEC schedule');
    } finally {
      setParsing(false);
    }
  };

  const updateCourseSet = (courseKey, nextSetId) => {
    setMatchedCourses(prev =>
      prev.map(c => (c.key === courseKey ? { ...c, setId: nextSetId } : c))
    );
  };

  const toggleSlot = id => {
    setAdoptedSlots(prev => prev.map(s => (s.id === id ? { ...s, checked: !s.checked } : s)));
  };

  const handleCommit = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const courseSetMap = {};
      for (const c of matchedCourses) {
        courseSetMap[c.key] = {
          setId: c.setId || 'none',
          courseCode: c.code,
          courseName: c.name,
        };
      }
      const res = await commitGecSchedule({
        termLabel: parsed.termLabel || existingGec?.termLabel || 'GEC Schedule',
        sets: parsed.sets?.length ? parsed.sets : existingGec?.sets || [],
        periods: parsed.periods?.length ? parsed.periods : existingGec?.periods || [],
        courseSetMap,
        adoptedSlots,
      });
      toast(
        res.addedSlotsCount > 0
          ? `Synced GEC schedule & adopted ${res.addedSlotsCount} class slot${res.addedSlotsCount === 1 ? '' : 's'}!`
          : 'Synced GEC F2F / Virtual schedule to your Timetable & Calendar!',
        { type: 'success' }
      );
      onApplied?.(res.saved);
      onClose?.();
    } catch (err) {
      toast(err?.message || 'Could not save GEC schedule', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="export-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="GEC Schedule Matcher">
      <div
        className="export-sheet"
        style={{ maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-8">
            <CalendarClock size={18} style={{ color: 'var(--accent-ink)' }} />
            <span style={{ fontSize: 16, fontWeight: 800 }}>GEC F2F / Virtual Schedule</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!parsed ? (
          <div>
            <p className="settings-help" style={{ marginTop: 0 }}>
              Upload the official GEC <strong>Face-to-Face / Virtual schedule</strong> (Set A &amp; Set B dates).
              We’ll match only the GEC subjects you’re enrolled in and tag your Timetable &amp; Home Schedule automatically.
            </p>

            {/* Upload 1: F2F / Virtual Date Matrix */}
            <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
              <div className="settings-label">1. F2F / Virtual Date Matrix (Image, PDF, or Text)</div>
              <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => matrixImgRef.current?.click()}
                >
                  <ImageIcon size={14} /> Upload Image
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => matrixFileRef.current?.click()}
                >
                  <FileUp size={14} /> Upload PDF
                </button>
              </div>
              <input
                ref={matrixImgRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setMatrixFile(f);
                  e.target.value = '';
                }}
              />
              <input
                ref={matrixFileRef}
                type="file"
                accept=".pdf,.docx,.txt,application/pdf"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setMatrixFile(f);
                  e.target.value = '';
                }}
              />
              {matrixFile && (
                <div className="settings-help" style={{ marginTop: 6, marginBottom: 4 }}>
                  Selected: <strong>{matrixFile.name}</strong>
                </div>
              )}
              <textarea
                className="input-field mt-8"
                rows={3}
                placeholder="Or paste table text (e.g. Set A: Art | Math | Rizal | World, Dec 1-2 Face-to-Face | Virtual...)"
                value={matrixText}
                onChange={e => setMatrixText(e.target.value)}
              />
            </div>

            {/* Optional Upload 2: Master GEC Room/Time Schedule */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}
              onClick={() => setShowMaster(v => !v)}
            >
              <span>2. Optional: Master GEC Room / Time Sheet</span>
              {showMaster ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showMaster && (
              <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
                <div className="settings-help" style={{ marginTop: 0 }}>
                  Already have your GEC rooms &amp; times from your Study Load? You can skip this! Otherwise upload the official all-GEC room schedule and we’ll adopt only your enrolled subjects.
                </div>
                <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => masterImgRef.current?.click()}
                  >
                    <ImageIcon size={14} /> Upload Image
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => masterFileRef.current?.click()}
                  >
                    <FileUp size={14} /> Upload PDF
                  </button>
                </div>
                <input
                  ref={masterImgRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setMasterFile(f);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={masterFileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setMasterFile(f);
                    e.target.value = '';
                  }}
                />
                {masterFile && (
                  <div className="settings-help" style={{ marginTop: 6, marginBottom: 4 }}>
                    Selected: <strong>{masterFile.name}</strong>
                  </div>
                )}
                <textarea
                  className="input-field mt-8"
                  rows={2}
                  placeholder="Or paste Master GEC rows..."
                  value={masterText}
                  onChange={e => setMasterText(e.target.value)}
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
              onClick={handleAnalyze}
            >
              {parsing ? (
                <>
                  <span className="spinner" /> Matching GEC Schedule…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Match Against My Enrolled Courses
                </>
              )}
            </button>
          </div>
        ) : (
          /* Step 2: Confirm Matched Enrolled GECs + Set A/B Assignments */
          <div>
            <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>
                {parsed.termLabel || 'GEC Schedule'} · {parsed.periods?.length || 0} date periods
              </div>
              {parsed.sets?.map(s => (
                <div key={s.id} style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  <strong>{s.label}:</strong> {(s.subjects || []).join(' · ')}
                </div>
              ))}
            </div>

            <div className="pattern-mini-label" style={{ marginBottom: 6 }}>
              Your Enrolled Courses — Confirm Set A / Set B ({matchedCourses.filter(c => c.setId && c.setId !== 'none').length} matched)
            </div>

            {matchedCourses.length === 0 ? (
              <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
                <div className="settings-help" style={{ margin: 0 }}>
                  No enrolled courses yet — import your Study Load PDF or add courses first, then re-open GEC Matcher anytime. Date rules will still be saved!
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {matchedCourses.map(c => (
                  <div key={c.key} className="gec-match-row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.code}
                      </div>
                      {c.name && c.name !== c.code && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </div>
                      )}
                    </div>
                    <div className="gec-set-picker" role="group" aria-label={`Set assignment for ${c.code}`}>
                      {parsed.sets?.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          className={`gec-set-pill${c.setId === s.id ? ' active' : ''}`}
                          onClick={() => updateCourseSet(c.key, c.setId === s.id ? 'none' : s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`gec-set-pill${!c.setId || c.setId === 'none' ? ' active is-none' : ''}`}
                        onClick={() => updateCourseSet(c.key, 'none')}
                      >
                        Not GEC
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Adoptable Master GEC Slots (if Master Schedule was also uploaded) */}
            {adoptedSlots.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="pattern-mini-label" style={{ marginBottom: 6 }}>
                  Matched GEC Room/Time Slots to Adopt ({adoptedSlots.filter(s => s.checked).length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {adoptedSlots.map(sl => (
                    <label key={sl.id} className="gec-match-row">
                      <input type="checkbox" checked={sl.checked} onChange={() => toggleSlot(sl.id)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                          {sl.targetCode} {sl.section ? `(${sl.section})` : ''}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {(sl.meetings || []).map(m => `${groupDaysLabel(m.days)} ${formatTimeRange12h(m.startTime, m.endTime)} ${m.room}`).join(' · ')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {unmatchedMaster.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="row-action-chip"
                  onClick={() => setShowSkipped(v => !v)}
                >
                  {showSkipped ? 'Hide' : 'Show'} {unmatchedMaster.length} non-enrolled GEC rows (skipped)
                </button>
                {showSkipped && (
                  <div className="settings-help" style={{ marginTop: 6 }}>
                    {unmatchedMaster.slice(0, 12).map(u => u.code || u.name).join(', ')}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-8">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setParsed(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                disabled={saving}
                onClick={handleCommit}
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save & Apply F2F/Virtual'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
