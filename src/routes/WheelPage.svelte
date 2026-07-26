<script lang="ts">
  import { invoke, isTauriRuntime } from '../lib/runtime';
  import { onDestroy, onMount, tick } from 'svelte';
  import LuxuryWheel from '../components/LuxuryWheel.svelte';
  import MonopolyWheel from '../components/MonopolyWheel.svelte';
  import PrizeEditor from '../components/PrizeEditor.svelte';
  import UiButton from '../components/ui/UiButton.svelte';
  import UiConfirmDialog from '../components/ui/UiConfirmDialog.svelte';
  import UiHistoryPanel from '../components/ui/UiHistoryPanel.svelte';
  import UiHistoryRow from '../components/ui/UiHistoryRow.svelte';
  import UiTextarea from '../components/ui/UiTextarea.svelte';
  import UiThemePicker from '../components/ui/UiThemePicker.svelte';
  import Wheel from '../components/Wheel.svelte';
  import type { AppVariant } from '../lib/app-variant';
  import {
    changeAutoSaveHistory,
    prepareAutoSaveClose,
    shouldHandleAutoSaveClose,
  } from '../lib/auto-save';
  import { applyCaimiSelectedWeights, caimiRouletteWeight } from '../lib/caimi';
  import {
    RETRY_ID,
    buildWheelOptions,
    normalizeBatchCount,
    pickWeighted,
    scaleRouletteRetryWeight,
    simulateBatch,
  } from '../lib/draw';
  import {
    adjustResultLimit,
    areCandidateChangesLocked,
    isResultLimitReached,
    isRewardAmountLocked,
    normalizeResultLimit,
    remainingResultSlots,
  } from '../lib/draw-limit';
  import {
    aggregateDrawHistories,
    filterDrawHistories,
    singleDrawHistoryStats,
  } from '../lib/draw-history';
  import { createDrawSoundController, type DrawSoundOutcome } from '../lib/draw-sound';
  import { downloadExcel, downloadFormattedJson } from '../lib/file-export';
  import { parseOptionText } from '../lib/parse-options';
  import { isMultilineTextConfirm, isSingleLineTextConfirm, isTextEditCancel } from '../lib/text-shortcuts';
  import {
    DEFAULT_FONT_SCALE,
    DEFAULT_STAY_SECONDS,
    DEFAULT_UI_THEME,
    normalizeStaySeconds,
    normalizeUiTheme,
    positiveNumberOrFallback,
    type UiTheme,
  } from '../lib/ui-settings';
  import {
    createRouletteWheelSlots,
    createWeightedSegments,
    pickWheelSegmentIndex,
  } from '../lib/wheel-geometry';
  import type {
    AnimationStyle,
    BatchSimulation,
    CommonSelection,
    DrawMode,
    DrawOutcome,
    DrawRecord,
    Prize,
    SavedDraw,
    SimulationEvent,
    WheelOption,
  } from '../lib/types';

  export let desktopRuntime = false;
  export let businessRuntime = desktopRuntime;
  export let variant: AppVariant = 'standard';
  export let active = true;

  const nativeRuntime = isTauriRuntime();

  const STORAGE_KEY = 'wheel-settings-v1';
  const LEGACY_STORAGE_KEY = ['for', 'tuna-wheel-settings-v1'].join('');
  const MAX_ROULETTE_ROUNDS = 5;
  const DRAW_HISTORY_DISPLAY_LIMIT = 5;
  const importPalette = ['#ff7657', '#e9b949', '#8ac86d', '#4ea59b', '#6574c4', '#b76a9d', '#e4884d'];
  const defaultPrizes: Prize[] = [];

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

  interface CurrentStat extends BatchRow {
    weight: number;
    rewardTotal: number;
  }

  interface DrawHistorySummary {
    completed: number;
    retries: number;
    rewardTotal: number;
  }

  type SidebarPanel = 'settings' | 'common' | 'batch' | 'history' | 'shortcuts';
  type DrawSidePanel = 'candidates' | 'statistics';
  type ConfirmableNumberField = 'limit' | 'interval' | 'reward';
  type DrawHistoryDeletion =
    | { kind: 'one'; draw: SavedDraw }
    | { kind: 'all'; confirmation: 1 | 2 };

  let prizes = defaultPrizes.map((prize) => ({ ...prize }));
  export let mode: DrawMode = 'selected';
  let animationStyle: AnimationStyle = 'luxury';
  let durationSeconds = 4;
  let soundEnabled = true;
  let rewardAmount = 0;
  let retryEnabled = true;
  let retryWeight = 0.65;
  let retryWeightBeforeEdit = retryWeight;
  let batchCount = 100;
  let batchTab: 'stats' | 'history' = 'stats';
  let importOpen = false;
  let importText = '';
  let activePanel: SidebarPanel | null = 'settings';
  let drawSidePanel: DrawSidePanel = 'candidates';
  let importTextarea: HTMLTextAreaElement;
  let selectedPrizeId: string | null = null;
  let pendingNewPrizeId: string | null = null;
  let selectedCommonId: string | null = null;
  let candidateKeyboardActive = false;
  let commonKeyboardActive = false;
  let rewardInput: HTMLInputElement;
  let commonSelectionInput: HTMLInputElement;
  let workspaceRoot: HTMLElement | null = null;
  let commonSelections: CommonSelection[] = [];
  let commonSelectionName = '';
  let commonSelectionSaveOpen = false;
  let commonSelectionLoading = true;
  let commonSelectionSaving = false;
  let commonSelectionError = '';
  let drawHistories: SavedDraw[] = [];
  let drawHistoryLoading = true;
  let drawHistorySaving = false;
  let drawHistoryDeleting = false;
  let drawHistoryError = '';
  let drawHistoryStart = '';
  let drawHistoryEnd = '';
  let autoSaveHistory = true;
  let pendingDrawHistoryDeletion: DrawHistoryDeletion | null = null;
  let continuousTarget = 0;
  let staySeconds = DEFAULT_STAY_SECONDS;
  let numberBeforeEdit: Record<ConfirmableNumberField, number> = {
    limit: continuousTarget,
    interval: staySeconds,
    reward: rewardAmount,
  };
  export let continuousRunning = false;
  export let fontScale = DEFAULT_FONT_SCALE;
  export let uiTheme: UiTheme = DEFAULT_UI_THEME;

  let rotation = 0;
  export let isSpinning = false;
  // 记录本局每个候选项已经被命中的次数；剩余权重就是剩余生命数。
  let rouletteHits: Record<string, number> = {};
  let rouletteFinished = false;
  let rouletteRound = 1;
  let singleAttempt = 0;
  let monopolyTargetId: string | null = null;
  let revealedCandidateName: string | null = null;
  let singleCompleted = 0;
  let records: DrawRecord[] = [];
  let currentDrawId = createId('draw');
  let batchResult: BatchSimulation | null = null;
  let batchRunAt: number | null = null;
  let wheelExporting: 'stats-excel' | 'stats-json' | 'batch-json' | null = null;
  // 历史导出共用一个锁，避免快速连点向 Tauri 发起重复写文件请求。
  let drawHistoryExporting: string | null = null;
  let statsExportError = '';
  let batchExportError = '';
  let hydrated = false;
  let databaseSettingsLoaded = false;
  let persistedWheelSettings: Record<string, unknown> = {};
  let timer: number | undefined;
  let continuousTimer: number | undefined;
  const drawSound = createDrawSoundController();
  let result: ResultCard = {
    eyebrow: '准备就绪',
    title: '好运正在路上',
    detail: '点击转盘中央，开始一次公平的随机抽取。',
    tone: 'idle',
  };

  $: enabledPrizes = prizes.filter((prize) => prize.enabled);
  $: wheelOptions = enabledPrizes.length === 0
    ? []
    : buildWheelOptions(prizes, retryEnabled, retryWeight);
  $: validCompleted = records.filter(
    (record) => record.outcome === 'selected' || record.outcome === 'winner',
  ).length;
  $: resultLimitReached = isResultLimitReached(continuousTarget, validCompleted);
  $: candidateChangesLocked = areCandidateChangesLocked(
    continuousTarget,
    records.length,
    isSpinning,
  );
  $: rewardAmountLocked = isRewardAmountLocked(
    desktopRuntime,
    records.length,
    isSpinning,
  );
  $: spinDisabled =
    enabledPrizes.length < 2 ||
    resultLimitReached;
  $: retryTotal = records.filter((record) => record.outcome === 'retry').length;
  $: totalRewardAmount = records.reduce((total, record) => total + (record.rewardAmount || 0), 0);
  $: currentStats = createCurrentStats(prizes, records, validCompleted);
  $: filteredDrawHistories = filterDrawHistories(
    drawHistories,
    drawHistoryStart,
    drawHistoryEnd,
  );
  // 数据库按时间倒序查询，界面只展示最新上限条，并在列表中按时间正序阅读。
  $: visibleDrawHistories = filteredDrawHistories
    .slice(0, DRAW_HISTORY_DISPLAY_LIMIT)
    .reverse();
  $: batchRows = createBatchRows(batchResult);
  $: batchHistory = batchResult ? [...batchResult.events].reverse().slice(0, 160) : [];
  $: parsedImportOptions = parseOptionText(importText);
  $: continuousCompleted = validCompleted;
  $: continuousRemaining = remainingResultSlots(continuousTarget, continuousCompleted);
  // 这里直接读取 rouletteHits，确保每次命中后圆盘立即减少一个生命扇区。
  $: activeDrawOptions = (() => {
    if (mode !== 'roulette') {
      return variant === 'caimi'
        ? buildWheelOptions(applyCaimiSelectedWeights(prizes), retryEnabled, retryWeight)
        : wheelOptions;
    }
    const effective = prizes
      .filter((p) => p.enabled)
      .map((p) => ({ ...p, weight: Math.max(0, p.weight - (rouletteHits[p.id] ?? 0)) }))
      .filter((p) => p.weight > 0);
    if (effective.length === 0) return wheelOptions;
    return buildWheelOptions(effective, retryEnabled, retryWeight);
  })();
  $: displayedWheelOptions = mode === 'roulette'
    ? createRouletteWheelSlots(activeDrawOptions)
    : wheelOptions;
  // 显式依赖 activeDrawOptions，确保俄罗斯模式命中后立即重建大富翁格子。
  $: monopolyWheelOptions = mode === 'roulette'
    ? currentDrawOptions(activeDrawOptions, wheelOptions)
    : wheelOptions;
  $: monopolyLifeWeights = mode === 'roulette'
    ? Object.fromEntries(activeDrawOptions
        .filter((option) => !option.isRetry)
        .map((option) => [option.id, Math.max(1, Math.round(option.weight))]))
    : null;
  $: if (hydrated && databaseSettingsLoaded) {
    persistWheelSettings({
      mode,
      animationStyle,
      durationSeconds,
      soundEnabled,
      rewardAmount,
      retryEnabled,
      retryWeight,
      autoSaveHistory,
      continuousTarget,
      staySeconds,
      uiTheme,
    });
  }

  onMount(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<{
          mode: DrawMode;
          animationStyle: AnimationStyle;
          durationSeconds: number;
          soundEnabled: boolean;
          rewardAmount: number;
          retryEnabled: boolean;
          retryWeight: number;
          autoSaveHistory: boolean;
          continuousTarget: number;
          staySeconds: number;
          continuousIntervalSeconds: number;
          uiTheme: UiTheme;
        }>;

        if (parsed.mode === 'selected' || parsed.mode === 'roulette') mode = parsed.mode;
        if (['simple', 'luxury', 'threeD'].includes(parsed.animationStyle ?? '')) {
          animationStyle = parsed.animationStyle!;
        }
        if (typeof parsed.durationSeconds === 'number') {
          durationSeconds = Math.min(10, Math.max(1, parsed.durationSeconds));
        }
        if (typeof parsed.soundEnabled === 'boolean') soundEnabled = parsed.soundEnabled;
        if (typeof parsed.rewardAmount === 'number') {
          rewardAmount = Math.max(0, parsed.rewardAmount);
        }
        if (typeof parsed.retryEnabled === 'boolean') retryEnabled = parsed.retryEnabled;
        retryWeight = positiveNumberOrFallback(parsed.retryWeight, 0.65);
        if (typeof parsed.autoSaveHistory === 'boolean') autoSaveHistory = parsed.autoSaveHistory;
        if (typeof parsed.continuousTarget === 'number') {
          continuousTarget = normalizeResultLimit(parsed.continuousTarget, 0);
        }
        // 旧版把统计栏的值直接持久化；迁移后只把它作为首次设置默认值。
        staySeconds = normalizeStaySeconds(parsed.staySeconds ?? parsed.continuousIntervalSeconds);
        uiTheme = normalizeUiTheme(parsed.uiTheme);
      }
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // 浏览器禁用本地存储时继续使用默认设置。
      }
    }
    void loadCommonSelections();
    void loadDrawHistories();
    void loadWheelSettingsFromDatabase();
    hydrated = true;
  });

  onDestroy(() => {
    if (timer) window.clearTimeout(timer);
    if (continuousTimer) window.clearTimeout(continuousTimer);
    drawSound.dispose();
  });

  /** 转盘设置与应用壳的字号共用一个键，写入时保留彼此字段。 */
  function persistWheelSettings(next: Record<string, unknown>) {
    const saved = { ...persistedWheelSettings, ...next };
    persistedWheelSettings = saved;
    void invoke('save_app_setting', { key: 'wheel-settings', value: saved }).catch(() => {
      // 数据库不可用时继续保留当前会话状态。
    });
    try {
      if (!databaseSettingsLoaded) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      }
    } catch {
      // 禁用本地存储时仍允许数据库配置继续生效。
    }
  }

  async function loadWheelSettingsFromDatabase() {
    try {
      const value = await invoke<unknown>('load_app_setting', { key: 'wheel-settings' });
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const parsed = value as Partial<{
          mode: DrawMode;
          animationStyle: AnimationStyle;
          durationSeconds: number;
          soundEnabled: boolean;
          rewardAmount: number;
          retryEnabled: boolean;
          retryWeight: number;
          autoSaveHistory: boolean;
          continuousTarget: number;
          staySeconds: number;
          continuousIntervalSeconds: number;
          uiTheme: UiTheme;
        }>;
        persistedWheelSettings = { ...(value as Record<string, unknown>) };
        if (parsed.mode === 'selected' || parsed.mode === 'roulette') mode = parsed.mode;
        if (['simple', 'luxury', 'threeD'].includes(parsed.animationStyle ?? '')) animationStyle = parsed.animationStyle!;
        if (typeof parsed.durationSeconds === 'number') durationSeconds = Math.min(10, Math.max(1, parsed.durationSeconds));
        if (typeof parsed.soundEnabled === 'boolean') soundEnabled = parsed.soundEnabled;
        if (typeof parsed.rewardAmount === 'number') rewardAmount = Math.max(0, parsed.rewardAmount);
        if (typeof parsed.retryEnabled === 'boolean') retryEnabled = parsed.retryEnabled;
        retryWeight = positiveNumberOrFallback(parsed.retryWeight, retryWeight);
        if (typeof parsed.autoSaveHistory === 'boolean') autoSaveHistory = parsed.autoSaveHistory;
        if (typeof parsed.continuousTarget === 'number') continuousTarget = normalizeResultLimit(parsed.continuousTarget, 0);
        staySeconds = normalizeStaySeconds(parsed.staySeconds ?? parsed.continuousIntervalSeconds ?? staySeconds);
        uiTheme = normalizeUiTheme(parsed.uiTheme);
      }
    } catch {
      // 首次运行或旧版本数据库没有配置时使用默认值和兼容迁移值。
    } finally {
      databaseSettingsLoaded = true;
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    if (!soundEnabled) drawSound.stopSpin();
  }

  function playDrawResultSound(outcome: DrawSoundOutcome) {
    if (soundEnabled) drawSound.playResult(outcome);
  }

  function createId(prefix: string): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isCommonSelection(value: unknown): value is CommonSelection {
    if (!value || typeof value !== 'object') return false;
    const selection = value as Partial<CommonSelection>;
    return selection.version === 1
      && typeof selection.id === 'string'
      && typeof selection.name === 'string'
      && typeof selection.createdAt === 'number'
      && Array.isArray(selection.prizes)
      && selection.prizes.every((prize) => (
        prize
        && typeof prize.id === 'string'
        && typeof prize.name === 'string'
        && typeof prize.color === 'string'
        && typeof prize.enabled === 'boolean'
      ));
  }

  function isSavedDraw(value: unknown): value is SavedDraw {
    if (!value || typeof value !== 'object') return false;
    const draw = value as Partial<SavedDraw>;
    return draw.version === 1
      && typeof draw.id === 'string'
      && typeof draw.createdAt === 'number'
      && (draw.mode === 'selected' || draw.mode === 'roulette')
      && typeof draw.rewardAmount === 'number'
      && Array.isArray(draw.prizes)
      && Array.isArray(draw.records);
  }

  async function loadCommonSelections() {
    commonSelectionLoading = true;
    commonSelectionError = '';
    try {
      const loaded = await invoke<unknown[]>('list_common_selections');
      commonSelections = Array.isArray(loaded)
        ? loaded.filter(isCommonSelection).sort((left, right) => right.createdAt - left.createdAt)
        : [];
    } catch (error) {
      commonSelectionError = error instanceof Error ? error.message : String(error);
    } finally {
      commonSelectionLoading = false;
    }
  }

  async function openCommonSelectionSaver() {
    if (isSpinning || prizes.length === 0) return;
    commonSelectionName = `${prizes.slice(0, 2).map((prize) => prize.name).join('、')}${prizes.length > 2 ? `等 ${prizes.length} 项` : ''}`;
    commonSelectionSaveOpen = true;
    commonSelectionError = '';
    await tick();
    commonSelectionInput?.select();
  }

  async function saveCurrentSelection() {
    const name = commonSelectionName.trim();
    if (!name || prizes.length === 0 || commonSelectionSaving) return;

    const selection: CommonSelection = {
      version: 1,
      id: createId('selection'),
      name: name.slice(0, 40),
      createdAt: Date.now(),
      prizes: prizes.map(({ id, name: prizeName, color, enabled }) => ({
        id,
        name: prizeName,
        color,
        enabled,
      })),
    };

    commonSelectionSaving = true;
    commonSelectionError = '';
    try {
      await invoke('save_common_selection', { selection });
      commonSelections = [selection, ...commonSelections];
      commonSelectionSaveOpen = false;
      commonSelectionName = '';
      result = {
        eyebrow: '常用候选已保存',
        title: selection.name,
        detail: `${selection.prizes.length} 个候选项已保存到本地数据库。`,
        tone: 'success',
      };
    } catch (error) {
      commonSelectionError = error instanceof Error ? error.message : String(error);
    } finally {
      commonSelectionSaving = false;
    }
  }

  function applyCommonSelection(selection: CommonSelection) {
    if (!updatePrizes(selection.prizes.map((prize) => ({ ...prize, weight: 1 })))) return;
    rouletteHits = {};
    rouletteFinished = false;
    singleAttempt = 0;
    importOpen = false;
    commonKeyboardActive = false;
    selectedCommonId = null;
    result = {
      eyebrow: '常用候选已导入',
      title: selection.name,
      detail: `${selection.prizes.length} 个候选项已放入当前轮盘，其他设置保持不变。`,
      tone: 'success',
    };
  }

  async function deleteCommonSelection(selection: CommonSelection) {
    if (commonSelectionSaving) return;
    commonSelectionError = '';
    try {
      await invoke('delete_common_selection', { id: selection.id });
      commonSelections = commonSelections.filter((item) => item.id !== selection.id);
      if (selectedCommonId === selection.id) {
        selectedCommonId = commonSelections[0]?.id ?? null;
      }
    } catch (error) {
      commonSelectionError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadDrawHistories() {
    drawHistoryLoading = true;
    drawHistoryError = '';
    try {
      const loaded = await invoke<unknown[]>('list_draw_histories', { variant });
      drawHistories = Array.isArray(loaded) ? loaded.filter(isSavedDraw) : [];
    } catch (error) {
      drawHistoryError = error instanceof Error ? error.message : String(error);
    } finally {
      drawHistoryLoading = false;
    }
  }

  async function archiveCurrentDrawHistory(): Promise<boolean> {
    if (!businessRuntime || validCompleted === 0 || drawHistorySaving) return false;
    const draw: SavedDraw = {
      version: 1,
      id: currentDrawId,
      createdAt: Date.now(),
      mode,
      rewardAmount: normalizedRewardAmount(),
      prizes: prizes.map((prize) => ({ ...prize })),
      records: records.map((record) => ({ ...record })),
    };

    drawHistorySaving = true;
    drawHistoryError = '';
    try {
      await invoke('save_draw_history', { draw, variant });
      drawHistories = [draw, ...drawHistories.filter((history) => history.id !== draw.id)];
      return true;
    } catch (error) {
      drawHistoryError = error instanceof Error ? error.message : String(error);
      result = {
        eyebrow: '保存失败',
        title: '当前抽奖未保存',
        detail: drawHistoryError,
        tone: 'danger',
      };
      return false;
    } finally {
      drawHistorySaving = false;
    }
  }

  export function shouldHandleWindowClose(): boolean {
    return desktopRuntime && shouldHandleAutoSaveClose(
      autoSaveHistory,
      validCompleted,
      isSpinning,
      drawHistorySaving,
    );
  }

  /** 浏览器只能提示离开，无法像 Tauri 一样在卸载阶段等待异步归档。 */
  export function shouldWarnBeforeUnload(): boolean {
    return businessRuntime && shouldHandleAutoSaveClose(
      autoSaveHistory,
      validCompleted,
      isSpinning,
      drawHistorySaving,
    );
  }

  export async function prepareForWindowClose(): Promise<boolean> {
    if (!desktopRuntime) return true;
    return prepareAutoSaveClose({
      enabled: () => autoSaveHistory,
      effectiveResultCount: () => validCompleted,
      stopContinuous: stopContinuousDraw,
      waitForSpin: () => waitWhile(() => isSpinning),
      waitForSaving: () => waitWhile(() => drawHistorySaving),
      saveCurrent: archiveCurrentDrawHistory,
    });
  }

  async function waitWhile(active: () => boolean): Promise<void> {
    while (active()) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
  }

  async function startNewDraw(clearCandidates = false) {
    if (isSpinning || drawHistorySaving) return;
    stopContinuousDraw();
    let archived = false;
    if (businessRuntime && autoSaveHistory && validCompleted > 0) {
      const saved = await archiveCurrentDrawHistory();
      if (!saved) return;
      archived = true;
    }
    continuousTarget = 0;
    rewardAmount = 0;
    resetCurrentDraw(clearCandidates, archived);
  }

  function resetCurrentDraw(clearCandidates = false, archived = false) {
    currentDrawId = createId('draw');
    records = [];
    batchResult = null;
    batchRunAt = null;
    statsExportError = '';
    batchExportError = '';
    rouletteHits = {};
    rouletteFinished = false;
    rouletteRound = 1;
    singleAttempt = 0;
    singleCompleted = 0;
    monopolyTargetId = null;
    revealedCandidateName = null;
    drawSidePanel = 'candidates';
    exitCandidateKeyboard();
    exitCommonKeyboard();
    if (clearCandidates) updatePrizes([]);
    result = {
      eyebrow: '新的抽奖',
      title: '准备就绪',
      detail: archived
        ? '上一轮统计已保存到本地历史，可以开始新一轮。'
        : clearCandidates || enabledPrizes.length < 2
        ? '添加至少两个候选项后才能开始。'
        : '点击转盘中央开始。',
      tone: 'idle',
    };
  }

  async function toggleAutoSaveHistory() {
    if (!businessRuntime || isSpinning || drawHistorySaving) return;
    const completedBeforeArchive = validCompleted;
    const change = await changeAutoSaveHistory(
      autoSaveHistory,
      validCompleted,
      () => archiveCurrentDrawHistory(),
      () => resetCurrentDraw(false, true),
    );
    if (!change.applied) return;

    autoSaveHistory = change.enabled;
    if (!change.enabled) {
      result = {
        eyebrow: '自动保存已关闭',
        title: '统计不会自动入库',
        detail: '关闭后不会写入历史。',
        tone: 'idle',
      };
      return;
    }

    result = {
      eyebrow: '自动保存已开启',
      title: change.archived ? '统计已入库并清空' : '后续抽奖会自动归档',
      detail: change.archived
        ? `已保存 ${completedBeforeArchive} 个有效结果，现在可以开始新一轮。`
        : '开始新抽奖时，上一轮统计会自动保存到本地历史。',
      tone: 'success',
    };
  }

  function requestDeleteDrawHistory(draw: SavedDraw) {
    pendingDrawHistoryDeletion = { kind: 'one', draw };
  }

  function requestClearDrawHistories() {
    if (drawHistories.length > 0) {
      pendingDrawHistoryDeletion = { kind: 'all', confirmation: 1 };
    }
  }

  async function confirmDrawHistoryDeletion() {
    const pending = pendingDrawHistoryDeletion;
    if (!businessRuntime || !pending || drawHistoryDeleting) return;
    if (pending.kind === 'all' && pending.confirmation === 1) {
      pendingDrawHistoryDeletion = { kind: 'all', confirmation: 2 };
      return;
    }
    drawHistoryDeleting = true;
    if (pending.kind === 'one') await deleteDrawHistory(pending.draw);
    else await clearDrawHistories();
    drawHistoryDeleting = false;
    pendingDrawHistoryDeletion = null;
  }

  async function deleteDrawHistory(draw: SavedDraw) {
    if (!businessRuntime) return;
    drawHistoryError = '';
    try {
      await invoke('delete_draw_history', { id: draw.id, variant });
      drawHistories = drawHistories.filter((history) => history.id !== draw.id);
    } catch (error) {
      drawHistoryError = error instanceof Error ? error.message : String(error);
    }
  }

  async function clearDrawHistories() {
    if (!businessRuntime || drawHistories.length === 0) return;
    drawHistoryError = '';
    try {
      await invoke('clear_draw_histories', { variant });
      drawHistories = [];
    } catch (error) {
      drawHistoryError = error instanceof Error ? error.message : String(error);
    }
  }

  function drawHistorySummary(draw: SavedDraw): DrawHistorySummary {
    return draw.records.reduce((summary, record) => {
      if (record.outcome === 'selected' || record.outcome === 'winner') {
        summary.completed += 1;
        summary.rewardTotal += Math.max(0, Number(record.rewardAmount) || 0);
      } else if (record.outcome === 'retry') {
        summary.retries += 1;
      }
      return summary;
    }, { completed: 0, retries: 0, rewardTotal: 0 });
  }

  async function exportDrawHistoriesExcel() {
    if (filteredDrawHistories.length === 0) return;
    const rows = aggregateDrawHistories(filteredDrawHistories);
    await runDrawHistoryExport('summary-excel', '无法导出历史汇总 Excel', () => downloadExcel('转盘历史查询', [
      ['名字', '参与次数', '中奖次数', '中奖金额'],
      ...rows.map((row) => [row.name, row.participationCount, row.winCount, row.rewardTotal]),
    ]));
  }

  async function exportDrawHistoriesJson() {
    if (filteredDrawHistories.length === 0) return;
    await runDrawHistoryExport('summary-json', '无法导出历史汇总 JSON', () => (
      downloadFormattedJson('转盘历史查询', aggregateDrawHistories(filteredDrawHistories))
    ));
  }

  async function exportDrawHistoryExcel(draw: SavedDraw) {
    const rows = singleDrawHistoryStats(draw);
    await runDrawHistoryExport(`draw:${draw.id}:excel`, '无法导出单条历史 Excel', () => downloadExcel('抽奖历史', [
      ['名字', '权重', '中奖次数', '中奖金额'],
      ...rows.map((row) => [row.name, row.weight, row.count, row.rewardTotal]),
    ]));
  }

  async function exportDrawHistoryJson(draw: SavedDraw) {
    await runDrawHistoryExport(`draw:${draw.id}:json`, '无法导出单条历史 JSON', () => (
      downloadFormattedJson('抽奖历史', singleDrawHistoryStats(draw))
    ));
  }

  async function runDrawHistoryExport(
    key: string,
    fallback: string,
    action: () => Promise<unknown>,
  ) {
    if (drawHistoryExporting !== null) return;
    drawHistoryExporting = key;
    drawHistoryError = '';
    try {
      await action();
    } catch (reason) {
      drawHistoryError = exportErrorMessage(reason, fallback);
    } finally {
      drawHistoryExporting = null;
    }
  }

  function exportErrorMessage(reason: unknown, fallback: string): string {
    const message = reason instanceof Error ? reason.message : String(reason ?? '');
    return message && message !== '[object Object]' ? message : fallback;
  }

  async function openDrawDownloadFolder() {
    drawHistoryError = '';
    try {
      await invoke('open_download_folder');
    } catch (reason) {
      drawHistoryError = reason instanceof Error ? reason.message : String(reason);
    }
  }

  function togglePanel(panel: SidebarPanel) {
    activePanel = activePanel === panel ? null : panel;
  }

  function normalizedRewardAmount(): number {
    return Math.max(0, Number(rewardAmount) || 0);
  }

  function normalizePrizes(candidates: Prize[]): Prize[] {
    return candidates.map((prize) => ({
      ...prize,
      weight: Math.max(1, Number(prize.weight) || 1),
    }));
  }

  async function selectPrize(id: string | null) {
    selectedPrizeId = id && prizes.some((prize) => prize.id === id) ? id : null;
    if (selectedPrizeId) candidateKeyboardActive = true;
    if (!selectedPrizeId) return;
    await tick();
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-prize-id]'))
      .find((element) => element.dataset.prizeId === selectedPrizeId);
    row?.scrollIntoView({ block: 'nearest' });
  }

  async function enterCandidateKeyboard() {
    commonKeyboardActive = false;
    selectedCommonId = null;
    candidateKeyboardActive = true;
    drawSidePanel = 'candidates';
    if (prizes.length > 0) {
      await selectPrize(selectedPrizeId ?? prizes[0].id);
    }
  }

  function focusGlobalShortcuts() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    workspaceRoot?.focus({ preventScroll: true });
  }

  function exitCandidateKeyboard() {
    candidateKeyboardActive = false;
    selectedPrizeId = null;
    focusGlobalShortcuts();
  }

  async function selectRewardInput() {
    if (rewardAmountIsLocked()) {
      showRewardAmountLocked();
      return;
    }
    commonKeyboardActive = false;
    selectedCommonId = null;
    candidateKeyboardActive = true;
    selectedPrizeId = null;
    drawSidePanel = 'statistics';
    await tick();
    rewardInput?.focus();
    rewardInput?.select();
  }

  async function enterCommonKeyboard() {
    candidateKeyboardActive = false;
    selectedPrizeId = null;
    commonKeyboardActive = true;
    activePanel = 'common';
    selectedCommonId = commonSelections[0]?.id ?? null;
    await scrollSelectedCommonIntoView();
  }

  function toggleCommonKeyboard() {
    if (activePanel === 'common') {
      exitCommonKeyboard();
      activePanel = null;
      return;
    }
    void enterCommonKeyboard();
  }

  function exitCommonKeyboard() {
    commonKeyboardActive = false;
    selectedCommonId = null;
    focusGlobalShortcuts();
  }

  async function moveCommonSelection(direction: -1 | 1) {
    if (commonSelections.length === 0) return;
    const currentIndex = selectedCommonId
      ? commonSelections.findIndex((selection) => selection.id === selectedCommonId)
      : -1;
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : commonSelections.length - 1)
      : (currentIndex + direction + commonSelections.length) % commonSelections.length;
    selectedCommonId = commonSelections[nextIndex].id;
    await scrollSelectedCommonIntoView();
  }

  async function scrollSelectedCommonIntoView() {
    if (!selectedCommonId) return;
    await tick();
    const card = Array.from(document.querySelectorAll<HTMLElement>('[data-common-id]'))
      .find((element) => element.dataset.commonId === selectedCommonId);
    card?.scrollIntoView({ block: 'nearest' });
  }

  function applySelectedCommon() {
    if (!selectedCommonId) return;
    const selection = commonSelections.find((item) => item.id === selectedCommonId);
    if (selection) applyCommonSelection(selection);
  }

  async function addPrize() {
    const id = createId('prize');
    if (!updatePrizes([
      ...prizes,
      {
        id,
        name: `新选项 ${prizes.length + 1}`,
        weight: 1,
        color: importPalette[prizes.length % importPalette.length],
        enabled: true,
      },
    ])) return;
    pendingNewPrizeId = id;
    await selectPrize(id);
    await editSelectedPrizeName();
  }

  function movePrizeSelection(direction: -1 | 1) {
    if (prizes.length === 0) return;
    const currentIndex = selectedPrizeId
      ? prizes.findIndex((prize) => prize.id === selectedPrizeId)
      : -1;
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : prizes.length - 1)
      : (currentIndex + direction + prizes.length) % prizes.length;
    void selectPrize(prizes[nextIndex].id);
  }

  async function togglePrizeParticipation(id: string) {
    if (drawHistorySaving || isSpinning) return;
    const shouldArchive = businessRuntime && autoSaveHistory && records.length > 0;
    if (!shouldArchive && guardCandidateChanges()) return;
    const selected = prizes.find((prize) => prize.id === id);
    if (!selected) return;
    const keepKeyboardSelection = candidateKeyboardActive;
    const next = prizes.map((prize) => (
      prize.id === id ? { ...prize, enabled: !prize.enabled } : prize
    ));

    if (shouldArchive) {
      let archived = false;
      if (validCompleted > 0) {
        if (!await archiveCurrentDrawHistory()) return;
        archived = true;
      }
      resetCurrentDraw(false, archived);
    }

    if (!updatePrizes(next)) return;
    if (keepKeyboardSelection) await selectPrize(id);
  }

  function toggleSelectedPrize() {
    if (!selectedPrizeId) return;
    void togglePrizeParticipation(selectedPrizeId);
  }

  function adjustSelectedPrizeWeight(delta: -1 | 1) {
    if (!selectedPrizeId) return;
    updatePrizes(prizes.map((prize) => (
      prize.id === selectedPrizeId
        ? { ...prize, weight: Math.max(1, prize.weight + delta) }
        : prize
    )));
  }

  async function editSelectedPrizeName() {
    if (!selectedPrizeId) return;
    await tick();
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-prize-id] .name-input'))
      .find((element) => element.closest<HTMLElement>('[data-prize-id]')?.dataset.prizeId === selectedPrizeId);
    input?.focus();
    input?.select();
  }

  function deleteSelectedPrize() {
    if (!selectedPrizeId) return;
    const currentIndex = prizes.findIndex((prize) => prize.id === selectedPrizeId);
    if (currentIndex < 0) return;
    const next = prizes.filter((prize) => prize.id !== selectedPrizeId);
    const nextSelected = next[Math.min(currentIndex, next.length - 1)]?.id ?? null;
    if (!updatePrizes(next)) return;
    void selectPrize(nextSelected);
  }

  export function setMode(next: DrawMode) {
    if (isSpinning || mode === next) return;
    mode = next;
    rouletteHits = {};
    rouletteFinished = false;
    rouletteRound = 1;
    singleAttempt = 0;
    monopolyTargetId = null;
    revealedCandidateName = null;
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

  function candidateChangesAreLocked(): boolean {
    return areCandidateChangesLocked(continuousTarget, records.length, isSpinning);
  }

  function rewardAmountIsLocked(): boolean {
    return isRewardAmountLocked(businessRuntime, records.length, isSpinning);
  }

  function showRewardAmountLocked() {
    if (isSpinning) return;
    result = {
      eyebrow: '奖励金额已锁定',
      title: '本轮桌面抽奖已有记录',
      detail: '开始新的抽奖后才能设置另一笔奖励金额。',
      tone: 'danger',
    };
  }

  function guardCandidateChanges(): boolean {
    if (!candidateChangesAreLocked()) return false;
    if (!isSpinning) {
      result = {
        eyebrow: '候选项已锁定',
        title: '当前受限抽奖已经开始',
        detail: '开始新的抽奖，或把上限设为 0 后再修改候选项。',
        tone: 'danger',
      };
    }
    return true;
  }

  function updatePrizes(next: Prize[]): boolean {
    if (drawHistorySaving) return false;
    if (guardCandidateChanges()) return false;
    prizes = normalizePrizes(next);
    if (pendingNewPrizeId && !prizes.some((prize) => prize.id === pendingNewPrizeId)) {
      pendingNewPrizeId = null;
    }
    if (selectedPrizeId && !prizes.some((prize) => prize.id === selectedPrizeId)) {
      selectedPrizeId = null;
    }
    // 删除已经不存在的候选项对应的命中状态。
    const validIds = new Set(next.map((p) => p.id));
    rouletteHits = Object.fromEntries(
      Object.entries(rouletteHits).filter(([id]) => validIds.has(id)),
    );
    if (mode === 'roulette') {
      rouletteFinished = false;
    }
    return true;
  }

  /** 返回按本局命中次数扣除生命后的候选项。 */
  function rouletteEffectivePrizes(): Prize[] {
    return prizes
      .filter((p) => p.enabled)
      .map((p) => ({ ...p, weight: Math.max(0, p.weight - (rouletteHits[p.id] ?? 0)) }))
      .filter((p) => p.weight > 0);
  }

  function currentDrawOptions(
    currentSource: WheelOption[] = activeDrawOptions,
    initialSource: WheelOption[] = wheelOptions,
  ): WheelOption[] {
    if (mode !== 'roulette') return currentSource;
    const applyModeWeight = (option: WheelOption) => (
      variant === 'caimi' && !option.isRetry
        ? { ...option, weight: caimiRouletteWeight(option.label, option.weight) }
        : option
    );
    const currentOptions = currentSource.map(applyModeWeight);
    const initialOptions = initialSource.map(applyModeWeight);
    const candidateTotal = (options: WheelOption[]) => options.reduce(
      (total, option) => total + (option.isRetry ? 0 : Math.max(0.01, Number(option.weight) || 0.01)),
      0,
    );
    const effectiveRetryWeight = scaleRouletteRetryWeight(
      retryWeight,
      candidateTotal(currentOptions),
      candidateTotal(initialOptions),
    );
    return currentOptions.map((option) => (
      option.isRetry ? { ...option, weight: effectiveRetryWeight } : option
    ));
  }

  function normalizeContinuousTarget() {
    continuousTarget = normalizeResultLimit(continuousTarget, validCompleted);
  }

  function adjustContinuousTarget(delta: -1 | 1) {
    if (continuousRunning) return;
    continuousTarget = adjustResultLimit(continuousTarget, delta, validCompleted);
  }

  function currentConfirmableNumber(field: ConfirmableNumberField): number {
    if (field === 'limit') return continuousTarget;
    if (field === 'interval') return staySeconds;
    return rewardAmount;
  }

  function normalizeConfirmableNumber(field: ConfirmableNumberField, value: unknown): number {
    if (field === 'limit') {
      continuousTarget = normalizeResultLimit(value, validCompleted);
      return continuousTarget;
    }
    if (field === 'interval') {
      staySeconds = normalizeStaySeconds(value);
      return staySeconds;
    }
    rewardAmount = Math.max(0, Number(value) || 0);
    return rewardAmount;
  }

  function beginConfirmableNumberEdit(event: FocusEvent, field: ConfirmableNumberField) {
    numberBeforeEdit[field] = currentConfirmableNumber(field);
    const input = event.currentTarget as HTMLInputElement;
    input.select();
    if (field === 'reward') {
      candidateKeyboardActive = true;
      selectedPrizeId = null;
    }
  }

  function updateConfirmableNumber(event: Event, field: ConfirmableNumberField) {
    if (field === 'reward' && rewardAmountIsLocked()) {
      showRewardAmountLocked();
      return;
    }
    const input = event.currentTarget as HTMLInputElement;
    input.value = String(normalizeConfirmableNumber(field, input.value));
  }

  function finishConfirmableNumberEdit(
    input: HTMLInputElement,
    field: ConfirmableNumberField,
    cancel: boolean,
  ) {
    const value = cancel
      ? normalizeConfirmableNumber(field, numberBeforeEdit[field])
      : normalizeConfirmableNumber(field, input.value);
    input.value = String(value);
    input.blur();
    candidateKeyboardActive = false;
    commonKeyboardActive = false;
    selectedPrizeId = null;
    selectedCommonId = null;
    focusGlobalShortcuts();
  }

  function beginRetryWeightEdit(event: FocusEvent) {
    retryWeightBeforeEdit = positiveNumberOrFallback(retryWeight, 0.65);
    (event.currentTarget as HTMLInputElement).select();
  }

  function updateRetryWeight(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) retryWeight = value;
  }

  function finishRetryWeightEdit(event: FocusEvent) {
    const input = event.currentTarget as HTMLInputElement;
    retryWeight = positiveNumberOrFallback(input.value, retryWeightBeforeEdit);
    input.value = String(retryWeight);
  }

  function showResultLimitReached() {
    stopContinuousDraw();
    result = {
      eyebrow: '上限',
      title: `已完成 ${validCompleted} 个结果`,
      detail: '把上限调高后可以继续；设为 0 则不限制次数。',
      tone: 'success',
    };
  }

  function spin() {
    if (
      isSpinning ||
      enabledPrizes.length < 2
    ) return;
    if (mode === 'roulette' && rouletteFinished) {
      startNewRouletteRound();
      return;
    }
    if (resultLimitReached) {
      showResultLimitReached();
      return;
    }
    if (continuousTimer) {
      window.clearTimeout(continuousTimer);
      continuousTimer = undefined;
    }
    drawSidePanel = 'statistics';

    const options = currentDrawOptions();
    const realOptions = options.filter((option) => !option.isRetry);
    if (realOptions.length === 0) {
      result = {
        eyebrow: '无法开始',
        title: '请至少启用一个候选项',
        detail: mode === 'roulette' ? '俄罗斯轮盘需要至少两个启用的候选项。' : '重来不能是唯一选项。',
        tone: 'danger',
      };
      return;
    }

    const picked = pickWeighted(options);
    const usesMonopoly = animationStyle === 'threeD';

    if (usesMonopoly) {
      // 大富翁棋盘由组件根据候选项编号计算走格终点。
      monopolyTargetId = picked.id;
    } else {
      // 俄罗斯模式从多个同名生命扇区中选择一个真实落点。
      const rotationOptions = mode === 'roulette' ? displayedWheelOptions : wheelOptions;
      const index = pickWheelSegmentIndex(rotationOptions, picked.id);
      if (index < 0) return;
      const weightedSegment = createWeightedSegments(rotationOptions)[index];
      const current = ((rotation % 360) + 360) % 360;
      const targetAngle = (weightedSegment.startRatio + weightedSegment.sizeRatio / 2) * 360;
      const target = ((-targetAngle % 360) + 360) % 360;
      const extraTurns = animationStyle === 'simple' ? 4 : 7;
      const delta = ((target - current + 360) % 360) + (extraTurns + Math.floor(Math.random() * 2)) * 360;
      rotation += delta;
    }

    isSpinning = true;
    revealedCandidateName = null;
    if (soundEnabled) drawSound.startSpin(durationSeconds * 1000);
    result = {
      eyebrow: usesMonopoly ? '棋盘走格中' : '命运正在选择',
      title: '别眨眼…',
      detail: `全程 ${durationSeconds.toFixed(1)} 秒，末段会平滑减速后揭晓`,
      tone: 'idle',
    };

    timer = window.setTimeout(() => {
      settleSingleDraw(picked);
      continueContinuousDraw();
    }, durationSeconds * 1000);
  }

  function startContinuousDraw() {
    if (isSpinning || continuousRunning || enabledPrizes.length < 2) return;
    normalizeContinuousTarget();
    staySeconds = normalizeStaySeconds(staySeconds);
    drawSidePanel = 'statistics';

    if (continuousTarget === 0) {
      result = {
        eyebrow: '连续抽奖',
        title: '请先设置上限',
        detail: '0 表示手动抽奖不限次数；连续抽奖需要一个明确的结束数量。',
        tone: 'idle',
      };
      return;
    }

    if (isResultLimitReached(continuousTarget, continuousCompleted)) {
      result = {
        eyebrow: '连续抽奖',
        title: '已达到上限',
        detail: `当前已有 ${continuousCompleted} 个有效结果。`,
        tone: 'success',
      };
      return;
    }

    continuousRunning = true;
    if (mode === 'roulette' && rouletteFinished) startNewRouletteRound();
    spin();
  }

  function stopContinuousDraw() {
    continuousRunning = false;
    if (continuousTimer) {
      window.clearTimeout(continuousTimer);
      continuousTimer = undefined;
    }
  }

  function continueContinuousDraw() {
    if (!continuousRunning) return;
    const completed = records.filter(
      (record) => record.outcome === 'selected' || record.outcome === 'winner',
    ).length;
    const delay = staySeconds * 1000;

    if (isResultLimitReached(continuousTarget, completed)) {
      continuousTimer = window.setTimeout(() => {
        continuousRunning = false;
        continuousTimer = undefined;
        result = {
          eyebrow: '连续抽奖完成',
          title: `${completed} 个有效结果`,
          detail: '统计已更新。',
          tone: 'success',
        };
      }, delay);
      return;
    }

    continuousTimer = window.setTimeout(() => {
      continuousTimer = undefined;
      if (!continuousRunning) return;
      if (mode === 'roulette' && rouletteFinished) startNewRouletteRound();
      spin();
    }, delay);
  }

  function settleSingleDraw(picked: WheelOption) {
    isSpinning = false;
    drawSound.stopSpin();
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
      playDrawResultSound('retry');
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
        eyebrow: '',
        title: picked.label,
        detail: normalizedRewardAmount() > 0
          ? `本次奖励金额 ${formatAmount(normalizedRewardAmount())}`
          : retryTotal > 0 ? `好运落定 · 当前累计重来 ${retryTotal} 次` : '好运落定，恭喜获得本次结果。',
        tone: 'success',
      };
      revealedCandidateName = picked.label;
      playDrawResultSound('success');
      return;
    }

    const activeBefore = rouletteEffectivePrizes();
    const hit = activeBefore.find((p) => p.id === picked.id);
    if (!hit) return;

    // 每次命中只扣除一条命。
    const hitsBefore = rouletteHits[picked.id] ?? 0;
    rouletteHits = { ...rouletteHits, [picked.id]: hitsBefore + 1 };

    const originalWeight = prizes.find((p) => p.id === picked.id)?.weight ?? 1;
    const hitsNow = hitsBefore + 1;
    const fullyEliminated = hitsNow >= originalWeight;
    const livesLeft = originalWeight - hitsNow;

    // 命中后重新计算存活候选项。
    const activeAfter = rouletteEffectivePrizes();

    if (activeAfter.length <= 1) {
      const winner = activeAfter[0] ?? enabledPrizes.find((p) => p.id !== picked.id);
      if (!winner) return;
      rouletteFinished = true;
      addRecord({
        round: rouletteRound,
        attempt: singleAttempt,
        optionId: winner.id,
        label: winner.name,
        outcome: 'winner',
        detail: `${hit.name} 最后出局，${winner.name} 成为第 ${rouletteRound}/${MAX_ROULETTE_ROUNDS} 局赢家`,
      });
      result = {
        eyebrow: `第 ${rouletteRound}/${MAX_ROULETTE_ROUNDS} 局 · 最终赢家`,
        title: winner.name,
        detail: normalizedRewardAmount() > 0
          ? `${hit.name} 最后出局 · 奖励金额 ${formatAmount(normalizedRewardAmount())}`
          : `${hit.name} 最后出局，轮盘上只剩下赢家。`,
        tone: 'success',
      };
      revealedCandidateName = winner.name;
      playDrawResultSound('success');
    } else {
      addRecord({
        round: rouletteRound,
        attempt: singleAttempt,
        optionId: hit.id,
        label: hit.name,
        outcome: 'eliminated',
        detail: fullyEliminated
          ? `${hit.name} 全部命中 · 彻底出局，剩余 ${activeAfter.length} 项`
          : `${hit.name} 命中 · 还剩 ${livesLeft} 命，比例缩小，剩余 ${activeAfter.length} 项`,
      });
      result = {
        eyebrow: `第 ${rouletteRound}/${MAX_ROULETTE_ROUNDS} 局 · ${fullyEliminated ? '淘汰' : '命中'}`,
        title: hit.name,
        detail: fullyEliminated
          ? `${hit.name} 彻底出局，场上还剩 ${activeAfter.length} 个候选项。`
          : `${hit.name} 损失1命，还剩 ${livesLeft} 命，转盘比例已缩小。`,
        tone: 'danger',
      };
      revealedCandidateName = hit.name;
      playDrawResultSound('eliminated');
    }
  }

  function addRecord(event: Omit<SimulationEvent, 'attempt'> & { attempt: number }) {
    const record: DrawRecord = {
      id: createId('record'),
      sequence: records.length + 1,
      ...event,
      rewardAmount: event.outcome === 'selected' || event.outcome === 'winner'
        ? normalizedRewardAmount()
        : 0,
      mode,
      createdAt: Date.now(),
      source: 'single',
    };
    records = [record, ...records];
  }

  function startNewRouletteRound() {
    if (isSpinning) return;
    if (rouletteRound >= MAX_ROULETTE_ROUNDS) {
      result = {
        eyebrow: `俄罗斯轮盘 · 已达 ${MAX_ROULETTE_ROUNDS} 局上限`,
        title: '本次轮盘已结束',
        detail: '点击"新的抽奖"开始新一轮。',
        tone: 'idle',
      };
      return;
    }
    if (resultLimitReached) {
      showResultLimitReached();
      return;
    }
    rouletteRound += 1;
    singleAttempt = 0;
    rouletteHits = {};
    rouletteFinished = false;
    monopolyTargetId = null;
    revealedCandidateName = null;
    result = {
      eyebrow: `俄罗斯轮盘 · 第 ${rouletteRound}/${MAX_ROULETTE_ROUNDS} 局`,
      title: '所有选项重新入场',
      detail: '继续旋转，逐一淘汰，直到最后的赢家出现。',
      tone: 'idle',
    };
  }

  function runBatch(simulationMode: DrawMode) {
    if (isSpinning) return;
    batchExportError = '';
    if (enabledPrizes.length < 2) {
      result = {
        eyebrow: '无法开始',
        title: '至少需要两个候选项',
        detail: '添加或启用候选项后再运行批量抽奖。',
        tone: 'danger',
      };
      return;
    }

    try {
      const safeCount = normalizeBatchCount(batchCount);
      batchCount = safeCount;
      // 点击运行时从最新候选项计算隐藏权重，避免实验室复用旧的派生数组。
      const simulationPrizes = variant === 'caimi' && simulationMode === 'selected'
        ? applyCaimiSelectedWeights(prizes)
        : prizes;
      const simulation = simulateBatch(
        simulationMode,
        simulationPrizes,
        safeCount,
        retryEnabled,
        retryWeight,
        undefined,
        variant === 'caimi' && simulationMode === 'roulette'
          ? (prize) => caimiRouletteWeight(prize.name, prize.weight)
          : undefined,
      );
      batchResult = simulation;
      batchRunAt = Date.now();
      batchTab = 'stats';
    } catch (error) {
      result = {
        eyebrow: '概率模拟未开始',
        title: '候选名单配置不足',
        detail: error instanceof Error ? error.message : '请检查候选项设置后重试。',
        tone: 'danger',
      };
    }
  }

  function createBatchRows(simulation: BatchSimulation | null): BatchRow[] {
    if (!simulation) return [];
    // 选中模式的候选项和重来共用同一个总权重池，百分比必须统一按总尝试数计算。
    const candidatePercentDenominator = simulation.mode === 'selected'
      ? simulation.attempts
      : simulation.completed;
    const rows = prizes
      .map((prize) => ({
        id: prize.id,
        name: prize.name,
        color: prize.color,
        count: simulation.prizeCounts[prize.id] ?? 0,
        percent: candidatePercentDenominator > 0
          ? ((simulation.prizeCounts[prize.id] ?? 0) / candidatePercentDenominator) * 100
          : 0,
      }))
      .filter((row) => row.count > 0 || prizes.find((prize) => prize.id === row.id)?.enabled)
      .sort((left, right) => right.count - left.count);

    if (simulation.retryCount > 0) {
      rows.push({
        id: RETRY_ID,
        name: simulation.mode === 'roulette' ? '重来（每次转动）' : '重来一次',
        color: '#f2eee5',
        count: simulation.retryCount,
        percent: simulation.attempts > 0 ? (simulation.retryCount / simulation.attempts) * 100 : 0,
      });
    }

    return rows;
  }

  function createCurrentStats(
    candidates: Prize[],
    drawRecords: DrawRecord[],
    completedCount: number,
  ): CurrentStat[] {
    const counts = new Map<string, { count: number; rewardTotal: number }>();
    for (const record of drawRecords) {
      if (record.outcome !== 'selected' && record.outcome !== 'winner') continue;
      const current = counts.get(record.optionId) ?? { count: 0, rewardTotal: 0 };
      current.count += 1;
      current.rewardTotal += Math.max(0, Number(record.rewardAmount) || 0);
      counts.set(record.optionId, current);
    }

    return candidates
      .map((prize): CurrentStat => {
        const stat = counts.get(prize.id) ?? { count: 0, rewardTotal: 0 };
        return {
          id: prize.id,
          name: prize.name,
          color: prize.color,
          weight: prize.weight,
          count: stat.count,
          rewardTotal: stat.rewardTotal,
          percent: completedCount > 0 ? (stat.count / completedCount) * 100 : 0,
        };
      })
      .filter((stat) => stat.count > 0 || candidates.find((prize) => prize.id === stat.id)?.enabled)
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'));
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

  function formatSelectionDate(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(timestamp);
  }

  function formatAmount(amount: number): string {
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(amount);
  }

  async function openImporter() {
    if (guardCandidateChanges()) return;
    exitCandidateKeyboard();
    exitCommonKeyboard();
    drawSidePanel = 'candidates';
    importOpen = true;
    await tick();
    importTextarea?.focus();
  }

  function applyImportedOptions() {
    if (parsedImportOptions.length === 0 || guardCandidateChanges()) return;
    const existingNames = new Set(
      prizes.map((prize) => prize.name.toLocaleLowerCase('zh-CN')),
    );
    const base = [...prizes];
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
    if (!updatePrizes(next)) return;
    importText = '';
    importOpen = false;
    result = {
      eyebrow: '文本解析完成',
      title: `${additions.length} 个选项已添加`,
      detail: '重复名称已自动跳过。',
      tone: 'success',
    };
  }

  async function exportCurrentStatsExcel() {
    if (validCompleted === 0 || wheelExporting) return;
    wheelExporting = 'stats-excel';
    statsExportError = '';
    const rows: (string | number)[][] = [
      ['候选项', '权重', '中奖次数', '中奖金额'],
      ...currentStats.map((stat) => [stat.name, stat.weight, stat.count, stat.rewardTotal]),
    ];
    try {
      await downloadExcel('转盘统计', rows);
    } catch (reason) {
      statsExportError = exportErrorMessage(reason, '无法导出当前统计 Excel');
    } finally {
      wheelExporting = null;
    }
  }

  async function exportCurrentStatsJson() {
    if (validCompleted === 0 || wheelExporting) return;
    wheelExporting = 'stats-json';
    statsExportError = '';
    const statistics = currentStats.map(({ name, weight, count, rewardTotal }) => ({
      name,
      weight,
      count,
      rewardTotal,
    }));
    try {
      await downloadFormattedJson('转盘统计', statistics);
    } catch (reason) {
      statsExportError = exportErrorMessage(reason, '无法导出当前统计 JSON');
    } finally {
      wheelExporting = null;
    }
  }

  async function exportBatchExperiment() {
    if (!batchResult || wheelExporting) return;
    wheelExporting = 'batch-json';
    batchExportError = '';
    try {
      await downloadFormattedJson('转盘概率模拟', {
        exportedAt: new Date().toISOString(),
        kind: 'batch-simulation',
        prizes,
        retryEnabled,
        retryWeight,
        simulation: batchResult,
      });
    } catch (reason) {
      batchExportError = exportErrorMessage(reason, '无法导出概率模拟 JSON');
    } finally {
      wheelExporting = null;
    }
  }

  function clearBatchExperiment() {
    batchResult = null;
    batchRunAt = null;
    batchTab = 'stats';
    batchExportError = '';
  }

  function scrollOpenPanel(direction: -1 | 1) {
    const candidates = [
      document.querySelector<HTMLElement>('.accordion-item.open .accordion-content'),
      document.querySelector<HTMLElement>('.candidate-board'),
    ];
    const scroller = candidates.find((element) => element && element.scrollHeight > element.clientHeight);
    if (scroller) {
      scroller.scrollBy({ top: direction * Math.max(180, scroller.clientHeight * 0.72), behavior: 'smooth' });
    } else {
      window.scrollBy({ top: direction * Math.max(240, window.innerHeight * 0.72), behavior: 'smooth' });
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!active) return;
    const target = event.target as HTMLElement | null;
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const editing = target?.matches('input, textarea, select, button, [contenteditable="true"]') ?? false;
    const shortcutKey = event.code === 'Space' ? 'space' : key;

    if (pendingDrawHistoryDeletion) {
      if (!modifier && !event.altKey && !event.shiftKey && (event.key === 'Enter' || key === 'y')) {
        event.preventDefault();
        void confirmDrawHistoryDeletion();
      } else if (!modifier && !event.altKey && !event.shiftKey && (event.key === 'Escape' || key === 'n')) {
        event.preventDefault();
        pendingDrawHistoryDeletion = null;
      }
      return;
    }

    if (target === importTextarea && isMultilineTextConfirm(event)) {
      event.preventDefault();
      applyImportedOptions();
      return;
    }

    if (target === importTextarea && isTextEditCancel(event)) {
      event.preventDefault();
      importText = '';
      importOpen = false;
      focusGlobalShortcuts();
      return;
    }

    const statisticsShortcut = drawSidePanel === 'statistics'
      && event.altKey
      && !modifier
      && !event.shiftKey;
    if (statisticsShortcut && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      adjustContinuousTarget(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (statisticsShortcut && event.key === 'Enter') {
      event.preventDefault();
      startContinuousDraw();
      return;
    }

    if (target instanceof HTMLInputElement && target.dataset.confirmableNumber) {
      const field = target.dataset.confirmableNumber as ConfirmableNumberField;
      if (isSingleLineTextConfirm(event) || isTextEditCancel(event)) {
        event.preventDefault();
        finishConfirmableNumberEdit(target, field, isTextEditCancel(event));
        return;
      }
    }

    if (target?.classList.contains('name-input') && isSingleLineTextConfirm(event)) {
      event.preventDefault();
      const prizeId = target.closest<HTMLElement>('[data-prize-id]')?.dataset.prizeId;
      if (prizeId === pendingNewPrizeId) pendingNewPrizeId = null;
      (target as HTMLInputElement).blur();
      candidateKeyboardActive = true;
      return;
    }

    if (target instanceof HTMLInputElement && target.classList.contains('name-input') && isTextEditCancel(event)) {
      event.preventDefault();
      const prizeId = target.closest<HTMLElement>('[data-prize-id]')?.dataset.prizeId;
      if (prizeId === pendingNewPrizeId) {
        pendingNewPrizeId = null;
        target.blur();
        deleteSelectedPrize();
        return;
      }
      target.value = prizes.find((prize) => prize.id === selectedPrizeId)?.name ?? target.defaultValue;
      target.blur();
      candidateKeyboardActive = true;
      return;
    }

    const weightInput = target instanceof HTMLInputElement && target.closest('.weight-control')
      ? target
      : null;
    if (
      candidateKeyboardActive
      && weightInput
      && !modifier
      && !event.shiftKey
      && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const prizeId = weightInput.closest<HTMLElement>('[data-prize-id]')?.dataset.prizeId;
      if (prizeId) selectedPrizeId = prizeId;
      weightInput.blur();
      if (event.altKey) {
        adjustSelectedPrizeWeight(event.key === 'ArrowUp' ? 1 : -1);
      } else {
        movePrizeSelection(event.key === 'ArrowUp' ? -1 : 1);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (candidateKeyboardActive) {
        event.preventDefault();
        exitCandidateKeyboard();
        return;
      }
      if (commonKeyboardActive) {
        event.preventDefault();
        exitCommonKeyboard();
        return;
      }
      event.preventDefault();
      activePanel = null;
      if (importOpen && !importText) importOpen = false;
      commonSelectionSaveOpen = false;
      focusGlobalShortcuts();
      return;
    }

    if (candidateKeyboardActive) {
      if (!editing && !modifier && !event.shiftKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        movePrizeSelection(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (!editing && !modifier && event.altKey && !event.shiftKey && selectedPrizeId && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        adjustSelectedPrizeWeight(event.key === 'ArrowUp' ? 1 : -1);
        return;
      }
      if (!editing && !modifier && !event.altKey && !event.shiftKey) {
        if (key === 'n') {
          event.preventDefault();
          void addPrize();
          return;
        }
        if (key === 'd') {
          event.preventDefault();
          deleteSelectedPrize();
          return;
        }
        if (shortcutKey === 'space') {
          event.preventDefault();
          toggleSelectedPrize();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          void editSelectedPrizeName();
          return;
        }
      }
    }

    if (commonKeyboardActive) {
      if (!editing && !modifier && !event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        void moveCommonSelection(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (!editing && !modifier && !event.altKey && !event.shiftKey && key === 'f') {
        event.preventDefault();
        applySelectedCommon();
        return;
      }
    }

    if (
      !editing
      && !candidateKeyboardActive
      && !commonKeyboardActive
      && !modifier
      && !event.altKey
      && !event.shiftKey
      && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      scrollOpenPanel(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // Web 和桌面都只在非编辑状态响应单键，避免输入名称或金额时误触。
    const globalShortcut = !editing && !modifier && !event.altKey && !event.shiftKey;
    if (!globalShortcut) return;

    if (!['w', 'e', 'r', 't', 'a', 'z', 'x', 'm', 'space'].includes(shortcutKey)) return;
    event.preventDefault();

    if (shortcutKey === 'w') {
      void openImporter();
    } else if (shortcutKey === 'e') {
      void exportCurrentStatsExcel();
    } else if (shortcutKey === 'r') {
      void startNewDraw(true);
    } else if (shortcutKey === 't') {
      void startNewDraw(false);
    } else if (shortcutKey === 'a') {
      toggleCommonKeyboard();
    } else if (shortcutKey === 'z') {
      exitCandidateKeyboard();
      exitCommonKeyboard();
      togglePanel('shortcuts');
    } else if (shortcutKey === 'space') {
      spin();
    } else if (shortcutKey === 'x') {
      void enterCandidateKeyboard();
    } else if (shortcutKey === 'm') {
      void selectRewardInput();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<main
    bind:this={workspaceRoot}
    class:settings-open={activePanel === 'settings'}
    class:common-open={activePanel === 'common'}
    class:batch-open={activePanel === 'batch'}
    class:history-open={activePanel === 'history'}
    class:shortcuts-open={activePanel === 'shortcuts'}
    class="workspace app-page-frame"
    id="top"
    tabindex="-1"
  >
    <aside class:open={activePanel === 'settings'} class="accordion-item config-panel app-surface-light">
      <button
        type="button"
        class="accordion-toggle"
        aria-expanded={activePanel === 'settings'}
        on:click={() => togglePanel('settings')}
      >
        <span class="accordion-icon">◎</span>
        <span><strong>设置</strong></span>
        <i>{activePanel === 'settings' ? '−' : '+'}</i>
      </button>

      {#if activePanel === 'settings'}
      <div class="accordion-content settings-content">
      <div class="panel-heading">
        <div>
          <h2>抽奖设置</h2>
        </div>
      </div>

      <section class="setting-block">
        <h3>动画质感</h3>
        <div class:roulette-mode={mode === 'roulette'} class="animation-options">
          <button
            type="button"
            class:active={animationStyle === 'simple'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'simple')}
          >
            <span class="motion-icon simple-icon"><i></i></span>
            <strong>平凡</strong>
          </button>
          <button
            type="button"
            class:active={animationStyle === 'luxury'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'luxury')}
          >
            <span class="motion-icon luxury-icon">✦</span>
            <strong>高级</strong>
          </button>
          <button
            type="button"
            class:active={animationStyle === 'threeD'}
            disabled={isSpinning}
            on:click={() => (animationStyle = 'threeD')}
          >
            <span class="motion-icon board-icon">⬡</span>
            <strong>大富翁</strong>
          </button>
        </div>
      </section>

      <section class="setting-block duration-block">
        <div class="setting-title-row compact">
          <label for="duration">动画时长</label>
          <output>{durationSeconds.toFixed(1)}<small>秒</small></output>
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

      <section class="setting-block">
        <div class="setting-title-row">
          <div><h3>音乐与音效</h3></div>
          <button
            type="button"
            class:active={soundEnabled}
            class="switch"
            aria-label={soundEnabled ? '关闭音乐与音效' : '开启音乐与音效'}
            aria-pressed={soundEnabled}
            on:click={toggleSound}
          ><span></span></button>
        </div>
      </section>

      <div class="section-divider"></div>

      <section class="setting-block">
        <div class="setting-title-row">
          <div>
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
              type="text"
              inputmode="decimal"
              value={retryWeight}
              disabled={isSpinning}
              on:focus={beginRetryWeightEdit}
              on:input={updateRetryWeight}
              on:blur={finishRetryWeightEdit}
            />
          </label>
        {/if}
      </section>

      {#if businessRuntime}
        <div class="section-divider"></div>
        <section class="setting-block auto-save-setting">
          <div class="setting-title-row">
            <div><h3>自动保存历史</h3></div>
            <button
              type="button"
              class:active={autoSaveHistory}
              class="switch"
              aria-label={autoSaveHistory ? '关闭自动保存历史' : '开启自动保存历史'}
              aria-pressed={autoSaveHistory}
              disabled={isSpinning || drawHistorySaving}
              on:click={() => void toggleAutoSaveHistory()}
            ><span></span></button>
          </div>
        </section>
      {/if}

      <div class="section-divider"></div>

      <section class="setting-block theme-setting">
        <div class="setting-title-row compact">
          <div><h3>界面风格</h3><small>对战签表使用独立配色</small></div>
        </div>
        <UiThemePicker bind:value={uiTheme} />
      </section>

      <div class="section-divider"></div>

      <section class="setting-block font-scale-setting">
        <div class="setting-title-row compact">
          <label for="font-scale">界面字号</label>
          <output>{Math.round(fontScale * 100)}<small>%</small></output>
        </div>
        <input
          id="font-scale"
          class="range-input"
          type="range"
          min="1"
          max="3"
          step="0.1"
          bind:value={fontScale}
          style={`--range-progress: ${((fontScale - 1) / 2) * 100}%`}
        />
        <div class="range-labels"><span>标准</span><span>放大两倍</span><span>放大三倍</span></div>
      </section>
      </div>
      {/if}
    </aside>

    <aside class:open={activePanel === 'common'} class="accordion-item common-panel app-surface-light">
      <button
        type="button"
        class="accordion-toggle"
        aria-expanded={activePanel === 'common'}
        on:click={() => togglePanel('common')}
      >
        <span class="accordion-icon">▤</span>
        <span><strong>常用候选</strong></span>
        <i>{activePanel === 'common' ? '−' : '+'}</i>
      </button>

      {#if activePanel === 'common'}
        <div class="accordion-content common-content">
          <div class="panel-heading">
            <div>
              <h2>常用候选</h2>
            </div>
            <span class="count-badge">{commonSelections.length}</span>
          </div>

          {#if commonSelectionError}
            <div class="common-error">{commonSelectionError}</div>
          {/if}

          {#if commonSelectionLoading}
            <div class="sidebar-empty-state"><i>···</i><strong>正在读取常用候选</strong></div>
          {:else if commonSelections.length === 0}
            <div class="sidebar-empty-state">
              <i>▤</i>
              <strong>还没有常用候选</strong>
              <span>在右侧候选面板中保存当前名单。</span>
            </div>
          {:else}
            <div class="common-list">
              {#each commonSelections as selection (selection.id)}
                <article
                  class:selected={selectedCommonId === selection.id}
                  class="common-card"
                  data-common-id={selection.id}
                  role="group"
                  aria-label={`常用候选：${selection.name}`}
                  on:pointerdown={() => {
                    commonKeyboardActive = true;
                    selectedCommonId = selection.id;
                  }}
                >
                  <div class="common-card-heading">
                    <div>
                      <strong>{selection.name}</strong>
                      <span>{selection.prizes.length} 项 · {formatSelectionDate(selection.createdAt)}</span>
                    </div>
                    <button
                      type="button"
                      class="common-delete"
                      aria-label={`删除常用候选 ${selection.name}`}
                      title="删除"
                      on:click={() => deleteCommonSelection(selection)}
                    >×</button>
                  </div>
                  <p>{selection.prizes.slice(0, 4).map((prize) => prize.name).join('、')}{selection.prizes.length > 4 ? '…' : ''}</p>
                  <button type="button" disabled={candidateChangesLocked} on:click={() => applyCommonSelection(selection)}>
                    导入到当前轮盘
                  </button>
                </article>
              {/each}
            </div>
          {/if}

        </div>
      {/if}
    </aside>

    <section class="stage-panel app-surface-dark">
      <div class="stage-heading">
        <div class="draw-session-actions">
          <button type="button" disabled={isSpinning || drawHistorySaving} on:click={() => void startNewDraw(true)}>新抽奖（清空候选）</button>
          <button type="button" disabled={isSpinning || drawHistorySaving} on:click={() => void startNewDraw(false)}>新抽奖（保留候选）</button>
        </div>
      </div>

      <div class="draw-workbench">
        <div class="draw-core">
      <div class="wheel-wrap">
        <div class="wheel-stack">
          <div class="wheel-status" class:busy={isSpinning} role="status" aria-live="polite">
            <i aria-hidden="true"></i>
            <span>{isSpinning ? '旋转中' : '等待开始'}</span>
          </div>
        {#if animationStyle === 'threeD'}
          <!-- 俄罗斯模式按当前剩余生命和重来概率更新棋盘。 -->
          <MonopolyWheel
            options={monopolyWheelOptions}
            targetOptionId={monopolyTargetId}
            duration={durationSeconds * 1000}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '下一局' : '开始'}
            integerCellWeights={monopolyLifeWeights}
            onSpin={spin}
          />
        {:else if animationStyle === 'luxury'}
          <LuxuryWheel
            options={displayedWheelOptions}
            {rotation}
            duration={durationSeconds * 1000}
            eliminatedIds={[]}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '下一局' : '开启'}
            onSpin={spin}
          />
        {:else}
          <Wheel
            options={displayedWheelOptions}
            {rotation}
            duration={durationSeconds * 1000}
            {animationStyle}
            eliminatedIds={[]}
            spinning={isSpinning}
            disabled={spinDisabled}
            centerLabel={rouletteFinished ? '下一局' : '开始'}
            onSpin={spin}
          />
        {/if}
        {#if !isSpinning && revealedCandidateName}
          <div
            class:success={result.tone === 'success'}
            class:danger={result.tone === 'danger'}
            class="winner-reveal"
            role="status"
            aria-live="polite"
          >
            <strong>{revealedCandidateName}</strong>
          </div>
        {/if}
        </div>
      </div>
        </div>

        <aside class="candidate-board" aria-label="当前候选">
          <div class="draw-side-tabs" aria-label="右侧面板">
            <button
              type="button"
              class:active={drawSidePanel === 'candidates'}
              on:click={() => (drawSidePanel = 'candidates')}
            >候选</button>
            <button
              type="button"
              class:active={drawSidePanel === 'statistics'}
              on:click={() => (drawSidePanel = 'statistics')}
            >统计 <span>{validCompleted}</span></button>
          </div>

          {#if drawSidePanel === 'candidates'}
          <div class="candidate-board-heading">
            <div>
              <h2>候选</h2>
            </div>
            <span class="count-badge">{enabledPrizes.length}/{prizes.length}</span>
          </div>

          {#if candidateChangesLocked && !isSpinning}
            <div class="candidate-lock-note">当前受限抽奖已经开始；新建抽奖或把上限设为 0 后可修改名单。</div>
          {/if}

          <button
            type="button"
            class="save-selection-trigger"
            disabled={isSpinning || prizes.length === 0}
            on:click={openCommonSelectionSaver}
          >
            <span>＋</span>
            <strong>保存为常用候选</strong>
          </button>

          {#if commonSelectionSaveOpen}
            <form class="save-selection-form" on:submit|preventDefault={saveCurrentSelection}>
              <label for="common-selection-name">给这组候选起个名字</label>
              <div>
                <input
                  id="common-selection-name"
                  bind:this={commonSelectionInput}
                  bind:value={commonSelectionName}
                  maxlength="40"
                  placeholder="例如：周五例会名单"
                  disabled={commonSelectionSaving}
                />
                <button type="submit" disabled={!commonSelectionName.trim() || prizes.length === 0 || commonSelectionSaving}>
                  {commonSelectionSaving ? '保存中' : '保存'}
                </button>
                <button
                  type="button"
                  aria-label="取消保存"
                  disabled={commonSelectionSaving}
                  on:click={() => (commonSelectionSaveOpen = false)}
                >×</button>
              </div>
            </form>
          {/if}

          <PrizeEditor
            {prizes}
            selectedId={selectedPrizeId}
            disabled={candidateChangesLocked || drawHistorySaving}
            participationDisabled={drawHistorySaving || isSpinning || (candidateChangesLocked && !autoSaveHistory)}
            onChange={updatePrizes}
            onSelect={(id) => void selectPrize(id)}
            onAdd={addPrize}
            onToggleParticipation={(id) => void togglePrizeParticipation(id)}
          />

          <button type="button" class="import-trigger" disabled={candidateChangesLocked || drawHistorySaving} on:click={openImporter}>
            <span>⌘</span> 从文本批量导入
            <small>空格 / 逗号 / 表格</small>
          </button>

          {#if importOpen}
            <section class="import-box" aria-label="文本批量导入">
                <div class="import-heading">
                <button type="button" aria-label="关闭文本导入" on:click={() => (importOpen = false)}>×</button>
              </div>
              <UiTextarea
                bind:element={importTextarea}
                bind:value={importText}
                size="compact"
                aria-keyshortcuts="Alt+Enter"
                rows="4"
                placeholder="每行一个，也支持空格、逗号和 Excel 粘贴"
              />
              <div class="import-footer">
                <span>识别到 <strong>{parsedImportOptions.length}</strong> 项，重复项会跳过</span>
                <button
                  type="button"
                  disabled={parsedImportOptions.length === 0 || candidateChangesLocked}
                  on:click={applyImportedOptions}
                >添加</button>
              </div>
            </section>
          {/if}
          {:else}
            <section class="continuous-control">
              <div class="continuous-fields">
                <label>
                  <span>上限</span>
                  <input
                    data-confirmable-number="limit"
                    type="number"
                    min="0"
                    max={Math.max(1000, continuousCompleted)}
                    step="1"
                    title="0 表示不限次数"
                    bind:value={continuousTarget}
                    disabled={continuousRunning}
                    on:focus={(event) => beginConfirmableNumberEdit(event, 'limit')}
                    on:change={(event) => updateConfirmableNumber(event, 'limit')}
                    on:blur={(event) => updateConfirmableNumber(event, 'limit')}
                  />
                </label>
                <label>
                  <span>结果停留</span>
                  <span class="seconds-input">
                    <input
                      data-confirmable-number="interval"
                      type="number"
                      min="0.5"
                      max="10"
                      step="0.5"
                      bind:value={staySeconds}
                      disabled={continuousRunning}
                      on:focus={(event) => beginConfirmableNumberEdit(event, 'interval')}
                      on:change={(event) => updateConfirmableNumber(event, 'interval')}
                      on:blur={(event) => updateConfirmableNumber(event, 'interval')}
                    />
                    <small>秒</small>
                  </span>
                </label>
              </div>
              <div class="continuous-progress">
                <span>已完成 {continuousCompleted}</span>
                <strong>{continuousRemaining === null ? '不限次数' : `还差 ${continuousRemaining}`}</strong>
              </div>
              {#if continuousRunning}
                <button type="button" class="continuous-stop" on:click={stopContinuousDraw}>停止连续抽奖</button>
              {:else}
                <button
                  type="button"
                  class="continuous-start"
                  disabled={enabledPrizes.length < 2 || continuousTarget === 0 || continuousRemaining === 0}
                  on:click={startContinuousDraw}
                >
                  {continuousTarget === 0 ? '设置上限后连续抽奖' : continuousRemaining === 0 ? '已达到上限' : '开始连续抽奖'}
                </button>
              {/if}
            </section>

            <label class="reward-setting candidate-reward">
              <strong>奖励金额</strong>
              <span class="reward-input">
                <input
                  bind:this={rewardInput}
                  data-confirmable-number="reward"
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={rewardAmount}
                  disabled={rewardAmountLocked}
                  title={rewardAmountLocked ? '桌面端产生抽奖记录后，奖励金额会锁定到下一轮' : '设置每个有效结果的奖励金额'}
                  on:focus={(event) => beginConfirmableNumberEdit(event, 'reward')}
                  on:change={(event) => updateConfirmableNumber(event, 'reward')}
                  on:blur={(event) => updateConfirmableNumber(event, 'reward')}
                />
              </span>
            </label>

            <div class="side-stat-summary">
              <div><span>有效命中</span><strong>{validCompleted}</strong></div>
              <div><span>重来</span><strong>{retryTotal}</strong></div>
              <div><span>累计金额</span><strong>{formatAmount(totalRewardAmount)}</strong></div>
            </div>

            <div class="current-stats-list side-stats-list">
              {#each currentStats as stat (stat.id)}
                <article>
                  <i style:background={stat.color}></i>
                  <div class="current-stat-main"><strong class="stat-name">{stat.name}</strong></div>
                  <div class="side-stat-value"><strong>{formatAmount(stat.weight)}</strong><span>权重</span></div>
                  <div class="side-stat-value win-stat"><strong>{stat.count}</strong><span>中奖</span></div>
                  <div class="side-stat-value"><strong>{formatAmount(stat.rewardTotal)}</strong><span>金额</span></div>
                </article>
              {:else}
                <div class="current-stats-empty">还没有抽奖结果</div>
              {/each}
            </div>

            <div class="side-stats-actions">
              <UiButton size="sm" data-export="stats-excel" disabled={validCompleted === 0 || wheelExporting !== null} on:click={exportCurrentStatsExcel}>{wheelExporting === 'stats-excel' ? '导出中…' : 'Excel'}</UiButton>
              <UiButton size="sm" data-export="stats-json" disabled={validCompleted === 0 || wheelExporting !== null} on:click={exportCurrentStatsJson}>{wheelExporting === 'stats-json' ? '导出中…' : 'JSON'}</UiButton>
              {#if nativeRuntime}
                <UiButton size="sm" title="在资源管理器中打开下载目录" on:click={openDrawDownloadFolder}>打开下载</UiButton>
              {/if}
            </div>
            {#if statsExportError}<div class="common-error" role="alert">{statsExportError}</div>{/if}
          {/if}
        </aside>
      </div>
    </section>

    <aside class:open={activePanel === 'batch'} class="accordion-item batch-panel app-surface-light">
      <button
        type="button"
        class="accordion-toggle"
        aria-expanded={activePanel === 'batch'}
        on:click={() => togglePanel('batch')}
      >
        <span class="accordion-icon">⌁</span>
        <span><strong>批量实验室</strong></span>
        <i>{activePanel === 'batch' ? '−' : '+'}</i>
      </button>

      {#if activePanel === 'batch'}
      <div class="accordion-content batch-content">
      <div class="panel-heading">
        <div>
          <h2>批量实验室</h2>
        </div>
        <span class="flask">⌁</span>
      </div>
      <div class="batch-runner">
        <label>
          <span>模拟次数</span>
          <div class="number-field">
            <input type="number" min="1" max="1000" bind:value={batchCount} disabled={isSpinning} />
            <small>次</small>
          </div>
        </label>
        <div class="quick-counts">
          {#each [10, 100, 500] as amount}
            <button type="button" class:active={batchCount === amount} on:click={() => (batchCount = amount)}>{amount}</button>
          {/each}
        </div>
        <div class="batch-run-buttons">
          <button type="button" class="run-button" disabled={isSpinning || enabledPrizes.length < 2} on:click={() => runBatch('selected')}>运行选中模拟</button>
          <button type="button" class="run-button roulette" disabled={isSpinning || enabledPrizes.length < 2} on:click={() => runBatch('roulette')}>运行俄罗斯模拟</button>
        </div>
      </div>

      {#if batchResult}
        <div class="batch-metrics">
          <div>
            <span>{batchResult.mode === 'selected' ? '有效结果' : '完成局数'}</span>
            <strong>{batchResult.completed}</strong>
          </div>
          <div>
            <span>模拟转动</span>
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
            {#each batchHistory as record (record.attempt)}
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

        {#if batchExportError}<div class="common-error" role="alert">{batchExportError}</div>{/if}
        <div class="history-actions">
          <UiButton size="sm" data-export="batch-json" disabled={wheelExporting !== null} on:click={exportBatchExperiment}>{wheelExporting === 'batch-json' ? '导出中…' : '导出模拟记录'}</UiButton>
          <UiButton size="sm" tone="danger" disabled={wheelExporting === 'batch-json'} on:click={clearBatchExperiment}>清空实验结果</UiButton>
        </div>
      {/if}
      </div>
      {/if}
    </aside>

    <aside class:open={activePanel === 'history'} class="accordion-item history-panel app-surface-light">
      <button
        type="button"
        class="accordion-toggle"
        aria-expanded={activePanel === 'history'}
        on:click={() => togglePanel('history')}
      >
        <span class="accordion-icon">◷</span>
        <span><strong>转盘历史</strong></span>
        <i>{activePanel === 'history' ? '−' : '+'}</i>
      </button>

      {#if activePanel === 'history'}
      <div class="accordion-content history-content">
        <div class="panel-heading">
          {#if businessRuntime}
            <span class="count-badge">{Math.min(DRAW_HISTORY_DISPLAY_LIMIT, filteredDrawHistories.length)}/{filteredDrawHistories.length}条</span>
          {/if}
        </div>

        {#if !businessRuntime}
          <div class="sidebar-empty-state web-history-unavailable">
            <i>◷</i>
            <strong>网页版无法查看历史</strong>
          </div>
        {:else}
          <UiHistoryPanel
            bind:start={drawHistoryStart}
            bind:end={drawHistoryEnd}
            loading={drawHistoryLoading}
            loadingText="正在读取历史…"
            empty={drawHistories.length === 0 || filteredDrawHistories.length === 0}
            emptyText={drawHistories.length === 0 ? '还没有保存的抽奖' : '日期范围内没有记录'}
          >
            <svelte:fragment slot="notice">
              {#if drawHistoryError}<div class="common-error" role="alert">{drawHistoryError}</div>{/if}
            </svelte:fragment>
            {#if drawHistories.length > 0 && filteredDrawHistories.length > 0}
              {#each visibleDrawHistories as draw (draw.id)}
                {@const summary = drawHistorySummary(draw)}
                <UiHistoryRow
                  selectable={false}
                  eyebrow={formatSelectionDate(draw.createdAt)}
                  title={`${draw.prizes.length} 项 · ${summary.completed} 次`}
                  hint={draw.prizes.map((prize) => prize.name).join('、') || '空名单'}
                  ariaLabel={`${formatSelectionDate(draw.createdAt)} 的抽奖历史`}
                >
                  <UiButton
                    size="xs"
                    data-export="draw-history-excel"
                    disabled={drawHistoryExporting !== null}
                    on:click={() => exportDrawHistoryExcel(draw)}
                  >{drawHistoryExporting === `draw:${draw.id}:excel` ? '导出中…' : 'Excel'}</UiButton>
                  <UiButton
                    size="xs"
                    data-export="draw-history-json"
                    disabled={drawHistoryExporting !== null}
                    on:click={() => exportDrawHistoryJson(draw)}
                  >{drawHistoryExporting === `draw:${draw.id}:json` ? '导出中…' : 'JSON'}</UiButton>
                  <UiButton
                    size="xs"
                    tone="danger"
                    aria-label={`删除 ${formatSelectionDate(draw.createdAt)} 的抽奖历史`}
                    on:click={() => requestDeleteDrawHistory(draw)}
                  >删除</UiButton>
                </UiHistoryRow>
              {/each}
            {/if}
            <svelte:fragment slot="actions">
            <UiButton
              size="sm"
              data-export="draw-history-summary-excel"
              disabled={filteredDrawHistories.length === 0 || drawHistoryExporting !== null}
              on:click={exportDrawHistoriesExcel}
            >{drawHistoryExporting === 'summary-excel' ? '导出中…' : '汇总 Excel'}</UiButton>
            <UiButton
              size="sm"
              data-export="draw-history-summary-json"
              disabled={filteredDrawHistories.length === 0 || drawHistoryExporting !== null}
              on:click={exportDrawHistoriesJson}
            >{drawHistoryExporting === 'summary-json' ? '导出中…' : '汇总 JSON'}</UiButton>
            {#if nativeRuntime}
              <UiButton size="sm" on:click={openDrawDownloadFolder}>打开下载</UiButton>
            {/if}
            <UiButton size="sm" tone="danger" disabled={drawHistories.length === 0} on:click={requestClearDrawHistories}>清空历史</UiButton>
            </svelte:fragment>
          </UiHistoryPanel>
        {/if}
      </div>
      {/if}
    </aside>

    <aside class:open={activePanel === 'shortcuts'} class="accordion-item shortcuts-panel app-surface-light">
      <button
        type="button"
        class="accordion-toggle"
        aria-expanded={activePanel === 'shortcuts'}
        on:click={() => togglePanel('shortcuts')}
      >
        <span class="accordion-icon">⌘</span>
        <span><strong>快捷键</strong></span>
        <i>{activePanel === 'shortcuts' ? '−' : '+'}</i>
      </button>

      {#if activePanel === 'shortcuts'}
      <div class="accordion-content shortcuts-content">
        <section class="shortcut-group shortcut-general">
          <h3>通用</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>进入 / 返回应用全屏</span><kbd>H</kbd></div>
            <div><span>文本区确认</span><kbd>Alt</kbd><b>＋</b><kbd>回车</kbd></div>
            <div><span>确认 / 编辑</span><kbd>回车</kbd></div>
            <div><span>增大 / 减小界面字号</span><kbd>Ctrl</kbd><b>＋</b><kbd>↑ / ↓</kbd></div>
            <div><span>取消编辑 / 退出选择 / 关闭折叠栏</span><kbd>Esc</kbd></div>
          </div>
        </section>

        <section class="shortcut-group shortcut-confirm">
          <h3>确认框</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>确认</span><kbd>Y</kbd><b>/</b><kbd>回车</kbd></div>
            <div><span>取消</span><kbd>N</kbd><b>/</b><kbd>Esc</kbd></div>
          </div>
        </section>

        <section class="shortcut-group shortcut-draw">
          <h3>转盘页</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>导出抽奖统计</span><kbd>E</kbd></div>
            <div><span>新抽奖并清空候选</span><kbd>R</kbd></div>
            <div><span>新抽奖并保留候选</span><kbd>T</kbd></div>
            <div><span>打开 / 关闭常用候选</span><kbd>A</kbd></div>
            <div><span>打开 / 关闭快捷键</span><kbd>Z</kbd></div>
            <div><span>开始抽奖</span><kbd>空格</kbd></div>
            <div><span>修改奖励金额</span><kbd>M</kbd></div>
            <div><span>进入候选</span><kbd>X</kbd></div>
          </div>
        </section>

        <section class="shortcut-group shortcut-common">
          <h3>常用候选区</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>打开文本区域</span><kbd>W</kbd></div>
            <div><span>引入候选</span><kbd>F</kbd></div>
          </div>
        </section>

        <section class="shortcut-group shortcut-candidates">
          <h3>候选区</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>添加一项并编辑</span><kbd>N</kbd></div>
            <div><span>权重加 1</span><kbd>Alt</kbd><b>＋</b><kbd>↑</kbd></div>
            <div><span>权重减 1</span><kbd>Alt</kbd><b>＋</b><kbd>↓</kbd></div>
            <div><span>删除当前项</span><kbd>D</kbd></div>
            <div><span>启用 / 停用</span><kbd>空格</kbd></div>
          </div>
        </section>

        <section class="shortcut-group shortcut-statistics">
          <h3>统计区</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>增减上限</span><kbd>Alt</kbd><b>＋</b><kbd>↑ / ↓</kbd></div>
            <div><span>开始连续抽奖</span><kbd>Alt</kbd><b>＋</b><kbd>回车</kbd></div>
          </div>
        </section>

        {#if businessRuntime}
        <section class="shortcut-group shortcut-ranking">
          <h3>排名区</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>添加排名</span><kbd>N</kbd></div>
            <div><span>添加新别名</span><kbd>S</kbd></div>
            <div><span>删除当前项</span><kbd>D</kbd></div>
            <div><span>删除全部别名</span><kbd>F</kbd></div>
            <div><span>选中排序</span><kbd>空格</kbd></div>
            <div><span>插入 / 替换</span><kbd>空格</kbd></div>
            <div><span>进入 / 退出当前项操作</span><kbd>→ / ←</kbd></div>
            <div><span>执行当前项操作</span><kbd>空格</kbd></div>
            <div><span>输入排名跳转</span><kbd>数字 / 退格</kbd></div>
            <div><span>确认关联</span><kbd>空格</kbd></div>
          </div>
        </section>
        {/if}

        <section class="shortcut-group shortcut-lineup">
          <h3>分组页</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>聚焦分组结果</span><kbd>X</kbd></div>
            {#if businessRuntime}
              <div><span>打开 / 关闭排名</span><kbd>A</kbd></div>
              <div><span>打开 / 关闭分组历史</span><kbd>Z</kbd></div>
            {/if}
          </div>
        </section>

        <section class="shortcut-group shortcut-battle">
          <h3>对战页</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>聚焦对战区</span><kbd>X</kbd></div>
            {#if businessRuntime}
              <div><span>打开 / 关闭排名</span><kbd>A</kbd></div>
              <div><span>打开 / 关闭对战历史</span><kbd>Z</kbd></div>
            {/if}
          </div>
        </section>

        <section class="shortcut-group shortcut-battle-area">
          <h3>对战区</h3>
          <div class="shortcut-list sidebar-shortcut-list">
            <div><span>进入 / 返回全屏</span><kbd>F</kbd></div>
            <div><span>微调比分框</span><kbd>G / B / V / N</kbd></div>
            <div><span>聚焦单败</span><kbd>S</kbd></div>
            <div><span>聚焦胜者组 / 败者组</span><kbd>W / L</kbd></div>
          </div>
        </section>

      </div>
      {/if}
    </aside>
  </main>

  {#if pendingDrawHistoryDeletion}
    <UiConfirmDialog
      titleId="draw-confirm-title"
      detailId="draw-confirm-detail"
      title={pendingDrawHistoryDeletion.kind === 'one'
          ? '删除这条抽奖历史？'
          : pendingDrawHistoryDeletion.confirmation === 1
            ? '清空全部抽奖历史？'
            : '真的清空全部抽奖历史？'}
      detail={pendingDrawHistoryDeletion.kind === 'all' && pendingDrawHistoryDeletion.confirmation === 1
          ? '全部抽奖历史都会删除。'
          : '删除后无法恢复。'}
      confirmLabel={drawHistoryDeleting ? '删除中…' : '确认'}
      confirmDisabled={drawHistoryDeleting}
      cancelDisabled={drawHistoryDeleting}
      on:cancel={() => (pendingDrawHistoryDeletion = null)}
      on:confirm={confirmDrawHistoryDeletion}
    />
  {/if}
