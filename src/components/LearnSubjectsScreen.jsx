/**
 * LearnSubjectsScreen — Dynamic Open-Source Subject Studio ("Learn Subjects").
 * Features MS 102 Quantitative Methods (with interactive Decision Matrix/EMV, 2-Var LP,
 * PERT/CPM Critical Path, and EOQ calculators) plus dynamic Wikibooks/Wikipedia/OpenAlex
 * curriculum generation for any subject you add!
 */
import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  BookOpen,
  Calculator,
  Sparkles,
  FilePlus2,
  RefreshCw,
  Plus,
  CheckCircle2,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import {
  getAllSubjects,
  addCustomSubject,
  removeCustomSubject,
  getSubjectProgress,
  markSubjectTopicDone,
  fetchOpenSourceModule,
} from '../lib/subjectCatalog';
import {
  solveDecisionTable,
  solveLinearProgramming2D,
  solvePertCpm,
  solveEoqInventory,
} from '../lib/quantMethods';
import { cleanAiOutputText } from '../lib/cleanAiText';
import { aiText } from '../lib/aiCore';
import { db, createFolder, createNote } from '../store/db';
import { useDialog } from './ui/DialogProvider';

const CATEGORIES = ['All', 'Business & Math', 'IT & Systems', 'Custom Track'];

