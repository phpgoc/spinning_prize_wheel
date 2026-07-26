<script lang="ts">
  export let start = '';
  export let end = '';
  export let startLabel = '开始日期';
  export let endLabel = '结束日期(不含)';
</script>

<div class="ui-date-range" role="group" aria-label="日期范围">
  <label>
    <span><i></i>{startLabel}</span>
    <div>
      <b aria-hidden="true">始</b>
      <span class="date-input-shell">
        <input class:empty={!start} type="date" bind:value={start} aria-label={startLabel} placeholder="yyyy / mm / dd" />
        {#if !start}<span class="date-placeholder" aria-hidden="true">yyyy / mm / dd</span>{/if}
      </span>
    </div>
  </label>
  <label title="所选日期当天不计入结果">
    <span><i></i>{endLabel}</span>
    <div>
      <b aria-hidden="true">止</b>
      <span class="date-input-shell">
        <input class:empty={!end} type="date" bind:value={end} aria-label={endLabel} placeholder="yyyy / mm / dd" />
        {#if !end}<span class="date-placeholder" aria-hidden="true">yyyy / mm / dd</span>{/if}
      </span>
    </div>
  </label>
</div>

<style>
  .ui-date-range {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: calc(7px * var(--app-component-scale, 1));
  }

  label {
    display: grid;
    min-width: 0;
    gap: calc(6px * var(--app-component-scale, 1));
    padding: calc(9px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--color-app-text) 11%, transparent);
    border-radius: var(--app-control-radius, calc(10px * var(--app-component-scale, 1)));
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--color-app-surface-raised) 95%, white), var(--color-app-surface-raised));
    box-shadow: inset 0 1px rgb(255 255 255 / 72%), 0 5px 16px rgb(30 31 25 / 5%);
    transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  label:focus-within {
    border-color: color-mix(in srgb, var(--accent-strong) 58%, transparent);
    box-shadow: 0 0 0 calc(3px * var(--app-component-scale, 1)) color-mix(in srgb, var(--accent-strong) 12%, transparent), 0 8px 22px rgb(30 31 25 / 8%);
    transform: translateY(-1px);
  }

  label > span {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: calc(5px * var(--app-component-scale, 1));
    color: var(--color-app-muted);
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1.2;
  }

  label > span i {
    width: calc(5px * var(--app-component-scale, 1));
    height: calc(5px * var(--app-component-scale, 1));
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--accent-strong);
    box-shadow: 0 0 0 calc(3px * var(--app-component-scale, 1)) color-mix(in srgb, var(--accent-strong) 11%, transparent);
  }

  label > div {
    display: grid;
    min-height: calc(42px * var(--app-component-scale, 1));
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: calc(6px * var(--app-component-scale, 1));
    padding: 0 calc(8px * var(--app-component-scale, 1));
    border: 1px solid color-mix(in srgb, var(--color-app-text) 14%, transparent);
    border-radius: calc(8px * var(--app-component-scale, 1));
    background: color-mix(in srgb, var(--color-app-surface) 82%, white);
    box-shadow: inset 0 1px rgb(255 255 255 / 58%);
  }

  b {
    display: grid;
    width: calc(22px * var(--app-component-scale, 1));
    height: calc(22px * var(--app-component-scale, 1));
    border-radius: calc(7px * var(--app-component-scale, 1));
    background: color-mix(in srgb, var(--accent-strong) 11%, transparent);
    color: var(--accent-ink);
    font-size: calc(9px * var(--font-scale, 1));
    place-items: center;
  }

  .date-input-shell {
    position: relative;
    display: block;
    min-height: calc(42px * var(--app-component-scale, 1));
    min-width: 0;
  }

  .date-placeholder {
    position: absolute;
    inset: 0 calc(29px * var(--app-component-scale, 1)) 0 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    color: var(--color-app-text);
    font-family: var(--font-mono, ui-monospace, 'SFMono-Regular', Consolas, monospace);
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 750;
    pointer-events: none;
    white-space: nowrap;
  }

  .date-input-shell:focus-within .date-placeholder { opacity: 0; }

  input {
    width: 100%;
    min-width: 0;
    height: calc(34px * var(--app-component-scale, 1));
    min-height: calc(30px * var(--app-component-scale, 1));
    padding: calc(5px * var(--app-component-scale, 1)) 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-app-text);
    font-family: var(--font-mono, ui-monospace, 'SFMono-Regular', Consolas, monospace);
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 750;
    color-scheme: light;
  }

  input.empty { color: transparent; }
  input.empty::-webkit-datetime-edit { color: transparent; }

  input::-webkit-calendar-picker-indicator {
    width: calc(18px * var(--app-component-scale, 1));
    height: calc(18px * var(--app-component-scale, 1));
    margin: 0 calc(2px * var(--app-component-scale, 1));
    cursor: pointer;
    opacity: 0.68;
  }
</style>
