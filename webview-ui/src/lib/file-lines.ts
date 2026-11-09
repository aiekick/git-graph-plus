import { getVsCodeApi } from './vscode-api';

const pending = new Map<string, (lines: string[] | null) => void>();
const cache = new Map<string, Promise<string[] | null>>();
let nextId = 0;

/**
 * Lines of `path` at `ref` (a commit-ish, 'index' or 'working'), fetched from
 * the extension. Null when the file doesn't exist there. Commit-ish results
 * are cached (immutable); 'index' / 'working' are always re-read.
 */
export function requestFileLines(ref: string, path: string): Promise<string[] | null> {
  const key = `${ref}\u0000${path}`;
  const immutable = ref !== 'index' && ref !== 'working';
  const hit = immutable ? cache.get(key) : undefined;
  if (hit) return hit;
  const requestId = `lines-${++nextId}`;
  const promise = new Promise<string[] | null>(resolve => {
    pending.set(requestId, resolve);
    getVsCodeApi().postMessage({ type: 'getFileLines', payload: { requestId, ref, path } });
  });
  if (immutable) cache.set(key, promise);
  return promise;
}

/** Routes a `fileLines` reply to its pending request (see App.svelte). */
export function receiveFileLines(requestId: string, lines: string[] | null): void {
  const resolve = pending.get(requestId);
  if (!resolve) return;
  pending.delete(requestId);
  resolve(lines);
}
