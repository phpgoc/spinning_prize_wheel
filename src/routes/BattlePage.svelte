<script lang="ts">
  import type { AppVariant } from '../lib/app-variant';
  import GroupingWorkspace from '../components/GroupingWorkspace.svelte';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';
</script>

{#if desktopRuntime}
  <GroupingWorkspace purpose="battle" {desktopRuntime} {variant} />
{:else}
  <main class="battle-web-unavailable app-page-frame">
    <strong>对战仅支持桌面版</strong>
    <p>对战签表需要桌面端数据库，请使用 Windows 版。</p>
  </main>
{/if}

<style>
  .battle-web-unavailable {
    display: grid;
    min-height: 60vh;
    align-content: center;
    justify-items: center;
    gap: calc(10px * var(--app-component-scale, 1));
    padding: calc(32px * var(--app-component-scale, 1));
    border: 1px solid var(--app-frame-border);
    border-radius: var(--app-frame-radius);
    background: var(--app-frame-background);
    color: #abb2bf;
    box-shadow: var(--app-frame-shadow);
    text-align: center;
  }
  .battle-web-unavailable strong { color: var(--accent); font-size: 24px; }
  .battle-web-unavailable p { color: #858b99; }
</style>
