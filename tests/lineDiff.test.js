import { describe, it, expect } from 'vitest';
import { diffAndRemapBlocks, diffLines } from '../shared/lineDiff.js';

describe('shared/lineDiff', () => {
  it('remaps existing blocks when lines are inserted at the top instead of marking everything changed', () => {
    const oldBody = 'Mitosis divides somatic cells.\nMeiosis creates gametes.';
    const newBody = '# Biology Chapter 4\n\nMitosis divides somatic cells.\nMeiosis creates gametes.';
    const existingBlocks = [
      { id: 'line-1', text: 'Mitosis divides somatic cells.', explanation: 'Old expl 1' },
      { id: 'line-2', text: 'Meiosis creates gametes.', explanation: 'Old expl 2' },
    ];

    const { remappedBlocks, linesToScan } = diffAndRemapBlocks(existingBlocks, oldBody, newBody);

    expect(remappedBlocks.map(b => b.id)).toEqual(['line-3', 'line-4']);
    expect(remappedBlocks[0].explanation).toBe('Old expl 1');
    expect(remappedBlocks[1].explanation).toBe('Old expl 2');
    // Only the new heading line 1 needs scanning (blank line 2 is ignored!)
    expect(linesToScan).toEqual([1]);
  });

  it('only flags edited lines when modifying middle of note', () => {
    const oldBody = 'Line A\nLine B\nLine C';
    const newBody = 'Line A\nLine B updated\nLine C';
    const existingBlocks = [
      { id: 'line-1', text: 'Line A', explanation: 'E1' },
      { id: 'line-2', text: 'Line B', explanation: 'E2' },
      { id: 'line-3', text: 'Line C', explanation: 'E3' },
    ];

    const { remappedBlocks, linesToScan } = diffAndRemapBlocks(existingBlocks, oldBody, newBody);
    expect(remappedBlocks.map(b => b.id)).toEqual(['line-1', 'line-3']);
    expect(linesToScan).toEqual([2]);
  });

  it('diffLines identifies only inserted lines', () => {
    expect(diffLines('A\nB\nC', 'Intro\nA\nB\nC')).toEqual([1]);
  });
});
