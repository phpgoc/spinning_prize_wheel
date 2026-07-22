<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let eyebrow: string;
  export let title: string;
  export let hint = '查看 →';
  export let active = false;
  export let ariaLabel: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ select: void }>();
</script>

<article class="ui-history-row" class:active>
  <button type="button" class="ui-history-summary" aria-label={ariaLabel} on:click={() => dispatch('select')}>
    <span><i></i>{eyebrow}</span>
    <strong>{title}</strong>
    <small>{hint}</small>
  </button>
  <div class="ui-history-actions"><slot /></div>
</article>

<style>
  .ui-history-row {
    display: grid;
    min-width: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-app-text) 10%, transparent);
    border-radius: calc(13px * var(--app-component-scale, 1));
    background:
      radial-gradient(circle at 100% 0, rgb(var(--app-accent-rgb, 231 255 114) / 8%), transparent 48%),
      var(--color-app-surface-raised);
    box-shadow: 0 calc(7px * var(--app-component-scale, 1)) calc(20px * var(--app-component-scale, 1)) rgb(28 29 23 / 6%);
    transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
  }

  .ui-history-row:hover {
    border-color: color-mix(in srgb, var(--accent-strong) 35%, transparent);
    box-shadow: 0 calc(10px * var(--app-component-scale, 1)) calc(26px * var(--app-component-scale, 1)) rgb(28 29 23 / 10%);
    transform: translateY(-1px);
  }

  .ui-history-row.active {
    border-color: color-mix(in srgb, var(--accent-strong) 58%, transparent);
    box-shadow: inset calc(3px * var(--app-component-scale, 1)) 0 var(--accent-strong), 0 calc(9px * var(--app-component-scale, 1)) calc(24px * var(--app-component-scale, 1)) color-mix(in srgb, var(--accent-ink) 12%, transparent);
  }

  .ui-history-summary {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: calc(5px * var(--app-component-scale, 1));
    padding: calc(12px * var(--app-component-scale, 1));
    border: 0;
    outline-offset: -3px;
    background: transparent;
    color: var(--color-app-text);
    text-align: left;
  }

  .ui-history-summary > span {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: calc(6px * var(--app-component-scale, 1));
    color: var(--color-app-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: calc(9px * var(--font-scale, 1));
    font-weight: 700;
  }

  .ui-history-summary > span i {
    width: calc(6px * var(--app-component-scale, 1));
    height: calc(6px * var(--app-component-scale, 1));
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--accent-strong);
    box-shadow: 0 0 0 calc(3px * var(--app-component-scale, 1)) color-mix(in srgb, var(--accent-strong) 12%, transparent);
  }

  .ui-history-summary strong {
    overflow: hidden;
    font-size: calc(13px * var(--font-scale, 1));
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ui-history-summary small {
    color: var(--accent-strong);
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 750;
  }

  .ui-history-actions {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(28px + 27px * var(--font-scale, 1))), 1fr));
    gap: calc(5px * var(--app-component-scale, 1));
    padding: calc(7px * var(--app-component-scale, 1));
    border-top: 1px solid color-mix(in srgb, var(--color-app-text) 8%, transparent);
    background: color-mix(in srgb, var(--color-app-text) 2.5%, transparent);
  }
</style>
