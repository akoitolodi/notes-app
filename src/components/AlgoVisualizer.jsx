/**
 * AlgoVisualizer — 100% Offline Interactive Algorithm & Data Structure Visualizer.
 * Sub-views:
 * 1. Sorting (Bubble, Insertion, Merge, QuickSort) with animated bars & Big-O badge
 * 2. Search & Pathfinding (Binary Search + Interactive Wall-Drawing BFS/DFS/Dijkstra Grid)
 * 3. Recursion Call-Stack (Factorial & Fibonacci live frame push/pop animation)
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Shuffle,
  Eraser,
} from 'lucide-react';
import {
  SORT_META,
  generateSortSteps,
  generateBinarySearchSteps,
  generateGridPathSteps,
  generateRecursionSteps,
} from '../lib/algoSteps';

const DEFAULT_SORT_ARR = [38, 14, 72, 25, 59, 9, 46, 63];
const DEFAULT_SEARCH_ARR = [4, 9, 14, 21, 28, 35, 42, 56, 68, 81];
const GRID_ROWS = 6;
const GRID_COLS = 8;
const GRID_START = [1, 1];
const GRID_END = [4, 6];
const INITIAL_WALLS = ['1,3', '2,3', '3,3', '3,5', '4,5'];

export default function AlgoVisualizer() {
  const [section, setSection] = useState('sorting'); // sorting | search | path | recursion
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(420);
  const [stepIdx, setStepIdx] = useState(0);

  // Sorting state
  const [sortAlgo, setSortAlgo] = useState('quick');
  const [sortArr, setSortArr] = useState(DEFAULT_SORT_ARR);

  // Binary search state
  const [searchTarget, setSearchTarget] = useState(42);

  // Grid pathfinding state
  const [pathAlgo, setPathAlgo] = useState('bfs');
  const [walls, setWalls] = useState(() => new Set(INITIAL_WALLS));

  // Recursion state
  const [recKind, setRecKind] = useState('factorial');
  const [recN, setRecN] = useState(4);

  const steps = useMemo(() => {
    if (section === 'sorting') return generateSortSteps(sortAlgo, sortArr);
    if (section === 'search') return generateBinarySearchSteps(DEFAULT_SEARCH_ARR, Number(searchTarget) || 42);
    if (section === 'path') {
      return generateGridPathSteps({
        rows: GRID_ROWS,
        cols: GRID_COLS,
        start: GRID_START,
        end: GRID_END,
        walls,
        algo: pathAlgo,
      });
    }
    return generateRecursionSteps(recKind, recN);
  }, [section, sortAlgo, sortArr, searchTarget, walls, pathAlgo, recKind, recN]);

  useEffect(() => {
    setPlaying(false);
    setStepIdx(0);
  }, [steps]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      setStepIdx(prev => {
        if (prev + 1 >= steps.length) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => clearInterval(t);
  }, [playing, speedMs, steps.length]);

  const frame = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))] || steps[0];

  const randomizeSort = () => {
    const next = Array.from({ length: 8 }, () => Math.floor(Math.random() * 82) + 8);
    setSortArr(next);
  };

  const toggleWall = (r, c) => {
    const k = `${r},${c}`;
    if (k === `${GRID_START[0]},${GRID_START[1]}` || k === `${GRID_END[0]},${GRID_END[1]}`) return;
    setWalls(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className="algo-viz-wrap">
      {/* Sub-view switcher */}
      <div className="coding-cat-row" style={{ margin: '0 0 10px', padding: 0 }}>
        {[
          ['sorting', 'Sorting'],
          ['search', 'Binary Search'],
          ['path', 'Pathfinding'],
          ['recursion', 'Call Stack'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`mode-pick-chip${section === id ? ' active' : ''}`}
            style={{ flex: 'none', padding: '6px 11px', fontSize: 12.5 }}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Controls per section */}
      {section === 'sorting' && (
        <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap' }}>
            <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
              {Object.entries(SORT_META).map(([k, meta]) => (
                <button
                  key={k}
                  type="button"
                  className={`row-action-chip${sortAlgo === k ? ' active-chip' : ''}`}
                  onClick={() => setSortAlgo(k)}
                >
                  {meta.name}
                </button>
              ))}
            </div>
            <button type="button" className="row-action-chip" onClick={randomizeSort}>
              <Shuffle size={12} /> Randomize
            </button>
          </div>
          <div className="settings-help" style={{ marginTop: 8 }}>
            Time: <strong>{SORT_META[sortAlgo].time}</strong> · Space: <strong>{SORT_META[sortAlgo].space}</strong>
          </div>

          <div className="algo-bars-stage" aria-label="Sorting bars visualization">
            {(frame?.array || []).map((val, i) => {
              const isSwapped = frame.swapped?.includes(i);
              const isActive = frame.active?.includes(i);
              const isSorted = frame.sorted?.includes(i);
              const hPct = Math.max(14, Math.round((val / 95) * 100));
              return (
                <div key={i} className="algo-bar-col">
                  <div
                    className={`algo-bar${isSwapped ? ' is-swap' : isActive ? ' is-active' : isSorted ? ' is-sorted' : ''}`}
                    style={{ height: `${hPct}%` }}
                  >
                    <span>{val}</span>
                  </div>
                  <span className="algo-bar-idx">{i}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'search' && (
        <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
          <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
            <span className="settings-help" style={{ margin: 0 }}>Target value:</span>
            {[14, 42, 68, 50].map(val => (
              <button
                key={val}
                type="button"
                className={`row-action-chip${Number(searchTarget) === val ? ' active-chip' : ''}`}
                onClick={() => setSearchTarget(val)}
              >
                {val}
              </button>
            ))}
            <input
              type="number"
              className="input-field"
              style={{ width: 78, padding: '4px 8px' }}
              value={searchTarget}
              onChange={e => setSearchTarget(e.target.value)}
              aria-label="Search target"
            />
          </div>

          <div className="algo-array-strip">
            {(frame?.array || []).map((val, i) => {
              const inRange = i >= frame.low && i <= frame.high;
              const isMid = i === frame.mid;
              const isFound = i === frame.foundIndex;
              return (
                <div
                  key={i}
                  className={`algo-array-box${isFound ? ' is-found' : isMid ? ' is-mid' : !inRange ? ' is-dim' : ''}`}
                >
                  <div className="algo-array-val">{val}</div>
                  <div className="algo-array-idx">
                    {i === frame.low ? 'L ' : ''}
                    {i === frame.mid ? 'M ' : ''}
                    {i === frame.high ? 'H' : ''}
                    {i !== frame.low && i !== frame.mid && i !== frame.high ? i : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'path' && (
        <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap' }}>
            <div className="flex gap-6">
              {[
                ['bfs', 'BFS (Shortest)'],
                ['dfs', 'DFS (Depth)'],
                ['dijkstra', 'Dijkstra'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`row-action-chip${pathAlgo === id ? ' active-chip' : ''}`}
                  onClick={() => setPathAlgo(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="row-action-chip" onClick={() => setWalls(new Set())}>
              <Eraser size={12} /> Clear Walls
            </button>
          </div>
          <p className="settings-help" style={{ marginTop: 6 }}>
            Tap any grid square to place/remove walls between <strong>S</strong> (start) and <strong>E</strong> (goal).
          </p>

          <div
            className="algo-path-grid"
            style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
          >
            {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, idx) => {
              const r = Math.floor(idx / GRID_COLS);
              const c = idx % GRID_COLS;
              const k = `${r},${c}`;
              const isStart = r === GRID_START[0] && c === GRID_START[1];
              const isEnd = r === GRID_END[0] && c === GRID_END[1];
              const isWall = walls.has(k);
              const isPath = frame?.path?.includes(k);
              const isCurrent = frame?.current === k;
              const isVisited = frame?.visited?.includes(k);
              const isFrontier = frame?.frontier?.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={`algo-grid-cell${
                    isStart
                      ? ' is-start'
                      : isEnd
                        ? ' is-end'
                        : isWall
                          ? ' is-wall'
                          : isPath
                            ? ' is-path'
                            : isCurrent
                              ? ' is-current'
                              : isVisited
                                ? ' is-visited'
                                : isFrontier
                                  ? ' is-frontier'
                                  : ''
                  }`}
                  onClick={() => toggleWall(r, c)}
                  aria-label={`Grid cell ${r},${c}`}
                >
                  {isStart ? 'S' : isEnd ? 'E' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {section === 'recursion' && (
        <div className="list-group settings-group" style={{ margin: '0 0 10px' }}>
          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap' }}>
            <div className="flex gap-6">
              <button
                type="button"
                className={`row-action-chip${recKind === 'factorial' ? ' active-chip' : ''}`}
                onClick={() => setRecKind('factorial')}
              >
                factorial(n)
              </button>
              <button
                type="button"
                className={`row-action-chip${recKind === 'fibonacci' ? ' active-chip' : ''}`}
                onClick={() => {
                  setRecKind('fibonacci');
                  if (recN > 4) setRecN(4);
                }}
              >
                fibonacci(n)
              </button>
            </div>
            <div className="flex items-center gap-6">
              <span className="settings-help" style={{ margin: 0 }}>n =</span>
              {(recKind === 'fibonacci' ? [2, 3, 4] : [3, 4, 5]).map(v => (
                <button
                  key={v}
                  type="button"
                  className={`row-action-chip${recN === v ? ' active-chip' : ''}`}
                  onClick={() => setRecN(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="algo-stack-stage">
            {(frame?.stack || []).length === 0 ? (
              <div className="settings-help" style={{ textAlign: 'center', margin: '18px 0' }}>
                {frame?.result !== undefined ? `Returned: ${frame.result}` : 'Call stack is empty — press Play or Step!'}
              </div>
            ) : (
              [...(frame?.stack || [])].reverse().map((sf, idx) => (
                <div
                  key={sf.id || idx}
                  className={`algo-stack-frame${sf.status === 'returning' ? ' is-returning' : ''}`}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{sf.label}</span>
                  <span className="settings-help" style={{ margin: 0 }}>
                    {sf.status === 'returning' ? `→ returns ${sf.returnVal}` : 'waiting on stack…'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Unified Step Playback Bar */}
      <div className="list-group settings-group" style={{ margin: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 550, marginBottom: 8, minHeight: 20 }}>
          {frame?.note || 'Ready'}
        </div>
        <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap' }}>
          <div className="flex items-center gap-6">
            <button
              type="button"
              className="icon-btn"
              aria-label="Reset animation"
              onClick={() => {
                setPlaying(false);
                setStepIdx(0);
              }}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Step back"
              onClick={() => {
                setPlaying(false);
                setStepIdx(i => Math.max(0, i - 1));
              }}
            >
              <SkipBack size={17} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (!playing && stepIdx >= steps.length - 1) setStepIdx(0);
                setPlaying(p => !p);
              }}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Step forward"
              onClick={() => {
                setPlaying(false);
                setStepIdx(i => Math.min(steps.length - 1, i + 1));
              }}
            >
              <SkipForward size={17} />
            </button>
          </div>
          <div className="flex items-center gap-8">
            <span className="settings-help" style={{ margin: 0 }}>
              Step {stepIdx + 1}/{steps.length}
            </span>
            <select
              className="input-field"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={speedMs}
              onChange={e => setSpeedMs(Number(e.target.value))}
              aria-label="Animation speed"
            >
              <option value={750}>0.5x</option>
              <option value={420}>1x</option>
              <option value={180}>2x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
