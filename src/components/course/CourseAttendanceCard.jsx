/**
 * CourseAttendanceCard — Customizable PH College Attendance & FDA Absence Guard.
 * Supports CHED 20% rule presets (MWF -> 10, TTh -> 7, 1x/wk -> 3) OR exact syllabus limit
 * plus configurable Lates-per-Absence rule (e.g. 3 Lates = 1 Absence, or 0 = Off).
 */
import { useState } from 'react';
import { ShieldAlert, Plus, RotateCcw, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { db, localDateKey } from '../../store/db';
import { ATTENDANCE_PRESETS, computeAttendanceStatus } from '../../lib/courseExtras';
import { useDialog } from '../ui/DialogProvider';

export default function CourseAttendanceCard({ course, onUpdated }) {
  const { toast } = useDialog();
  const [configOpen, setConfigOpen] = useState(false);

  const att = course?.attendance || {
    absences: 0,
    lates: 0,
    maxAbsences: 7,
    latesPerAbsence: 3,
    log: [],
  };
  const status = computeAttendanceStatus(att);
  const log = Array.isArray(att.log) ? att.log : [];

  const saveAtt = async nextAtt => {
    await db.courses.update(course.id, { attendance: nextAtt });
    onUpdated?.();
  };

  const recordTick = async kind => {
    const next = {
      ...att,
      absences: kind === 'absent' ? status.absences + 1 : status.absences,
      lates: kind === 'late' ? status.lates + 1 : status.lates,
      log: [{ kind, dateKey: localDateKey(), ts: Date.now() }, ...log].slice(0, 40),
    };
    await saveAtt(next);
    toast(kind === 'absent' ? 'Logged 1 absence' : 'Logged 1 late arrival');
  };

  const undoLast = async () => {
    if (log.length === 0) return;
    const [last, ...rest] = log;
    const next = {
      ...att,
      absences: last.kind === 'absent' ? Math.max(0, status.absences - 1) : status.absences,
      lates: last.kind === 'late' ? Math.max(0, status.lates - 1) : status.lates,
      log: rest,
    };
    await saveAtt(next);
    toast('Undid last attendance entry');
  };

  const barColor =
    status.riskLevel === 'danger'
      ? '#ff375f'
      : status.riskLevel === 'warn'
        ? '#ff9f0a'
        : '#28b44c';

  return (
    <div className="list-group settings-group">
      <div className="flex items-center justify-between gap-8" style={{ marginBottom: 4 }}>
        <span className="settings-label flex items-center gap-6" style={{ margin: 0 }}>
          <ShieldAlert size={14} style={{ color: barColor }} /> Attendance Guard
        </span>
        <span
          className={`mode-badge ${
            status.riskLevel === 'danger' ? 'mode-vault' : status.riskLevel === 'warn' ? 'mode-explore' : 'mode-code'
          }`}
        >
          {status.remaining <= 0 ? 'FDA Limit Reached!' : `${status.remaining} left`}
        </span>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 650, marginTop: 4 }}>
        {status.effectiveAbsences} / {status.maxAbsences} effective absences
        <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 12.5 }}>
          {' '}
          ({status.absences} absent · {status.lates} late
          {status.latesPerAbsence > 0 ? `, ${status.latesPerAbsence} lates = 1 absent` : ''})
        </span>
      </div>

      <div className="progress-bar-track" style={{ margin: '8px 0' }}>
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.max(4, status.pctUsed)}%`, background: barColor }}
        />
      </div>

      <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="row-action-chip" onClick={() => recordTick('absent')}>
          <Plus size={12} /> Absent
        </button>
        <button type="button" className="row-action-chip" onClick={() => recordTick('late')}>
          <Plus size={12} /> Late
        </button>
        {log.length > 0 && (
          <button type="button" className="row-action-chip" onClick={undoLast}>
            <RotateCcw size={12} /> Undo
          </button>
        )}
        <button
          type="button"
          className="row-action-chip"
          style={{ marginLeft: 'auto' }}
          onClick={() => setConfigOpen(v => !v)}
        >
          <SlidersHorizontal size={12} /> Rules {configOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {configOpen && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
          <div className="settings-help" style={{ marginTop: 0 }}>
            Quick CHED 20% presets (or enter your exact professor&apos;s syllabus max):
          </div>
          <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
            {ATTENDANCE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className={`row-action-chip${status.maxAbsences === p.maxAbsences ? ' active-chip' : ''}`}
                onClick={() =>
                  saveAtt({ ...att, maxAbsences: p.maxAbsences, latesPerAbsence: p.latesPerAbsence })
                }
              >
                {p.label} · {p.maxAbsences}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div className="settings-help" style={{ margin: '0 0 4px' }}>Max Absences:</div>
              <input
                type="number"
                min="1"
                max="30"
                className="input-field"
                value={status.maxAbsences}
                onChange={e => saveAtt({ ...att, maxAbsences: Math.max(1, Number(e.target.value) || 7) })}
              />
            </div>
            <div>
              <div className="settings-help" style={{ margin: '0 0 4px' }}>Lates = 1 Absent (0 = off):</div>
              <input
                type="number"
                min="0"
                max="10"
                className="input-field"
                value={status.latesPerAbsence}
                onChange={e => saveAtt({ ...att, latesPerAbsence: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          </div>
          {log.length > 0 && (
            <div className="settings-help" style={{ marginTop: 8 }}>
              Recent log: {log.slice(0, 5).map(x => `${x.kind === 'absent' ? 'Absent' : 'Late'} (${x.dateKey})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