export default function LearnSubjectsScreen({ onBack, onOpenNote }) {
  const { toast } = useDialog();
  const [subjects, setSubjects] = useState(() => getAllSubjects());
  const [category, setCategory] = useState('All');
  const [selectedId, setSelectedId] = useState(null);
  const [topicIdx, setTopicIdx] = useState(0);
  const [tab, setTab] = useState('lessons'); // lessons | lab
  const [progress, setProgress] = useState(() => getSubjectProgress());

  // Dynamic Custom Subject Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newTopics, setNewTopics] = useState('');

  // Open-source Lesson state
  const [lessonDoc, setLessonDoc] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [aiDigest, setAiDigest] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  // MS 102 Quant Lab states
  const [quantTool, setQuantTool] = useState('decision'); // decision | lp | pert | eoq
  const [decMatrixText, setDecMatrixText] = useState(
    'Large Plant: 200000, -180000\nSmall Plant: 100000, -20000\nDo Nothing: 0, 0'
  );
  const [decProbsText, setDecProbsText] = useState('0.5, 0.5');

  const [lpType, setLpType] = useState('max');
  const [lpC1, setLpC1] = useState('40');
  const [lpC2, setLpC2] = useState('30');
  const [lpConsText, setLpConsText] = useState('2x + 1y <= 100\n1x + 1y <= 80');

  const [pertText, setPertText] = useState('A: 3, -\nB: 4, A\nC: 2, A\nD: 5, B C');

  const [eoqD, setEoqD] = useState('1200');
  const [eoqS, setEoqS] = useState('50');
  const [eoqH, setEoqH] = useState('3');
  const [eoqLead, setEoqLead] = useState('5');

  const subject = subjects.find(s => s.id === selectedId) || null;
  const activeTopic = subject ? subject.topics[topicIdx] || subject.topics[0] : null;

  const loadModule = async (subj, topic, forceRefresh = false) => {
    setLessonLoading(true);
    setAiDigest('');
    try {
      const data = await fetchOpenSourceModule(subj, topic, { forceRefresh });
      setLessonDoc(data);
      if (forceRefresh) toast('Refreshed open-source module', { type: 'success' });
    } catch (err) {
      toast(err.message || 'Could not load lesson', { type: 'error' });
    } finally {
      setLessonLoading(false);
    }
  };

  const openSubject = subj => {
    setSelectedId(subj.id);
    setTopicIdx(0);
    setTab('lessons');
    const first = subj.topics[0];
    if (first) loadModule(subj, first, false);
  };

  const handleSelectTopic = idx => {
    setTopicIdx(idx);
    const t = subject.topics[idx];
    if (t) {
      loadModule(subject, t, false);
      if (t.labId) setQuantTool(t.labId);
    }
  };

  const handleCreateCustomSubject = e => {
    e.preventDefault();
    try {
      const created = addCustomSubject({ code: newCode, name: newName, topics: newTopics });
      setSubjects(getAllSubjects());
      setNewCode('');
      setNewName('');
      setNewTopics('');
      setShowAddForm(false);
      openSubject(created);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  };

  const handleDeleteCustom = (id, e) => {
    e.stopPropagation();
    removeCustomSubject(id);
    setSubjects(getAllSubjects());
    toast('Removed custom subject');
  };

  const handleAiDigest = async () => {
    if (!subject || !activeTopic || aiBusy) return;
    setAiBusy(true);
    try {
      const sourceText = (lessonDoc?.sections || [])
        .map(s => `${s.heading}\n${s.body}`)
        .join('\n\n')
        .slice(0, 3500);
      const reply = await aiText({
        system:
          'You are a crystal-clear tutor. Write a structured student study guide with simple numbered steps, plain formulas, and 1 concrete worked example. Use plain text only — NO asterisks (*), NO hashtags (#), NO LaTeX $ symbols.',
        user: `Subject: ${subject.code} - ${subject.name}\nTopic: ${activeTopic.title}\nReference material:\n${sourceText}`,
        maxTokens: 900,
        timeoutMs: 45000,
      });
      setAiDigest(cleanAiOutputText(reply));
    } catch (err) {
      toast(`AI summary failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveTopicToNotes = async () => {
    if (!subject || !activeTopic) return;
    const folders = await db.folders.toArray();
    let target = folders.find(f => !f.locked && f.name.toLowerCase() === subject.code.toLowerCase());
    if (!target) {
      const fid = await createFolder(subject.code || subject.name, { mode: 'study', locked: false });
      target = await db.folders.get(fid);
    }
    const sectionsText = (lessonDoc?.sections || [])
      .map(s => `${s.heading}\n${s.body}`)
      .join('\n\n');
    const body = [
      aiDigest ? `AI Study Guide\n${aiDigest}` : '',
      sectionsText,
    ]
      .filter(Boolean)
      .join('\n\n');
    const created = await createNote(
      target?.id ?? null,
      `${subject.code}: ${activeTopic.title}`,
      cleanAiOutputText(body),
      subject.name
    );
    toast('Saved lesson to Notes!', { type: 'success' });
    onOpenNote?.(created, target || { id: '__all__', name: 'All Notes' });
  };

  // Quant Lab computations
  const decisionRes = useMemo(() => {
    try {
      const alts = decMatrixText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
          const [namePart, valsPart] = line.includes(':') ? line.split(':') : ['Alt', line];
          const payoffs = String(valsPart || '')
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
          return { name: namePart.trim(), payoffs };
        });
      const probs = decProbsText
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      return { ok: true, data: solveDecisionTable(alts, ['Favorable', 'Unfavorable', 'Neutral'], probs) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [decMatrixText, decProbsText]);

  const lpRes = useMemo(() => {
    try {
      const constraints = lpConsText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
          const m = /^(-?\d+(?:\.\d+)?)\s*x\s*([+-]\s*\d+(?:\.\d+)?)\s*y\s*(<=|>=|=)\s*(-?\d+(?:\.\d+)?)$/i.exec(
            line.replace(/\s+/g, ' ')
          );
          if (!m) throw new Error(`Format constraint like "2x + 1y <= 100" (got "${line}")`);
          return {
            a1: parseFloat(m[1]),
            a2: parseFloat(m[2].replace(/\s+/g, '')),
            op: m[3],
            b: parseFloat(m[4]),
          };
        });
      return {
        ok: true,
        data: solveLinearProgramming2D({ objectiveType: lpType, c1: lpC1, c2: lpC2, constraints }),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [lpType, lpC1, lpC2, lpConsText]);

  const pertRes = useMemo(() => {
    try {
      const tasks = pertText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
          const [idPart, rest] = line.split(':');
          const segs = String(rest || '').split(',');
          const dur = parseFloat(segs[0]);
          const preds = (segs[1] || '').trim();
          return { id: idPart.trim(), duration: dur, predecessors: preds };
        });
      return { ok: true, data: solvePertCpm(tasks) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [pertText]);

  const eoqRes = useMemo(() => {
    try {
      return {
        ok: true,
        data: solveEoqInventory({
          demandD: eoqD,
          orderingCostS: eoqS,
          holdingCostH: eoqH,
          leadTimeDays: eoqLead,
        }),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [eoqD, eoqS, eoqH, eoqLead]);

  const visibleSubjects = subjects.filter(s => category === 'All' || s.category === category);

  return (
    <div className="screen">
      <header className="navbar">
        <button
          type="button"
          className="navbar-btn navbar-back"
          onClick={() => (subject ? setSelectedId(null) : onBack())}
        >
          <ChevronLeft size={20} /> {subject ? 'Subjects' : 'Folders'}
        </button>
        <span className="navbar-title">{subject ? subject.code : 'Learn Subjects'}</span>
        <span style={{ width: 54 }} />
      </header>

      <div className="large-title">{subject ? subject.name : 'Learn Subjects'}</div>

      {/* Catalog View */}
      {!subject && (
        <div className="editor">
          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="mode-picker-row">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`mode-pick-chip${category === c ? ' active' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(v => !v)}
            >
              <Plus size={14} /> Add Subject
            </button>
          </div>

          {showAddForm && (
            <form className="explanation-card" style={{ marginBottom: 12 }} onSubmit={handleCreateCustomSubject}>
              <div className="settings-label">Generate Dynamic Open-Source Track</div>
              <div className="flex gap-8" style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  className="input-field"
                  style={{ width: 100, margin: 0 }}
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  placeholder="Code (IT 210)"
                />
                <input
                  type="text"
                  className="input-field flex-1"
                  style={{ margin: 0 }}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Subject Name (e.g. Information Assurance)"
                />
              </div>
              <input
                type="text"
                className="ai-input"
                value={newTopics}
                onChange={e => setNewTopics(e.target.value)}
                placeholder="Topics comma-separated (e.g. CIA Triad, Cryptography, Access Control)"
              />
              <button type="submit" className="btn btn-primary btn-sm mt-10">
                Create Study Track
              </button>
            </form>
          )}

          <div className="study-widgets-grid">
            {visibleSubjects.map(s => {
              const doneCount = (progress[s.id] || []).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="explanation-card"
                  style={{ textAlign: 'left', cursor: 'pointer', position: 'relative' }}
                  onClick={() => openSubject(s)}
                >
                  <div className="flex items-center justify-between gap-8">
                    <span className="course-code-pill">{s.code}</span>
                    <span className="mode-badge mode-study">{s.badge}</span>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15.5, marginTop: 8 }}>{s.name}</div>
                  <div className="settings-help" style={{ margin: '4px 0 8px' }}>
                    {s.description}
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                      {doneCount}/{s.topics.length} topics done
                    </span>
                    {s.custom && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="icon-btn"
                        aria-label={`Remove ${s.name}`}
                        onClick={e => handleDeleteCustom(s.id, e)}
                      >
                        <Trash2 size={13} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inside Subject View */}
      {subject && (
        <>
          <div className="hub-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'lessons'}
              className={`hub-tab-btn${tab === 'lessons' ? ' active' : ''}`}
              onClick={() => setTab('lessons')}
            >
              <BookOpen size={13} /> <span>Open Lessons</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'lab'}
              className={`hub-tab-btn${tab === 'lab' ? ' active' : ''}`}
              onClick={() => setTab('lab')}
            >
              <Calculator size={13} />{' '}
              <span>{subject.id === 'ms102-quant' ? 'Quant Methods Lab' : 'Practice & Formulas'}</span>
            </button>
          </div>

          <div className="editor">
            {/* Topic Picker */}
            <div className="mode-picker-row" style={{ marginBottom: 12 }}>
              {subject.topics.map((t, idx) => {
                const isDone = (progress[subject.id] || []).includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    className={`mode-pick-chip${topicIdx === idx ? ' active' : ''}`}
                    onClick={() => handleSelectTopic(idx)}
                  >
                    {isDone ? '✓ ' : ''}{t.title}
                  </button>
                );
              })}
            </div>

            {tab === 'lessons' && activeTopic && (
              <div className="explanation-card">
                <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                  <strong style={{ fontSize: 15.5 }}>{activeTopic.title}</strong>
                  <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => loadModule(subject, activeTopic, true)}
                    >
                      <RefreshCw size={12} /> Refresh
                    </button>
                    <button
                      type="button"
                      className="row-action-chip active-chip"
                      disabled={aiBusy}
                      onClick={handleAiDigest}
                    >
                      <Sparkles size={12} /> {aiBusy ? 'Summarizing…' : 'AI Study Guide'}
                    </button>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={handleSaveTopicToNotes}
                    >
                      <FilePlus2 size={12} /> Save Note
                    </button>
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => {
                        setProgress(markSubjectTopicDone(subject.id, activeTopic.slug));
                        toast('Topic marked completed!', { type: 'success' });
                      }}
                    >
                      <CheckCircle2 size={12} /> Done
                    </button>
                  </div>
                </div>

                {aiDigest && (
                  <div className="list-group settings-group" style={{ margin: '0 0 12px', padding: 12 }}>
                    <div className="settings-label" style={{ marginBottom: 4 }}>Clean AI Study Summary</div>
                    <div className="smart-output-prose">{aiDigest}</div>
                  </div>
                )}

                {lessonLoading ? (
                  <div className="scan-indicator"><span className="spinner" /> Fetching Wikibooks &amp; Wikipedia…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(lessonDoc?.sections || []).map((sec, i) => (
                      <div key={i} className="list-group settings-group" style={{ margin: 0, padding: 12 }}>
                        <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
                          <strong style={{ fontSize: 13.5 }}>{sec.heading}</strong>
                          <span className="mode-badge mode-study" style={{ fontSize: 10 }}>{sec.source}</span>
                        </div>
                        <div className="smart-output-prose" style={{ fontSize: 13 }}>{sec.body}</div>
                        {sec.url && (
                          <a
                            href={sec.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="row-action-chip"
                            style={{ marginTop: 8, display: 'inline-flex', width: 'fit-content' }}
                          >
                            <ExternalLink size={11} /> Source
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* MS 102 Quantitative Methods Interactive Lab */}
            {tab === 'lab' && (
              <div className="explanation-card">
                {subject.id === 'ms102-quant' ? (
                  <>
                    <div className="mode-picker-row" style={{ marginBottom: 12 }}>
                      {[
                        ['decision', 'Decision & EMV'],
                        ['lp', 'Linear Prog (2-Var)'],
                        ['pert', 'PERT / CPM'],
                        ['eoq', 'Inventory EOQ'],
                      ].map(([id, lbl]) => (
                        <button
                          key={id}
                          type="button"
                          className={`mode-pick-chip${quantTool === id ? ' active' : ''}`}
                          onClick={() => setQuantTool(id)}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>

                    {quantTool === 'decision' && (
                      <>
                        <div className="settings-label">Payoff Matrix (Name: state1, state2, ...)</div>
                        <textarea
                          rows={3}
                          className="ai-input"
                          value={decMatrixText}
                          onChange={e => setDecMatrixText(e.target.value)}
                          spellCheck="false"
                        />
                        <div className="settings-label mt-10">State Probabilities (optional, sum = 1)</div>
                        <input
                          type="text"
                          className="ai-input"
                          value={decProbsText}
                          onChange={e => setDecProbsText(e.target.value)}
                        />
                        {decisionRes.ok ? (
                          <div className="subnet-grid mt-12">
                            <div className="subnet-cell">
                              <div className="subnet-k">Maximax</div>
                              <div className="subnet-v">{decisionRes.data.maximax.name} ({decisionRes.data.maximax.value})</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">Maximin</div>
                              <div className="subnet-v">{decisionRes.data.maximin.name} ({decisionRes.data.maximin.value})</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">Minimax Regret</div>
                              <div className="subnet-v">{decisionRes.data.minimaxRegret.name} ({decisionRes.data.minimaxRegret.value})</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">EMV / EVPI</div>
                              <div className="subnet-v">
                                {decisionRes.data.emv
                                  ? `${decisionRes.data.emv.best.name} (${decisionRes.data.emv.best.emv}) · EVPI ${decisionRes.data.evpi}`
                                  : `Laplace: ${decisionRes.data.laplace.name}`}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-mistake mt-10">{decisionRes.error}</div>
                        )}
                      </>
                    )}

                    {quantTool === 'lp' && (
                      <>
                        <div className="flex gap-8" style={{ marginBottom: 8 }}>
                          <select
                            className="input-field"
                            style={{ width: 92, margin: 0 }}
                            value={lpType}
                            onChange={e => setLpType(e.target.value)}
                          >
                            <option value="max">MAX Z</option>
                            <option value="min">MIN Z</option>
                          </select>
                          <input type="number" className="input-field" style={{ width: 80, margin: 0 }} value={lpC1} onChange={e => setLpC1(e.target.value)} />
                          <span style={{ alignSelf: 'center', fontWeight: 700 }}>x +</span>
                          <input type="number" className="input-field" style={{ width: 80, margin: 0 }} value={lpC2} onChange={e => setLpC2(e.target.value)} />
                          <span style={{ alignSelf: 'center', fontWeight: 700 }}>y</span>
                        </div>
                        <div className="settings-label">Constraints (x, y ≥ 0 automatic)</div>
                        <textarea
                          rows={3}
                          className="ai-input"
                          value={lpConsText}
                          onChange={e => setLpConsText(e.target.value)}
                          spellCheck="false"
                        />
                        {lpRes.ok ? (
                          lpRes.data.feasible ? (
                            <div className="list-group settings-group mt-12" style={{ margin: '12px 0 0', padding: 12 }}>
                              <div className="settings-label">Optimal Corner Point</div>
                              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--accent)' }}>
                                x = {lpRes.data.optimalPoint.x}, y = {lpRes.data.optimalPoint.y} → Z = {lpRes.data.optimalPoint.z}
                              </div>
                              <div className="settings-help" style={{ marginTop: 6 }}>
                                Vertices: {lpRes.data.vertices.map(v => `(${v.x}, ${v.y})→${v.z}`).join(' · ')}
                              </div>
                            </div>
                          ) : (
                            <div className="inline-mistake mt-10">Infeasible constraints.</div>
                          )
                        ) : (
                          <div className="inline-mistake mt-10">{lpRes.error}</div>
                        )}
                      </>
                    )}

                    {quantTool === 'pert' && (
                      <>
                        <div className="settings-label">Activities (ID: duration, predecessors)</div>
                        <textarea
                          rows={4}
                          className="ai-input"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                          value={pertText}
                          onChange={e => setPertText(e.target.value)}
                          spellCheck="false"
                        />
                        {pertRes.ok ? (
                          <div className="list-group settings-group mt-12" style={{ margin: '12px 0 0', padding: 12 }}>
                            <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 15 }}>
                              Duration: {pertRes.data.projectDuration} · Critical Path: {pertRes.data.criticalPath.join(' → ')}
                            </div>
                            <div className="truth-table-wrap mt-8">
                              <table className="truth-table">
                                <thead>
                                  <tr>
                                    <th>Act</th><th>Dur</th><th>ES</th><th>EF</th><th>LS</th><th>LF</th><th>Slack</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pertRes.data.tasks.map(t => (
                                    <tr key={t.id}>
                                      <td><strong>{t.id}{t.isCritical ? '*' : ''}</strong></td>
                                      <td>{t.duration}</td>
                                      <td>{t.es}</td><td>{t.ef}</td><td>{t.ls}</td><td>{t.lf}</td>
                                      <td>{t.slack}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-mistake mt-10">{pertRes.error}</div>
                        )}
                      </>
                    )}

                    {quantTool === 'eoq' && (
                      <>
                        <div className="patch-devices-row">
                          <div>
                            <div className="settings-label">Annual Demand (D)</div>
                            <input type="number" className="ai-input" value={eoqD} onChange={e => setEoqD(e.target.value)} />
                          </div>
                          <div>
                            <div className="settings-label">Order Cost (S)</div>
                            <input type="number" className="ai-input" value={eoqS} onChange={e => setEoqS(e.target.value)} />
                          </div>
                          <div>
                            <div className="settings-label">Holding Cost (H)</div>
                            <input type="number" className="ai-input" value={eoqH} onChange={e => setEoqH(e.target.value)} />
                          </div>
                          <div>
                            <div className="settings-label">Lead Time (Days)</div>
                            <input type="number" className="ai-input" value={eoqLead} onChange={e => setEoqLead(e.target.value)} />
                          </div>
                        </div>
                        {eoqRes.ok ? (
                          <div className="subnet-grid mt-12">
                            <div className="subnet-cell">
                              <div className="subnet-k">Optimal EOQ (Q*)</div>
                              <div className="subnet-v">{eoqRes.data.eoq} units</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">Orders / Year</div>
                              <div className="subnet-v">{eoqRes.data.ordersPerYear}</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">Total Annual Cost</div>
                              <div className="subnet-v">{eoqRes.data.totalInventoryCost}</div>
                            </div>
                            <div className="subnet-cell">
                              <div className="subnet-k">Reorder Point (ROP)</div>
                              <div className="subnet-v">{eoqRes.data.reorderPoint} units</div>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-mistake mt-10">{eoqRes.error}</div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="list-group settings-group" style={{ margin: 0, padding: 14 }}>
                    <div className="settings-label">Quick Reference — {activeTopic?.title}</div>
                    <div className="smart-output-prose">{activeTopic?.formulaSummary}</div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm mt-12"
                      onClick={handleSaveTopicToNotes}
                    >
                      <FilePlus2 size={14} /> Save Formula Sheet to Notes
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
