<script lang="ts">
  export let checked = false;
  export let disabled = false;
  export let compact = false;
  export let reveal = false;
  export let battleAction = false;
</script>

<label class="ui-checkbox {$$restProps.class ?? ''}" class:compact class:disabled class:reveal class:battle-action={battleAction}>
  <input {...$$restProps} type="checkbox" bind:checked {disabled} on:change />
  <span><slot /></span>
</label>

<style>
  .ui-checkbox {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: calc(42px * var(--app-component-scale, 1));
    box-sizing: border-box;
    align-items: center;
    gap: calc(7px * var(--app-component-scale, 1));
    padding: calc(8px * var(--app-component-scale, 1)) calc(10px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--color-app-text) 14%, transparent);
    border-radius: var(--app-control-radius, 10px);
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 800;
    line-height: 1.2;
  }

  .compact { min-height: calc(34px * var(--app-component-scale, 1)); padding-block: calc(5px * var(--app-component-scale, 1)); }
  .reveal {
    min-height: calc(48px * var(--app-component-scale, 1));
    margin-top: calc(12px * var(--app-component-scale, 1));
    border-color: rgb(255 255 255 / 10%);
    background: rgb(255 255 255 / 3.5%);
    color: var(--on-dark-muted);
  }
  .battle-action {
    width: 100%;
    max-width: 100%;
    min-height: var(--battle-control-height, auto);
    margin: 0;
    padding: calc(10px * var(--app-component-scale, 1)) calc(12px * var(--app-component-scale, 1));
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 900;
  }
  input {
    width: calc(14px * var(--app-component-scale, 1));
    height: calc(14px * var(--app-component-scale, 1));
    flex: 0 0 auto;
    margin: 0;
    accent-color: var(--accent-strong);
  }

  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .battle-action span { overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; }
  .ui-checkbox:has(input:checked) { border-color: var(--accent-strong); background: var(--accent-soft); color: var(--accent-ink); }
  .disabled { cursor: not-allowed; opacity: 0.48; }
</style>
