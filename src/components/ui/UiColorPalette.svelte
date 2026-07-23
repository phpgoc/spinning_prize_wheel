<script lang="ts">
  export let label: string;
  export let value: string;
  export let colors = ['#111827', '#282c34', '#3e4451', '#5b6078', '#98c379', '#7dcfff', '#fabd2f', '#f87171'];

  let input: HTMLInputElement;

  function selectColor(color: string) {
    input.value = color;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
</script>

<div class="ui-color-palette" role="group" aria-label={`${label}设置`}>
  <label class="current-color">
    <span>{label.replace('颜色', '')}</span>
    <span class="color-well" style={`--color-value: ${value};`}>
      <input bind:this={input} type="color" aria-label={label} {value} on:input />
    </span>
  </label>
  <div class="color-swatches" aria-label={`${label} 调色板`}>
    {#each colors as color}
      <button
        type="button"
        class:selected={value.toLowerCase() === color.toLowerCase()}
        style={`--color-value: ${color};`}
        aria-label={`${label} ${color}`}
        title={color}
        on:click={() => selectColor(color)}
      ></button>
    {/each}
  </div>
</div>

<style>
  .ui-color-palette {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: calc(7px * var(--app-component-scale, 1));
    padding: calc(5px * var(--app-component-scale, 1)) calc(7px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 18%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 4%, transparent);
    color: var(--battle-text-color, var(--color-app-text));
  }

  .current-color {
    display: grid;
    justify-items: center;
    gap: 3px;
    color: inherit;
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 800;
  }

  .color-well {
    position: relative;
    display: block;
    width: calc(27px * var(--app-component-scale, 1));
    height: calc(24px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 32%, transparent);
    border-radius: 5px;
    background: var(--color-value);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 16%);
    overflow: hidden;
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    cursor: pointer;
    opacity: 0;
  }

  .color-swatches {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 3px;
  }

  .color-swatches button {
    width: 100%;
    min-width: calc(12px * var(--app-component-scale, 1));
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 16%);
    border-radius: 4px;
    background: var(--color-value);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 9%);
  }

  .color-swatches button:hover,
  .color-swatches button:focus-visible { outline: 2px solid var(--accent, var(--color-app-accent)); outline-offset: 2px; }
  .color-swatches button.selected { border-color: #fff; box-shadow: 0 0 0 1px var(--accent, var(--color-app-accent)); }
</style>
