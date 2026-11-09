<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { avatarStore } from '../../lib/stores/avatars.svelte';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { uiStore } from '../../lib/stores/ui.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { toCsv } from '../../lib/graph-export';
  import {
    bucketLabel, filterAndSortAuthors, periodBounds,
    type AuthorSortKey, type StatsFilter, type StatsPeriod, type StatsReport,
  } from '../../lib/stats';

  const vscode = getVsCodeApi();
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const PAGE = 25;
  const PERIODS: StatsPeriod[] = ['30d', '90d', '6m', '1y', 'all', 'custom'];

  // ── Filters ── (one row above everything; each change reloads the report)
  let period = $state<StatsPeriod>('1y');
  let customFrom = $state('');
  let customTo = $state('');
  let scope = $state('all');
  let pathInput = $state('');
  let pathFilter = $state('');

  const filter = $derived.by((): StatsFilter => ({
    ...periodBounds(period, new Date(), { from: customFrom, to: customTo }),
    scope,
    ...(pathFilter ? { path: pathFilter } : {}),
  }));

  let report = $state<StatsReport | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let requestedKey = '';

  $effect(() => {
    const f = filter;
    requestedKey = JSON.stringify(f);
    loading = true;
    error = null;
    vscode.postMessage({ type: 'getStatsReport', payload: { ...f } });
  });

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg?.type !== 'statsReport' || JSON.stringify(msg.payload.filter) !== requestedKey) return;
      report = msg.payload.report;
      error = msg.payload.error ?? null;
      loading = false;
      if (selected && !report?.authors.some(a => a.key === selected)) selected = null;
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  function applyPath() {
    pathFilter = pathInput.trim().replace(/^\/+|\/+$/g, '');
  }

  // ── Contributors ──
  let authorQuery = $state('');
  let sortKey = $state<AuthorSortKey>('commits');
  let sortDesc = $state(true);
  let authorShown = $state(PAGE);
  let selected = $state<string | null>(null);

  const authors = $derived(report ? filterAndSortAuthors(report.authors, authorQuery, sortKey, sortDesc) : []);
  const maxAuthorCommits = $derived(report ? Math.max(1, ...report.authors.map(a => a.commits)) : 1);
  const selectedAuthor = $derived(report?.authors.find(a => a.key === selected) ?? null);

  function sortBy(key: AuthorSortKey) {
    if (sortKey === key) sortDesc = !sortDesc;
    else { sortKey = key; sortDesc = key !== 'name'; }
  }

  // ── Hotspots ──
  let hotTab = $state<'files' | 'folders'>('files');
  let hotShown = $state(PAGE);
  const hot = $derived(report ? (hotTab === 'files' ? report.files : report.folders) : []);
  const maxHot = $derived(Math.max(1, ...hot.map(h => h.commits)));

  /** Opens the graph restricted to the history of a file or folder. */
  function showHistory(path: string) {
    vscode.postMessage({ type: 'showPathHistory', payload: { path } });
    uiStore.setViewMode('graph');
  }

  // ── Activity chart ──
  const CHART_H = 170;
  const PAD = { l: 40, r: 8, t: 10, b: 24 };
  let chartWidth = $state(600);
  let hoverIdx = $state<number | null>(null);

  const timeline = $derived(report?.timeline ?? { unit: 'month' as const, starts: [], total: [], byAuthor: {} });
  const authorSeries = $derived(selected ? timeline.byAuthor[selected] ?? null : null);
  const plotW = $derived(Math.max(10, chartWidth - PAD.l - PAD.r));
  const plotH = CHART_H - PAD.t - PAD.b;
  const slot = $derived(timeline.starts.length > 0 ? plotW / timeline.starts.length : plotW);
  const gap = $derived(slot >= 8 ? 2 : slot >= 4 ? 1 : 0);
  const barW = $derived(Math.max(1, slot - gap));
  /** A round axis maximum (1, 2, 5 × 10^n) above the tallest bar. */
  const yMax = $derived.by(() => {
    const m = Math.max(1, ...timeline.total);
    const p = 10 ** Math.floor(Math.log10(m));
    return [1, 2, 5, 10].map(k => k * p).find(v => v >= m) ?? m;
  });
  const barY = (v: number) => PAD.t + plotH - (v / yMax) * plotH;
  const ticks = $derived.by(() => {
    const n = timeline.starts.length;
    if (n === 0) return [];
    const count = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
    const out = new Set<number>();
    for (let k = 0; k < count; k++) out.add(Math.round((k * (n - 1)) / (count - 1)));
    return [...out];
  });

  function onChartMove(e: MouseEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.l) / slot);
    hoverIdx = i >= 0 && i < timeline.starts.length ? i : null;
  }

  function bucketTitle(i: number): string {
    const s = timeline.starts[i];
    const label = bucketLabel(s, timeline.unit, true);
    return timeline.unit === 'week' ? t('stats.weekOf', { date: label }) : label;
  }

  // ── Weekday × hour heatmap ──
  const heatMax = $derived(report ? Math.max(1, ...report.weekdayHour.flat()) : 1);
  function heatColor(count: number): string {
    if (count === 0) return 'var(--heat-empty)';
    const k = Math.min(count / heatMax, 1);
    return `color-mix(in srgb, var(--chart-accent) ${Math.round(15 + k * 85)}%, transparent)`;
  }

  // ── Export ──
  function exportTable(kind: 'authors' | 'hot', format: 'xlsx' | 'csv') {
    const table = kind === 'authors'
      ? {
        headers: [t('stats.colName'), t('stats.colEmail'), t('stats.colCommits'), t('stats.colAdded'), t('stats.colRemoved'), t('stats.colFiles'), t('stats.colFirst'), t('stats.colLast')],
        rows: authors.map(a => [a.name, a.key, String(a.commits), String(a.additions), String(a.deletions), String(a.files), a.firstDate, a.lastDate]),
        numberColumns: [2, 3, 4, 5],
      }
      : {
        headers: [t('stats.colPath'), t('stats.colCommits'), t('stats.colAuthors'), t('stats.colAdded'), t('stats.colRemoved')],
        rows: hot.map(h => [h.path, String(h.commits), String(h.authors), String(h.additions), String(h.deletions)]),
        numberColumns: [1, 2, 3, 4],
      };
    const fileName = kind === 'authors' ? 'contributors' : `hotspots-${hotTab}`;
    const full = { ...table, laneColors: [], fileRows: [] };
    vscode.postMessage({
      type: 'saveSelectionExport',
      payload: format === 'xlsx'
        ? { format, table: full, fileName }
        : { format, text: toCsv(full, uiStore.csvDelimiter), fileName },
    });
  }

  const fmt = (n: number) => n.toLocaleString();
  const localBranches = $derived(branchStore.branches.filter(b => !b.remote).map(b => b.name).sort());
