<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import caimiIconUrl from './assets/caimi-icon.png?url';
  import AppHeader from './components/AppHeader.svelte';
  import CaimiBanner from './components/CaimiBanner.svelte';
  import ExportNotice from './components/ExportNotice.svelte';
  import type WheelPage from './routes/WheelPage.svelte';
  import {
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
  import { isTauriRuntime } from './lib/runtime';

  export let pathname = typeof window === 'undefined' ? '/' : window.location.pathname;

  type WheelPageComponent = (typeof import('./routes/WheelPage.svelte'))['default'];

  const STORAGE_KEY = 'wheel-settings-v1';
  const LEGACY_STORAGE_KEY = ['for', 'tuna-wheel-settings-v1'].join('');

  let page: AppPage = pageFromPath(pathname);
  let variant: AppVariant = variantFromPath(pathname);
  let tauriRuntime = isTauriRuntime();
  let desktopRuntime = tauriRuntime;
  const businessRuntime = true;
  let wheelPage: WheelPage | null = null;
  let WheelPageComponent: WheelPageComponent | null = null;
  let wheelPageLoad: Promise<void> | null = null;
  let wheelPageLoadError = '';
  let drawMode: DrawMode = 'selected';
  let wheelSpinning = false;
  let continuousRunning = false;
  let fontScale = initialFontScale();
  let uiTheme: UiTheme = initialUiTheme();
  let removeCloseRequestedListener: (() => void) | null = null;
  let removeBeforeUnloadListener: (() => void) | null = null;
  let appUnmounted = false;
  let appMounted = false;
  let closingWindow = false;
  let persistedFontScale = fontScale;
  const APP_PAGE_ORDER: AppPage[] = ['wheel', 'grouping', 'battle'];

  $: page = pageFromPath(pathname);
  $: variant = variantFromPath(pathname);
  // SSR 只输出轻量应用壳；转盘及其画布逻辑留到浏览器按需加载。
  $: if (typeof window !== 'undefined' && page === 'wheel') void loadWheelPage();
  $: if (typeof document !== 'undefined') updateFavicon(variant);
  // 字号只由应用壳持久化；各页面通过绑定和 CSS 变量消费同一份状态。
  $: if (appMounted && fontScale !== persistedFontScale) {
    persistedFontScale = fontScale;
    saveFontScale();
  }

  onMount(() => {
    appUnmounted = false;
    appMounted = true;
    if (pathname === '/' || pathname === '/caimi') {
      void goto(variantRoute(variant, 'wheel'), { replaceState: true });
    }
    updateFavicon(variant);
    if (tauriRuntime) void registerCloseRequestedListener();
    else registerBrowserBeforeUnloadListener();
    return () => {
      appUnmounted = true;
      appMounted = false;
      removeCloseRequestedListener?.();
      removeCloseRequestedListener = null;
      removeBeforeUnloadListener?.();
      removeBeforeUnloadListener = null;
    };
  });

  function registerBrowserBeforeUnloadListener() {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!wheelPage?.shouldWarnBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    removeBeforeUnloadListener = () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }

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

  function loadWheelPage(): Promise<void> {
    if (WheelPageComponent || wheelPageLoad) return wheelPageLoad ?? Promise.resolve();
    wheelPageLoadError = '';
    wheelPageLoad = import('./routes/WheelPage.svelte')
      .then((module) => {
        if (!appUnmounted) WheelPageComponent = module.default;
      })
      .catch((reason) => {
        wheelPageLoadError = reason instanceof Error ? reason.message : '无法加载转盘页面';
      })
      .finally(() => {
        wheelPageLoad = null;
      });
    return wheelPageLoad;
  }

  function updateFavicon(nextVariant: AppVariant) {
    const link = document.querySelector<HTMLLinkElement>('link[data-app-favicon]');
    if (!link) return;
    link.type = nextVariant === 'caimi' ? 'image/png' : 'image/svg+xml';
    link.href = nextVariant === 'caimi' ? caimiIconUrl : '/favicon.ico';
  }

  function navigatePage(nextPage: AppPage) {
    if (nextPage === page || (nextPage !== 'wheel' && (wheelSpinning || continuousRunning))) return;
    void goto(variantRoute(variant, nextPage));
  }

  function navigateVariant(nextVariant: AppVariant) {
    if (tauriRuntime || nextVariant === variant) return;
    void goto(variantRoute(nextVariant, page));
  }

  function changeDrawMode(mode: DrawMode) {
    wheelPage?.setMode(mode);
  }

  function saveFontScale() {
    let saved: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}',
      ) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        saved = parsed as Record<string, unknown>;
      }
    } catch {
      // 损坏的旧设置只保留本次有效字号。
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, fontScale }));
    } catch {
      // 禁用本地存储时字号仍在当前会话生效。
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
  }

  function handleGlobalPageShortcut(event: KeyboardEvent) {
    if (
      !event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    ) return;

    event.preventDefault();
    const currentIndex = APP_PAGE_ORDER.indexOf(page);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + direction + APP_PAGE_ORDER.length) % APP_PAGE_ORDER.length;
    navigatePage(APP_PAGE_ORDER[nextIndex]);
  }

  function handleGlobalShortcut(event: KeyboardEvent) {
    handleGlobalFontScaleShortcut(event);
    handleGlobalPageShortcut(event);
  }
</script>

<svelte:window on:keydown={handleGlobalShortcut} />

<svelte:head>
  <title>{variant === 'caimi' ? '猜蜜版 · ' : ''}{page === 'wheel' ? '转盘' : page === 'grouping' ? '分组' : '对战'}{page === 'wheel' ? '' : ' · 转盘'}</title>
</svelte:head>

<div
  class:caimi-variant={variant === 'caimi'}
  class:desktop-runtime={tauriRuntime}
  class:wheel-active={page === 'wheel'}
  class="app-shell"
  data-ui-theme={uiTheme}
  style={`--font-scale: ${fontScale}`}
>
  <ExportNotice />
  <AppHeader
    {page}
    {variant}
    nativeRuntime={tauriRuntime}
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
    {#if WheelPageComponent}
      <svelte:component
        this={WheelPageComponent}
        bind:this={wheelPage}
        bind:mode={drawMode}
        bind:isSpinning={wheelSpinning}
        bind:continuousRunning
        bind:fontScale
        bind:uiTheme
        active={page === 'wheel'}
        {desktopRuntime}
        {businessRuntime}
        {variant}
      />
    {:else if page === 'wheel'}
      <main class="app-route-loading app-page-frame" aria-live="polite">
        <strong>{wheelPageLoadError ? '转盘加载失败' : '正在加载转盘…'}</strong>
        {#if wheelPageLoadError}<p>{wheelPageLoadError}</p>{/if}
      </main>
    {/if}
  </div>

  {#if page !== 'wheel'}
    <slot />
  {/if}
</div>

<style>
  .app-route-loading {
    display: grid;
    min-height: 60vh;
    align-content: center;
    justify-items: center;
    gap: 8px;
    color: var(--color-app-muted);
  }
  .app-route-loading strong { color: var(--color-app-text); }
</style>
