import * as vscode from 'vscode';
import { normalizeInteractiveRebaseMode, type InteractiveRebaseMode } from '../git/classic-rebase';

/**
 * Reads the `gitGraphPlus.timeout` setting (in seconds) and returns the
 * equivalent in milliseconds for `GitService.setDefaultTimeout`. Falls back to
 * the 60s default when the value is missing or non-positive.
 */
export function readTimeoutMs(): number {
  const seconds = vscode.workspace.getConfiguration('gitGraphPlus').get<number>('timeout', 60);
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

/** Default number of commits loaded on the first graph render / refresh. */
export const DEFAULT_INITIAL_COMMIT_COUNT = 200;
/** Default number of extra commits fetched each time "Load more" is clicked. */
export const DEFAULT_LOAD_MORE_COMMIT_COUNT = 50;

function readPositiveIntSetting(key: string, fallback: number): number {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<number>(key, fallback);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

/**
 * Reads `gitGraphPlus.initialCommitCount` — how many commits to load when the
 * graph first renders (and on refresh). Falls back to 200 when unset/invalid.
 */
export function readInitialCommitCount(): number {
  return readPositiveIntSetting('initialCommitCount', DEFAULT_INITIAL_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.loadMoreCommitCount` — how many additional commits each
 * "Load more" click fetches. Falls back to 50 when unset/invalid.
 */
export function readLoadMoreCommitCount(): number {
  return readPositiveIntSetting('loadMoreCommitCount', DEFAULT_LOAD_MORE_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.interactiveRebase.mode` — whether interactive rebase
 * opens the GUI editor (`ui`, default) or runs classic `git rebase -i` in the
 * integrated terminal (`classic`).
 */
export function readInteractiveRebaseMode(): InteractiveRebaseMode {
  return normalizeInteractiveRebaseMode(
    vscode.workspace.getConfiguration('gitGraphPlus').get<string>('interactiveRebase.mode', 'ui'),
  );
}

/**
 * Reads `gitGraphPlus.showAvatars` — whether author avatars are fetched from
 * gravatar.com (the only network request the extension makes on its own) and
 * shown. When false, no request leaves the machine. Defaults to true.
 */
export function readShowAvatars(): boolean {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('showAvatars', true) !== false;
}

/** Delimiters offered by `gitGraphPlus.export.csvDelimiter`. */
export const CSV_DELIMITERS = [';', ',', '\t', '|'] as const;
export type CsvDelimiter = typeof CSV_DELIMITERS[number];

/**
 * Reads `gitGraphPlus.export.csvDelimiter` — the field separator of CSV
 * exports. Defaults to `;` (what Excel expects in most non-English locales).
 */
export function readCsvDelimiter(): CsvDelimiter {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('export.csvDelimiter', ';');
  return (CSV_DELIMITERS as readonly string[]).includes(raw) ? (raw as CsvDelimiter) : ';';
}
