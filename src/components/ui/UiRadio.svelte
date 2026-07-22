<script lang="ts">
  export let name: string;
  export let value: unknown;
  export let group: unknown;
  export let disabled = false;
</script>

<label class="ui-radio {$$restProps.class ?? ''}" class:disabled>
  <input {...$$restProps} type="radio" {name} {value} {disabled} bind:group />
  <span><slot /></span>
</label>

<style>
  .ui-radio {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: var(--battle-control-height, calc(42px * var(--app-component-scale, 1)));
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

  input {
    width: calc(14px * var(--app-component-scale, 1));
    height: calc(14px * var(--app-component-scale, 1));
    flex: 0 0 auto;
    margin: 0;
    accent-color: #7d9134;
  }

  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ui-radio:has(input:checked) { border-color: #8a993e; background: #f2f6df; color: #465318; }
  .disabled { cursor: not-allowed; opacity: 0.48; }
</style>
