import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/svelte';
import StatsView from '../StatsView.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import type { StatsReport } from '../../../lib/stats';

function lastRequest() {
  return globalThis.__postedMessages
    .map(m => m.data as { type: string; payload: Record<string, unknown> })
    .filter(m => m.type === 'getStatsReport')
    .at(-1);
}

function report(): StatsReport {
  const authors = Array.from({ length: 30 }, (_, i) => ({
    key: `p${i}@x.org`, name: `Person ${i}`, names: [`Person ${i}`],
    commits: 100 - i, additions: 10 * i, deletions: i, files: 3,
    firstDate: '2026-01-01', lastDate: '2026-03-01',
  }));
  return {
    totals: { commits: 2000, authors: 30, additions: 500, deletions: 80, files: 40, firstDate: '2026-01-01', lastDate: '2026-03-01' },
    authors,
    timeline: { unit: 'week', starts: ['2026-01-05', '2026-01-12'], total: [5, 7], byAuthor: { 'p0@x.org': [2, 1] } },
    files: [{ path: 'src/a.ts', commits: 12, additions: 30, deletions: 4, authors: 5 }],
    folders: [{ path: 'src', commits: 20, additions: 50, deletions: 9, authors: 7 }],
    authorTopFiles: { 'p0@x.org': [{ path: 'src/a.ts', commits: 4 }] },
    weekdayHour: Array.from({ length: 7 }, () => new Array(24).fill(1)),
  };
}

async function deliver(r: StatsReport | null = report()) {
  const req = lastRequest()!;
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'statsReport', payload: { filter: req.payload, report: r } } }));
}

afterEach(() => cleanup());

beforeEach(() => {
  i18n.setLocale('en');
  globalThis.__postedMessages = [];
});

describe('StatsView', () => {
  it('asks for the last year on all branches by default, with a spinner meanwhile', () => {
    const { container } = render(StatsView);
    const req = lastRequest()!;
    expect(req.payload.scope).toBe('all');
    expect(typeof req.payload.since).toBe('string');
    expect(container.querySelector('.spinner')).not.toBeNull();
  });

  it('re-requests when the period changes', async () => {
    const { getByText } = render(StatsView);
    await fireEvent.click(getByText('All'));
    expect(lastRequest()!.payload.since).toBeUndefined();
  });

  it('shows the KPI tiles and pages the contributors 25 at a time', async () => {
    const { container, getByText } = render(StatsView);
    await deliver();
    await waitFor(() => expect(container.querySelectorAll('.tile').length).toBe(6));
    const rows = () => container.querySelectorAll('.contributors tbody tr').length;
    expect(rows()).toBe(25);
    await fireEvent.click(getByText('Show more (5 left)'));
    expect(rows()).toBe(30);
  });

  it('filters people by name or e-mail', async () => {
    const { container } = render(StatsView);
    await deliver();
    const input = container.querySelector('.mini-search') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'p12@' } });
    expect(container.querySelectorAll('.contributors tbody tr')).toHaveLength(1);
  });

  it('opens a person card with their top files, which link to the file history', async () => {
    const { container } = render(StatsView);
    await deliver();
    await waitFor(() => container.querySelector('.contributors tbody tr'));
    await fireEvent.click(container.querySelector('.contributors tbody tr')!);
    expect(container.querySelector('.person-name')?.textContent).toBe('Person 0');
    // Selected author is overlaid on the activity chart, with a legend.
    expect(container.querySelector('.legend')).not.toBeNull();
    await fireEvent.click(container.querySelector('.person-files .link')!);
    const sent = globalThis.__postedMessages.map(m => m.data as { type: string; payload: unknown }).find(m => m.type === 'showPathHistory');
    expect(sent?.payload).toEqual({ path: 'src/a.ts' });
    expect(uiStore.viewMode).toBe('graph');
  });

  it('switches hotspots between files and folders', async () => {
    const { container, getByText } = render(StatsView);
    await deliver();
    await waitFor(() => container.querySelector('.hotspots tbody tr'));
    expect(container.querySelector('.hotspots tbody .path')?.textContent).toBe('src/a.ts');
    await fireEvent.click(getByText('Folders'));
    expect(container.querySelector('.hotspots tbody .path')?.textContent).toBe('src');
  });

  it('renders the 7×24 heatmap', async () => {
    const { container } = render(StatsView);
    await deliver();
    await waitFor(() => container.querySelector('.heatmap'));
    // header row + 7 day rows
    expect(container.querySelectorAll('.heatmap .heatmap-row')).toHaveLength(8);
    expect(container.querySelectorAll('.heatmap .heatmap-row')[1].querySelectorAll('.heatmap-cell')).toHaveLength(24);
  });

  it('ignores a report for an outdated filter', async () => {
    const { container, getByText } = render(StatsView);
    const old = lastRequest()!;
    await fireEvent.click(getByText('All'));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'statsReport', payload: { filter: old.payload, report: report() } } }));
    await Promise.resolve();
    expect(container.querySelector('.tiles')).toBeNull();
  });
});
