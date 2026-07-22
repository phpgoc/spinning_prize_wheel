<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribeExportCompleted, type ExportCompletedNotice } from '../lib/file-export';

  let notice: ExportCompletedNotice | null = null;
  let noticeKey = 0;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => subscribeExportCompleted((completed) => {
    notice = completed;
    noticeKey += 1;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      notice = null;
      clearTimer = undefined;
    }, 4_200);
  }));
</script>

{#if notice}
  {#key noticeKey}
    <div class="export-notice" role="status" aria-live="polite">
      <span>✓</span>
      <div>
        <strong>{notice.desktop ? '已导出' : '已下载'}</strong>
        <small title={notice.location}>{notice.location}</small>
      </div>
    </div>
  {/key}
{/if}

<style>
  .export-notice {
    position: fixed;
    z-index: 200;
    top: 76px;
    left: 50%;
    display: grid;
    width: min(620px, calc(100vw - 30px));
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 12px 15px 15px;
    overflow: hidden;
    border: 1px solid rgba(199, 222, 83, 0.42);
    border-radius: 12px;
    background: rgba(25, 28, 20, 0.96);
    box-shadow: 0 16px 42px rgba(0, 0, 0, 0.34);
    color: #f1f4df;
    pointer-events: none;
    transform: translateX(-50%);
    animation: export-notice-in 320ms cubic-bezier(0.2, 0.82, 0.25, 1);
    backdrop-filter: blur(12px);
  }

  .export-notice::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    background: #dff85d;
    content: '';
    transform-origin: left;
    animation: export-notice-time 4.2s linear forwards;
  }

  .export-notice > span {
    display: grid;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #dff85d;
    color: #252b10;
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 950;
    place-items: center;
  }

  .export-notice > div { min-width: 0; }
  .export-notice strong { display: block; font-size: calc(13px * var(--font-scale, 1)); }
  .export-notice small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: #c9cead;
    font-family: var(--font-mono);
    font-size: calc(10px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes export-notice-in {
    from { opacity: 0; transform: translate(-50%, -18px) scale(0.96); }
    to { opacity: 1; transform: translate(-50%, 0) scale(1); }
  }

  @keyframes export-notice-time {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .export-notice,
    .export-notice::after { animation: none; }
  }
</style>
