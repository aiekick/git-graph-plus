/**
 * Reconnects a filtered set of commits into a graph: each kept commit's parents
 * become its nearest *kept* ancestors, walking through the commits that were
 * filtered out — what `git log --parents` does for path limiting, but which
 * git does not do for commit filters like `-S` / `-G`.
 *
 * `topoOrder` is the full ancestry as `[hash, ...parents]` entries in
 * topological order (children before parents, as `git rev-list --topo-order
 * --parents` prints it). Commits missing from it keep no parents.
 */
export function rewriteParents(
  kept: Set<string>,
  topoOrder: Array<[string, ...string[]]>,
  maxParents = 16,
): Map<string, string[]> {
  const parentsOf = new Map<string, string[]>();
  for (const [hash, ...parents] of topoOrder) parentsOf.set(hash, parents);

  // nearest[h] = nearest kept commits reachable from h, h included when kept.
  // Walking parents-first (reverse topo order) means every parent is resolved
  // before its children: no recursion, linear in the history size.
  const nearest = new Map<string, string[]>();
  const union = (lists: Iterable<string[] | undefined>): string[] => {
    const out = new Set<string>();
    for (const list of lists) {
      if (!list) continue;
      for (const h of list) {
        out.add(h);
        if (out.size >= maxParents) return [...out];
      }
    }
    return [...out];
  };
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const [hash, ...parents] = topoOrder[i];
    nearest.set(hash, kept.has(hash) ? [hash] : union(parents.map(p => nearest.get(p))));
  }

  const result = new Map<string, string[]>();
  for (const hash of kept) {
    result.set(hash, union((parentsOf.get(hash) ?? []).map(p => nearest.get(p))));
  }
  return result;
}

/** Parses `git rev-list --parents` output into `[hash, ...parents]` entries. */
export function parseRevListParents(raw: string): Array<[string, ...string[]]> {
  const out: Array<[string, ...string[]]> = [];
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) out.push(parts as [string, ...string[]]);
  }
  return out;
}
