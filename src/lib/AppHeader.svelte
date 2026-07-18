<script lang="ts">
  import { variantRoute, type AppPage, type AppVariant } from './app-variant';
  import type { DrawMode } from './types';

  export let page: AppPage;
  export let variant: AppVariant;
  export let desktopRuntime = false;
  export let drawBusy = false;
  export let mode: DrawMode = 'selected';
  export let onNavigatePage: (page: AppPage) => void;
  export let onNavigateVariant: (variant: AppVariant) => void;
  export let onModeChange: (mode: DrawMode) => void;
  export let onResetDraw: () => void;
</script>

<header class="topbar">
  <a class="brand" href={variantRoute(variant, 'draw')} aria-label="转盘首页">
    <span class="brand-mark"><i></i></span>
    <span><strong>转盘</strong></span>
  </a>

  <div class="topbar-controls">
    {#if !desktopRuntime}
      <nav class="variant-switch" aria-label="版本页面">
        <button type="button" class:active={variant === 'standard'} on:click={() => onNavigateVariant('standard')}>普通版</button>
        <button type="button" class:active={variant === 'caimi'} on:click={() => onNavigateVariant('caimi')}>猜蜜版</button>
      </nav>
    {/if}

    <nav class="page-switch" aria-label="工具页面">
      <button type="button" class:active={page === 'draw'} on:click={() => onNavigatePage('draw')}>抽奖</button>
      <button
        type="button"
        class:active={page === 'lineup'}
        disabled={drawBusy}
        on:click={() => onNavigatePage('lineup')}
      >随机排阵</button>
    </nav>

    {#if page === 'draw'}
      <div class="mode-switch" aria-label="抽奖模式">
        <button
          type="button"
          class:active={mode === 'selected'}
          disabled={drawBusy}
          on:click={() => onModeChange('selected')}
        >
          <span class="mode-dot"></span>
          选中模式
        </button>
        <button
          type="button"
          class:active={mode === 'roulette'}
          disabled={drawBusy}
          on:click={() => onModeChange('roulette')}
        >
          <span class="crosshair">＋</span>
          俄罗斯轮盘
        </button>
      </div>
    {/if}
  </div>

  <div class="topbar-meta">
    {#if page === 'draw'}
      <button type="button" class="icon-button" title="恢复默认设置" on:click={onResetDraw}>↺</button>
    {/if}
  </div>
</header>
