<script lang="ts">
  import { onMount } from 'svelte';
  import caimiIconUrl from './assets/caimi-icon.png?url';
  import defaultIconUrl from '../src-tauri/icons/app-icon.svg?url';
  import AppHeader from './lib/AppHeader.svelte';
  import CaimiBanner from './lib/CaimiBanner.svelte';
  import DrawPage from './lib/DrawPage.svelte';
  import ExportNotice from './lib/ExportNotice.svelte';
  import RandomLineup from './lib/RandomLineup.svelte';
  import {
    BUILD_VARIANT,
    variantFromHash,
    variantRoute,
    type AppPage,
    type AppVariant,
  } from './lib/app-variant';
  import { normalizeFontScale } from './lib/ui-settings';
  import type { DrawMode } from './lib/types';

  const STORAGE_KEY = 'wheel-settings-v1';
  const LEGACY_STORAGE_KEY = ['for', 'tuna-wheel-settings-v1'].join('');

  let page: AppPage = 'draw';
  let variant: AppVariant = BUILD_VARIANT;
  let desktopRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  let drawPage: DrawPage | null = null;
  let drawMode: DrawMode = 'selected';
  let drawSpinning = false;
  let continuousRunning = false;
  let fontScale = initialFontScale();

  onMount(() => {
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  });

  function initialFontScale(): number {
    if (typeof window === 'undefined') return 1;
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}',
      ) as { fontScale?: unknown };
      return normalizeFontScale(saved.fontScale);
    } catch {
      return 1;
    }
  }

  function pageFromHash(hash: string): AppPage {
    return hash.endsWith('/lineup') ? 'lineup' : 'draw';
  }

  function syncRoute() {
    page = pageFromHash(window.location.hash);
    variant = variantFromHash(window.location.hash);
  }

  function navigatePage(nextPage: AppPage) {
    if (nextPage === page || (nextPage === 'lineup' && (drawSpinning || continuousRunning))) return;
    window.location.hash = variantRoute(variant, nextPage);
  }

  function navigateVariant(nextVariant: AppVariant) {
    if (desktopRuntime || nextVariant === variant) return;
    window.location.hash = variantRoute(nextVariant, page);
    window.location.reload();
  }

  function changeDrawMode(mode: DrawMode) {
    drawPage?.setMode(mode);
  }

  function resetDraw() {
    drawPage?.resetSettings();
  }
</script>

<svelte:head>
  <title>{variant === 'caimi' ? '猜蜜版 · ' : ''}{page === 'draw' ? '转盘抽签' : '分组'} · 转盘</title>
  <link
    rel="icon"
    type={variant === 'caimi' ? 'image/png' : 'image/svg+xml'}
    href={variant === 'caimi' ? caimiIconUrl : defaultIconUrl}
  />
</svelte:head>

<div
  class:caimi-variant={variant === 'caimi'}
  class:desktop-runtime={desktopRuntime}
  class:draw-active={page === 'draw'}
  class="app-shell"
  style={`--font-scale: ${fontScale}`}
>
  <ExportNotice />
  <AppHeader
    {page}
    {variant}
    {desktopRuntime}
    drawBusy={drawSpinning || continuousRunning}
    mode={drawMode}
    onNavigatePage={navigatePage}
    onNavigateVariant={navigateVariant}
    onModeChange={changeDrawMode}
    onResetDraw={resetDraw}
  />

  {#if variant === 'caimi'}
    <CaimiBanner />
  {/if}

  <div class:page-hidden={page !== 'draw'} class="draw-page-host" aria-hidden={page !== 'draw'}>
    <DrawPage
      bind:this={drawPage}
      bind:mode={drawMode}
      bind:isSpinning={drawSpinning}
      bind:continuousRunning
      bind:fontScale
      active={page === 'draw'}
      {desktopRuntime}
      {variant}
    />
  </div>

  {#if page === 'lineup'}
    <RandomLineup {desktopRuntime} {variant} />
  {/if}
</div>
