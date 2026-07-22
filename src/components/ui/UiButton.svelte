<script lang="ts">
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  export let tone: 'neutral' | 'accent' | 'danger' | 'ghost' = 'neutral';
  export let fullWidth = false;
</script>

<button
  {...$$restProps}
  {type}
  class="ui-button {$$restProps.class ?? ''}"
  class:full-width={fullWidth}
  class:size-xs={size === 'xs'}
  class:size-sm={size === 'sm'}
  class:size-md={size === 'md'}
  class:size-lg={size === 'lg'}
  class:tone-accent={tone === 'accent'}
  class:tone-danger={tone === 'danger'}
  class:tone-ghost={tone === 'ghost'}
  on:click
  on:keydown
>
  <slot />
</button>

<style>
  .ui-button {
    --ui-button-height: 38px;
    --ui-button-padding-x: 13px;
    --ui-button-font-size: 12px;
    display: inline-flex;
    min-height: calc(var(--ui-button-height) * var(--app-component-scale, 1));
    align-items: center;
    justify-content: center;
    gap: calc(6px * var(--app-component-scale, 1));
    padding: calc(7px * var(--app-component-scale, 1)) calc(var(--ui-button-padding-x) * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
    border-radius: var(--app-control-radius, 10px);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    font-size: calc(var(--ui-button-font-size) * var(--font-scale, 1));
    font-weight: 750;
    line-height: 1.2;
    white-space: nowrap;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
  }

  .size-xs { --ui-button-height: 26px; --ui-button-padding-x: 7px; --ui-button-font-size: 9px; }
  .size-sm { --ui-button-height: 32px; --ui-button-padding-x: 10px; --ui-button-font-size: 11px; }
  .size-lg { --ui-button-height: 46px; --ui-button-padding-x: 18px; --ui-button-font-size: 15px; }
  .full-width { width: 100%; }

  .tone-accent {
    border-color: color-mix(in srgb, var(--accent) 48%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: color-mix(in srgb, var(--accent) 78%, currentColor);
  }

  .tone-danger {
    border-color: color-mix(in srgb, var(--danger) 48%, transparent);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: color-mix(in srgb, var(--danger) 78%, currentColor);
  }

  .tone-ghost { border-color: transparent; background: transparent; }
  .ui-button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 13%, transparent); }
  .tone-accent:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .tone-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 22%, transparent); }
</style>
