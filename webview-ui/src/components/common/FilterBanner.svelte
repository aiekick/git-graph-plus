<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';

  // A filter the graph is restricted to (file / line history, search in
  // changes): what it is, the value, an optional badge and a way back.
  interface Props {
    icon: string;
    label: string;
    value: string;
    badge?: string;
    note?: string;
    onClear: () => void;
  }

  let { icon, label, value, badge, note, onClear }: Props = $props();
</script>

<div class="filter-banner" role="status">
  <i class="codicon codicon-{icon}"></i>
  <span class="label">{label}</span>
  <span class="value" use:tooltip={value}>{value}</span>
  {#if badge}<span class="badge">{badge}</span>{/if}
  {#if note}<span class="note" use:tooltip={note}><i class="codicon codicon-info"></i></span>{/if}
  <button class="clear" onclick={onClear}>
    <i class="codicon codicon-close"></i>
    <span>{t('history.showAll')}</span>
  </button>
</div>

<style>
  .filter-banner {
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
  .value {
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .badge {
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
