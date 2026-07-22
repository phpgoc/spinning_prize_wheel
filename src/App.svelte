<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import caimiIconUrl from './assets/caimi-icon.png?url';
  import defaultIconUrl from '../src-tauri/icons/app-icon.svg?url';
  import AppHeader from './components/AppHeader.svelte';
  import BattlePage from './routes/BattlePage.svelte';
  import CaimiBanner from './components/CaimiBanner.svelte';
  import WheelPage from './routes/WheelPage.svelte';
  import ExportNotice from './components/ExportNotice.svelte';
  import GroupingWorkspace from './components/GroupingWorkspace.svelte';
  import {
    BUILD_VARIANT,
    variantFromPath,
    variantRoute,
    type AppPage,
    type AppVariant,
  } from './lib/app-variant';
  import {
    DEFAULT_UI_THEME,
    normalizeFontScale,
    normalizeUiTheme,
    type UiTheme,
  } from './lib/ui-settings';
  import type { DrawMode } from './lib/types';

  const STORAGE_KEY = 'wheel-settings-v1';
  const LEGACY_STORAGE_KEY = ['for', 'tuna-wheel-settings-v1'].join('');

  let page: AppPage = 'wheel';
  let variant: AppVariant = BUILD_VARIANT;
  let desktopRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  let wheelPage: WheelPage | null = null;
  let drawMode: DrawMode = 'selected';
  let wheelSpinning = false;
  let continuousRunning = false;
  let fontScale = initialFontScale();
  let uiTheme: UiTheme = initialUiTheme();
  let removeCloseRequestedListener: (() => void) | null = null;
  let appUnmounted = false;
  let closingWindow = false;

  onMount(() => {
    appUnmounted = false;
    syncRoute();
    window.addEventListener('popstate', syncRoute);
    if (desktopRuntime) void registerCloseRequestedListener();
    return () => {
      appUnmounted = true;
      window.removeEventListener('popstate', syncRoute);
      removeCloseRequestedListener?.();
      removeCloseRequestedListener = null;
    };
  });

  async function registerCloseRequestedListener() {
    try {
      const currentWindow = getCurrentWindow();
      const unlisten = await currentWindow.onCloseRequested(async (event) => {
        const currentWheelPage = wheelPage;
        if (!currentWheelPage?.shouldHandleWindowClose()) return;
        event.preventDefault();
        if (closingWindow) return;

        closingWindow = true;
        try {
          if (await currentWheelPage.prepareForWindowClose()) {
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

  function initialUiTheme(): UiTheme {
    if (typeof window === 'undefined') return DEFAULT_UI_THEME;
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}',
      ) as { uiTheme?: unknown };
      return normalizeUiTheme(saved.uiTheme);
    } catch {
      return DEFAULT_UI_THEME;
    }
  }

  function pageFromPath(pathname: string): AppPage {
    if (pathname.endsWith('/battle')) return 'battle';
    return pathname.endsWith('/grouping') ? 'grouping' : 'wheel';
  }

  function syncRoute() {
    page = pageFromPath(window.location.pathname);
    variant = variantFromPath(window.location.pathname);
  }

  function navigatePage(nextPage: AppPage) {
    if (nextPage === page || (nextPage !== 'wheel' && (wheelSpinning || continuousRunning))) return;
    void goto(variantRoute(variant, nextPage)).then(syncRoute);
  }

  function navigateVariant(nextVariant: AppVariant) {
    if (desktopRuntime || nextVariant === variant) return;
    void goto(variantRoute(nextVariant, page)).then(syncRoute);
  }

  function changeDrawMode(mode: DrawMode) {
    wheelPage?.setMode(mode);
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
  <title>{variant === 'caimi' ? '猜蜜版 · ' : ''}{page === 'wheel' ? '转盘' : page === 'grouping' ? '分组' : '对战'}{page === 'wheel' ? '' : ' · 转盘'}</title>
  <link
    rel="icon"
    type={variant === 'caimi' ? 'image/png' : 'image/svg+xml'}
    href={variant === 'caimi' ? caimiIconUrl : defaultIconUrl}
  />
</svelte:head>

<div
  class:caimi-variant={variant === 'caimi'}
  class:desktop-runtime={desktopRuntime}
  class:wheel-active={page === 'wheel'}
  class="app-shell"
  data-ui-theme={uiTheme}
  style={`--font-scale: ${fontScale}`}
>
  <ExportNotice />
  <AppHeader
    {page}
    {variant}
    {desktopRuntime}
    wheelBusy={wheelSpinning || continuousRunning}
    mode={drawMode}
    onNavigatePage={navigatePage}
    onNavigateVariant={navigateVariant}
    onModeChange={changeDrawMode}
  />

  {#if variant === 'caimi'}
    <CaimiBanner />
  {/if}

  <div class:page-hidden={page !== 'wheel'} class="wheel-page-host" aria-hidden={page !== 'wheel'}>
    <WheelPage
      bind:this={wheelPage}
      bind:mode={drawMode}
      bind:isSpinning={wheelSpinning}
      bind:continuousRunning
      bind:fontScale
      bind:uiTheme
      active={page === 'wheel'}
      {desktopRuntime}
      {variant}
    />
  </div>

  {#if page === 'grouping'}
    <GroupingWorkspace {desktopRuntime} {variant} />
  {/if}

  {#if page === 'battle'}
    <BattlePage {desktopRuntime} {variant} />
  {/if}
</div>
