import type { DiffHunk } from './types';

/**
 * Unchanged lines hidden around a diff's hunks: before the first one, between
 * two hunks and after the last one. Line numbers are 1-based new-side lines;
 * `oldOffset` turns them into old-side numbers (old = new - oldOffset), which
 * is constant inside a gap since nothing changed there.
 */
export interface DiffGap {
  /** Gap before hunk `index` (`index === hunks.length` is the trailing gap). */
  index: number;
  newFrom: number;
  newTo: number;
  oldOffset: number;
}

type HunkRange = Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>;

/** First line of a hunk side; a `-n,0` / `+n,0` side sits *after* line n. */
const first = (start: number, count: number) => (count === 0 ? start + 1 : start);

/**
 * Gaps of a diff whose new side has `totalNewLines` lines. Empty gaps are left
 * out, so the result only holds ranges worth an "expand" control.
 */
export function computeGaps(hunks: HunkRange[], totalNewLines: number): DiffGap[] {
  const gaps: DiffGap[] = [];
  let nextNew = 1; // first new-side line after the previous hunk
  let nextOld = 1;
  hunks.forEach((h, i) => {
    const newFirst = first(h.newStart, h.newLines);
    if (newFirst > nextNew) {
      gaps.push({ index: i, newFrom: nextNew, newTo: newFirst - 1, oldOffset: nextNew - nextOld });
    }
    nextNew = newFirst + h.newLines;
    nextOld = first(h.oldStart, h.oldLines) + h.oldLines;
  });
  if (totalNewLines >= nextNew) {
    gaps.push({ index: hunks.length, newFrom: nextNew, newTo: totalNewLines, oldOffset: nextNew - nextOld });
  }
  return gaps;
}

/**
 * Splits a gap into the lines revealed below the previous hunk (`top`) and
 * above the next one (`bottom`), plus how many stay hidden in between.
 */
export function revealedLines(gap: DiffGap, top: number, bottom: number): { top: number[]; bottom: number[]; hidden: number } {
  const size = gap.newTo - gap.newFrom + 1;
  if (top + bottom >= size) {
    return { top: range(gap.newFrom, gap.newTo), bottom: [], hidden: 0 };
  }
  return {
    top: range(gap.newFrom, gap.newFrom + top - 1),
    bottom: range(gap.newTo - bottom + 1, gap.newTo),
    hidden: size - top - bottom,
  };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}
