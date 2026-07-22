<script lang="ts">
  import UiDateRange from './UiDateRange.svelte';

  export let start = '';
  export let end = '';
  export let loading = false;
  export let loadingText = '正在读取历史…';
  export let empty = false;
  export let emptyText = '还没有历史记录';
</script>

<section class="ui-history-panel">
  <UiDateRange bind:start bind:end />
  <slot name="notice" />

  <div class="ui-history-list">
    {#if loading}
      <div class="ui-history-empty busy"><i>···</i><strong>{loadingText}</strong></div>
    {:else if empty}
      <div class="ui-history-empty"><i>◷</i><strong>{emptyText}</strong></div>
    {:else}
      <slot />
    {/if}
  </div>

  <div class="ui-history-footer"><slot name="actions" /></div>
  <slot name="status" />
</section>

<style>
  .ui-history-panel { display: grid; min-width: 0; gap: calc(9px * var(--app-component-scale, 1)); }

  .ui-history-list {
    display: grid;
    min-width: 0;
    gap: calc(8px * var(--app-component-scale, 1));
  }

  .ui-history-empty {
    display: grid;
    min-height: calc(112px * var(--app-component-scale, 1));
    padding: calc(18px * var(--app-component-scale, 1));
    border: 1px dashed color-mix(in srgb, var(--color-app-text) 14%, transparent);
    border-radius: calc(13px * var(--app-component-scale, 1));
    background: linear-gradient(145deg, rgb(255 255 255 / 38%), rgb(255 255 255 / 9%));
    color: var(--color-app-muted);
    gap: calc(7px * var(--app-component-scale, 1));
    text-align: center;
    place-content: center;
  }

  .ui-history-empty i {
    color: var(--accent-strong);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: calc(22px * var(--font-scale, 1));
    font-style: normal;
  }

  .ui-history-empty strong { font-size: calc(11px * var(--font-scale, 1)); }
  .ui-history-empty.busy i { letter-spacing: 0.14em; }

  .ui-history-footer {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(48px + 38px * var(--font-scale, 1))), 1fr));
    gap: calc(6px * var(--app-component-scale, 1));
    padding-top: calc(9px * var(--app-component-scale, 1));
    border-top: 1px solid color-mix(in srgb, var(--color-app-text) 9%, transparent);
  }
</style>
