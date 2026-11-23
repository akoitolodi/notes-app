/**
 * algoSteps — Deterministic step generators for the 100% offline Algorithm & Data Structure Visualizer.
 * Covers Sorting (Bubble, Insertion, Merge, QuickSort), Binary Search,
 * Grid Pathfinding (BFS, DFS, Dijkstra), and Recursion Call Stack (Factorial, Fibonacci).
 */

export const SORT_META = {
  bubble: { name: 'Bubble Sort', time: 'O(n²)', space: 'O(1)' },
  insertion: { name: 'Insertion Sort', time: 'O(n²)', space: 'O(1)' },
  merge: { name: 'Merge Sort', time: 'O(n log n)', space: 'O(n)' },
  quick: { name: 'Quick Sort', time: 'O(n log n) avg', space: 'O(log n)' },
};

export function generateBubbleSortSteps(input = [38, 14, 72, 25, 59, 9, 46, 63]) {
  const a = input.slice();
  const n = a.length;
  const sorted = [];
  const steps = [{ array: a.slice(), active: [], swapped: [], sorted: [], note: 'Initial array ready for Bubble Sort.' }];

  for (let i = 0; i < n; i++) {
    let didSwap = false;
    for (let j = 0; j < n - i - 1; j++) {
      steps.push({
        array: a.slice(),
        active: [j, j + 1],
        swapped: [],
        sorted: sorted.slice(),
        note: `Compare a[${j}]=${a[j]} and a[${j + 1}]=${a[j + 1]}`,
      });
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
        didSwap = true;
        steps.push({
          array: a.slice(),
          active: [],
          swapped: [j, j + 1],
          sorted: sorted.slice(),
          note: `Swap ${a[j + 1]} and ${a[j]} so larger value bubbles right.`,
        });
      }
    }
    sorted.push(n - i - 1);
    if (!didSwap) {
      for (let k = 0; k < n - i - 1; k++) sorted.push(k);
      break;
    }
  }
  steps.push({
    array: a.slice(),
    active: [],
    swapped: [],
    sorted: a.map((_, idx) => idx),
    note: 'Bubble Sort complete — every element is in ascending order!',
  });
  return steps;
}

export function generateInsertionSortSteps(input = [38, 14, 72, 25, 59, 9, 46, 63]) {
  const a = input.slice();
  const n = a.length;
  const steps = [{ array: a.slice(), active: [0], swapped: [], sorted: [0], note: 'Start with a[0] as the sorted prefix.' }];

  for (let i = 1; i < n; i++) {
    const key = a[i];
    let j = i - 1;
    steps.push({
      array: a.slice(),
      active: [i],
      swapped: [],
      sorted: Array.from({ length: i }, (_, k) => k),
      note: `Pick key = ${key} at index ${i} to insert into sorted left side.`,
    });
    while (j >= 0 && a[j] > key) {
      a[j + 1] = a[j];
      steps.push({
        array: a.slice(),
        active: [j, j + 1],
        swapped: [j + 1],
        sorted: Array.from({ length: i }, (_, k) => k),
        note: `Shift ${a[j]} right to index ${j + 1}.`,
      });
      j -= 1;
    }
    a[j + 1] = key;
    steps.push({
      array: a.slice(),
      active: [],
      swapped: [j + 1],
      sorted: Array.from({ length: i + 1 }, (_, k) => k),
      note: `Insert key = ${key} at index ${j + 1}.`,
    });
  }
  steps.push({
    array: a.slice(),
    active: [],
    swapped: [],
    sorted: a.map((_, idx) => idx),
    note: 'Insertion Sort complete!',
  });
  return steps;
}

export function generateMergeSortSteps(input = [38, 14, 72, 25, 59, 9, 46, 63]) {
  const a = input.slice();
  const steps = [{ array: a.slice(), active: [], swapped: [], sorted: [], note: 'Divide & Conquer: splitting array recursively.' }];

  function merge(l, m, r) {
    const left = a.slice(l, m + 1);
    const right = a.slice(m + 1, r + 1);
    let i = 0;
    let j = 0;
    let k = l;
    while (i < left.length && j < right.length) {
      steps.push({
        array: a.slice(),
        active: [l + i, m + 1 + j],
        swapped: [],
        sorted: [],
        note: `Merge [${l}..${r}]: compare ${left[i]} vs ${right[j]}.`,
      });
      if (left[i] <= right[j]) {
        a[k] = left[i++];
      } else {
        a[k] = right[j++];
      }
      steps.push({
        array: a.slice(),
        active: [],
        swapped: [k],
        sorted: [],
        note: `Write ${a[k]} into position ${k}.`,
      });
      k += 1;
    }
    while (i < left.length) {
      a[k] = left[i++];
      steps.push({ array: a.slice(), active: [], swapped: [k], sorted: [], note: `Copy remaining ${a[k]} to index ${k}.` });
      k += 1;
    }
    while (j < right.length) {
      a[k] = right[j++];
      steps.push({ array: a.slice(), active: [], swapped: [k], sorted: [], note: `Copy remaining ${a[k]} to index ${k}.` });
      k += 1;
    }
  }

  function sort(l, r) {
    if (l >= r) return;
    const m = Math.floor((l + r) / 2);
    sort(l, m);
    sort(m + 1, r);
    merge(l, m, r);
  }

  sort(0, a.length - 1);
  steps.push({
    array: a.slice(),
    active: [],
    swapped: [],
    sorted: a.map((_, idx) => idx),
    note: 'Merge Sort complete in O(n log n)!',
  });
  return steps;
}

