/**
 * Content-aware line diff & block remapping.
 *
 * When a student inserts or deletes lines above existing text, naive index-based
 * diffing marks every subsequent line as "changed", detaching explanations and
 * triggering huge redundant AI re-scans.
 *
 * Here we compute an LCS (Longest Common Subsequence) mapping between oldLines
 * and newLines so unchanged lines keep their existing blocks at their new line
 * numbers, and only genuinely new or edited lines are queued for scanning.
 */

const MEANINGFUL_RE = /[a-zA-Z0-9\u00C0-\uFFFF]/;

export function isMeaningfulLine(line) {
  return MEANINGFUL_RE.test(String(line || '').trim());
}

/**
 * Compute oldIndex -> newIndex mapping for unchanged lines via LCS.
 * Falls back to a greedy multiset match for extremely long notes (> 400 lines)
 * to keep memory and runtime bounded on mobile phones.
 */
export function matchUnchangedLines(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const oldToNew = new Map();

  if (m === 0 || n === 0) return oldToNew;

  // Fast trim of identical prefix and suffix
  let pre = 0;
  while (pre < m && pre < n && oldLines[pre] === newLines[pre]) {
    oldToNew.set(pre, pre);
    pre++;
  }
  let suf = 0;
  while (
    suf < m - pre &&
    suf < n - pre &&
    oldLines[m - 1 - suf] === newLines[n - 1 - suf]
  ) {
    oldToNew.set(m - 1 - suf, n - 1 - suf);
    suf++;
  }

  const midOldLen = m - pre - suf;
  const midNewLen = n - pre - suf;
  if (midOldLen <= 0 || midNewLen <= 0) return oldToNew;

  // Exact LCS when DP matrix fits comfortably in memory (~160k cells)
  if (midOldLen * midNewLen <= 160000) {
    const cols = midNewLen + 1;
    const dp = new Uint32Array((midOldLen + 1) * cols);

    for (let i = midOldLen - 1; i >= 0; i--) {
      const a = oldLines[pre + i];
      const row = i * cols;
      const nextRow = (i + 1) * cols;
      for (let j = midNewLen - 1; j >= 0; j--) {
        if (a === newLines[pre + j]) {
          dp[row + j] = dp[nextRow + j + 1] + 1;
        } else {
          const down = dp[nextRow + j];
          const right = dp[row + j + 1];
          dp[row + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < midOldLen && j < midNewLen) {
      if (oldLines[pre + i] === newLines[pre + j]) {
        oldToNew.set(pre + i, pre + j);
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    return oldToNew;
  }

  // Fallback for huge notes: order-preserving greedy occurrence match
  const buckets = new Map();
  for (let j = 0; j < midNewLen; j++) {
    const text = newLines[pre + j];
    if (!buckets.has(text)) buckets.set(text, []);
    buckets.get(text).push(pre + j);
  }
  let lastNewIdx = pre - 1;
  for (let i = 0; i < midOldLen; i++) {
    const text = oldLines[pre + i];
    const list = buckets.get(text);
    if (!list) continue;
    const pos = list.findIndex(idx => idx > lastNewIdx);
    if (pos !== -1) {
      const matched = list.splice(pos, 1)[0];
      oldToNew.set(pre + i, matched);
      lastNewIdx = matched;
    }
  }
  return oldToNew;
}

/**
 * Remap existing blocks onto `newBody` and return:
 * - remappedBlocks: existing blocks whose lines survived (with updated `line-<N>` IDs)
 * - linesToScan: 1-indexed meaningful line numbers in `newBody` that need fresh AI explanations
 */
export function diffAndRemapBlocks(existingBlocks, oldBody, newBody) {
  const oldLines = (oldBody || '').split('\n');
  const newLines = (newBody || '').split('\n');
  const oldToNew = matchUnchangedLines(oldLines, newLines);

  // Also map any existing block directly by matching text if oldBody was empty/out-of-sync
  const remappedByNewIdx = new Map();

  for (const b of existingBlocks || []) {
    const m = /^line-(\d+)$/.exec(String(b?.id || ''));
    if (!m) continue;
    const oldIdx = parseInt(m[1], 10) - 1;
    if (oldIdx < 0) continue;

    // First prefer exact LCS-mapped position
    if (oldToNew.has(oldIdx)) {
      const newIdx = oldToNew.get(oldIdx);
      if (newLines[newIdx] === b.text && !remappedByNewIdx.has(newIdx)) {
        remappedByNewIdx.set(newIdx, { ...b, id: `line-${newIdx + 1}` });
        continue;
      }
    }

    // Fallback: if block still matches same index in newLines
    if (oldIdx < newLines.length && newLines[oldIdx] === b.text && !remappedByNewIdx.has(oldIdx)) {
      remappedByNewIdx.set(oldIdx, { ...b, id: `line-${oldIdx + 1}` });
    }
  }

  const linesToScan = [];
  for (let i = 0; i < newLines.length; i++) {
    if (!isMeaningfulLine(newLines[i])) continue;
    if (!remappedByNewIdx.has(i)) {
      linesToScan.push(i + 1);
    }
  }

  const remappedBlocks = [...remappedByNewIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block);

  return { remappedBlocks, linesToScan };
}

/** Convenience helper returning 1-indexed changed/added lines in newBody. */
export function diffLines(oldBody, newBody) {
  const oldLines = (oldBody || '').split('\n');
  const newLines = (newBody || '').split('\n');
  const oldToNew = matchUnchangedLines(oldLines, newLines);
  const matchedNew = new Set(oldToNew.values());
  const changed = [];
  for (let i = 0; i < newLines.length; i++) {
    if (!matchedNew.has(i)) changed.push(i + 1);
  }
  return changed;
}
