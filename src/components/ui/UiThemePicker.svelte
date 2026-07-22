<script lang="ts">
  import type { UiTheme } from '../../lib/ui-settings';

  export let value: UiTheme = 'classic';

  const options: Array<{ value: UiTheme; name: string; detail: string }> = [
    { value: 'classic', name: '经典', detail: '深灰 · 苔绿' },
    { value: 'mist', name: '雾蓝', detail: '冷灰 · 雾蓝' },
    { value: 'sand', name: '暖砂', detail: '暖灰 · 琥珀' },
  ];
</script>

<div class="ui-theme-picker" role="group" aria-label="界面风格">
  {#each options as option}
    <button
      type="button"
      class:active={value === option.value}
      class:classic={option.value === 'classic'}
      class:mist={option.value === 'mist'}
      class:sand={option.value === 'sand'}
      aria-pressed={value === option.value}
      on:click={() => (value = option.value)}
    >
      <span class="theme-preview" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong>{option.name}</strong>
      <small>{option.detail}</small>
      <b aria-hidden="true">✓</b>
    </button>
  {/each}
</div>

<style>
  .ui-theme-picker {
    --theme-card-min: calc(46px + 38px * var(--font-scale, 1));
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--theme-card-min)), 1fr));
    gap: calc(7px * var(--app-component-scale, 1));
  }

  button {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: calc(86px * var(--app-component-scale, 1));
    justify-items: start;
    gap: calc(3px * var(--app-component-scale, 1));
    padding: calc(9px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--color-app-text) 12%, transparent);
    border-radius: calc(11px * var(--app-component-scale, 1));
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    box-shadow: inset 0 1px rgb(255 255 255 / 68%);
    text-align: left;
    transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
  }

  button:hover { transform: translateY(-1px); }
  button.active {
    border-color: var(--preview-accent);
    box-shadow: 0 0 0 calc(2px * var(--app-component-scale, 1)) color-mix(in srgb, var(--preview-accent) 18%, transparent), 0 calc(8px * var(--app-component-scale, 1)) calc(18px * var(--app-component-scale, 1)) rgb(28 29 23 / 10%);
  }

  .classic { --preview-canvas: #171813; --preview-surface: #efede6; --preview-accent: #b7cd48; }
  .mist { --preview-canvas: #111820; --preview-surface: #e8eef2; --preview-accent: #6ca9ca; }
  .sand { --preview-canvas: #211a14; --preview-surface: #f1e9df; --preview-accent: #c88735; }

  .theme-preview {
    display: grid;
    width: 100%;
    height: calc(24px * var(--app-component-scale, 1));
    grid-template-columns: 1fr 0.7fr 0.34fr;
    border-radius: calc(7px * var(--app-component-scale, 1));
    overflow: hidden;
    background: var(--preview-canvas);
  }
  .theme-preview i:nth-child(1) { background: var(--preview-canvas); }
  .theme-preview i:nth-child(2) { background: var(--preview-surface); }
  .theme-preview i:nth-child(3) { background: var(--preview-accent); }

  strong { font-size: calc(11px * var(--font-scale, 1)); }
  small { color: var(--color-app-muted); font-size: calc(8px * var(--font-scale, 1)); line-height: 1.2; }
  b {
    position: absolute;
    top: calc(5px * var(--app-component-scale, 1));
    right: calc(5px * var(--app-component-scale, 1));
    display: grid;
    width: calc(17px * var(--app-component-scale, 1));
    height: calc(17px * var(--app-component-scale, 1));
    border-radius: 50%;
    background: var(--preview-accent);
    color: #17200e;
    font-size: calc(9px * var(--font-scale, 1));
    opacity: 0;
    place-items: center;
    transform: scale(0.7);
    transition: opacity 150ms ease, transform 150ms ease;
  }
  button.active b { opacity: 1; transform: scale(1); }
</style>