export function generateQuickSortSteps(input = [38, 14, 72, 25, 59, 9, 46, 63]) {
  const a = input.slice();
  const sortedSet = new Set();
  const steps = [{ array: a.slice(), active: [], swapped: [], sorted: [], note: 'Quick Sort partitions around a pivot value.' }];

  function partition(lo, hi) {
    const pivot = a[hi];
    let i = lo;
    steps.push({
      array: a.slice(),
      active: [hi],
      swapped: [],
      sorted: Array.from(sortedSet),
      note: `Partition [${lo}..${hi}] with pivot = ${pivot} (index ${hi}).`,
    });
    for (let j = lo; j < hi; j++) {
      steps.push({
        array: a.slice(),
        active: [j, hi],
        swapped: [],
        sorted: Array.from(sortedSet),
        note: `Check a[${j}]=${a[j]} against pivot ${pivot}.`,
      });
      if (a[j] < pivot) {
        if (i !== j) {
          [a[i], a[j]] = [a[j], a[i]];
          steps.push({
            array: a.slice(),
            active: [hi],
            swapped: [i, j],
            sorted: Array.from(sortedSet),
            note: `Swap ${a[i]} into left partition at index ${i}.`,
          });
        }
        i += 1;
      }
    }
    if (i !== hi) {
      [a[i], a[hi]] = [a[hi], a[i]];
      steps.push({
        array: a.slice(),
        active: [],
        swapped: [i, hi],
        sorted: Array.from(sortedSet),
        note: `Place pivot ${pivot} in its final sorted index ${i}.`,
      });
    }
    sortedSet.add(i);
    return i;
  }

  function qs(lo, hi) {
    if (lo > hi) return;
    if (lo === hi) {
      sortedSet.add(lo);
      return;
    }
    const p = partition(lo, hi);
    qs(lo, p - 1);
    qs(p + 1, hi);
  }

  qs(0, a.length - 1);
  steps.push({
    array: a.slice(),
    active: [],
    swapped: [],
    sorted: a.map((_, idx) => idx),
    note: 'Quick Sort complete!',
  });
  return steps;
}

export function generateSortSteps(algo, input) {
  if (algo === 'insertion') return generateInsertionSortSteps(input);
  if (algo === 'merge') return generateMergeSortSteps(input);
  if (algo === 'quick') return generateQuickSortSteps(input);
  return generateBubbleSortSteps(input);
}

/** Binary Search step generator on an ascending sorted array. */
export function generateBinarySearchSteps(sortedArr = [4, 9, 14, 21, 28, 35, 42, 56, 68, 81], target = 42) {
  const arr = sortedArr.slice().sort((x, y) => x - y);
  let lo = 0;
  let hi = arr.length - 1;
  const steps = [{ array: arr, low: lo, mid: -1, high: hi, foundIndex: -1, note: `Searching for target ${target} in sorted array (${arr.length} items).` }];

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    steps.push({
      array: arr,
      low: lo,
      mid,
      high: hi,
      foundIndex: -1,
      note: `low=${lo}, high=${hi} → check mid=${mid} (value ${arr[mid]}).`,
    });
    if (arr[mid] === target) {
      steps.push({
        array: arr,
        low: lo,
        mid,
        high: hi,
        foundIndex: mid,
        note: `Found ${target} at index ${mid} in O(log n)!`,
      });
      return steps;
    }
    if (arr[mid] < target) {
      lo = mid + 1;
      steps.push({
        array: arr,
        low: lo,
        mid,
        high: hi,
        foundIndex: -1,
        note: `${arr[mid]} < ${target} → discard left half (low = ${lo}).`,
      });
    } else {
      hi = mid - 1;
      steps.push({
        array: arr,
        low: lo,
        mid,
        high: hi,
        foundIndex: -1,
        note: `${arr[mid]} > ${target} → discard right half (high = ${hi}).`,
      });
    }
  }

  steps.push({
    array: arr,
    low: lo,
    mid: -1,
    high: hi,
    foundIndex: -1,
    note: `Target ${target} not found in array.`,
  });
  return steps;
}

