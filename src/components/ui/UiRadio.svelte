<script lang="ts">
  export let name: string;
  export let value: unknown;
  export let group: unknown;
  export let disabled = false;
  export let battle = false;
</script>

<label class="ui-radio {$$restProps.class ?? ''}" class:battle class:disabled>
  <input {...$$restProps} type="radio" {name} {value} {disabled} bind:group />
  <span><slot /></span>
</label>

<style>
  .ui-radio {
    display: flex;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: var(--battle-control-height, calc(46px * var(--app-component-scale, 1)));
    box-sizing: border-box;
    align-items: center;
    gap: calc(9px * var(--app-component-scale, 1));
    padding: calc(10px * var(--app-component-scale, 1)) calc(12px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--color-app-text) 14%, transparent);
    border-radius: var(--app-control-radius, 10px);
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 800;
    line-height: 1.2;
  }

  .battle {
    border-color: rgb(255 255 255 / 14%);
    background: linear-gradient(145deg, rgb(255 255 255 / 8%), rgb(255 255 255 / 3%));
    color: var(--on-dark);
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 900;
    box-shadow: inset 0 1px rgb(255 255 255 / 6%);
  }

  input {
    width: calc(14px * var(--app-component-scale, 1));
    height: calc(14px * var(--app-component-scale, 1));
    flex: 0 0 auto;
    margin: 0;
    accent-color: var(--accent-strong);
  }

  span {
    min-width: 0;
    overflow: visible;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }
  .ui-radio:has(input:checked) { border-color: var(--accent-strong); background: var(--accent-soft); color: var(--accent-ink); }
  .battle:has(input:checked) {
    border-color: color-mix(in srgb, var(--accent) 58%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, rgb(255 255 255 / 4%));
    color: var(--on-dark);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 6px 18px rgb(0 0 0 / 14%);
  }
  .disabled { cursor: not-allowed; opacity: 0.48; }
</style>
