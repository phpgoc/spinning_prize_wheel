<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import LuxuryWheel from './lib/LuxuryWheel.svelte';
  import PrizeEditor from './lib/PrizeEditor.svelte';
  import ThreeWheel from './lib/ThreeWheel.svelte';
  import Wheel from './lib/Wheel.svelte';
  import {
    RETRY_ID,
    buildWheelOptions,
    pickWeighted,
    simulateBatch,
  } from './lib/draw';
  import { parseOptionText } from './lib/parse-options';
  import type {
    AnimationStyle,
    BatchSimulation,
    DrawMode,
    DrawOutcome,
    DrawRecord,
    Prize,
    SimulationEvent,
    WheelOption,
  } from './lib/types';

  const STORAGE_KEY = 'fortuna-wheel-settings-v1';
  const importPalette = ['#ff7657', '#e9b949', '#8ac86d', '#4ea59b', '#6574c4', '#b76a9d', '#e4884d'];
  const defaultPrizes: Prize[] = [
    { id: 'aurora', name: '极光大奖', weight: 1, color: '#ff7557', enabled: true },
    { id: 'starlight', name: '星光礼盒', weight: 1, color: '#e9b949', enabled: true },
    { id: 'forest', name: '森林假日', weight: 1, color: '#8ac86d', enabled: true },
    { id: 'ocean', name: '海岛之旅', weight: 1, color: '#4ea59b', enabled: true },
    { id: 'mystery', name: '神秘福袋', weight: 1, color: '#6574c4', enabled: true },
    { id: 'encore', name: '幸运加码', weight: 1, color: '#b76a9d', enabled: true },
  ];

  interface ResultCard {
    eyebrow: string;
    title: string;
    detail: string;
    tone: 'idle' | 'success' | 'retry' | 'danger';
  }

  interface BatchRow {
    id: string;
    name: string;
    color: string;
    count: number;
    percent: number;
  }

  let prizes = defaultPrizes.map((prize) => ({ ...prize }));
  let mode: DrawMode = 'selected';
  let animationStyle: AnimationStyle = 'luxury';
  let durationSeconds = 4;
  let retryEnabled = true;
  let retryWeight = 0.65;
  let batchCount = 100;
  let batchTab: 'stats' | 'history' = 'stats';
  let importOpen = false;
  let importText = '';
  let importMode: 'replace' | 'append' = 'replace';
  let shortcutsOpen = false;
  let shortcutMod = 'Ctrl';
  let importTextarea: HTMLTextAreaElement;

  let rotation = 0;
  let isSpinning = false;
  let eliminatedIds: string[] = [];
  let rouletteFinished = false;
  let rouletteRound = 1;
  let singleAttempt = 0;
  let singleCompleted = 0;
  let records: DrawRecord[] = [];
  let batchResult: BatchSimulation | null = null;
  let batchRunAt: number | null = null;
  let hydrated = false;
  let timer: number | undefined;
  let result: ResultCard = {
    eyebrow: '准备就绪',
    title: '好运正在路上',
    detail: '点击转盘中央，开始一次公平的随机抽取。',
    tone: 'idle',
  };

  $: enabledPrizes = prizes.filter((prize) => prize.enabled);
  $: wheelOptions = buildWheelOptions(prizes, retryEnabled, retryWeight);
  $: eliminatedSet = new Set(eliminatedIds);
  $: rouletteRemaining = enabledPrizes.filter((prize) => !eliminatedSet.has(prize.id));
  $: spinDisabled =
    enabledPrizes.length === 0 ||
    (mode === 'roulette' && (enabledPrizes.length < 2 || rouletteFinished));
  $: validCompleted = records.filter(
    (record) => record.outcome === 'selected' || record.outcome === 'winner',
  ).length;
  $: retryTotal = records.filter((record) => record.outcome === 'retry').length;
  $: batchRows = createBatchRows(batchResult);
  $: batchHistory = records.filter((record) => record.source === 'batch').slice(0, 160);
  $: parsedImportOptions = parseOptionText(importText);
  $: if (hydrated) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prizes,
        mode,
        animationStyle,
        durationSeconds,
        retryEnabled,
        retryWeight,
      }),
    );
  }

  onMount(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<{
          prizes: Prize[];
          mode: DrawMode;
          animationStyle: AnimationStyle;
          durationSeconds: number;
          retryEnabled: boolean;
          retryWeight: number;
        }>;

        if (Array.isArray(parsed.prizes) && parsed.prizes.length >= 2) prizes = parsed.prizes;
        if (parsed.mode === 'selected' || parsed.mode === 'roulette') mode = parsed.mode;
        if (['simple', 'luxury', 'threeD'].includes(parsed.animationStyle ?? '')) {
          animationStyle = parsed.animationStyle!;
        }
        if (typeof parsed.durationSeconds === 'number') {
          durationSeconds = Math.min(10, Math.max(1, parsed.durationSeconds));
        }
        if (typeof parsed.retryEnabled === 'boolean') retryEnabled = parsed.retryEnabled;
        if (typeof parsed.retryWeight === 'number') retryWeight = parsed.retryWeight;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    shortcutMod = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl';
    hydrated = true;
  });

  onDestroy(() => {
    if (timer) window.clearTimeout(timer);
  });

  function createId(prefix: string): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setMode(next: DrawMode) {
    if (isSpinning || mode === next) return;
    mode = next;
    eliminatedIds = [];
    rouletteFinished = false;
    rouletteRound = 1;
    singleAttempt = 0;
    result = next === 'selected'
      ? {
          eyebrow: '选中模式',
          title: '一次旋转，一个答案',
          detail: '重来结果会计入次数，但不会占用一次有效抽取。',
          tone: 'idle',
        }
      : {
          eyebrow: '俄罗斯轮盘',
          title: '留到最后才是赢家',
          detail: '每次命中的奖项会被淘汰，直到只剩最后一项。',
          tone: 'idle',
        };
  }

  function updatePrizes(next: Prize[]) {
    prizes = next;
    eliminatedIds = eliminatedIds.filter((id) => next.some((prize) => prize.id === id));
    if (mode === 'roulette') {
      rouletteFinished = false;
    }
  }

  function currentDrawOptions(): WheelOption[] {
    return mode === 'selected'
      ? wheelOptions
      : buildWheelOptions(prizes, retryEnabled, retryWeight, eliminatedSet);
  }

  function spin() {
    if (isSpinning || spinDisabled) return;

    const options = currentDrawOptions();
    const realOptions = options.filter((option) => !option.isRetry);
    if (realOptions.length === 0) {
      result = {
        eyebrow: '无法开始',
        title: '请至少启用一个奖项',
        detail: mode === 'roulette' ? '俄罗斯轮盘需要至少两个启用的奖项。' : '重来不能是唯一选项。',
        tone: 'danger',
      };
      return;
    }

    const picked = pickWeighted(options);
    const index = wheelOptions.findIndex((option) => option.id === picked.id);
    const slice = 360 / Math.max(1, wheelOptions.length);
    const current = ((rotation % 360) + 360) % 360;
    const target = ((-(index + 0.5) * slice % 360) + 360) % 360;
    const extraTurns = animationStyle === 'simple' ? 4 : animationStyle === 'luxury' ? 7 : 6;
    const delta = ((target - current + 360) % 360) + (extraTurns + Math.floor(Math.random() * 2)) * 360;

    rotation += delta;
    isSpinning = true;
    result = {
      eyebrow: animationStyle === 'threeD' ? '空间旋转中' : '命运正在选择',
      title: '别眨眼…',
      detail: `全程 ${durationSeconds.toFixed(1)} 秒，末段会平滑减速后揭晓`,
      tone: 'idle',
    };

    timer = window.setTimeout(() => settleSingleDraw(picked), durationSeconds * 1000);
  }

  function settleSingleDraw(picked: WheelOption) {
    isSpinning = false;
    singleAttempt += 1;

    if (picked.isRetry) {
      const round = mode === 'selected' ? singleCompleted + 1 : rouletteRound;
      addRecord({
        round,
        attempt: singleAttempt,
        optionId: RETRY_ID,
        label: picked.label,
        outcome: 'retry',
        detail: mode === 'selected'
          ? `第 ${round} 次有效抽取触发重来，请再次旋转`
          : `第 ${rouletteRound} 局触发重来，没有奖项被淘汰`,
      });
      result = {
        eyebrow: '特殊结果 · 已计数',
        title: '再来一次',
        detail: '这次已记入重来统计，但不占用有效结果。',
        tone: 'retry',
      };
      return;
    }

    if (mode === 'selected') {
      singleCompleted += 1;
      addRecord({
        round: singleCompleted,
        attempt: singleAttempt,
        optionId: picked.id,
        label: picked.label,
        outcome: 'selected',
        detail: `第 ${singleCompleted} 次有效抽取命中 ${picked.label}`,
      });
      result = {
        eyebrow: `第 ${singleCompleted} 次有效结果`,
        title: picked.label,
        detail: retryTotal > 0 ? `好运落定 · 当前累计重来 ${retryTotal} 次` : '好运落定，恭喜获得本次结果。',
        tone: 'success',
      };
      return;
    }

    const activeBefore = enabledPrizes.filter((prize) => !eliminatedSet.has(prize.id));
    const hit = activeBefore.find((prize) => prize.id === picked.id);
    if (!hit) return;

    const remaining = activeBefore.filter((prize) => prize.id !== picked.id);
    eliminatedIds = [...eliminatedIds, picked.id];

    if (remaining.length === 1) {
      const winner = remaining[0];
      rouletteFinished = true;
      addRecord({
        round: rouletteRound,
        attempt: singleAttempt,
        optionId: winner.id,
        label: winner.name,
        outcome: 'winner',
        detail: `${hit.name} 淘汰，${winner.name} 成为第 ${rouletteRound} 局赢家`,
      });
      result = {
        eyebrow: `第 ${rouletteRound} 局 · 最终赢家`,
        title: winner.name,
        detail: `${hit.name} 最后出局，轮盘上只剩下赢家。`,
        tone: 'success',
      };
    } else {
      addRecord({
        round: rouletteRound,
        attempt: singleAttempt,
        optionId: hit.id,
        label: hit.name,
        outcome: 'eliminated',
        detail: `${hit.name} 淘汰，剩余 ${remaining.length} 项`,
      });
      result = {
        eyebrow: `第 ${rouletteRound} 局 · 淘汰`,
        title: hit.name,
        detail: `离开轮盘，场上还剩 ${remaining.length} 个候选项。`,
        tone: 'danger',
      };
    }
  }

  function addRecord(event: Omit<SimulationEvent, 'attempt'> & { attempt: number }) {
    const record: DrawRecord = {
      id: createId('record'),
      sequence: records.length + 1,
      ...event,
      mode,
      createdAt: Date.now(),
      source: 'single',
    };
    records = [record, ...records];
  }

  function startNewRouletteRound() {
    if (isSpinning) return;
    rouletteRound += 1;
    singleAttempt = 0;
    eliminatedIds = [];
    rouletteFinished = false;
    result = {
      eyebrow: `俄罗斯轮盘 · 第 ${rouletteRound} 局`,
      title: '所有选项重新入场',
      detail: '继续旋转，逐一淘汰，直到最后的赢家出现。',
      tone: 'idle',
    };
  }

  function runBatch() {
    if (isSpinning) return;

    try {
      const safeCount = Math.min(1000, Math.max(1, Math.floor(Number(batchCount) || 1)));
      batchCount = safeCount;
      const simulation = simulateBatch(
        mode,
        prizes,
        safeCount,
        retryEnabled,
        retryWeight,
      );
      batchResult = simulation;
      batchRunAt = Date.now();
      batchTab = 'stats';

      const startedAt = Date.now();
      const imported = [...simulation.events].reverse().map((event, index): DrawRecord => ({
        id: createId('batch'),
        sequence: records.length + simulation.events.length - index,
        ...event,
        mode,
        createdAt: startedAt - index,
        source: 'batch',
      }));
      records = [...imported, ...records];
    } catch (error) {
      result = {
        eyebrow: '批量任务未开始',
        title: '奖池配置不足',
        detail: error instanceof Error ? error.message : '请检查奖项设置后重试。',
        tone: 'danger',
      };
    }
  }

  function createBatchRows(simulation: BatchSimulation | null): BatchRow[] {
    if (!simulation) return [];
    const rows = prizes
      .map((prize) => ({
        id: prize.id,
        name: prize.name,
        color: prize.color,
        count: simulation.prizeCounts[prize.id] ?? 0,
        percent: simulation.completed > 0
          ? ((simulation.prizeCounts[prize.id] ?? 0) / simulation.completed) * 100
          : 0,
      }))
      .filter((row) => row.count > 0 || prizes.find((prize) => prize.id === row.id)?.enabled)
      .sort((left, right) => right.count - left.count);

    if (simulation.retryCount > 0) {
      rows.push({
        id: RETRY_ID,
        name: '重来一次',
        color: '#f2eee5',
        count: simulation.retryCount,
        percent: simulation.attempts > 0 ? (simulation.retryCount / simulation.attempts) * 100 : 0,
      });
    }

    return rows;
  }

  function outcomeLabel(outcome: DrawOutcome): string {
    return {
      selected: '命中',
      retry: '重来',
      eliminated: '淘汰',
      winner: '胜出',
    }[outcome];
  }

  function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(timestamp);
  }

  function clearHistory() {
    records = [];
    batchResult = null;
    batchRunAt = null;
  }

  function resetSettings() {
    if (isSpinning) return;
    prizes = defaultPrizes.map((prize) => ({ ...prize }));
    animationStyle = 'luxury';
    durationSeconds = 4;
    retryEnabled = true;
    retryWeight = 0.65;
    eliminatedIds = [];
    rouletteFinished = false;
    result = {
      eyebrow: '设置已还原',
      title: '回到默认幸运池',
      detail: '奖项、动画和重来权重已经恢复。',
      tone: 'idle',
    };
  }

  async function openImporter() {
    importOpen = true;
    await tick();
    importTextarea?.focus();
  }

  function applyImportedOptions() {
    if (parsedImportOptions.length === 0) return;
    if (importMode === 'replace' && parsedImportOptions.length < 2) {
      result = {
        eyebrow: '无法替换奖池',
        title: '至少需要两个选项',
        detail: '继续粘贴，或切换为“追加到现有奖池”。',
        tone: 'danger',
      };
      return;
    }

    const existingNames = new Set(
      (importMode === 'append' ? prizes : []).map((prize) => prize.name.toLocaleLowerCase('zh-CN')),
    );
    const base = importMode === 'append' ? [...prizes] : [];
    const additions = parsedImportOptions
      .filter((name) => !existingNames.has(name.toLocaleLowerCase('zh-CN')))
      .slice(0, Math.max(0, 100 - base.length))
      .map((name, index): Prize => ({
        id: createId('import'),
        name,
        weight: 1,
        color: importPalette[(base.length + index) % importPalette.length],
        enabled: true,
      }));

    const next = [...base, ...additions];
    if (next.length < 2) return;
    updatePrizes(next);
    importText = '';
    importOpen = false;
    result = {
      eyebrow: '文本解析完成',
      title: `${additions.length} 个选项已导入`,
      detail: importMode === 'replace' ? '原奖池已替换，所有新选项默认等权。' : '新选项已追加，重复名称自动跳过。',
      tone: 'success',
    };
  }

  function exportRecords() {
    if (records.length === 0) return;
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fortuna-records-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape') {
      shortcutsOpen = false;
      if (importOpen && !importText) importOpen = false;
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    if (key === 'k' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      shortcutsOpen = !shortcutsOpen;
      return;
    }

    if (target?.matches('input, textarea, select')) return;

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      spin();
    } else if (key === 'b' && event.shiftKey) {
      event.preventDefault();
      runBatch();
    } else if (key === 'i' && event.shiftKey) {
      event.preventDefault();
      openImporter();
    } else if (key === 'e' && event.shiftKey) {
      event.preventDefault();
      exportRecords();
    } else if (key === 'n' && event.shiftKey && mode === 'roulette') {
      event.preventDefault();
      startNewRouletteRound();
    } else if (event.altKey && event.key === '1') {
      event.preventDefault();
      setMode('selected');
    } else if (event.altKey && event.key === '2') {
      event.preventDefault();
      setMode('roulette');
    } else if (event.altKey && event.key === 'Backspace') {
      event.preventDefault();
      resetSettings();
    }
  }
