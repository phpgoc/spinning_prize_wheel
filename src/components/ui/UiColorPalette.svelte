<script lang="ts">
  export let label: string;
  export let value: string;

  let input: HTMLInputElement;

  $: hue = hueFromHex(value);
  $: pointerX = 50 + Math.sin(hue * Math.PI / 180) * 36;
  $: pointerY = 50 - Math.cos(hue * Math.PI / 180) * 36;

  function selectColor(color: string) {
    input.value = color;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function selectFromWheel(event: PointerEvent) {
    const wheel = event.currentTarget as HTMLElement;
    const rect = wheel.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const angle = Math.atan2(x, -y) * 180 / Math.PI;
    const nextHue = (angle + 360) % 360;
    // 圆盘负责选择色相，明度和饱和度保持在适合深色对战区的范围。
    selectColor(hsvToHex(nextHue, 0.78, 0.94));
  }

  function moveWheel(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextHue = (hue + (event.key === 'ArrowRight' ? 8 : -8) + 360) % 360;
    selectColor(hsvToHex(nextHue, 0.78, 0.94));
  }

  function hueFromHex(color: string): number {
    const normalized = color.trim().replace('#', '');
    if (!/^[\da-f]{6}$/iu.test(normalized)) return 0;
    const values = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = values;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    if (delta === 0) return 0;
    let result = red === max
      ? ((green - blue) / delta) % 6
      : green === max
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
    result *= 60;
    return result < 0 ? result + 360 : result;
  }

  function hsvToHex(hueValue: number, saturation: number, brightness: number): string {
    const chroma = brightness * saturation;
    const segment = hueValue / 60;
    const x = chroma * (1 - Math.abs(segment % 2 - 1));
    const [red, green, blue] = segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
    const offset = brightness - chroma;
    return `#${[red, green, blue].map((component) => Math.round((component + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
  }
</script>

<div class="ui-color-palette">
  <div class="palette-heading">
    <strong>{label.replace('颜色', '')}</strong>
    <output>{value}</output>
  </div>
  <div class="palette-control">
    <button
      type="button"
      class="color-wheel"
      aria-label="色盘"
      style={`--pointer-x: ${pointerX}%; --pointer-y: ${pointerY}%;`}
      on:pointerdown={selectFromWheel}
      on:keydown={moveWheel}
    >
      <span class="wheel-pointer"></span>
      <span class="wheel-center" style={`--color-value: ${value};`}></span>
    </button>
    <label class="native-color-input" title="打开系统取色器">
      <span class="color-well" style={`--color-value: ${value};`}></span>
      <input bind:this={input} type="color" aria-label={label} {value} on:input />
    </label>
  </div>
</div>

<style>
  .ui-color-palette {
    display: grid;
    min-width: 0;
    gap: 6px;
    padding: calc(8px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 18%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--battle-text-color, var(--color-app-text)) 4%, transparent);
    color: var(--battle-text-color, var(--color-app-text));
  }

  .palette-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 6px; }
  .palette-heading strong { overflow: hidden; font-size: calc(10px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  .palette-heading output { color: color-mix(in srgb, currentColor 60%, transparent); font-family: var(--font-mono, ui-monospace, monospace); font-size: calc(9px * var(--font-scale, 1)); }
  .palette-control { display: flex; align-items: center; justify-content: center; gap: 8px; }

  .color-wheel {
    position: relative;
    display: block;
    width: calc(76px * var(--app-component-scale, 1));
    height: calc(76px * var(--app-component-scale, 1));
    padding: 0;
    border: 3px solid color-mix(in srgb, var(--battle-text-color, white) 28%, transparent);
    border-radius: 50%;
    background:
      radial-gradient(circle at center, rgb(0 0 0 / 0) 0 25%, rgb(0 0 0 / 18%) 78%, rgb(0 0 0 / 42%) 100%),
      conic-gradient(#ff3b30, #ffcc00, #34c759, #00c7be, #007aff, #af52de, #ff2d55, #ff3b30);
    box-shadow: 0 3px 12px rgb(0 0 0 / 22%), inset 0 0 0 1px rgb(255 255 255 / 18%);
    cursor: crosshair;
  }

  .color-wheel:focus-visible { outline: 2px solid var(--accent, var(--color-app-accent)); outline-offset: 3px; }
  .wheel-pointer { position: absolute; top: var(--pointer-y); left: var(--pointer-x); width: 10px; height: 10px; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px #20211b, 0 1px 5px rgb(0 0 0 / 45%); pointer-events: none; }
  .wheel-center { position: absolute; top: 50%; left: 50%; width: 17px; height: 17px; transform: translate(-50%, -50%); border: 2px solid rgb(255 255 255 / 78%); border-radius: 50%; background: var(--color-value); box-shadow: 0 1px 4px rgb(0 0 0 / 42%); pointer-events: none; }

  .native-color-input { position: relative; display: block; width: 20px; height: 20px; cursor: pointer; }
  .color-well { display: block; width: 100%; height: 100%; border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: var(--color-value); box-shadow: inset 0 0 0 2px rgb(0 0 0 / 18%); }
  .native-color-input input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; opacity: 0; cursor: pointer; }
</style>