</script>

<div class="stats-view">
  <!-- Filters -->
  <div class="filters" role="group">
    <div class="segmented" role="radiogroup" aria-label={t('stats.period')}>
      {#each PERIODS as p}
        <button class:active={period === p} onclick={() => { period = p; }} role="radio" aria-checked={period === p}>{t(`stats.period.${p}`)}</button>
      {/each}
    </div>
    {#if period === 'custom'}
      <input type="date" bind:value={customFrom} aria-label={t('stats.from')} />
      <span class="dash">–</span>
      <input type="date" bind:value={customTo} aria-label={t('stats.to')} />
    {/if}
    <select bind:value={scope} aria-label={t('stats.scope')}>
      <option value="all">{t('stats.scopeAll')}</option>
      <option value="current">{t('stats.scopeCurrent')}</option>
      {#each localBranches as b}<option value={b}>{b}</option>{/each}
    </select>
    <div class="path-filter">
      <i class="codicon codicon-folder"></i>
      <input
        type="text"
        bind:value={pathInput}
        placeholder={t('stats.pathPlaceholder')}
        onkeydown={(e) => { if (e.key === 'Enter') applyPath(); }}
        onblur={applyPath}
      />
      {#if pathFilter}
        <button class="icon-btn" onclick={() => { pathInput = ''; applyPath(); }} aria-label={t('search.clear')}><i class="codicon codicon-close"></i></button>
      {/if}
    </div>
  </div>

  {#if loading && !report}
    <div class="loading"><span class="spinner"></span> {t('stats.loading')}</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if report}
    <div class="content" class:stale={loading}>
      {#if report.totals.commits === 0}
        <div class="empty">{t('stats.noCommits')}</div>
      {:else}
        <!-- KPI tiles -->
        <div class="tiles">
          <div class="tile"><span class="tile-value">{fmt(report.totals.commits)}</span><span class="tile-label">{t('stats.colCommits')}</span></div>
          <div class="tile"><span class="tile-value">{fmt(report.totals.authors)}</span><span class="tile-label">{t('stats.contributorsLabel')}</span></div>
          <div class="tile"><span class="tile-value">+{fmt(report.totals.additions)}</span><span class="tile-label">{t('stats.linesAdded')}</span></div>
          <div class="tile"><span class="tile-value">−{fmt(report.totals.deletions)}</span><span class="tile-label">{t('stats.linesRemoved')}</span></div>
          <div class="tile"><span class="tile-value">{fmt(report.totals.files)}</span><span class="tile-label">{t('stats.filesChanged')}</span></div>
          <div class="tile wide"><span class="tile-value small">{report.totals.firstDate} → {report.totals.lastDate}</span><span class="tile-label">{t('stats.activeSpan')}</span></div>
        </div>

        <!-- Activity -->
        <section class="card">
          <div class="card-header">
            <h3>{t('stats.activity')}</h3>
            <span class="sub">{t(`stats.per.${timeline.unit}`)}</span>
            {#if selectedAuthor}
              <span class="legend">
                <span class="swatch muted"></span>{t('stats.allContributors')}
                <span class="swatch accent"></span>{selectedAuthor.name}
              </span>
            {/if}
          </div>
          <div class="chart" bind:clientWidth={chartWidth}>
            <svg width={chartWidth} height={CHART_H} role="img" aria-label={t('stats.activity')}
                 onmousemove={onChartMove} onmouseleave={() => { hoverIdx = null; }}>
              <!-- recessive grid: baseline + mid + top -->
              {#each [0, 0.5, 1] as f}
                <line class="grid" x1={PAD.l} x2={PAD.l + plotW} y1={barY(yMax * f)} y2={barY(yMax * f)} />
                <text class="axis" x={PAD.l - 6} y={barY(yMax * f) + 3} text-anchor="end">{fmt(Math.round(yMax * f))}</text>
              {/each}
              {#each timeline.total as v, i}
                {#if v > 0}
                  <rect class={selectedAuthor ? 'bar muted' : 'bar accent'} class:hover={hoverIdx === i}
                        x={PAD.l + i * slot + gap / 2} y={barY(v)} width={barW} height={Math.max(1, PAD.t + plotH - barY(v))} rx={Math.min(2, barW / 2)} />
                {/if}
                {#if authorSeries && authorSeries[i] > 0}
                  <rect class="bar accent" class:hover={hoverIdx === i}
                        x={PAD.l + i * slot + gap / 2} y={barY(authorSeries[i])} width={barW} height={Math.max(1, PAD.t + plotH - barY(authorSeries[i]))} rx={Math.min(2, barW / 2)} />
                {/if}
              {/each}
              {#each ticks as i}
                <text class="axis" x={PAD.l + i * slot + slot / 2} y={CHART_H - 6} text-anchor="middle">{bucketLabel(timeline.starts[i], timeline.unit, i === ticks[0])}</text>
              {/each}
              {#if hoverIdx !== null}
                <line class="crosshair" x1={PAD.l + hoverIdx * slot + slot / 2} x2={PAD.l + hoverIdx * slot + slot / 2} y1={PAD.t} y2={PAD.t + plotH} />
              {/if}
            </svg>
            {#if hoverIdx !== null}
              <div class="chart-tip" style="left: {Math.min(chartWidth - 180, Math.max(0, PAD.l + hoverIdx * slot + slot / 2 - 90))}px">
                <div class="tip-title">{bucketTitle(hoverIdx)}</div>
                <div>{t('stats.nCommits', { count: timeline.total[hoverIdx] })}</div>
                {#if selectedAuthor && authorSeries}
                  <div class="tip-author">{selectedAuthor.name}: {authorSeries[hoverIdx]}</div>
                {/if}
              </div>
            {/if}
          </div>
        </section>

        <div class="columns">
          <!-- Contributors -->
          <section class="card contributors">
            <div class="card-header">
              <h3>{t('stats.contributors', { count: report.authors.length })}</h3>
              <div class="header-actions">
                <input class="mini-search" type="text" bind:value={authorQuery} placeholder={t('stats.searchPeople')} oninput={() => { authorShown = PAGE; }} />
                <button class="icon-btn" onclick={() => exportTable('authors', 'xlsx')} use:tooltip={t('stats.exportXlsx')} aria-label={t('stats.exportXlsx')}><i class="codicon codicon-table"></i></button>
                <button class="icon-btn" onclick={() => exportTable('authors', 'csv')} use:tooltip={t('stats.exportCsv')} aria-label={t('stats.exportCsv')}><i class="codicon codicon-export"></i></button>
              </div>
            </div>

            {#if selectedAuthor}
              <div class="person">
                <div class="person-head">
                  {#if avatarStore.enabled}<img class="avatar-lg" src={avatarStore.url(selectedAuthor.key, 40)} alt="" />{/if}
                  <div class="person-id">
                    <div class="person-name">{selectedAuthor.name}</div>
                    <div class="person-mail">{selectedAuthor.key}{#if selectedAuthor.names.length > 1} · {t('stats.alsoKnownAs')} {selectedAuthor.names.slice(1).join(', ')}{/if}</div>
                  </div>
                  <button class="icon-btn" onclick={() => { selected = null; }} aria-label={t('search.clear')}><i class="codicon codicon-close"></i></button>
                </div>
                <div class="person-stats">
                  <span><b>{fmt(selectedAuthor.commits)}</b> {t('stats.colCommits')}</span>
                  <span class="add">+{fmt(selectedAuthor.additions)}</span>
                  <span class="del">−{fmt(selectedAuthor.deletions)}</span>
                  <span><b>{fmt(selectedAuthor.files)}</b> {t('stats.colFiles')}</span>
                  <span>{selectedAuthor.firstDate} → {selectedAuthor.lastDate}</span>
                </div>
                {#if (report.authorTopFiles[selectedAuthor.key] ?? []).length > 0}
                  <div class="person-files-title">{t('stats.topFiles')}</div>
                  <ul class="person-files">
                    {#each report.authorTopFiles[selectedAuthor.key] as f}
                      <li>
                        <button class="link" onclick={() => showHistory(f.path)} use:tooltip={t('stats.showHistory')}>{f.path}</button>
                        <span class="count">{f.commits}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}

            <table class="grid-table">
              <thead>
                <tr>
                  <th class="rank">#</th>
                  <th><button class="sort" onclick={() => sortBy('name')}>{t('stats.colName')}{#if sortKey === 'name'} <i class="codicon codicon-arrow-{sortDesc ? 'down' : 'up'}"></i>{/if}</button></th>
                  <th class="num"><button class="sort" onclick={() => sortBy('commits')}>{t('stats.colCommits')}{#if sortKey === 'commits'} <i class="codicon codicon-arrow-{sortDesc ? 'down' : 'up'}"></i>{/if}</button></th>
                  <th class="num"><button class="sort" onclick={() => sortBy('additions')}>+{#if sortKey === 'additions'} <i class="codicon codicon-arrow-{sortDesc ? 'down' : 'up'}"></i>{/if}</button></th>
                  <th class="num"><button class="sort" onclick={() => sortBy('deletions')}>−{#if sortKey === 'deletions'} <i class="codicon codicon-arrow-{sortDesc ? 'down' : 'up'}"></i>{/if}</button></th>
                  <th class="num"><button class="sort" onclick={() => sortBy('lastDate')}>{t('stats.colLast')}{#if sortKey === 'lastDate'} <i class="codicon codicon-arrow-{sortDesc ? 'down' : 'up'}"></i>{/if}</button></th>
                </tr>
              </thead>
              <tbody>
                {#each authors.slice(0, authorShown) as a, i (a.key)}
                  <tr class="clickable" class:selected={selected === a.key} onclick={() => { selected = selected === a.key ? null : a.key; }}>
                    <td class="rank">{i + 1}</td>
                    <td>
                      <div class="who">
                        {#if avatarStore.enabled}<img class="avatar" src={avatarStore.url(a.key, 20)} alt="" />{/if}
                        <span class="truncate" use:tooltip={a.key}>{a.name}</span>
                      </div>
                    </td>
                    <td class="num">
                      <div class="bar-cell">
                        <span class="inline-bar" style="width: {(a.commits / maxAuthorCommits) * 100}%"></span>
                        <span class="val">{fmt(a.commits)}</span>
                      </div>
                    </td>
                    <td class="num add">{fmt(a.additions)}</td>
                    <td class="num del">{fmt(a.deletions)}</td>
                    <td class="num muted">{a.lastDate}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if authors.length > authorShown}
              <button class="more" onclick={() => { authorShown += PAGE * 2; }}>{t('stats.showMore', { count: authors.length - authorShown })}</button>
            {/if}
          </section>

          <!-- Hotspots -->
          <section class="card hotspots">
            <div class="card-header">
              <h3>{t('stats.hotspots')}</h3>
              <div class="segmented small">
                <button class:active={hotTab === 'files'} onclick={() => { hotTab = 'files'; hotShown = PAGE; }}>{t('stats.files')}</button>
                <button class:active={hotTab === 'folders'} onclick={() => { hotTab = 'folders'; hotShown = PAGE; }}>{t('stats.folders')}</button>
              </div>
              <div class="header-actions">
                <button class="icon-btn" onclick={() => exportTable('hot', 'xlsx')} use:tooltip={t('stats.exportXlsx')} aria-label={t('stats.exportXlsx')}><i class="codicon codicon-table"></i></button>
                <button class="icon-btn" onclick={() => exportTable('hot', 'csv')} use:tooltip={t('stats.exportCsv')} aria-label={t('stats.exportCsv')}><i class="codicon codicon-export"></i></button>
              </div>
            </div>
            <div class="hint">{t('stats.hotspotsHint')}</div>
            <table class="grid-table">
              <thead>
                <tr>
                  <th>{t('stats.colPath')}</th>
                  <th class="num">{t('stats.colCommits')}</th>
                  <th class="num" use:tooltip={t('stats.authorsHint')}>{t('stats.colAuthors')}</th>
                  <th class="num">+</th>
                  <th class="num">−</th>
                </tr>
              </thead>
              <tbody>
                {#each hot.slice(0, hotShown) as h (h.path)}
                  <tr class="clickable" onclick={() => showHistory(h.path)} use:tooltip={t('stats.showHistory')}>
                    <td><span class="truncate path">{h.path}</span></td>
                    <td class="num">
                      <div class="bar-cell">
                        <span class="inline-bar heat" style="width: {(h.commits / maxHot) * 100}%; opacity: {0.35 + 0.65 * (h.commits / maxHot)}"></span>
                        <span class="val">{fmt(h.commits)}</span>
                      </div>
                    </td>
                    <td class="num">{h.authors}</td>
                    <td class="num add">{fmt(h.additions)}</td>
                    <td class="num del">{fmt(h.deletions)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if hot.length > hotShown}
              <button class="more" onclick={() => { hotShown += PAGE * 2; }}>{t('stats.showMore', { count: hot.length - hotShown })}</button>
            {/if}
          </section>
        </div>

        <!-- Weekday × hour -->
        <section class="card">
          <div class="card-header"><h3>{t('stats.commitsByDayHour', { count: report.totals.commits })}</h3></div>
          <div class="heatmap">
            <div class="heatmap-row">
              <div class="heatmap-label"></div>
              {#each Array(24) as _, h}<div class="heatmap-hour">{h.toString().padStart(2, '0')}</div>{/each}
            </div>
            {#each [1, 2, 3, 4, 5, 6, 0] as d}
              <div class="heatmap-row">
                <div class="heatmap-label">{WEEKDAYS[d]}</div>
                {#each report.weekdayHour[d] as count, h}
                  <div class="heatmap-cell" style="background: {heatColor(count)}"
                       use:tooltip={`${WEEKDAYS[d]} ${h.toString().padStart(2, '0')}:00 · ${t('stats.nCommits', { count })}`}></div>
                {/each}
              </div>
            {/each}
            <div class="heatmap-legend">
              <span>{t('stats.less')}</span>
              {#each [0, 0.25, 0.5, 0.75, 1] as k}
                <div class="heatmap-cell legend" style="background: {k === 0 ? 'var(--heat-empty)' : `color-mix(in srgb, var(--chart-accent) ${Math.round(15 + k * 85)}%, transparent)`}"></div>
              {/each}
              <span>{t('stats.more')}</span>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stats-view {
    --chart-accent: var(--vscode-charts-blue, #3794ff);
    --chart-muted: color-mix(in srgb, var(--vscode-foreground, #888) 22%, transparent);
    --heat-empty: rgba(128, 128, 128, 0.08);
    height: 100%;
    overflow-y: auto;
    padding: 12px 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── Filters ── */
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .segmented {
    display: inline-flex;
    gap: 1px;
    padding: 1px;
    border-radius: 4px;
    background: rgba(128, 128, 128, 0.15);
  }
  .segmented button {
    padding: 3px 9px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .segmented.small button { padding: 1px 7px; font-size: 11px; }
  .segmented button.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  .filters select, .filters input[type="date"], .path-filter {
    height: 26px;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 4px;
    font-size: 12px;
    padding: 0 6px;
  }
  .dash { color: var(--text-secondary); }
  .path-filter {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 200px;
    flex: 1;
    max-width: 360px;
  }
  .path-filter i { color: var(--text-secondary); }
  .path-filter input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    outline: none;
    font-size: 12px;
  }

  .loading, .error, .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px;
    color: var(--text-secondary);
  }
  .error { color: var(--vscode-errorForeground, #f44336); }
  .content { display: flex; flex-direction: column; gap: 12px; transition: opacity 0.15s; }
  .content.stale { opacity: 0.55; pointer-events: none; }

  /* ── Tiles ── */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
  }
  .tile.wide { grid-column: span 2; }
  .tile-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .tile-value.small { font-size: 14px; padding-top: 5px; }
  .tile-label { font-size: 11px; color: var(--text-secondary); }

  /* ── Cards ── */
  .card {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--bg-primary, transparent);
    min-width: 0;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .card-header h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .sub, .hint { font-size: 11px; color: var(--text-secondary); }
  .hint { margin: -4px 0 6px; }
  .header-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 12px;
  }

  .legend {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; margin-left: 6px; }
  .swatch.accent { background: var(--chart-accent); }
  .swatch.muted { background: var(--chart-muted); }

  /* ── Chart ── */
  .chart { position: relative; width: 100%; }
  .chart svg { display: block; }
  .grid { stroke: rgba(128, 128, 128, 0.18); stroke-width: 1; }
  .axis { fill: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
  .bar.accent { fill: var(--chart-accent); }
  .bar.muted { fill: var(--chart-muted); }
  .bar.hover { filter: brightness(1.25); }
  .crosshair { stroke: var(--text-secondary); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; pointer-events: none; }
  .chart-tip {
    position: absolute;
    top: 0;
    width: 180px;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--border-color));
    background: var(--vscode-editorHoverWidget-background, var(--bg-secondary));
    color: var(--vscode-editorHoverWidget-foreground, var(--text-primary));
    font-size: 11px;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  .tip-title { font-weight: 600; margin-bottom: 2px; }
  .tip-author { color: var(--text-secondary); }

  /* ── Tables ── */
  .grid-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
  .grid-table th {
    text-align: left;
    font-weight: 500;
    color: var(--text-secondary);
    font-size: 11px;
    padding: 3px 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .grid-table td { padding: 3px 6px; border-bottom: 1px solid rgba(128, 128, 128, 0.08); }
  .grid-table .num { text-align: right; font-variant-numeric: tabular-nums; width: 70px; }
  .grid-table .rank { width: 28px; text-align: right; color: var(--text-secondary); opacity: 0.7; }
  .contributors .grid-table td:nth-child(3), .contributors .grid-table th:nth-child(3),
  .hotspots .grid-table td:nth-child(2), .hotspots .grid-table th:nth-child(2) { width: 120px; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover { background: var(--bg-hover); }
  tr.selected { background: var(--vscode-list-activeSelectionBackground, rgba(0, 120, 215, 0.25)); }
  .sort {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .sort i { font-size: 10px; }
  .who { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; display: block; }
  .path { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .avatar { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; }
  .bar-cell { position: relative; display: flex; justify-content: flex-end; align-items: center; height: 16px; }
  .inline-bar {
    position: absolute;
    left: 0;
    top: 5px;
    height: 6px;
    border-radius: 0 3px 3px 0;
    background: var(--chart-accent);
    opacity: 0.45;
  }
  .val { position: relative; }
  .add { color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); }
  .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336); }
  .muted { color: var(--text-secondary); }
  .more {
    margin-top: 6px;
    border: none;
    background: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 0;
  }
  .mini-search {
    height: 22px;
    width: 160px;
    padding: 0 6px;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 4px;
    font-size: 12px;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    padding: 2px 4px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15)); color: var(--text-primary); }

  /* ── Person card ── */
  .person {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }
  .person-head { display: flex; align-items: center; gap: 10px; }
  .avatar-lg { width: 36px; height: 36px; border-radius: 50%; }
  .person-id { flex: 1; min-width: 0; }
  .person-name { font-weight: 600; color: var(--text-primary); }
  .person-mail { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .person-stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 4px; font-size: 12px; color: var(--text-secondary); }
  .person-stats b { color: var(--text-primary); }
  .person-files-title { font-size: 11px; color: var(--text-secondary); margin-top: 6px; }
  .person-files { list-style: none; margin: 4px 0 0; padding: 0; }
  .person-files li { display: flex; align-items: center; gap: 8px; font-size: 11px; padding: 1px 0; }
  .person-files .count { margin-left: auto; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .link:hover { text-decoration: underline; }

  /* ── Heatmap ── */
  .heatmap { display: inline-flex; flex-direction: column; gap: 2px; }
  .heatmap-row { display: flex; gap: 2px; align-items: center; }
  .heatmap-label { width: 32px; font-size: 10px; color: var(--text-secondary); text-align: right; padding-right: 4px; flex-shrink: 0; }
  .heatmap-hour { width: 18px; font-size: 9px; color: var(--text-secondary); text-align: center; opacity: 0.6; }
  .heatmap-cell { width: 18px; height: 18px; border-radius: 3px; }
  .heatmap-legend { display: flex; align-items: center; gap: 3px; padding: 6px 0 0 36px; font-size: 10px; color: var(--text-secondary); }
  .heatmap-cell.legend { width: 12px; height: 12px; }
</style>
