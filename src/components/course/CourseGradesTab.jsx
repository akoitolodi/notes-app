/**
 * CourseGradesTab — Per-Course Grades, Syllabus Weights, Canvas "What-If" Grade Simulator,
 * and Pre-Submit AI Rubric Checker.
 */
import { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  RotateCcw,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
} from 'lucide-react';
import { db } from '../../store/db';
import {
  DEFAULT_COURSE_WEIGHTS,
  computeCourseGrade,
  evaluateAgainstRubric,
} from '../../lib/courseExtras';
import MarkdownContent from '../ui/MarkdownContent';
import { useDialog } from '../ui/DialogProvider';

export default function CourseGradesTab({ course, assignments = [], onUpdated }) {
  const { toast } = useDialog();
  const weights = Array.isArray(course?.weights) && course.weights.length > 0
    ? course.weights
    : DEFAULT_COURSE_WEIGHTS;
  const manualEntries = Array.isArray(course?.gradeEntries) ? course.gradeEntries : [];
  const units = Number(course?.units) || 3;

  const [whatIfOn, setWhatIfOn] = useState(false);
  const [whatIfMap, setWhatIfMap] = useState({});
  const [weightsOpen, setWeightsOpen] = useState(false);

  // Add manual grade item
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState(weights[0]?.id || 'quizzes');
  const [newEarned, setNewEarned] = useState('');
  const [newPossible, setNewPossible] = useState('100');

  // Pre-Submit AI Rubric Checker
  const [rubricTitle, setRubricTitle] = useState('');
  const [rubricText, setRubricText] = useState('');
  const [draftText, setDraftText] = useState('');
  const [rubricBusy, setRubricBusy] = useState(false);
  const [rubricReport, setRubricReport] = useState('');

  // Combine synced Course Assignments (that have scores or are in What-If mode) + manual course grades
  const combinedEntries = useMemo(() => {
    const fromTasks = assignments.map(a => ({
      id: `task:${a.id}`,
      rawTaskId: a.id,
      name: a.title,
      categoryId: a.gradeCategoryId || weights[0]?.id || 'quizzes',
      earned: a.scoreEarned ?? '',
      possible: a.scorePossible ?? 100,
      source: 'assignment',
    }));
    const fromManual = manualEntries.map(m => ({
      ...m,
      source: 'manual',
    }));
    return [...fromManual, ...fromTasks];
  }, [assignments, manualEntries, weights]);

  const gradeStats = useMemo(
    () =>
      computeCourseGrade({
        weights,
        entries: combinedEntries,
        whatIfMap: whatIfOn ? whatIfMap : {},
      }),
    [weights, combinedEntries, whatIfOn, whatIfMap]
  );

  const hasWhatIfEdits = whatIfOn && Object.values(whatIfMap).some(v => v !== '' && v !== undefined);

  const saveWeights = async nextWeights => {
    await db.courses.update(course.id, { weights: nextWeights });
    onUpdated?.();
  };

  const handleAddManualGrade = async e => {
    e?.preventDefault?.();
    if (!newName.trim()) {
      toast('Enter a grade item name', { type: 'error' });
      return;
    }
    const nextEntry = {
      id: `manual:${Date.now()}`,
      name: newName.trim(),
      categoryId: newCat || weights[0]?.id || 'quizzes',
      earned: newEarned === '' ? '' : Number(newEarned),
      possible: Math.max(1, Number(newPossible) || 100),
    };
    await db.courses.update(course.id, { gradeEntries: [...manualEntries, nextEntry] });
    setNewName('');
    setNewEarned('');
    setNewPossible('100');
    setAddOpen(false);
    onUpdated?.();
    toast('Score added to Course Grades', { type: 'success' });
  };

  const handleUpdateScore = async (entry, earnedStr, possibleStr) => {
    const earnedVal = earnedStr === '' ? '' : Number(earnedStr);
    const possibleVal = Math.max(1, Number(possibleStr) || 100);
    if (entry.source === 'assignment' && entry.rawTaskId) {
      await db.plannerItems.update(entry.rawTaskId, {
        scoreEarned: earnedVal,
        scorePossible: possibleVal,
        workflowStatus: earnedVal !== '' ? 'graded' : undefined,
        done: earnedVal !== '' ? true : undefined,
        updatedAt: Date.now(),
      });
    } else {
      const next = manualEntries.map(m =>
        m.id === entry.id ? { ...m, earned: earnedVal, possible: possibleVal } : m
      );
      await db.courses.update(course.id, { gradeEntries: next });
    }
    onUpdated?.();
  };

  const handleUpdateCategory = async (entry, catId) => {
    if (entry.source === 'assignment' && entry.rawTaskId) {
      await db.plannerItems.update(entry.rawTaskId, { gradeCategoryId: catId });
    } else {
      const next = manualEntries.map(m => (m.id === entry.id ? { ...m, categoryId: catId } : m));
      await db.courses.update(course.id, { gradeEntries: next });
    }
    onUpdated?.();
  };

  const handleDeleteManual = async id => {
    await db.courses.update(course.id, { gradeEntries: manualEntries.filter(m => m.id !== id) });
    onUpdated?.();
  };

  const handleCheckRubric = async () => {
    if (rubricBusy) return;
    setRubricBusy(true);
    setRubricReport('');
    try {
      const res = await evaluateAgainstRubric({
        courseName: course.nickname || course.name,
        assignmentTitle: rubricTitle.trim() || 'Draft Submission',
        rubricText,
        draftText,
      });
      setRubricReport(res);
    } catch (err) {
      toast(`Rubric check failed: ${err.message}`, { type: 'error' });
    } finally {
      setRubricBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Live Course Standing Card */}
      <div className="list-group settings-group" style={{ marginTop: 4 }}>
        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
          <span className="settings-label" style={{ margin: 0 }}>
            {hasWhatIfEdits ? 'What-If Simulated Standing' : 'Course Standing'}
          </span>
          <div className="flex gap-6">
            <button
              type="button"
              className={`row-action-chip${whatIfOn ? ' active-chip' : ''}`}
              onClick={() => setWhatIfOn(v => !v)}
            >
              What-If Mode {whatIfOn ? 'ON' : 'OFF'}
            </button>
            {hasWhatIfEdits && (
              <button
                type="button"
                className="row-action-chip"
                onClick={() => setWhatIfMap({})}
                title="Reset What-If scores"
              >
                <RotateCcw size={12} /> Reset
              </button>
            )}
          </div>
        </div>

        <div className="grade-stats-grid">
          <div className="grade-stat-card">
            <div className="grade-stat-label">Grade</div>
            <div className="grade-stat-val">
              {gradeStats.standing !== null ? `${gradeStats.standing}%` : '—'}
            </div>
          </div>
          <div className="grade-stat-card">
            <div className="grade-stat-label">PH GWA</div>
            <div className="grade-stat-val">
              {gradeStats.phGwa !== null ? gradeStats.phGwa.toFixed(2) : '—'}
            </div>
          </div>
          <div className="grade-stat-card">
            <div className="grade-stat-label">US GPA</div>
            <div className="grade-stat-val">
              {gradeStats.usGpa !== null ? gradeStats.usGpa.toFixed(2) : '—'}
            </div>
          </div>
        </div>

        {whatIfOn && (
          <div className="grade-target-banner" style={{ marginBottom: 8 }}>
            <strong>Canvas What-If Simulator Active:</strong> Type test scores below to preview how upcoming exams or
            projects change your standing — your real saved scores stay untouched!
          </div>
        )}

        {/* Syllabus Weights Toggle */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ paddingLeft: 0 }}
          onClick={() => setWeightsOpen(v => !v)}
        >
          <SlidersHorizontal size={13} />
          <span>Syllabus Weights &amp; Units ({units} units)</span>
          {weightsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {weightsOpen && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--divider)' }}>
            <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
              <span className="settings-help" style={{ margin: 0 }}>Course Units (for Semester GWA):</span>
              <input
                type="number"
                min="1"
                max="10"
                className="input-field"
                style={{ width: 72, padding: '5px 8px' }}
                value={units}
                onChange={async e => {
                  await db.courses.update(course.id, { units: Math.max(1, Number(e.target.value) || 3) });
                  onUpdated?.();
                }}
              />
            </div>
            {weights.map((w, idx) => (
              <div key={w.id || idx} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr auto', gap: 6, marginBottom: 6 }}>
                <input
                  className="input-field"
                  value={w.name}
                  onChange={e =>
                    saveWeights(weights.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <input
                  type="number"
                  className="input-field"
                  placeholder="Wt %"
                  value={w.weight}
                  onChange={e =>
                    saveWeights(weights.map((x, i) => (i === idx ? { ...x, weight: Number(e.target.value) || 0 } : x)))
                  }
                />
                <button
                  type="button"
                  className="row-icon-btn"
                  aria-label="Remove category"
                  onClick={() => saveWeights(weights.filter((_, i) => i !== idx))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                saveWeights([...weights, { id: `cat_${Date.now()}`, name: 'Project', weight: 10 }])
              }
            >
              <Plus size={13} /> Add Category
            </button>
          </div>
        )}
      </div>

      {/* Recorded Scores & What-If Rows */}
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', paddingRight: 16 }}>
        <span>Scores ({combinedEntries.length})</span>
        <button type="button" className="row-action-chip" onClick={() => setAddOpen(v => !v)}>
          <Plus size={12} /> Add Score
        </button>
      </div>

      {addOpen && (
        <form className="list-group settings-group" onSubmit={handleAddManualGrade}>
          <input
            className="input-field"
            placeholder="Item name (e.g. Quiz 1, Midterm Exam)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.8fr 0.8fr', gap: 6, marginTop: 8 }}>
            <select
              className="input-field"
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              aria-label="Grade category"
            >
              {weights.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.weight}%)
                </option>
              ))}
            </select>
            <input
              type="number"
              className="input-field"
              placeholder="Score"
              value={newEarned}
              onChange={e => setNewEarned(e.target.value)}
            />
            <input
              type="number"
              className="input-field"
              placeholder="Out of"
              value={newPossible}
              onChange={e => setNewPossible(e.target.value)}
            />
          </div>
          <div className="flex gap-8 mt-10">
            <button type="submit" className="btn btn-primary btn-sm">
              Save Score
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="list-group">
        {combinedEntries.length === 0 ? (
          <div className="list-item list-item-static">
            <span className="list-item-subtitle">
              No scores yet — tap &ldquo;+ Add Score&rdquo; or sync Canvas assignments to start tracking your grade!
            </span>
          </div>
        ) : (
          combinedEntries.map(entry => {
            const valShown = whatIfOn && whatIfMap[entry.id] !== undefined ? whatIfMap[entry.id] : entry.earned;
            return (
              <div key={entry.id} className="list-item list-item-static" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="flex items-center justify-between gap-8">
                  <strong style={{ fontSize: 13.5 }}>{entry.name}</strong>
                  {entry.source === 'manual' && (
                    <button
                      type="button"
                      className="row-icon-btn"
                      aria-label="Delete grade entry"
                      onClick={() => handleDeleteManual(entry.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr auto 0.7fr', gap: 6, alignItems: 'center' }}>
                  <select
                    className="input-field"
                    style={{ padding: '6px 8px', fontSize: 12 }}
                    value={entry.categoryId}
                    onChange={e => handleUpdateCategory(entry, e.target.value)}
                  >
                    {weights.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="input-field"
                    style={{
                      padding: '6px 8px',
                      fontSize: 13,
                      borderColor: whatIfOn && whatIfMap[entry.id] !== undefined ? 'var(--accent)' : undefined,
                    }}
                    placeholder={whatIfOn ? 'What-If' : 'Score'}
                    value={valShown}
                    onChange={e => {
                      const v = e.target.value;
                      if (whatIfOn) {
                        setWhatIfMap(prev => ({ ...prev, [entry.id]: v }));
                      } else {
                        handleUpdateScore(entry, v, entry.possible);
                      }
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>/</span>
                  <input
                    type="number"
                    className="input-field"
                    style={{ padding: '6px 8px', fontSize: 13 }}
                    value={entry.possible}
                    disabled={whatIfOn}
                    onChange={e => handleUpdateScore(entry, entry.earned, e.target.value)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pre-Submit AI Rubric Checker */}
      <div className="section-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ClipboardCheck size={13} /> Pre-Submit AI Rubric Checker
      </div>
      <div className="list-group settings-group">
        <p className="settings-help" style={{ marginTop: 0 }}>
          Check your essay, lab report, or code against your teacher&apos;s Canvas rubric <strong>before</strong> you
          submit!
        </p>
        <input
          className="input-field"
          placeholder="Assignment title (optional)"
          value={rubricTitle}
          onChange={e => setRubricTitle(e.target.value)}
        />
        <textarea
          className="input-field mt-8"
          rows={3}
          placeholder="Paste teacher's assignment prompt / rubric criteria…"
          value={rubricText}
          onChange={e => setRubricText(e.target.value)}
        />
        <textarea
          className="input-field mt-8"
          rows={4}
          placeholder="Paste your draft answer / essay / code here…"
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm mt-10"
          disabled={rubricBusy || !rubricText.trim() || !draftText.trim()}
          onClick={handleCheckRubric}
        >
          <Sparkles size={14} /> {rubricBusy ? 'Checking Rubric…' : 'Pre-Grade My Draft'}
        </button>

        {rubricReport && (
          <div className="explanation-card" style={{ marginTop: 12, marginBottom: 0 }}>
            <MarkdownContent text={rubricReport} />
          </div>
        )}
      </div>
    </div>
  );
}
