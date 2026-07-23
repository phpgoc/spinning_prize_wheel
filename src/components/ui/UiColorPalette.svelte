<script lang="ts">
  import iro from '@jaames/iro';
  import { onDestroy, tick } from 'svelte';

  export let label: string;
  export let value: string;

  let input: HTMLInputElement;
  let pickerHost: HTMLDivElement | null = null;
  let picker: iro.ColorPicker | null = null;
  let pickerChangeHandler: ((color: iro.Color) => void) | null = null;
  let open = false;

  $: panelId = `color-palette-${label.replace(/[^\p{L}\p{N}]+/gu, '-')}`;

  // 外部色盘只在浮层打开后初始化，避免四个控件常驻时增加页面负担。
  $: if (open && pickerHost && !picker) {
    void tick().then(() => {
      if (!picker && pickerHost) createPicker();
    });
  }

  // 预设按钮或外部输入改变颜色时，同步已经打开的色盘。
  $: if (picker && value && picker.color.hexString.toLowerCase() !== value.toLowerCase()) {
    picker.color.set(value);
  }

  function createPicker() {
    if (!pickerHost) return;
    const nextPicker = iro.ColorPicker(pickerHost, {
      width: 132,
      color: value,
      wheelLightness: false,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.28)',
      layout: [{ component: iro.ui.Wheel }],
    });
    picker = nextPicker;
    pickerChangeHandler = (color: iro.Color) => selectColor(color.hexString);
    nextPicker.on('color:change', pickerChangeHandler);
  }

  function selectColor(color: string) {
    input.value = color;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function togglePalette() {
    open = !open;
    if (open) await tick();
    else destroyPicker();
  }

  function destroyPicker() {
    if (picker && pickerChangeHandler) picker.off('color:change', pickerChangeHandler);
    picker = null;
    pickerChangeHandler = null;
  }

  function closePaletteOnEscape(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      open = false;
      destroyPicker();
    }
  }

  function closePaletteOutside(node: HTMLElement) {
    function handlePointerDown(event: PointerEvent) {
      if (open && event.target instanceof Node && !node.contains(event.target)) {
        open = false;
        destroyPicker();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true);
    return {
      destroy() {
        document.removeEventListener('pointerdown', handlePointerDown, true);
      },
    };
  }

  onDestroy(() => {
    destroyPicker();
  });
</script>

<svelte:window on:keydown={closePaletteOnEscape} />

<div use:closePaletteOutside class:open class="ui-color-palette">
  <button
    type="button"
    class="palette-trigger"
    aria-label={`展开${label.replace('颜色', '')}色盘`}
    aria-expanded={open}
    aria-controls={panelId}
    on:click={togglePalette}
  >
    <span class="trigger-color" style={`--color-value: ${value};`}></span>
    <span>{label.replace('颜色', '')}</span>
    <small>{value}</small>
  </button>
  <label class="native-color-input" title="打开系统取色器">
    <span class="color-well" style={`--color-value: ${value};`}></span>
    <input bind:this={input} type="color" aria-label={label} {value} on:input />
  </label>

  {#if open}
    <div id={panelId} class="palette-popover" role="dialog" aria-label={`${label.replace('颜色', '')}色盘`}>
      <div bind:this={pickerHost} class="iro-picker"></div>
    </div>
  {/if}
</div>

<style>
  .ui-color-palette { position: relative; display: flex; min-width: 0; align-items: stretch; gap: 4px; color: var(--battle-text-color, var(--color-app-text)); }
  .palette-trigger {
    display: grid;
    min-width: 0;
    min-height: calc(38px * var(--app-component-scale, 1));
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    gap: 1px 6px;
    padding: 5px 7px;
    border: 1px solid color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 18%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 4%, transparent);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .palette-trigger:hover,
  .open .palette-trigger { border-color: color-mix(in srgb, var(--accent) 52%, transparent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .palette-trigger > span:nth-child(2) { overflow: hidden; font-size: calc(10px * var(--font-scale, 1)); font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
  .palette-trigger small { grid-column: 2; color: color-mix(in srgb, currentColor 58%, transparent); font-family: var(--font-mono, ui-monospace, monospace); font-size: calc(8px * var(--font-scale, 1)); }
  .trigger-color { width: 17px; height: 17px; grid-row: 1 / 3; border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: var(--color-value); box-shadow: inset 0 0 0 2px rgb(0 0 0 / 18%); }
  .palette-popover { position: absolute; z-index: 120; top: calc(100% + 7px); right: 0; display: grid; min-width: 150px; justify-items: center; padding: 10px; border: 1px solid color-mix(in srgb, var(--battle-text-color, white) 24%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--battle-background-color, #282c34) 96%, black); box-shadow: 0 12px 30px rgb(0 0 0 / 42%); }
  .iro-picker { width: 132px; min-height: 132px; }
  :global(.IroColorPicker) { margin: 0 auto; }
  .native-color-input { position: relative; display: grid; width: calc(30px * var(--app-component-scale, 1)); min-width: calc(30px * var(--app-component-scale, 1)); border: 1px solid color-mix(in srgb, var(--battle-text-color, white) 18%, transparent); border-radius: 8px; cursor: pointer; place-items: center; }
  .color-well { display: block; width: 16px; height: 16px; border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: var(--color-value); box-shadow: inset 0 0 0 2px rgb(0 0 0 / 18%); }
  .native-color-input input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; opacity: 0; cursor: pointer; }
</style>
