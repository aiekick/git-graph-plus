<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import type { HistoryFilter } from '../../lib/types';

  interface Props {
    filter: HistoryFilter;
    onClear: () => void;
  }

  let { filter, onClear }: Props = $props();

  const hasLines = $derived(filter.startLine !== undefined && filter.endLine !== undefined);
</script>

<!-- Shown while the graph is restricted to a file's (or line range's) history. -->
<div class="history-banner" role="status">
  <i class="codicon codicon-history"></i>
  <span class="label">{hasLines ? t('history.linesOf') : t('history.fileOf')}</span>
  <span class="path" use:tooltip={filter.path}>{filter.path}</span>
  {#if hasLines}
    <span class="range">{filter.startLine === filter.endLine ? `L${filter.startLine}` : `L${filter.startLine}–${filter.endLine}`}</span>
  {/if}
  <span class="note" use:tooltip={t('history.renamesNote')}><i class="codicon codicon-info"></i></span>
  <button class="clear" onclick={onClear}>
    <i class="codicon codicon-close"></i>
    <span>{t('history.showAll')}</span>
  </button>
</div>

<style>
  .history-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 12px;
    background: rgba(33, 150, 243, 0.08);
    border-bottom: 1px solid rgba(33, 150, 243, 0.3);
    font-size: 12px;
  }
  .label {
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .path {
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .range {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 8px;
    background: rgba(33, 150, 243, 0.18);
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .note {
    display: flex;
    color: var(--text-secondary);
    opacity: 0.8;
  }
  .clear {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
    padding: 2px 8px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
  }
  .clear:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }
</style>
