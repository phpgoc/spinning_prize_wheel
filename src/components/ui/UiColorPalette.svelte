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

  function commitHexValue(event: Event) {
    const field = event.currentTarget as HTMLInputElement;
    const next = field.value.trim();
    if (/^#[0-9a-f]{6}$/iu.test(next)) {
      selectColor(next.toLowerCase());
    } else {
      field.value = value;
    }
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
  <!-- 保留一个不可见的原生输入作为事件桥接，界面只显示一个圆盘入口。 -->
  <input bind:this={input} class="palette-value-input" type="color" aria-label={label} {value} on:input />

  {#if open}
    <div id={panelId} class="palette-popover" role="dialog" aria-label={`${label.replace('颜色', '')}色盘`}>
      <div bind:this={pickerHost} class="iro-picker"></div>
      <label class="palette-hex-field">
        <span>十六进制</span>
        <input class="palette-hex-input" value={value} maxlength="7" spellcheck="false" aria-label={`${label}十六进制`} on:change={commitHexValue} />
      </label>
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
  .palette-popover { position: absolute; z-index: 120; top: calc(100% + 7px); right: 0; display: grid; min-width: 150px; justify-items: center; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--battle-text-color, white) 24%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--battle-background-color, #282c34) 96%, black); box-shadow: 0 12px 30px rgb(0 0 0 / 42%); }
  .iro-picker { width: 132px; min-height: 132px; }
  :global(.IroColorPicker) { margin: 0 auto; }
  .palette-value-input { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; pointer-events: none; }
  .palette-hex-field { display: flex; width: 100%; align-items: center; gap: 6px; color: color-mix(in srgb, currentColor 72%, transparent); font-size: calc(10px * var(--font-scale, 1)); }
  .palette-hex-field span { flex: 0 0 auto; }
  .palette-hex-input {
    flex: 1;
    width: 70px;
    min-width: 0;
    padding: 4px 5px;
    border: 1px solid color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 18%, transparent);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: calc(10px * var(--font-scale, 1));
  }
</style>