/** Grid Pathfinding step generator for BFS, DFS, and Dijkstra (unweighted/unit grid). */
export function generateGridPathSteps({
  rows = 6,
  cols = 8,
  start = [1, 1],
  end = [4, 6],
  walls = new Set(),
  algo = 'bfs', // 'bfs' | 'dfs' | 'dijkstra'
}) {
  const keyOf = (r, c) => `${r},${c}`;
  const wallSet = walls instanceof Set ? walls : new Set(walls || []);
  const startKey = keyOf(start[0], start[1]);
  const endKey = keyOf(end[0], end[1]);

  const visited = new Set();
  const parent = new Map();
  const dist = new Map([[startKey, 0]]);
  const frontier = [[start[0], start[1], 0]];
  const steps = [
    {
      visited: [],
      frontier: [startKey],
      current: startKey,
      path: [],
      found: false,
      note: `Start ${algo.toUpperCase()} from (${start[0]},${start[1]}) to (${end[0]},${end[1]}).`,
    },
  ];

  const dirs = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ];

  let found = false;
  while (frontier.length > 0) {
    let cur;
    if (algo === 'dfs') {
      cur = frontier.pop();
    } else if (algo === 'dijkstra') {
      frontier.sort((a, b) => a[2] - b[2]);
      cur = frontier.shift();
    } else {
      cur = frontier.shift();
    }
    const [r, c, d] = cur;
    const ck = keyOf(r, c);
    if (visited.has(ck)) continue;
    visited.add(ck);

    if (ck === endKey) {
      found = true;
      break;
    }

    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nk = keyOf(nr, nc);
      if (wallSet.has(nk) || visited.has(nk)) continue;
      const nextDist = d + 1;
      if (!dist.has(nk) || nextDist < dist.get(nk)) {
        dist.set(nk, nextDist);
        parent.set(nk, ck);
        frontier.push([nr, nc, nextDist]);
      }
    }

    steps.push({
      visited: Array.from(visited),
      frontier: frontier.map(x => keyOf(x[0], x[1])),
      current: ck,
      path: [],
      found: false,
      note: `Visited (${r},${c}) · frontier size ${frontier.length}`,
    });
  }

  const path = [];
  if (found) {
    let k = endKey;
    while (k) {
      path.unshift(k);
      k = parent.get(k);
    }
    steps.push({
      visited: Array.from(visited),
      frontier: [],
      current: endKey,
      path,
      found: true,
      note: `Reached goal! Shortest path length = ${path.length - 1} steps.`,
    });
  } else {
    steps.push({
      visited: Array.from(visited),
      frontier: [],
      current: '',
      path: [],
      found: false,
      note: 'No path found — target is blocked by walls.',
    });
  }
  return steps;
}

/** Recursion Call-Stack step generator for factorial(n) or fibonacci(n). */
export function generateRecursionSteps(kind = 'factorial', rawN = 4) {
  const n = kind === 'fibonacci' ? Math.max(1, Math.min(5, Number(rawN) || 4)) : Math.max(1, Math.min(6, Number(rawN) || 4));
  const stack = [];
  const steps = [];

  const snap = note => {
    steps.push({
      stack: stack.map(f => ({ ...f })),
      note,
    });
  };

  if (kind === 'fibonacci') {
    function fib(k) {
      const frame = { id: `${k}-${steps.length}`, label: `fib(${k})`, status: 'active', returnVal: null };
      stack.push(frame);
      snap(`Call fib(${k}) — push frame onto call stack (depth ${stack.length}).`);
      if (k <= 1) {
        frame.status = 'returning';
        frame.returnVal = k;
        snap(`Base case! fib(${k}) returns ${k}.`);
        stack.pop();
        return k;
      }
      const a = fib(k - 1);
      const b = fib(k - 2);
      const res = a + b;
      frame.status = 'returning';
      frame.returnVal = res;
      snap(`fib(${k}) = ${a} + ${b} = ${res} — pop frame.`);
      stack.pop();
      return res;
    }
    const finalVal = fib(n);
    steps.push({ stack: [], result: finalVal, note: `Call stack empty — final result fib(${n}) = ${finalVal}.` });
    return steps;
  }

  function fact(k) {
    const frame = { id: `${k}-${steps.length}`, label: `fact(${k})`, status: 'active', returnVal: null };
    stack.push(frame);
    snap(`Call fact(${k}) — push frame onto call stack (depth ${stack.length}).`);
    if (k <= 1) {
      frame.status = 'returning';
      frame.returnVal = 1;
      snap(`Base case! fact(${k}) returns 1.`);
      stack.pop();
      return 1;
    }
    const sub = fact(k - 1);
    const res = k * sub;
    frame.status = 'returning';
    frame.returnVal = res;
    snap(`Unwind: fact(${k}) = ${k} × ${sub} = ${res} — pop frame.`);
    stack.pop();
    return res;
  }
  const finalVal = fact(n);
  steps.push({ stack: [], result: finalVal, note: `Call stack empty — final result fact(${n}) = ${finalVal}.` });
  return steps;
}
