<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import UiButton from './UiButton.svelte';

  export let titleId: string;
  export let detailId: string;
  export let icon = '!';
  export let title: string;
  export let detail: string;
  export let confirmLabel = '确认';
  export let cancelLabel: string | null = '取消';
  export let tone: 'neutral' | 'accent' | 'danger' = 'danger';
  export let confirmDisabled = false;
  export let cancelDisabled = false;
  export let confirmShortcuts = 'Y Enter';
  export let cancelShortcuts = 'N Escape';
  export let dialogClass = '';

  const dispatch = createEventDispatcher<{ confirm: void; cancel: void }>();
</script>

<div class="ui-confirm-backdrop">
  <div
    class="ui-confirm-dialog {dialogClass}"
    class:single-action={cancelLabel === null}
    class:tone-accent={tone === 'accent'}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={detailId}
    tabindex="-1"
  >
    <span class="ui-confirm-icon">{icon}</span>
    <h2 id={titleId}>{title}</h2>
    <p id={detailId}>{detail}</p>
    <div class="ui-confirm-actions">
      {#if cancelLabel !== null}
        <UiButton fullWidth aria-keyshortcuts={cancelShortcuts} disabled={cancelDisabled} on:click={() => dispatch('cancel')}>
          <span>{cancelLabel}</span>
        </UiButton>
      {/if}
      <UiButton fullWidth {tone} aria-keyshortcuts={confirmShortcuts} disabled={confirmDisabled} on:click={() => dispatch('confirm')}>
        <span>{confirmLabel}</span>
      </UiButton>
    </div>
  </div>
</div>

<style>
  .ui-confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: grid;
    padding: calc(24px * var(--app-component-scale, 1));
    background: rgba(8, 9, 7, 0.72);
    backdrop-filter: blur(6px);
    place-items: center;
  }

  .ui-confirm-dialog {
    width: min(100%, calc(390px * var(--app-component-scale, 1)));
    padding: calc(25px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
    border-radius: var(--app-frame-radius, calc(18px * var(--app-component-scale, 1)));
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    box-shadow: 0 calc(28px * var(--app-component-scale, 1)) calc(80px * var(--app-component-scale, 1)) rgba(0, 0, 0, 0.46);
    text-align: center;
  }

  .ui-confirm-icon {
    display: grid;
    width: calc(42px * var(--app-component-scale, 1));
    height: calc(42px * var(--app-component-scale, 1));
    margin: 0 auto calc(13px * var(--app-component-scale, 1));
    border-radius: 50%;
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: color-mix(in srgb, var(--danger) 78%, var(--color-app-text));
    font-size: calc(25px * var(--font-scale, 1));
    font-weight: 900;
    place-items: center;
  }

  .tone-accent .ui-confirm-icon {
    background: color-mix(in srgb, var(--accent-strong) 13%, transparent);
    color: var(--accent-ink);
  }

  h2 { font-size: calc(20px * var(--font-scale, 1)); }

  p {
    margin-top: calc(9px * var(--app-component-scale, 1));
    color: var(--color-app-muted);
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.6;
  }

  .ui-confirm-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: calc(9px * var(--app-component-scale, 1));
    margin-top: calc(20px * var(--app-component-scale, 1));
  }

  .single-action .ui-confirm-actions { grid-template-columns: minmax(0, 1fr); }
</style>
