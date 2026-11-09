import { describe, it, expect } from 'vitest';
import { computeGaps, revealedLines } from '../diff-gaps';

describe('computeGaps', () => {
  it('finds the leading, middle and trailing gaps with their old-side offset', () => {
    // 100-line file; hunk 1 replaces line 10 with 3 lines (context 3),
    // hunk 2 deletes old line 50.
    const hunks = [
      { oldStart: 7, oldLines: 7, newStart: 7, newLines: 9 },   // new 7..15, old 7..13
      { oldStart: 47, oldLines: 7, newStart: 49, newLines: 6 }, // new 49..54, old 47..53
    ];
    expect(computeGaps(hunks, 100)).toEqual([
      { index: 0, newFrom: 1, newTo: 6, oldOffset: 0 },
      { index: 1, newFrom: 16, newTo: 48, oldOffset: 2 },
      { index: 2, newFrom: 55, newTo: 100, oldOffset: 1 },
    ]);
  });

  it('omits empty gaps', () => {
    const hunks = [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }];
    expect(computeGaps(hunks, 3)).toEqual([]);
  });

  it('handles a pure insertion at the top (-0,0)', () => {
    const hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 }];
    expect(computeGaps(hunks, 5)).toEqual([{ index: 1, newFrom: 3, newTo: 5, oldOffset: 2 }]);
  });
});

describe('revealedLines', () => {
  const gap = { index: 1, newFrom: 16, newTo: 48, oldOffset: 2 };

  it('reveals lines below the previous hunk and above the next one', () => {
    expect(revealedLines(gap, 2, 3)).toEqual({ top: [16, 17], bottom: [46, 47, 48], hidden: 28 });
  });

  it('shows the whole gap once both sides meet', () => {
    const r = revealedLines(gap, 20, 20);
    expect(r.hidden).toBe(0);
    expect(r.top).toHaveLength(33);
    expect(r.bottom).toEqual([]);
  });
});
