<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import caimiIconUrl from './assets/caimi-icon.png?url';
  import defaultIconUrl from '../src-tauri/icons/app-icon.svg?url';
  import AppHeader from './lib/AppHeader.svelte';
  import BattlePage from './lib/BattlePage.svelte';
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
  let removeCloseRequestedListener: (() => void) | null = null;
  let appUnmounted = false;
  let closingWindow = false;

  onMount(() => {
    appUnmounted = false;
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    if (desktopRuntime) void registerCloseRequestedListener();
    return () => {
      appUnmounted = true;
      window.removeEventListener('hashchange', syncRoute);
      removeCloseRequestedListener?.();
      removeCloseRequestedListener = null;
    };
  });

  async function registerCloseRequestedListener() {
    try {
      const currentWindow = getCurrentWindow();
      const unlisten = await currentWindow.onCloseRequested(async (event) => {
        const currentDrawPage = drawPage;
        if (!currentDrawPage?.shouldHandleWindowClose()) return;
        event.preventDefault();
        if (closingWindow) return;

        closingWindow = true;
        try {
          if (await currentDrawPage.prepareForWindowClose()) {
            await currentWindow.destroy();
          }
        } finally {
          closingWindow = false;
        }
      });
      if (appUnmounted) unlisten();
      else removeCloseRequestedListener = unlisten;
    } catch (reason) {
      console.error('无法监听窗口关闭事件', reason);
    }
  }

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
    if (hash.endsWith('/battle')) return 'battle';
    // 继续识别旧地址，避免升级后已有书签失效。
    return hash.endsWith('/grouping') || hash.endsWith('/lineup') ? 'grouping' : 'draw';
  }

  function syncRoute() {
    page = pageFromHash(window.location.hash);
    variant = variantFromHash(window.location.hash);
  }

  function navigatePage(nextPage: AppPage) {
    if (nextPage === page || (nextPage !== 'draw' && (drawSpinning || continuousRunning))) return;
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

  function saveFontScale() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}',
      ) as Record<string, unknown>;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, fontScale }));
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontScale }));
    }
  }

  function handleGlobalFontScaleShortcut(event: KeyboardEvent) {
    if (
      !event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.shiftKey
      || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    ) return;

    event.preventDefault();
    fontScale = normalizeFontScale(fontScale + (event.key === 'ArrowUp' ? 0.1 : -0.1));
    saveFontScale();
  }
</script>

<svelte:window on:keydown={handleGlobalFontScaleShortcut} />

<svelte:head>
  <title>{variant === 'caimi' ? '猜蜜版 · ' : ''}{page === 'draw' ? '转盘抽签' : page === 'grouping' ? '分组' : '对战'} · 转盘</title>
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

  {#if page === 'grouping'}
    <RandomLineup {desktopRuntime} {variant} />
  {/if}

  {#if page === 'battle'}
    <BattlePage {desktopRuntime} {variant} />
  {/if}
</div>
