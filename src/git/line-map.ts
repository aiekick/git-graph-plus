import type { DiffHunk } from './types';

type HunkRange = Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>;

/** First line of a hunk side; a `-n,0` / `+n,0` side sits *after* line n. */
const first = (start: number, count: number) => (count === 0 ? start + 1 : start);

/**
 * Maps a 1-based line number of a diff's old side to the matching line on its
 * new side. Lines inside a changed region map to the start of what replaced
 * them (or, for a pure deletion, to the line right after it). `hunks` must be
 * in file order, as git emits them (any context size, `-U0` included).
 */
export function mapOldLineToNew(hunks: HunkRange[], line: number): number {
  let delta = 0;
  for (const h of hunks) {
    const oldFirst = first(h.oldStart, h.oldLines);
    const newFirst = first(h.newStart, h.newLines);
    if (line < oldFirst) break;
    if (line < oldFirst + h.oldLines) {
      // Inside a changed block: land on the matching line of what replaced it.
      return Math.max(1, newFirst + Math.min(line - oldFirst, Math.max(h.newLines - 1, 0)));
    }
    // Lines after the hunk move by the size difference of its two sides.
    delta = (newFirst + h.newLines) - (oldFirst + h.oldLines);
  }
  return Math.max(1, line + delta);
}
