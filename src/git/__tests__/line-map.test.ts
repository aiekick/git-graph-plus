import { describe, it, expect } from 'vitest';
import { mapOldLineToNew } from '../line-map';

describe('mapOldLineToNew', () => {
  it('keeps lines unchanged when there are no hunks', () => {
    expect(mapOldLineToNew([], 42)).toBe(42);
  });

  it('shifts lines after an insertion', () => {
    // 3 lines inserted after old line 10 → new 11..13
    const hunks = [{ oldStart: 10, oldLines: 0, newStart: 11, newLines: 3 }];
    expect(mapOldLineToNew(hunks, 10)).toBe(10);
    expect(mapOldLineToNew(hunks, 11)).toBe(14);
  });

  it('shifts lines after a deletion and maps deleted lines to what follows', () => {
    // old 5..7 deleted (new side position after line 4)
    const hunks = [{ oldStart: 5, oldLines: 3, newStart: 4, newLines: 0 }];
    expect(mapOldLineToNew(hunks, 4)).toBe(4);
    expect(mapOldLineToNew(hunks, 6)).toBe(5);
    expect(mapOldLineToNew(hunks, 8)).toBe(5);
    expect(mapOldLineToNew(hunks, 20)).toBe(17);
  });

  it('maps lines inside a replaced block onto the replacement', () => {
    // old 10..13 (4 lines) replaced by new 10..11 (2 lines)
    const hunks = [{ oldStart: 10, oldLines: 4, newStart: 10, newLines: 2 }];
    expect(mapOldLineToNew(hunks, 10)).toBe(10);
    expect(mapOldLineToNew(hunks, 11)).toBe(11);
    expect(mapOldLineToNew(hunks, 13)).toBe(11);
    expect(mapOldLineToNew(hunks, 14)).toBe(12);
  });

  it('accumulates several hunks', () => {
    const hunks = [
      { oldStart: 2, oldLines: 0, newStart: 3, newLines: 2 }, // +2 after old 2
      { oldStart: 10, oldLines: 1, newStart: 11, newLines: 0 }, // old 10 deleted (git: -10,1 +11,0)
    ];
    expect(mapOldLineToNew(hunks, 5)).toBe(7);
    expect(mapOldLineToNew(hunks, 11)).toBe(12);
  });
});
