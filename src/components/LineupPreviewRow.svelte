<script lang="ts">
  import type { ResolvedLineupName } from '../lib/types';

  export let variant: 'grouping' | 'battle' = 'grouping';
  export let name: string;
  export let index: number;
  export let resolved: ResolvedLineupName | null | undefined = undefined;
  export let desktopRuntime = false;
  export let resolvingNames = false;
  export let unknown = false;
  export let insertActive = false;
  export let rankingSaving = false;
  export let onRename: (name: string) => void;
  export let onInsert: () => void;
  export let onLink: () => void;
  export let onRecord: () => void;
  export let onRemove: () => void;
</script>

<div class:unknown class:grouping={variant === 'grouping'} class:battle={variant === 'battle'} class="preview-row">
  <div class="preview-leading-actions">
    <button
      type="button"
      class:active={insertActive}
      class="insert-before-button"
      title={`在 ${name} 前插入`}
      aria-label={`在 ${name} 前插入`}
      on:click={onInsert}
    >＋</button>
    <span class="preview-position">{String(index + 1).padStart(2, '0')}</span>
  </div>
  <div class="preview-name">
    <input
      value={name}
      aria-label={`第 ${index + 1} 个名称`}
      on:change={(event) => onRename((event.currentTarget as HTMLInputElement).value)}
    />
    {#if desktopRuntime}
      <small>{resolvingNames
        ? '核对中'
        : resolved?.known
          ? `本名 ${resolved.canonicalName} · 排名 ${resolved.rank}`
          : '未录入排名'}</small>
    {/if}
  </div>
  <div class="preview-trailing-actions">
    {#if desktopRuntime && !resolvingNames && unknown}
      <div class="preview-link-actions">
        <button type="button" class="link-preview-user" title="关联到现有排名" on:click={onLink}>关联</button>
        <button type="button" class="add-preview-user" title="直接加入无排名" disabled={rankingSaving} on:click={onRecord}>录入</button>
      </div>
    {/if}
    <button
      type="button"
      class="remove-preview-user"
      title={`移除 ${name}`}
      aria-label={`移除 ${name}`}
      on:click={onRemove}
    >删除</button>
  </div>
</div>

<style>
  .preview-row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: calc(44px + 22px * var(--lineup-layout-scale, 1));
    grid-template-columns: minmax(0, 1fr) minmax(90px, 1.35fr) minmax(0, 1fr);
    align-items: center;
    gap: calc(4px + 2px * var(--lineup-layout-scale, 1));
    padding: calc(5px + 4px * var(--lineup-layout-scale, 1)) calc(6px + 4px * var(--lineup-layout-scale, 1));
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.13);
    border-radius: calc(7px + 4px * var(--lineup-layout-scale, 1));
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.035);
  }

  .preview-row.grouping {
    background:
      linear-gradient(100deg, rgb(var(--app-accent-rgb, 231 255 114) / 0.075), transparent 54%),
      rgba(255, 255, 255, 0.035);
  }

  .preview-row.battle {
    border-color: color-mix(in srgb, var(--battle-participant-color, var(--accent)) 18%, transparent);
    border-radius: calc(4px + 3px * var(--lineup-layout-scale, 1));
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--battle-participant-color, var(--accent)) 7%, transparent), transparent 48%),
      color-mix(in srgb, var(--battle-match-color, #3e4451) 26%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, var(--battle-participant-color, var(--accent)) 45%, transparent);
  }

  .preview-row.unknown {
    border-color: rgba(221, 151, 132, 0.24);
    background: rgba(221, 151, 132, 0.035);
    box-shadow: inset 2px 0 rgba(221, 151, 132, 0.5);
  }

  .preview-position {
    padding: 0;
    color: var(--lineup-dim-on-dark);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .preview-leading-actions,
  .preview-trailing-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: calc(4px + 2px * var(--lineup-layout-scale, 1));
  }

  .preview-leading-actions { justify-content: flex-start; }
  .preview-trailing-actions { justify-content: flex-end; flex-wrap: wrap; }
  .preview-row > div { min-width: 0; }

  .preview-name {
    display: grid;
    min-height: calc(30px + 16px * var(--lineup-layout-scale, 1));
    align-content: center;
    justify-items: stretch;
    padding: 0 calc(4px + 4px * var(--lineup-layout-scale, 1));
    text-align: center;
  }

  .preview-name input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--on-dark);
    font-family: var(--font-sans, sans-serif);
    font-size: calc(18px * var(--font-scale, 1));
    font-weight: 900;
    letter-spacing: 0.025em;
    text-align: center;
    text-shadow: 0 2px 12px rgb(var(--app-accent-rgb, 231 255 114) / 0.14);
  }

  .battle .preview-name input { color: var(--battle-participant-color, var(--on-dark)); }

  .preview-name input:focus {
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.055);
    box-shadow: 0 0 0 2px rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
  }

  .preview-name small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: var(--lineup-muted-on-dark);
    font-size: calc(9px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unknown .preview-name small { color: #d8aaa0; }

  .insert-before-button {
    display: grid;
    width: calc(27px * var(--app-component-scale, 1));
    min-width: calc(27px * var(--app-component-scale, 1));
    height: calc(27px * var(--app-component-scale, 1));
    padding: 0;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
    border-radius: 6px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.05);
    color: var(--accent);
    cursor: pointer;
    font-size: calc(16px * var(--font-scale, 1));
    font-weight: 850;
    line-height: 1;
    place-items: center;
  }

  .insert-before-button:hover,
  .insert-before-button.active {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.48);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.12);
  }

  .preview-link-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    flex-wrap: wrap;
  }

  .link-preview-user,
  .add-preview-user,
  .remove-preview-user {
    padding: 4px 6px;
    border: 1px solid rgba(221, 170, 155, 0.24);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    font-size: calc(10px * var(--font-scale, 1));
  }

  .link-preview-user { border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.22); color: var(--accent); }
  .add-preview-user { color: #d8b1a7; }

  .remove-preview-user {
    border-color: rgba(221, 151, 132, 0.24);
    color: #d8aaa0;
    line-height: 1;
  }

  .remove-preview-user:hover { background: rgba(255, 255, 255, 0.06); color: var(--on-dark-muted); }
</style>
