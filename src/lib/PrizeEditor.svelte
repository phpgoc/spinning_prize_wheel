<script lang="ts">
  import type { Prize } from './types';

  export let prizes: Prize[];
  export let disabled = false;
  export let selectedId: string | null = null;
  export let onChange: (next: Prize[]) => void;
  export let onSelect: (id: string) => void;
  export let onAdd: () => void;

  function updatePrize(id: string, patch: Partial<Prize>) {
    onChange(prizes.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
  }

  function removePrize(id: string) {
    onChange(prizes.filter((prize) => prize.id !== id));
  }

  function clearPrizes() {
    onChange([]);
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
    <div
      class:muted={!prize.enabled}
      class:selected={selectedId === prize.id}
      class="prize-row"
      data-prize-id={prize.id}
      role="group"
      aria-label={`候选项 ${index + 1}：${prize.name}`}
      on:pointerdown={() => onSelect(prize.id)}
      on:focusin={() => onSelect(prize.id)}
    >
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
        on:focus={(event) => (event.currentTarget as HTMLInputElement).select()}
        on:input={(event) => updatePrize(prize.id, { name: textValue(event) })}
      />

      <label class="weight-control" title="权重">
        <span>×</span>
        <input
          aria-label={`${prize.name}的权重`}
          type="number"
          min="1"
          step="1"
          value={prize.weight}
          {disabled}
          on:change={(event) =>
            updatePrize(prize.id, { weight: Math.max(1, numberValue(event) || 1) })}
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
        {disabled}
        on:click={() => removePrize(prize.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>

<div class="prize-actions">
  <button type="button" class="add-button" {disabled} on:click={onAdd}>
    <span>＋</span>
    添加选项
  </button>
  <button type="button" class="clear-button" disabled={disabled || prizes.length === 0} on:click={clearPrizes}>
    清空
  </button>
</div>

<style>
  .prize-list {
    display: grid;
    gap: 7px;
  }

  .prize-row {
    position: relative;
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

  .prize-row.selected {
    z-index: 1;
    border-color: #899b36;
    background: #fbffe8;
    box-shadow: 0 0 0 2px rgba(231, 255, 114, 0.72), 0 7px 18px rgba(87, 99, 34, 0.14);
    transform: translateX(3px);
  }

  .prize-row.selected::before {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: -5px;
    width: 3px;
    border-radius: 999px;
    background: #8da139;
    content: '';
  }

  .prize-row.muted {
    opacity: 0.45;
  }

  .prize-row.muted.selected {
    opacity: 0.82;
  }

  .prize-index {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: calc(13px * var(--font-scale, 1));
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
    font-size: calc(16px * var(--font-scale, 1));
    font-weight: 650;
  }

  .weight-control {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: calc(13px * var(--font-scale, 1));
  }

  .weight-control input {
    appearance: textfield;
    font-family: var(--font-mono);
    font-size: calc(14px * var(--font-scale, 1));
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
    font-size: calc(20px * var(--font-scale, 1));
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

  .prize-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px;
    margin-top: 9px;
  }

  .add-button,
  .clear-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border: 1px dashed var(--line-strong);
    border-radius: 11px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: calc(15px * var(--font-scale, 1));
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
    font-size: calc(19px * var(--font-scale, 1));
  }

  .clear-button {
    padding-inline: 14px;
    border-style: solid;
    color: var(--text-dim);
  }

  .clear-button:hover:not(:disabled) {
    border-color: rgba(239, 115, 87, 0.35);
    background: rgba(239, 115, 87, 0.06);
    color: var(--danger);
  }

  @media (max-width: 420px) {
    .prize-row {
      grid-template-columns: 20px 25px minmax(0, 1fr) 52px 27px 22px;
      gap: 4px;
      padding-inline: 5px;
    }
  }
</style>
