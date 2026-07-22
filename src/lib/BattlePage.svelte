<script lang="ts">
  import type { AppVariant } from './app-variant';
  import RandomLineup from './RandomLineup.svelte';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';
</script>

{#if desktopRuntime}
  <RandomLineup purpose="battle" {desktopRuntime} {variant} />
{:else}
  <main class="battle-web-unavailable">
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
    gap: 10px;
    padding: 32px;
    color: #abb2bf;
    text-align: center;
  }
  .battle-web-unavailable strong { color: #e7ff72; font-size: 24px; }
  .battle-web-unavailable p { color: #858b99; }
</style>
