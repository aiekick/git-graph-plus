import { getVsCodeApi } from './vscode-api';
import type { FileStat } from './types';

type Stats = Record<string, FileStat[]>;

const pending = new Map<string, (stats: Stats | null) => void>();
let nextId = 0;

/**
 * Asks the extension for the per-file line counts of `hashes` (one numstat
 * listing per commit). Resolves to null when the extension reports an error
 * (it shows the error itself).
 */
export function requestSelectionFileStats(hashes: string[]): Promise<Stats | null> {
  const requestId = `stats-${++nextId}`;
  return new Promise(resolve => {
    pending.set(requestId, resolve);
    getVsCodeApi().postMessage({ type: 'getSelectionFileStats', payload: { requestId, hashes } });
  });
}

/** Routes a `selectionFileStats` reply to its pending request (see App.svelte). */
export function receiveSelectionFileStats(requestId: string, stats: Stats | null): void {
  const resolve = pending.get(requestId);
  if (!resolve) return;
  pending.delete(requestId);
  resolve(stats);
}
