import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import FileDiffView from '../FileDiffView.svelte';
import type { DiffData } from '../../../lib/types';

// 60-line file ("L1".."L60"); line 30 changed to "X30" (context 3 → lines 27..33).
const FILE = Array.from({ length: 60 }, (_, i) => (i === 29 ? 'X30' : `L${i + 1}`));

vi.mock('../../../lib/file-lines', () => ({
  requestFileLines: vi.fn(async () => FILE),
}));

function diff(): DiffData {
  return {
    file: 'src/foo.ts',
    isBinary: false,
    isImage: false,
    hunks: [{
      header: '@@ -27,7 +27,7 @@',
      oldStart: 27, oldLines: 7, newStart: 27, newLines: 7,
      lines: [
        { type: 'context', content: 'L27', oldLineNumber: 27, newLineNumber: 27 },
        { type: 'context', content: 'L28', oldLineNumber: 28, newLineNumber: 28 },
        { type: 'context', content: 'L29', oldLineNumber: 29, newLineNumber: 29 },
        { type: 'delete', content: 'L30', oldLineNumber: 30 },
        { type: 'add', content: 'X30', newLineNumber: 30 },
        { type: 'context', content: 'L31', oldLineNumber: 31, newLineNumber: 31 },
        { type: 'context', content: 'L32', oldLineNumber: 32, newLineNumber: 32 },
        { type: 'context', content: 'L33', oldLineNumber: 33, newLineNumber: 33 },
      ],
    }],
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) { await Promise.resolve(); await tick(); }
}

function lastPosted(type: string) {
  return globalThis.__postedMessages.map(m => m.data as { type: string; payload: unknown }).filter(m => m.type === type).at(-1);
}

afterEach(() => cleanup());

describe('FileDiffView hidden context', () => {
  it('shows a bar for the hidden lines above and below the hunk', async () => {
    const { container } = render(FileDiffView, { diff: diff(), commitHash: 'abc', refs: { oldRef: 'abc^', newRef: 'abc' } });
    await settle();
    const bars = container.querySelectorAll('.diff-gap-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0].textContent).toContain('26');
    expect(bars[1].textContent).toContain('27');
  });

  it('reveals hidden lines step by step and entirely', async () => {
    const { container } = render(FileDiffView, { diff: diff(), commitHash: 'abc', refs: { oldRef: 'abc^', newRef: 'abc' } });
    await settle();
    // Leading gap: only "above" (lines just before the hunk) and "all".
    const leading = container.querySelectorAll('.diff-gap-bar')[0];
    await fireEvent.click(leading.querySelector('.codicon-fold-up')!.closest('button')!);
    let revealed = [...container.querySelectorAll('.diff-revealed .line-content')].map(e => e.textContent);
    expect(revealed).toEqual(Array.from({ length: 20 }, (_, i) => `L${i + 7}`));
    await fireEvent.click(container.querySelectorAll('.diff-gap-bar')[0].querySelector('.codicon-unfold')!.closest('button')!);
    revealed = [...container.querySelectorAll('.diff-revealed .line-content')].map(e => e.textContent);
    expect(revealed).toEqual(Array.from({ length: 26 }, (_, i) => `L${i + 1}`));
    expect(container.querySelectorAll('.diff-gap-bar')).toHaveLength(1);
  });

  it('opens the revision at the double-clicked line (deleted lines on the old side)', async () => {
    const { container } = render(FileDiffView, { diff: diff(), commitHash: 'abc', refs: { oldRef: 'abc^', newRef: 'abc' } });
    await settle();
    const lines = container.querySelectorAll('.diff-hunk .diff-line');
    await fireEvent.dblClick(lines[4]); // + X30
    expect(lastPosted('openFileAtRef')?.payload).toEqual({ ref: 'abc', path: 'src/foo.ts', line: 30 });
    await fireEvent.dblClick(lines[3]); // - L30
    expect(lastPosted('openFileAtRef')?.payload).toEqual({ ref: 'abc^', path: 'src/foo.ts', line: 30 });
  });

  it('opens the hunk, and the working file at the first change', async () => {
    const { container } = render(FileDiffView, { diff: diff(), commitHash: 'abc', refs: { oldRef: 'abc^', newRef: 'abc' } });
    await settle();
    await fireEvent.click(container.querySelector('.hunk-open-btn')!);
    expect(lastPosted('openFileAtRef')?.payload).toEqual({ ref: 'abc', path: 'src/foo.ts', line: 27 });
    await fireEvent.click(container.querySelector('.diff-open-actions .codicon-go-to-file')!.closest('button')!);
    expect(lastPosted('openWorkingFileAtLine')?.payload).toEqual({ ref: 'abc', path: 'src/foo.ts', line: 30 });
  });

  it('offers none of this without refs', async () => {
    const { container } = render(FileDiffView, { diff: diff(), commitHash: 'abc' });
    await settle();
    expect(container.querySelector('.diff-gap-bar')).toBeNull();
    expect(container.querySelector('.hunk-open-btn')).toBeNull();
    expect(container.querySelector('.diff-open-actions')).toBeNull();
  });
});
