<script lang="ts">
  export let value = '';
  export let element: HTMLTextAreaElement | null = null;
  export let size: 'compact' | 'editor' = 'editor';
  export let stretch = false;
</script>

<textarea
  {...$$restProps}
  bind:this={element}
  bind:value
  class="ui-textarea {$$restProps.class ?? ''}"
  class:compact={size === 'compact'}
  class:stretch
  on:keydown
  on:focus
  on:blur
></textarea>

<style>
  .ui-textarea {
    display: block;
    width: 100%;
    min-height: calc(270px * var(--app-component-scale, 1));
    margin-top: calc(8px * var(--app-component-scale, 1));
    padding: calc(13px * var(--app-component-scale, 1));
    resize: vertical;
    border: 1px solid color-mix(in srgb, var(--color-app-text) 14%, transparent);
    border-radius: var(--app-control-radius, 10px);
    outline: 0;
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    font-family: var(--font-mono, ui-monospace, 'SFMono-Regular', Consolas, monospace),system-ui;
    font-size: calc(15px * var(--font-scale, 1));
    line-height: 1.7;
    transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
  }

  .ui-textarea.compact {
    min-height: calc(79px * var(--app-component-scale, 1));
    margin-top: 0;
    padding: calc(8px * var(--app-component-scale, 1));
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.55;
  }

  .ui-textarea.stretch { min-height: calc(160px * var(--app-component-scale, 1)); flex: 1; }

  .ui-textarea::placeholder { color: var(--text-dim); opacity: 1; }
  .ui-textarea:focus {
    border-color: #8a993e;
    box-shadow: 0 0 0 calc(3px * var(--app-component-scale, 1)) rgba(138, 153, 62, 0.12);
  }
</style>
