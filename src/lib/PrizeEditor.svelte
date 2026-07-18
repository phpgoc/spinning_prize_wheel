<script lang="ts">
  import type { Prize } from './types';

  export let prizes: Prize[];
  export let disabled = false;
  export let onChange: (next: Prize[]) => void;

  const palette = ['#ff7657', '#e9b949', '#8ac86d', '#4ea59b', '#6574c4', '#b76a9d', '#e4884d'];

  function updatePrize(id: string, patch: Partial<Prize>) {
    onChange(prizes.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
  }

  function addPrize() {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `prize-${Date.now()}`;

    onChange([
      ...prizes,
      {
        id,
        name: `新奖项 ${prizes.length + 1}`,
        weight: 1,
        color: palette[prizes.length % palette.length],
        enabled: true,
      },
    ]);
  }

  function removePrize(id: string) {
    if (prizes.length <= 2) return;
    onChange(prizes.filter((prize) => prize.id !== id));
  }

  function textValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  function numberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }
</script>

<div class="prize-list">
  {#each prizes as prize, index (prize.id)}
    <div class:muted={!prize.enabled} class="prize-row">
      <div class="prize-index">{String(index + 1).padStart(2, '0')}</div>

      <label class="color-control" title="奖项颜色">
        <span style:background={prize.color}></span>
        <input
          aria-label={`${prize.name}的颜色`}
          type="color"
          value={prize.color}
          {disabled}
          on:input={(event) => updatePrize(prize.id, { color: textValue(event) })}
        />
      </label>

      <input
        class="name-input"
        aria-label={`第 ${index + 1} 个奖项名称`}
        value={prize.name}
        maxlength="18"
        {disabled}
        on:input={(event) => updatePrize(prize.id, { name: textValue(event) })}
      />

      <label class="weight-control" title="权重">
        <span>×</span>
        <input
          aria-label={`${prize.name}的权重`}
          type="number"
          min="0.01"
          max="999"
          step="0.1"
          value={prize.weight}
          {disabled}
          on:change={(event) =>
            updatePrize(prize.id, { weight: Math.max(0.01, numberValue(event) || 0.01) })}
        />
      </label>

      <button
        type="button"
        class:active={prize.enabled}
        class="visibility-button"
        aria-label={prize.enabled ? `停用${prize.name}` : `启用${prize.name}`}
        title={prize.enabled ? '已启用' : '已停用'}
        {disabled}
        on:click={() => updatePrize(prize.id, { enabled: !prize.enabled })}
      >
        <span></span>
      </button>

      <button
        type="button"
        class="remove-button"
        aria-label={`删除${prize.name}`}
        title="删除奖项"
        disabled={disabled || prizes.length <= 2}
        on:click={() => removePrize(prize.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>

<button type="button" class="add-button" {disabled} on:click={addPrize}>
  <span>＋</span>
  添加奖项
</button>

<style>
  .prize-list {
    display: grid;
    gap: 7px;
  }

  .prize-row {
    display: grid;
    grid-template-columns: 24px 28px minmax(0, 1fr) 60px 28px 24px;
    align-items: center;
    gap: 6px;
    min-height: 43px;
    padding: 5px 7px;
    border: 1px solid var(--line-subtle);
    border-radius: 11px;
    background: var(--surface-soft);
    transition: border-color 160ms ease, opacity 160ms ease, transform 160ms ease;
  }

  .prize-row:focus-within {
    border-color: var(--line-strong);
    transform: translateY(-1px);
  }

  .prize-row.muted {
    opacity: 0.45;
  }

  .prize-index {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
  }

  .color-control {
    position: relative;
    display: grid;
    width: 24px;
    height: 24px;
    cursor: pointer;
    place-items: center;
  }

  .color-control span {
    width: 17px;
    height: 17px;
    border: 2px solid rgba(255, 255, 255, 0.72);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(17, 17, 13, 0.2);
  }

  .color-control input {
    position: absolute;
    width: 100%;
    height: 100%;
    cursor: pointer;
    opacity: 0;
  }

  .name-input,
  .weight-control input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
  }

  .name-input {
    font-size: 13px;
    font-weight: 650;
  }

  .weight-control {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .weight-control input {
    appearance: textfield;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .weight-control input::-webkit-inner-spin-button,
  .weight-control input::-webkit-outer-spin-button {
    appearance: none;
  }

  .visibility-button,
  .remove-button {
    display: grid;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    place-items: center;
  }

  .visibility-button {
    width: 27px;
    height: 21px;
    border-radius: 999px;
    background: var(--switch-off);
    transition: background 160ms ease;
  }

  .visibility-button span {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transform: translateX(-3px);
    transition: transform 160ms ease;
  }

  .visibility-button.active {
    background: var(--accent);
  }

  .visibility-button.active span {
    transform: translateX(3px);
  }

  .remove-button {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 17px;
    line-height: 1;
    transition: color 160ms ease, background 160ms ease;
  }

  .remove-button:hover:not(:disabled) {
    background: rgba(255, 118, 87, 0.12);
    color: var(--danger);
  }

  button:disabled,
  input:disabled {
    cursor: not-allowed;
  }

  .remove-button:disabled {
    opacity: 0.25;
  }

  .add-button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 9px;
    padding: 10px;
    border: 1px dashed var(--line-strong);
    border-radius: 11px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
  }

  .add-button:hover:not(:disabled) {
    border-color: var(--accent);
    background: rgba(235, 255, 123, 0.05);
    color: var(--text);
  }

  .add-button span {
    color: var(--accent);
    font-size: 16px;
  }

  @media (max-width: 420px) {
    .prize-row {
      grid-template-columns: 20px 25px minmax(0, 1fr) 52px 27px 22px;
      gap: 4px;
      padding-inline: 5px;
    }
  }
</style>
