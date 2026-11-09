import * as vscode from 'vscode';
import { GitService } from '../git/git-service';

/**
 * Read-only documents showing a file as it was at a git revision, so the diff
 * view can open "this version" in a real editor (syntax highlighting, search,
 * go to line). The URI path keeps the file's own path so VS Code picks the
 * language from its extension; repo and ref travel in the query.
 */
export const REVISION_SCHEME = 'gitgraphplus-rev';

export function revisionUri(repoPath: string, ref: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: REVISION_SCHEME,
    path: '/' + filePath,
    query: JSON.stringify({ repo: repoPath, ref }),
  });
}

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { repo, ref } = JSON.parse(uri.query) as { repo: string; ref: string };
    return new GitService(repo).readFileAtRef(ref, uri.path.replace(/^\//, ''));
  }
}