</script>

<svelte:head>
  <title>Fortuna · 幸运转盘</title>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="#top" aria-label="Fortuna 首页">
      <span class="brand-mark"><i></i></span>
      <span>
        <strong>FORTUNA</strong>
        <small>LUCK LAB / 幸运实验室</small>
      </span>
    </a>

    <div class="mode-switch" aria-label="抽奖模式">
      <button
        type="button"
        class:active={mode === 'selected'}
        disabled={isSpinning}
        on:click={() => setMode('selected')}
      >
        <span class="mode-dot"></span>
        选中模式
      </button>
      <button
        type="button"
        class:active={mode === 'roulette'}
        disabled={isSpinning}
        on:click={() => setMode('roulette')}
      >
        <span class="crosshair">＋</span>
        俄罗斯轮盘
      </button>
    </div>

    <div class="topbar-meta">
      <span class="local-badge"><i></i> 本地运行</span>
      <button
        type="button"
        class="shortcut-trigger"
        title="查看键盘快捷键"
        aria-label="查看键盘快捷键"
        on:click={() => (shortcutsOpen = true)}
      ><kbd>{shortcutMod}</kbd><kbd>K</kbd></button>
      <button type="button" class="icon-button" title="恢复默认设置" on:click={resetSettings}>↺</button>
    </div>
  </header>

  <main class="workspace" id="top">
    <aside class="panel config-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">PRIZE POOL</span>
          <h2>奖池配置</h2>
        </div>
        <span class="count-badge">{enabledPrizes.length}/{prizes.length}</span>
      </div>
      <p class="section-note">编辑名称、颜色和权重，修改会自动保存在本机。</p>

      <PrizeEditor {prizes} disabled={isSpinning} onChange={updatePrizes} />

      <button type="button" class="import-trigger" disabled={isSpinning} on:click={openImporter}>
        <span>⌘</span> 从文本批量导入
        <small>空格 / 逗号 / Excel</small>
      </button>

      {#if importOpen}
        <section class="import-box" aria-label="文本批量导入">
          <div class="import-heading">
            <strong>粘贴选项文本</strong>
            <button type="button" aria-label="关闭文本导入" on:click={() => (importOpen = false)}>×</button>
          </div>
          <textarea
            bind:this={importTextarea}
            bind:value={importText}
            rows="4"
            placeholder={'一等奖 二等奖 三等奖\n或从 Excel 复制整列后直接粘贴'}
          ></textarea>
          <div class="import-modes">
            <button type="button" class:active={importMode === 'replace'} on:click={() => (importMode = 'replace')}>替换奖池</button>
            <button type="button" class:active={importMode === 'append'} on:click={() => (importMode = 'append')}>追加选项</button>
          </div>
          <div class="import-footer">
            <span>识别到 <strong>{parsedImportOptions.length}</strong> 项，重复项会跳过</span>
            <button
              type="button"
              disabled={parsedImportOptions.length === 0 || (importMode === 'replace' && parsedImportOptions.length < 2)}
              on:click={applyImportedOptions}
            >确认导入</button>
          </div>
        </section>
      {/if}

      <div class="section-divider"></div>

      <section class="setting-block">
        <div class="setting-title-row">
          <div>
            <span class="eyebrow">SPECIAL OPTION</span>
            <h3>重来机制</h3>
          </div>
          <button
            type="button"
            class:active={retryEnabled}
            class="switch"
            aria-label={retryEnabled ? '关闭重来机制' : '开启重来机制'}
            aria-pressed={retryEnabled}
            disabled={isSpinning}
            on:click={() => (retryEnabled = !retryEnabled)}
          ><span></span></button>
        </div>
        <p>抽到“重来”会增加尝试次数，批量任务会自动补抽到有效数量。</p>
        {#if retryEnabled}
          <label class="inline-number">
            <span>重来权重</span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.05"
              bind:value={retryWeight}
              disabled={isSpinning}
            />
          </label>
        {/if}
      </section>

      <div class="section-divider"></div>

      <section class="setting-block">
        <span class="eyebrow">MOTION STYLE</span>
        <h3>动画质感</h3>
        <div class="animation-options">
          <button
            type="button"
            class:active={animationStyle === 'simple'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'simple')}
          >
            <span class="motion-icon simple-icon"><i></i></span>
            <strong>简单</strong>
            <small>清爽直接</small>
          </button>
          <button
            type="button"
            class:active={animationStyle === 'luxury'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'luxury')}
          >
            <span class="motion-icon luxury-icon">✦</span>
            <strong>奢华</strong>
            <small>光环粒子</small>
          </button>
          <button
            type="button"
            class:active={animationStyle === 'threeD'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'threeD')}
          >
            <span class="motion-icon cube-icon">◇</span>
            <strong>3D</strong>
            <small>Three.js 实体</small>
          </button>
        </div>
      </section>

      <section class="setting-block duration-block">
        <div class="setting-title-row compact">
          <label for="duration">动画时长</label>
          <output>{durationSeconds.toFixed(1)}<small>s</small></output>
        </div>
        <input
          id="duration"
          class="range-input"
          type="range"
          min="1"
          max="10"
          step="0.5"
          bind:value={durationSeconds}
          disabled={isSpinning}
          style={`--range-progress: ${((durationSeconds - 1) / 9) * 100}%`}
        />
        <div class="range-labels"><span>迅速</span><span>仪式感</span><span>史诗</span></div>
      </section>

    </aside>

    <section class="stage-panel">
      <div class="stage-heading">
        <div>
          <span class="eyebrow">LIVE DRAW</span>
          <h1>{mode === 'selected' ? '今天，好运会停在哪里？' : '谁能留到最后？'}</h1>
        </div>
        <div class="status-pill" class:busy={isSpinning}>
          <i></i>{isSpinning ? '旋转中' : '等待开始'}
        </div>
      </div>

      {#if mode === 'roulette'}
        <div class="roulette-track">
          <span>第 {rouletteRound} 局</span>
          <div class="survivor-dots" aria-label={`剩余 ${rouletteRemaining.length} 项`}>
            {#each enabledPrizes as prize (prize.id)}
              <i
                class:out={eliminatedSet.has(prize.id)}
                style:background={prize.color}
                title={`${prize.name}${eliminatedSet.has(prize.id) ? '（已淘汰）' : ''}`}
              ></i>
            {/each}
          </div>
          <strong>{rouletteRemaining.length} 项存活</strong>
        </div>
      {/if}

      <div class="wheel-wrap">
        {#if animationStyle === 'threeD'}
          <ThreeWheel
            options={wheelOptions}
            {rotation}
            duration={durationSeconds * 1000}
            {eliminatedIds}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '结束' : '开始'}
            onSpin={spin}
          />
        {:else if animationStyle === 'luxury'}
          <LuxuryWheel
            options={wheelOptions}
            {rotation}
            duration={durationSeconds * 1000}
            {eliminatedIds}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '结束' : '开启'}
            onSpin={spin}
          />
        {:else}
          <Wheel
            options={wheelOptions}
            {rotation}
            duration={durationSeconds * 1000}
            {animationStyle}
            {eliminatedIds}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '结束' : '开始'}
            onSpin={spin}
          />
        {/if}
      </div>

      <div class:success={result.tone === 'success'} class:retry={result.tone === 'retry'} class:danger={result.tone === 'danger'} class="result-card">
        <div class="result-symbol">
          {result.tone === 'success' ? '✦' : result.tone === 'retry' ? '↻' : result.tone === 'danger' ? '×' : '·'}
        </div>
        <div>
          <span>{result.eyebrow}</span>
          <strong>{result.title}</strong>
          <p>{result.detail}</p>
        </div>
        {#if mode === 'roulette' && rouletteFinished}
          <button type="button" on:click={startNewRouletteRound}>新一局 →</button>
        {/if}
      </div>

      <div class="stage-footer">
        <span><kbd>{shortcutMod}</kbd> + <kbd>ENTER</kbd> 快速开始</span>
        <span>{records.length} 次尝试 · {validCompleted} 个有效结果 · {retryTotal} 次重来</span>
      </div>
    </section>

    <aside class="panel batch-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">BATCH LAB</span>
          <h2>批量实验室</h2>
        </div>
        <span class="flask">⌁</span>
      </div>
      <p class="section-note">
        {mode === 'selected'
          ? '批量生成有效结果；重来会自动补抽并单独统计。'
          : '每次模拟一整局淘汰赛，统计最终赢家。'}
      </p>

      <div class="batch-runner">
        <label>
          <span>{mode === 'selected' ? '有效抽取数' : '模拟局数'}</span>
          <div class="number-field">
            <input type="number" min="1" max="1000" bind:value={batchCount} disabled={isSpinning} />
            <small>{mode === 'selected' ? '次' : '局'}</small>
          </div>
        </label>
        <div class="quick-counts">
          {#each [10, 100, 500] as amount}
            <button type="button" class:active={batchCount === amount} on:click={() => (batchCount = amount)}>{amount}</button>
          {/each}
        </div>
        <button type="button" class="run-button" disabled={isSpinning} on:click={runBatch}>
          <span>▶</span> 运行批量抽取
        </button>
      </div>

      {#if batchResult}
        <div class="batch-metrics">
          <div>
            <span>有效结果</span>
            <strong>{batchResult.completed}</strong>
          </div>
          <div>
            <span>实际转动</span>
            <strong>{batchResult.attempts}</strong>
          </div>
          <div class:has-retry={batchResult.retryCount > 0}>
            <span>重来</span>
            <strong>{batchResult.retryCount}</strong>
          </div>
        </div>

        <div class="result-tabs">
          <button type="button" class:active={batchTab === 'stats'} on:click={() => (batchTab = 'stats')}>统计分布</button>
          <button type="button" class:active={batchTab === 'history'} on:click={() => (batchTab = 'history')}>逐次记录</button>
          <span>{batchRunAt ? formatTime(batchRunAt) : ''}</span>
        </div>

        {#if batchTab === 'stats'}
          <div class="stats-list">
            {#each batchRows as row, index (row.id)}
              <div class:retry-row={row.id === RETRY_ID} class="stat-row">
                <span class="rank">{String(index + 1).padStart(2, '0')}</span>
                <i style:background={row.color}></i>
                <div>
                  <div class="stat-label"><strong>{row.name}</strong><span>{row.count} 次</span></div>
                  <div class="stat-bar"><span style={`width: ${Math.max(2, row.percent)}%; background: ${row.color}`}></span></div>
                </div>
                <b>{row.percent.toFixed(1)}%</b>
              </div>
            {/each}
          </div>
        {:else}
          <div class="history-list">
            {#each batchHistory as record (record.id)}
              <article>
                <div class:retry={record.outcome === 'retry'} class:winner={record.outcome === 'winner'} class:eliminated={record.outcome === 'eliminated'} class="outcome-icon">
                  {record.outcome === 'retry' ? '↻' : record.outcome === 'winner' ? '♛' : record.outcome === 'eliminated' ? '×' : '✓'}
                </div>
                <div>
                  <strong>{record.label}</strong>
                  <span>{record.detail}</span>
                </div>
                <small>{outcomeLabel(record.outcome)}</small>
              </article>
            {:else}
              <p class="empty-copy">运行一次批量抽取后，这里会保留每次结果。</p>
            {/each}
          </div>
        {/if}

        <div class="history-actions">
          <button type="button" on:click={exportRecords}>导出 JSON</button>
          <button type="button" on:click={clearHistory}>清空记录</button>
        </div>
      {:else}
        <div class="batch-empty">
          <div class="empty-visual">
            <span>10</span><span>100</span><span>500</span>
            <i>↗</i>
          </div>
          <strong>让概率说话</strong>
          <p>选择次数并运行，统计分布和每一次结果会同时保留。</p>
        </div>
      {/if}
    </aside>
  </main>

  {#if shortcutsOpen}
    <div class="shortcut-modal">
      <button
        type="button"
        class="shortcut-backdrop"
        aria-label="关闭快捷键列表"
        on:click={() => (shortcutsOpen = false)}
      ></button>
      <div class="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <div class="shortcut-heading">
          <div>
            <span class="eyebrow">KEYBOARD CONTROL</span>
            <h2 id="shortcut-title">组合键控制台</h2>
          </div>
          <button type="button" aria-label="关闭快捷键列表" on:click={() => (shortcutsOpen = false)}>×</button>
        </div>
        <p>所有关键操作都要求组合键，避免现场抽奖时误触。</p>
        <div class="shortcut-list">
          <div><span>开始单次旋转</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Enter</kbd></div>
          <div><span>运行批量任务</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>B</kbd></div>
          <div><span>打开文本导入</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>I</kbd></div>
          <div><span>导出抽奖记录</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>E</kbd></div>
          <div><span>新建轮盘局</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>N</kbd></div>
          <div><span>切换选中模式</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Alt</kbd><b>＋</b><kbd>1</kbd></div>
          <div><span>切换俄罗斯轮盘</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Alt</kbd><b>＋</b><kbd>2</kbd></div>
          <div><span>恢复默认配置</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>Alt</kbd><b>＋</b><kbd>⌫</kbd></div>
          <div><span>打开 / 关闭本面板</span><kbd>{shortcutMod}</kbd><b>＋</b><kbd>K</kbd></div>
        </div>
      </div>
    </div>
  {/if}

  <footer>
    <span>FORTUNA / 纯本地随机实验</span>
    <span>配置仅保存在当前设备 · 无服务端 · 无数据上传</span>
  </footer>
</div>
