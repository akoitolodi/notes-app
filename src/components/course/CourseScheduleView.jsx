/**
 * CourseScheduleView.jsx — Visual 30-Minute Weekly Timetable Grid & Study Load
 * inside Course Dashboard, modeled after clean academic planner cards with
 * Live Now/Next class tracker, conflict detection, Room & Teacher metadata,
 * Studio Gold / Course Colors themes, and Study Load unit summary.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  MapPin,
  User,
  AlertTriangle,
  Calendar,
  ListChecks,
  BookOpen,
  Pencil,
  Sparkles,
  Plus,
  X,
} from 'lucide-react';
import {
  SCHEDULE_DAYS,
  formatTime12h,
  formatTimeRange12h,
  groupDaysLabel,
  resolveScheduleEntries,
  computeTimetableGrid,
  detectScheduleConflicts,
  buildStudyLoadSummary,
  getNowAndNextClass,
} from '../../lib/scheduleView';

const PALETTE_KEY = 'aicn:schedulePalette';
const VIEW_MODE_KEY = 'aicn:scheduleViewMode';
const SLOT_HEIGHT = 42; // px per 30-min row (60-min block = 84px, 90-min block = 126px)

function hexToSoftTint(hex, alpha = 0.24) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(245, 158, 11, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function CourseScheduleView({
  courses = [],
  scheduleRows = [],
  onOpenCourse,
  onEditCourse,
  onAddCourseSchedule,
  onImportSchedulePdf = null,
}) {
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'load' ? 'load' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [paletteMode, setPaletteMode] = useState(() => {
    try {
      return localStorage.getItem(PALETTE_KEY) === 'course' ? 'course' : 'gold';
    } catch {
      return 'gold';
    }
  });
  const [nowDate, setNowDate] = useState(() => new Date());
  const [inspectBlock, setInspectBlock] = useState(null);

  // Tick every 60s so Live Now / Up Next / red time indicator line stays current
  useEffect(() => {
    const id = setInterval(() => setNowDate(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const setView = next => {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setPalette = next => {
    setPaletteMode(next);
    try {
      localStorage.setItem(PALETTE_KEY, next);
    } catch {
      // ignore
    }
  };

  const entries = useMemo(
    () => resolveScheduleEntries(courses, scheduleRows),
    [courses, scheduleRows]
  );

  const grid = useMemo(() => computeTimetableGrid(entries), [entries]);
  const { conflicts, layoutByKey } = useMemo(
    () => detectScheduleConflicts(entries),
    [entries]
  );
  const studyLoad = useMemo(
    () => buildStudyLoadSummary(courses, entries),
    [courses, entries]
  );
  const nowState = useMemo(
    () => getNowAndNextClass(entries, nowDate),
    [entries, nowDate]
  );

  const entriesByDay = useMemo(() => {
    const map = new Map();
    for (const d of grid.visibleDays) map.set(d.idx, []);
    for (const e of entries) {
      if (!map.has(e.dayOfWeek)) map.set(e.dayOfWeek, []);
      map.get(e.dayOfWeek).push(e);
    }
    return map;
  }, [entries, grid.visibleDays]);

  const showNowLine =
    nowState.nowMinutes >= grid.gridStartMin && nowState.nowMinutes <= grid.gridEndMin;
  const nowLineTop = ((nowState.nowMinutes - grid.gridStartMin) / 30) * SLOT_HEIGHT;
  const totalGridHeight = grid.slots.length * SLOT_HEIGHT;

  return (
    <div className="schedule-section-wrap">
      {/* 1. Live Now / Up Next Hero Card */}
      <div className={`schedule-now-card${nowState.currentClass ? ' is-live' : ''}`}>
        {nowState.currentClass ? (
          <>
            <div className="schedule-now-eyebrow">
              <span className="live-pulse-dot" />
              <span>IN CLASS NOW · {nowState.minutesRemainingCurrent}m left</span>
            </div>
            <div className="schedule-now-title">
              {nowState.currentClass.code}{' '}
              <span className="schedule-kind-tag">{nowState.currentClass.kind}</span>
            </div>
            <div className="schedule-now-meta">
              <span>
                <Clock size={12} />{' '}
                {formatTimeRange12h(nowState.currentClass.startTime, nowState.currentClass.endTime)}
              </span>
              {nowState.currentClass.room && (
                <span>
                  <MapPin size={12} /> {nowState.currentClass.room}
                </span>
              )}
              {nowState.currentClass.instructor && (
                <span>
                  <User size={12} /> {nowState.currentClass.instructor}
                </span>
              )}
            </div>
          </>
        ) : nowState.nextClass ? (
          <>
            <div className="schedule-now-eyebrow">
              <Sparkles size={12} />
              <span>UP NEXT IN {nowState.minutesUntilNext} MIN</span>
            </div>
            <div className="schedule-now-title">
              {nowState.nextClass.code}{' '}
              <span className="schedule-kind-tag">{nowState.nextClass.kind}</span>
            </div>
            <div className="schedule-now-meta">
              <span>
                <Clock size={12} />{' '}
                {formatTimeRange12h(nowState.nextClass.startTime, nowState.nextClass.endTime)}
              </span>
              {nowState.nextClass.room && (
                <span>
                  <MapPin size={12} /> {nowState.nextClass.room}
                </span>
              )}
              {nowState.nextClass.instructor && (
                <span>
                  <User size={12} /> {nowState.nextClass.instructor}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap' }}>
            <div>
              <div className="schedule-now-eyebrow">
                <Calendar size={12} />
                <span>
                  {entries.length > 0
                    ? `${SCHEDULE_DAYS.find(d => d.idx === nowState.todayDow)?.short || 'Today'} · Done for today`
                    : 'Weekly Timetable & Study Load'}
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                {entries.length > 0
                  ? `${studyLoad.items.length} subjects · ${studyLoad.totalUnits} units · ${studyLoad.totalWeeklyHours} hrs/wk`
                  : 'Add class days, times, rooms & teachers to your courses'}
              </div>
            </div>
            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              {onImportSchedulePdf && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onImportSchedulePdf}
                >
                  Import Schedule PDF
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onAddCourseSchedule}
              >
                <Plus size={13} /> Add Schedule
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. View Switch (Grid | Study Load) + Palette Switch (Studio Gold | Course Colors) */}
      <div className="schedule-controls-row">
        <div className="view-switcher view-switcher-inline" style={{ margin: 0, flex: '1 1 180px' }}>
          <button
            type="button"
            className={`view-switch-btn${viewMode === 'grid' ? ' active' : ''}`}
            onClick={() => setView('grid')}
          >
            <Calendar size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            Timetable Grid
          </button>
          <button
            type="button"
            className={`view-switch-btn${viewMode === 'load' ? ' active' : ''}`}
            onClick={() => setView('load')}
          >
            <ListChecks size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            Study Load ({studyLoad.items.length})
          </button>
        </div>

        {viewMode === 'grid' && (
          <div className="flex items-center gap-6">
            {onImportSchedulePdf && entries.length > 0 && (
              <button
                type="button"
                className="row-action-chip"
                onClick={onImportSchedulePdf}
                title="Import or update timetable from Class Schedule PDF"
              >
                Import PDF
              </button>
            )}
            <div className="feynman-lang-switch" role="group" aria-label="Timetable color style">
            <button
              type="button"
              className={`feynman-lang-btn${paletteMode === 'gold' ? ' active' : ''}`}
              onClick={() => setPalette('gold')}
            >
              Studio Gold
            </button>
            <button
              type="button"
              className={`feynman-lang-btn${paletteMode === 'course' ? ' active' : ''}`}
              onClick={() => setPalette('course')}
            >
              Course Colors
            </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Conflict Alert (if any overlapping classes exist) */}
      {conflicts.length > 0 && (
        <div className="sticky-alert-banner" style={{ margin: '0 0 10px' }}>
          <div className="flex items-center gap-6" style={{ fontSize: 12.5, fontWeight: 700, color: '#ff375f' }}>
            <AlertTriangle size={14} /> Schedule Overlap Detected ({conflicts.length})
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
            {conflicts
              .slice(0, 2)
              .map(
                c =>
                  `${c.dayLabel}: ${c.first.code} (${formatTime12h(c.first.startTime)}) overlaps ${c.second.code}`
              )
              .join(' · ')}
          </div>
        </div>
      )}

      {/* 4. Empty Prompt if no schedule rows yet */}
      {entries.length === 0 ? (
        <div className="list-group settings-group" style={{ margin: 0, textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6 }}>No Class Schedules Yet</div>
          <p className="settings-help" style={{ maxWidth: 360, margin: '0 auto 14px' }}>
            Edit any course card or tap Add Schedule above to assign meeting days (MWF / TTh),
            class times, room numbers, and teachers — it renders automatically onto the weekly grid.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAddCourseSchedule}>
            <Plus size={14} /> Set Course Days &amp; Rooms
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <>
          {/* ============ AESTHETIC 30-MIN VISUAL TIMETABLE GRID ============ */}
          <div className={`timetable-board palette-${paletteMode}`}>
            <div className="timetable-scroll">
              <div
                className="timetable-canvas"
                style={{ minWidth: Math.max(586, 56 + grid.visibleDays.length * 112) }}
              >
                {/* Header Row: Time | Mon | Tue | Wed | Thu | Fri */}
                <div
                  className="timetable-header-row"
                  style={{
                    gridTemplateColumns: `56px repeat(${grid.visibleDays.length}, minmax(106px, 1fr))`,
                  }}
                >
                  <div className="timetable-head-cell is-time-col">Time</div>
                  {grid.visibleDays.map(d => (
                    <div
                      key={d.idx}
                      className={`timetable-head-cell${d.idx === nowState.todayDow ? ' is-today' : ''}`}
                    >
                      {d.short}
                    </div>
                  ))}
                </div>

                {/* Body Grid: Sticky Time Axis + Proportional Day Columns */}
                <div
                  className="timetable-body"
                  style={{
                    gridTemplateColumns: `56px repeat(${grid.visibleDays.length}, minmax(106px, 1fr))`,
                    height: totalGridHeight,
                  }}
                >
                  {/* Sticky Left Time Labels (every 30 mins) */}
                  <div className="timetable-time-col" style={{ height: totalGridHeight }}>
                    {grid.slots.map(slot => (
                      <div
                        key={slot.minutes}
                        className={`timetable-time-cell${slot.isFullHour ? ' is-hour' : ' is-half'}`}
                        style={{ height: SLOT_HEIGHT }}
                      >
                        <span>{slot.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Weekday Columns + Absolutely Positioned Class Blocks */}
                  {grid.visibleDays.map(d => {
                    const dayList = entriesByDay.get(d.idx) || [];
                    const isToday = d.idx === nowState.todayDow;
                    return (
                      <div
                        key={d.idx}
                        className={`timetable-day-col${isToday ? ' is-today' : ''}`}
                        style={{ height: totalGridHeight }}
                      >
                        {/* Horizontal 30-min guide lines */}
                        {grid.slots.map(slot => (
                          <div
                            key={slot.minutes}
                            className={`timetable-grid-slot${slot.isFullHour ? ' is-hour' : ' is-half'}`}
                            style={{ height: SLOT_HEIGHT }}
                          />
                        ))}

                        {/* Current Time Line across today's column */}
                        {isToday && showNowLine && (
                          <div
                            className="timetable-now-line"
                            style={{ top: nowLineTop }}
                            aria-hidden="true"
                          >
                            <span className="live-pulse-dot" />
                          </div>
                        )}

                        {/* Scheduled Class Blocks */}
                        {dayList.map((block, bIdx) => {
                          const top = ((block.startMin - grid.gridStartMin) / 30) * SLOT_HEIGHT + 2;
                          const height = Math.max(
                            28,
                            (block.durationMin / 30) * SLOT_HEIGHT - 4
                          );
                          const lane = layoutByKey.get(block);
                          const isSplitLane = Boolean(lane && lane.cols > 1);
                          const widthPct = lane ? 100 / lane.cols : 100;
                          const leftPct = lane ? lane.col * widthPct : 0;
                          const isLiveNow = nowState.currentClass?.id === block.id;
                          const compactBlock = height < 62;

                          const blockStyle =
                            paletteMode === 'course'
                              ? {
                                  top,
                                  height,
                                  left: `calc(${leftPct}% + 3px)`,
                                  width: `calc(${widthPct}% - 6px)`,
                                  background: hexToSoftTint(block.color, 0.2),
                                  borderLeftColor: block.color,
                                  '--stagger-idx': bIdx,
                                }
                              : {
                                  top,
                                  height,
                                  left: `calc(${leftPct}% + 3px)`,
                                  width: `calc(${widthPct}% - 6px)`,
                                  '--stagger-idx': bIdx,
                                };

                          return (
                            <button
                              key={`${block.id || block.code}-${block.dayOfWeek}-${block.startMin}`}
                              type="button"
                              className={`timetable-block${paletteMode === 'course' ? ' is-course-tinted' : ''}${isLiveNow ? ' is-live' : ''}`}
                              style={blockStyle}
                              onClick={() => setInspectBlock(block)}
                            >
                              <div className="timetable-block-head">
                                <span className="timetable-block-code">{block.code}</span>
                                {!compactBlock && !isSplitLane && block.kind === 'LAB' && (
                                  <span className="timetable-block-badge">LAB</span>
                                )}
                              </div>
                              <div className="timetable-block-time">
                                {formatTimeRange12h(block.startTime, block.endTime)}
                              </div>
                              {!compactBlock && (block.room || block.instructor) && (
                                <div className="timetable-block-meta">
                                  {block.room && <span>{block.room}</span>}
                                  {block.room && block.instructor && <span> · </span>}
                                  {block.instructor && <span>{block.instructor}</span>}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Compact Teachers & Rooms Directory Strip below Grid */}
          <div className="schedule-directory-strip">
            <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
              <span className="settings-label" style={{ margin: 0 }}>
                Subjects, Teachers &amp; Rooms ({studyLoad.items.length})
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-ink)' }}>
                {studyLoad.totalUnits} units · {studyLoad.totalWeeklyHours} hrs/wk
              </span>
            </div>
            <div className="schedule-mini-roster">
              {studyLoad.items.map(item => {
                const schedSummary = item.meetings
                  .map(
                    m =>
                      `${groupDaysLabel(m.days)} ${formatTimeRange12h(m.startTime, m.endTime)}${m.room ? ` (${m.room})` : ''}`
                  )
                  .join(' · ');
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="schedule-roster-chip"
                    onClick={() => (item.course ? onOpenCourse?.(item.course) : null)}
                  >
                    <span className="schedule-roster-dot" style={{ background: item.color }} />
                    <div style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                        {item.code}
                        {item.instructor ? ` · ${item.instructor}` : ''}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {schedSummary || 'No schedule set — tap Edit'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* ============ DETAILED STUDY LOAD VIEW (Code · Days · Time · Room · Teacher · Units) ============ */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {studyLoad.items.map(item => (
            <div key={item.key} className="study-load-card">
              <div className="flex items-start justify-between gap-8">
                <div className="flex items-center gap-8" style={{ minWidth: 0 }}>
                  <span
                    className="schedule-roster-dot"
                    style={{ background: item.color, width: 10, height: 28, borderRadius: 4 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text)' }}>
                        {item.code}
                      </span>
                      <span className="mode-badge mode-study" style={{ fontSize: 10.5 }}>
                        {item.units} units
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {item.title}
                    </div>
                  </div>
                </div>
                {item.course && (
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => onEditCourse?.(item.course)}
                      title="Edit schedule & room"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                    <button
                      type="button"
                      className="row-action-chip active-chip"
                      onClick={() => onOpenCourse?.(item.course)}
                    >
                      <BookOpen size={11} /> Open
                    </button>
                  </div>
                )}
              </div>

              <div className="study-load-meta-row">
                <span>
                  <User size={12} /> {item.instructor || 'No teacher set'}
                </span>
                <span>
                  <MapPin size={12} /> {item.rooms.length > 0 ? item.rooms.join(', ') : 'No room set'}
                </span>
              </div>

              {item.meetings.length > 0 ? (
                <div className="study-load-meetings">
                  {item.meetings.map((m, idx) => (
                    <div key={idx} className="study-load-slot">
                      <span className="schedule-kind-tag">{m.kind}</span>
                      <strong>{groupDaysLabel(m.days)}</strong>
                      <span>{formatTimeRange12h(m.startTime, m.endTime)}</span>
                      {m.room && <span style={{ color: 'var(--text-secondary)' }}>· {m.room}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  No days or time assigned yet — tap Edit to add meetings.
                </div>
              )}
            </div>
          ))}

          {/* Study Load Footer Totals */}
          <div className="study-load-totals">
            <div>
              <div className="pattern-mini-label">Subjects</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{studyLoad.items.length}</div>
            </div>
            <div>
              <div className="pattern-mini-label">Total Units</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{studyLoad.totalUnits}</div>
            </div>
            <div>
              <div className="pattern-mini-label">Weekly Class Time</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{studyLoad.totalWeeklyHours} hrs</div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Quick Block Inspector Sheet (when user taps any timetable block) */}
      {inspectBlock && (
        <div
          className="export-overlay"
          onClick={() => setInspectBlock(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
              <div className="flex items-center gap-8">
                <span
                  className="course-code-pill"
                  style={{ background: inspectBlock.color || '#f59e0b' }}
                >
                  {inspectBlock.code}
                </span>
                <span className="schedule-kind-tag">{inspectBlock.kind}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close details"
                onClick={() => setInspectBlock(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>
              {inspectBlock.title}
            </div>

            <div className="list-group settings-group" style={{ margin: '12px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                <div className="flex items-center gap-8">
                  <Calendar size={14} style={{ color: 'var(--accent-ink)' }} />
                  <span>
                    {SCHEDULE_DAYS.find(d => d.idx === inspectBlock.dayOfWeek)?.short} ·{' '}
                    {formatTimeRange12h(inspectBlock.startTime, inspectBlock.endTime)}
                  </span>
                </div>
                <div className="flex items-center gap-8">
                  <MapPin size={14} style={{ color: 'var(--accent-ink)' }} />
                  <span>Room: {inspectBlock.room || 'Not set'}</span>
                </div>
                <div className="flex items-center gap-8">
                  <User size={14} style={{ color: 'var(--accent-ink)' }} />
                  <span>Teacher: {inspectBlock.instructor || 'Not set'}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              {inspectBlock.course && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const c = inspectBlock.course;
                      setInspectBlock(null);
                      onOpenCourse?.(c);
                    }}
                  >
                    <BookOpen size={14} /> Open Course
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const c = inspectBlock.course;
                      setInspectBlock(null);
                      onEditCourse?.(c);
                    }}
                  >
                    <Pencil size={14} /> Edit Schedule
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
