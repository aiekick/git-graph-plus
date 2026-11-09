import { describe, it, expect } from 'vitest';
import { parseRevListParents, rewriteParents } from '../parent-rewrite';

// History (children first):
//   m  = merge(b, d)
//   b -> a
//   d -> c -> a
//   a  (root)
const topo = parseRevListParents('m b d\nb a\nd c\nc a\na\n');

describe('rewriteParents', () => {
  it('links kept commits through filtered-out ones', () => {
    const r = rewriteParents(new Set(['m', 'a']), topo);
    expect(r.get('m')).toEqual(['a']);
    expect(r.get('a')).toEqual([]);
  });

  it('keeps both sides of a merge when each holds a kept commit', () => {
    const r = rewriteParents(new Set(['m', 'b', 'c']), topo);
    expect(r.get('m')).toEqual(['b', 'c']);
    expect(r.get('b')).toEqual([]);
    expect(r.get('c')).toEqual([]);
  });

  it('dedupes ancestors reached by several paths', () => {
    const r = rewriteParents(new Set(['m', 'a']), parseRevListParents('m b d\nb a\nd a\na\n'));
    expect(r.get('m')).toEqual(['a']);
  });

  it('gives no parents to commits outside the ancestry', () => {
    expect(rewriteParents(new Set(['x']), topo).get('x')).toEqual([]);
  });
});
