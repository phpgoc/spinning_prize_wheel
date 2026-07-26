<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, tick } from 'svelte';
  import type { AppVariant } from '../lib/app-variant';
  import BattleBracketEditor from './BattleBracketEditor.svelte';
  import BattleBracketViewer from './BattleBracketViewer.svelte';
  import GroupingPreviewRow from './GroupingPreviewRow.svelte';
  import UiButton from './ui/UiButton.svelte';
  import UiCheckbox from './ui/UiCheckbox.svelte';
  import UiColorPalette from './ui/UiColorPalette.svelte';
  import UiConfirmDialog from './ui/UiConfirmDialog.svelte';
  import UiHistoryPanel from './ui/UiHistoryPanel.svelte';
  import UiHistoryRow from './ui/UiHistoryRow.svelte';
  import UiRadio from './ui/UiRadio.svelte';
  import UiTextarea from './ui/UiTextarea.svelte';
  import {
    battleFixedSeedOptions,
    battleTmpScoresWithMagicFill,
    createAvoidSameGroupPlan,
    createBattleTmpSnapshot,
    createSeededBattlePlan,
    parseBattleTmpSnapshot,
    updateBattleTmpResult,
    type BattleFormat,
    type BattleHistory,
    type BattleOrderMode,
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from '../lib/battle';
  import { createBattleBracketWorkbook } from '../lib/battle-excel';
  import {
    createBattleHistoryTransfer,
    parseBattleHistoryTransferRecord,
  } from '../lib/battle-history-transfer';
  import { downloadExcel, downloadExcelBytes, downloadFormattedJson } from '../lib/file-export';
  import {
    createGroupingHistoryTransfer,
    parseGroupingHistoryTransfer,
  } from '../lib/grouping-history-transfer';
  import { parseOptionText } from '../lib/parse-options';
  import {
    createRankingTransfer,
    parseRankingTransfer,
    type RankedUserTransfer,
  } from '../lib/ranking-transfer';
  import {
    applyCaimiGroupingSwap,
    createGroupingRankingSnapshot,
    createRandomGrouping,
    insertGroupingPreviewName,
    isResolvedGroupingName,
    groupingLastTierSize,
    groupingOrderAvailability,
    groupingPreviewTierStarts,
    nextRankedUserActionIndex,
    orderBattleNamesByFixedRank,
    orderCaimiBattleNamesByFixedRank,
    orderPartiallyResolvedGroupingNames,
    rankedBattleGroupingNameCount,
    rankedUserIdAtShortcut,
    rankedUserDropTargetForCard,
    rankedUserKeyboardDropPoints,
    filterGroupingHistories,
    shuffleGroupingNames,
    unrankedGroupingNameCount,
    unresolvedGroupingNameCount,
    uniqueGroupingNames,
    uniqueResolvedGroupingPeople,
    updateRankShortcutInput,
    type RankedUserDropTarget,
    type RandomGrouping,
  } from '../lib/random-grouping';
  import { isMultilineTextConfirm, isSingleLineTextConfirm, isTextEditCancel } from '../lib/text-shortcuts';
  import type { RankedUser, ResolvedGroupingName, SavedGrouping } from '../lib/types';
  import { invoke, isTauriRuntime } from '../lib/runtime';
  import { importWebDatabase } from '../lib/web-database';

  export let desktopRuntime = false;
  export let businessRuntime = desktopRuntime;
  export let variant: AppVariant = 'standard';
  export let purpose: 'grouping' | 'battle' = 'grouping';

  const nativeRuntime = isTauriRuntime();

  type GroupingOrderMode = 'rank' | 'input' | 'random';
  type BattleColorName = 'background' | 'text' | 'participant' | 'match';
  type BattleColors = Record<BattleColorName, string>;
  type BattleColorPresetName = 'classic' | 'ocean' | 'sunset';
  type BattleColorPresetSelection = BattleColorPresetName | 'custom';
  type BattleScoreGroup = 'single' | 'winner' | 'loser';
  type DesktopPanel = 'ranking' | 'history';
  type GroupingHistoryDeletion =
    | { kind: 'one'; history: SavedGrouping }
    | { kind: 'all'; confirmation: 1 | 2 };
  type BattleLoadTarget =
    | { kind: 'current' }
    | { kind: 'history'; history: BattleHistory };
  type PendingBattleLoad = { target: BattleLoadTarget; confirmation: 1 | 2 | 3 };

  const BATTLE_COLOR_PRESETS: Record<BattleColorPresetName, {
    label: string;
    colors: BattleColors;
  }> = {
    classic: {
      label: 'One Dark',
      colors: { background: '#282c34', text: '#abb2bf', participant: '#98c379', match: '#3e4451' },
    },
    ocean: {
      label: 'Tokyo',
      colors: { background: '#1a1b26', text: '#c0caf5', participant: '#7dcfff', match: '#414868' },
    },
    sunset: {
      label: 'Gruvbox',
      colors: { background: '#282828', text: '#ebdbb2', participant: '#fabd2f', match: '#504945' },
    },
  };
  const BATTLE_COLOR_PRESET_OPTIONS = Object.entries(BATTLE_COLOR_PRESETS) as [
    BattleColorPresetName,
    (typeof BATTLE_COLOR_PRESETS)[BattleColorPresetName],
  ][];

  let sourceText = '';
  let confirmedSourceText = '';
  let sourceTextarea: HTMLTextAreaElement | null = null;
  let groupCount = 4;
  let result: RandomGrouping | null = null;
  let resultSignature = '';
  let error = '';
  let mounted = false;
  let desktopInitialized = false;
  let resolvingNames = false;
  let resolvedNames: ResolvedGroupingName[] = [];
  let resolutionRequest = 0;
  let rankedUsers: RankedUser[] = [];
  let rankingLoading = false;
  let rankingSaving = false;
  let rankingError = '';
  let desktopPanel: DesktopPanel | null = 'ranking';
  let editingUserId: number | null = null;
  let editingRankField: 'name' | 'aliases' = 'name';
  let selectedRankedUserId: number | null = null;
  let userName = '';
  let userAliases = '';
  let userNameInput: HTMLInputElement | null = null;
  let userAliasInput: HTMLInputElement | null = null;
  let pendingDeleteUser: RankedUser | null = null;
  let pendingAliasClearUser: RankedUser | null = null;
  let clearAllRankingsConfirmation: 0 | 1 | 2 = 0;
  let deletingUserId: number | null = null;
  let clearingAliasesUserId: number | null = null;
  let clearingAllRankings = false;
  let pendingRankDragUserId: number | null = null;
  let draggingUserId: number | null = null;
  let activeRankDropTarget: RankedUserDropTarget | null = null;
  let activeRankDropCardId: number | null = null;
  let activeRankDropPosition: 'before' | 'swap' | 'after' | null = null;
  let rankDragPointerId: number | null = null;
  let rankDragStartX = 0;
  let rankDragStartY = 0;
  let rankDragX = 0;
  let rankDragY = 0;
  let suppressRankNameClickUserId: number | null = null;
  let rankingReordering = false;
  let keyboardMovingUserId: number | null = null;
  let keyboardDropPointIndex = -1;
  let rankedUserActionIndex = -1;
  let rankingFocusActive = false;
  let keyboardRankLabel = '选择一项';
  let aliasLinkName: string | null = null;
  let aliasLinkRankInput = '';
  let rankSelectionShortcutInput = '';
  let rankSelectionShortcutAt = 0;
  let historyStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let resultOrderMode: GroupingOrderMode = 'input';
  let groupingTitle = '';
  let resultSourceNames: string[] = [];
  let resultOrderedNames: string[] = [];
  let resultHistory: SavedGrouping | null = null;
  let groupingHistories: SavedGrouping[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyImportStatus = '';
  let historyStart = '';
  let historyEnd = '';
  let pendingGroupingHistoryDeletion: GroupingHistoryDeletion | null = null;
  let historyDeleting = false;
  let historyExporting: { id: string; format: 'excel' | 'json' } | null = null;
  let insertIndex: number | null = null;
  let insertName = '';
  let insertError = '';
  let insertInput: HTMLInputElement | null = null;
  let rankingFileInput: HTMLInputElement | null = null;
  let databaseFileInput: HTMLInputElement | null = null;
  let historyFileInput: HTMLInputElement | null = null;
  let pendingRankingImport: RankedUserTransfer[] | null = null;
  let rankingImporting = false;
  let historyImporting = false;
  let importErrorDialog: { title: string; detail: string } | null = null;
  let pendingDatabaseImport: { name: string; bytes: Uint8Array } | null = null;
  let databaseImporting = false;
  let clearGroupingConfirmation: 0 | 1 | 2 | 3 = 0;
  let clearingBattleTmp = false;
  let groupingResultElement: HTMLElement | null = null;
  const battleScoreFocusValues = new WeakMap<HTMLInputElement, string>();
  let lastConfirmedBattleScore: { matchId: string; side: 'up' | 'down' } | null = null;
  let pendingBattleScoreGroup: BattleScoreGroup | null = null;
  let slowRevealEnabled = true;
  let revealedGroupingCells = new Set<string>();
  let allGroupingCellsRevealed = false;
  let revealedBattleSlots = new Set<string>();
  let allBattleSlotsRevealed = false;
  let battleRevealFresh = false;
  let hiddenGroupingCellKeys = new Set<string>();
  let battleFormat: BattleFormat = 'avoid-first-pair';
  let battleOrderMode: BattleOrderMode = 'input';
  let battleFixedSeedCount = 0;
  let battleDoubleGrandFinal = false;
  let battleTmpSnapshot: BattleTmpSnapshot | null = null;
  let battleTitle = '';
  let battleTitleBeforeHistoryView: string | null = null;
  let battleTmpAvailable = false;
  let battleHistorySaved = false;
  let battleHistories: BattleHistory[] = [];
  let battleHistoryView: BattleHistory | null = null;
  let battleHistoryStart = '';
  let battleHistoryEnd = '';
  let battleHistoryFileInput: HTMLInputElement | null = null;
  let battleHistoryImporting = false;
  let battleHistoryExporting: { id: string; format: 'excel' | 'json' } | null = null;
  let battleHistoryError = '';
  let battleHistoryDeleteConfirmation: 0 | 1 | 2 = 0;
  let pendingBattleHistoryDeletion: BattleHistory | null = null;
  let pendingBattleLoad: PendingBattleLoad | null = null;
  let battleLoadingTarget = false;
  let battleSyncStatus: 'idle' | 'loading' | 'saving' | 'saved' | 'error' = 'idle';
  let battleFullscreen = false;
  let battleFullscreenChanging = false;
  let bodyOverflowBeforeBattleFullscreen = '';
  let battleColorLoadedVariant: AppVariant | null = null;
  let battleColorPreset: BattleColorPresetSelection = 'classic';
  let battleColors: BattleColors = { ...BATTLE_COLOR_PRESETS.classic.colors };
  let battleColorSnapshotAvailable = false;
  let battleExporting: 'excel' | 'json' | null = null;
  let clearedBattlePreviewSignature: string | null = null;
  const GROUPING_HISTORY_DISPLAY_LIMIT = 5;
  const BATTLE_HISTORY_DISPLAY_LIMIT = 8;

  $: battlePage = purpose === 'battle';
  $: names = uniqueGroupingNames(parseOptionText(confirmedSourceText));
  $: sourceTextDirty = sourceText !== confirmedSourceText;
  $: namesSignature = names.join('\u0000');
  $: desktopRankSignature = businessRuntime
    ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
    : 'web';
  $: inputSignature = `${groupCount}|${namesSignature}|${resultOrderMode === 'random' ? 'random' : desktopRankSignature}`;
  $: resultOutdated = result !== null && resultSignature !== inputSignature;
  $: tierPreview = names.length > 0 ? Math.ceil(names.length / Math.max(2, Number(groupCount) || 2)) : 0;
  $: unresolvedPreviewCount = businessRuntime
    ? unresolvedGroupingNameCount(names, resolvedNames)
    : 0;
  $: previewRows = names.map((name, index) => ({
    name,
    resolved: resolvedNames[index]?.inputName === name ? resolvedNames[index] : null,
  }));
  $: previewTierStarts = new Set(groupingPreviewTierStarts(names.length, Number(groupCount)));
  $: rankedPeople = rankedUsers.filter((user) => user.rank < 10_000);
  $: unrankedPeople = rankedUsers.filter((user) => user.rank >= 10_000);
  $: rankMoveSourceId = draggingUserId ?? keyboardMovingUserId;
  $: rankMoveSwapAllowed = rankMoveSourceCanSwap(rankMoveSourceId);
  $: {
    rankedUsers;
    rankedPeople;
    unrankedPeople;
    selectedRankedUserId;
    keyboardMovingUserId;
    keyboardDropPointIndex;
    keyboardRankLabel = keyboardRankDropLabel();
  }
  $: filteredGroupingHistories = filterGroupingHistories(groupingHistories, historyStart, historyEnd);
  $: visibleHistories = filteredGroupingHistories
    .slice(0, GROUPING_HISTORY_DISPLAY_LIMIT)
    .reverse();
  $: filteredBattleHistories = battleHistories
    .filter((history) => {
      const date = new Date(history.createdAt);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return (!battleHistoryStart || day >= battleHistoryStart)
        && (!battleHistoryEnd || day < battleHistoryEnd);
    })
    .sort((left, right) => right.createdAt - left.createdAt || right.updatedAt - left.updatedAt);
  $: visibleBattleHistories = filteredBattleHistories
    .slice(0, BATTLE_HISTORY_DISPLAY_LIMIT)
    .reverse();
  $: hiddenGroupingCellKeys = (() => {
    if (!result || !slowRevealEnabled || allGroupingCellsRevealed) {
      return new Set<string>();
    }
    return new Set(result.tiers.flatMap((tier, tierIndex) => (
      tierIndex === 0
        ? []
        : tier.map((_, groupIndex) => groupingCellKey(tierIndex, groupIndex))
          .filter((key) => !revealedGroupingCells.has(key))
    )));
  })();
  $: hiddenGroupingCellCount = hiddenGroupingCellKeys.size;
  $: hiddenBattleSlotKeys = (() => {
    if (!battleTmpSnapshot || !slowRevealEnabled || !battleRevealFresh || allBattleSlotsRevealed) return new Set<string>();
    const snapshot = battleTmpSnapshot;
    return new Set(snapshot.matches.flatMap((match) => (
      (['up', 'down'] as const).flatMap((side) => {
        // 悬念揭晓只遮住抽签产生的首轮签位，晋级到第二轮及败者组后立即显示。
        const initialDrawSlot = match.level === 1
          && (match.stage === 'single' || match.stage === 'winner');
        if (!initialDrawSlot) return [];
        const participantId = match[side];
        if (participantId === null || revealedBattleSlots.has(battleSlotKey(match, side))) return [];
        const participant = snapshot.participants.find((item) => item.id === participantId);
        const fixedFirstRound = participant !== undefined
          && participant.seed <= snapshot.fixedSeedCount;
        return fixedFirstRound ? [] : [battleSlotKey(match, side)];
      })
    )));
  })();
  $: hiddenBattleSlotCount = hiddenBattleSlotKeys.size;
  $: groupingUnrankedCount = businessRuntime
    ? unrankedGroupingNameCount(names, resolvedNames)
    : 0;
  $: groupingUnresolvedCapacity = groupingLastTierSize(names.length, Number(groupCount));
  $: groupingUnresolvedOverflow = Math.max(0, groupingUnrankedCount - groupingUnresolvedCapacity);
  $: orderAvailability = groupingOrderAvailability(
    names.length,
    businessRuntime,
    resolvingNames,
    unresolvedPreviewCount,
  );
  $: groupingOrderAvailabilityState = groupingOrderAvailability(
    names.length,
    businessRuntime,
    resolvingNames,
    groupingUnrankedCount,
    groupingUnresolvedCapacity,
  );
  $: canGenerateByInput = !sourceTextDirty && orderAvailability.input;
  $: canGenerateByRandom = !sourceTextDirty && names.length >= 2;
  $: canGenerateGroupingByRank = !sourceTextDirty && groupingOrderAvailabilityState.rank;
  $: battleFixedOptions = battleFixedSeedOptions(names.length);
  $: if (battleFixedSeedCount !== 0 && !battleFixedOptions.includes(battleFixedSeedCount)) {
    battleFixedSeedCount = 0;
  }
  $: battleConfiguredFixedCount = battleFixedOptions.length > 0 ? battleFixedSeedCount : 0;
  $: battleRankedNameCount = rankedBattleGroupingNameCount(names, resolvedNames);
  $: battleRankCountReady = businessRuntime
    && names.length >= 4
    && battleRankedNameCount >= battleConfiguredFixedCount;
  $: battleRankReady = battleRankCountReady && !resolvingNames && !sourceTextDirty;
  $: battleOrderedPreviewNames = battleOrderMode === 'rank'
    && battleRankReady
      ? orderBattleNamesForCurrentVariant(
        names,
        resolvedNames,
        battleConfiguredFixedCount,
        variant,
      )
      : names;
  $: battleCanExecute = battleTmpSnapshot === null && !sourceTextDirty && (
    battleFormat === 'avoid-first-pair'
      ? names.length === 8
      : names.length >= 4 && (battleOrderMode === 'rank' ? battleRankReady : canGenerateByInput)
  );
  $: battlePreviewSignature = [
    variant,
    namesSignature,
    desktopRankSignature,
    battleFormat,
    battleOrderMode,
    battleConfiguredFixedCount,
    battleDoubleGrandFinal,
  ].join('|');
  $: if (
    clearedBattlePreviewSignature !== null
    && clearedBattlePreviewSignature !== battlePreviewSignature
  ) {
    // 清空后保留设置和名单时先保持结果区为空；用户修改配置后才重新显示只读预览。
    clearedBattlePreviewSignature = null;
  }
  $: battlePreviewSnapshot = createBattlePreviewSnapshot(
    battlePage && clearedBattlePreviewSignature !== battlePreviewSignature,
    battleTmpSnapshot,
    variant,
    battleFormat,
    battleOrderMode,
    battleOrderedPreviewNames,
    battleOrderMode === 'rank' && !battleRankReady ? 0 : battleConfiguredFixedCount,
    battleDoubleGrandFinal,
    variant === 'caimi'
      && battleOrderMode === 'rank'
      && battleRankReady
      && battleConfiguredFixedCount > 0
      ? rankScoresForGrouping(battleOrderedPreviewNames, resolvedNames)
      : undefined,
  );
  $: if (mounted && businessRuntime && !desktopInitialized) {
    void initializeDesktop();
  }
  $: if (mounted && battlePage && battleColorLoadedVariant !== variant) {
    void loadBattleColors();
  }

  onMount(() => {
    mounted = true;
    if (battlePage) void loadBattleHistories();
    return () => {
      if (battleFullscreen) {
        document.body.style.overflow = bodyOverflowBeforeBattleFullscreen;
        if (nativeRuntime) {
          void getCurrentWindow().setFullscreen(false).catch((reason) => {
            console.error('无法在离开对战页时退出窗口全屏', reason);
          });
        } else if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
      }
    };
  });

  function battleColorStorageKey(): string {
    return `battle-colors-v1:${variant}`;
  }

  function battleColorSnapshotStorageKey(): string {
    return `battle-color-snapshot-v1:${variant}`;
  }

  function readBattleColorSnapshot(): BattleColors | null {
    try {
      const stored = localStorage.getItem(battleColorSnapshotStorageKey());
      if (stored === null) return null;
      const value = JSON.parse(stored) as Partial<BattleColors>;
      const colorNames: BattleColorName[] = ['background', 'text', 'participant', 'match'];
      if (!colorNames.every((name) => typeof value[name] === 'string' && /^#[0-9a-f]{6}$/iu.test(value[name]!))) {
        return null;
      }
      return Object.fromEntries(colorNames.map((name) => [name, value[name]])) as BattleColors;
    } catch {
      return null;
    }
  }

  async function loadBattleColors() {
    battleColorLoadedVariant = variant;
    battleColorPreset = 'classic';
    battleColors = { ...BATTLE_COLOR_PRESETS.classic.colors };
    try {
      const databaseSaved = await invoke<unknown>('load_app_setting', { key: battleColorStorageKey() });
      const saved = (databaseSaved && typeof databaseSaved === 'object' && !Array.isArray(databaseSaved)
        ? databaseSaved
        : JSON.parse(localStorage.getItem(battleColorStorageKey()) ?? '{}')) as Partial<BattleColors> & {
        preset?: unknown;
      };
      const defaultColors = BATTLE_COLOR_PRESETS.classic.colors;
      battleColors = Object.fromEntries(Object.entries(defaultColors).map(([name, fallback]) => [
        name,
        typeof saved[name as BattleColorName] === 'string'
          && /^#[0-9a-f]{6}$/iu.test(saved[name as BattleColorName]!)
            ? saved[name as BattleColorName]
            : fallback,
      ])) as unknown as BattleColors;
      const matchingPreset = matchingBattleColorPreset(battleColors);
      battleColorPreset = saved.preset === 'custom'
        ? 'custom'
        : matchingPreset ?? 'custom';
    } catch {
      // 本地颜色损坏时继续使用默认值，不影响对战操作。
    }
    battleColorSnapshotAvailable = await invoke<unknown>('load_app_setting', { key: battleColorSnapshotStorageKey() })
      .then((value) => Boolean(value))
      .catch(() => readBattleColorSnapshot() !== null);
  }

  function matchingBattleColorPreset(colors: BattleColors): BattleColorPresetName | null {
    return BATTLE_COLOR_PRESET_OPTIONS.find(([, preset]) => (
      Object.entries(preset.colors).every(([name, value]) => colors[name as BattleColorName] === value)
    ))?.[0] ?? null;
  }

  function saveBattleColors() {
    const value = { ...battleColors, preset: battleColorPreset };
    void invoke('save_app_setting', { key: battleColorStorageKey(), value }).catch(() => undefined);
  }

  function selectBattleColorPreset(preset: BattleColorPresetName) {
    battleColorPreset = preset;
    battleColors = { ...BATTLE_COLOR_PRESETS[preset].colors };
    saveBattleColors();
  }

  function updateBattleColor(name: BattleColorName, event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    battleColors = { ...battleColors, [name]: value };
    battleColorPreset = matchingBattleColorPreset(battleColors) ?? 'custom';
    saveBattleColors();
  }

  function saveBattleColorSnapshot() {
    void invoke('save_app_setting', { key: battleColorSnapshotStorageKey(), value: battleColors }).catch(() => undefined);
    battleColorSnapshotAvailable = true;
  }

  async function loadBattleColorSnapshot() {
    const stored = await invoke<unknown>('load_app_setting', { key: battleColorSnapshotStorageKey() }).catch(() => null);
    const saved = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as BattleColors
      : readBattleColorSnapshot();
    if (!saved) {
      battleColorSnapshotAvailable = false;
      return;
    }
    battleColors = saved;
    battleColorPreset = matchingBattleColorPreset(saved) ?? 'custom';
    saveBattleColors();
  }

  async function setBattleFullscreen(fullscreen: boolean) {
    if (!battlePage || battleFullscreen === fullscreen || battleFullscreenChanging) return;
    battleFullscreenChanging = true;
    try {
      if (nativeRuntime) {
        await getCurrentWindow().setFullscreen(fullscreen);
      } else if (fullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!fullscreen && document.fullscreenElement) {
        await document.exitFullscreen();
      }
      if (fullscreen) {
        bodyOverflowBeforeBattleFullscreen = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = bodyOverflowBeforeBattleFullscreen;
      }
      battleFullscreen = fullscreen;
      await tick();
      groupingResultElement?.focus({ preventScroll: true });
    } catch (reason) {
      error = messageFrom(reason, fullscreen ? '无法进入窗口全屏' : '无法退出窗口全屏');
    } finally {
      battleFullscreenChanging = false;
    }
  }

  function isTextEditingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && target.matches('input, textarea, select, [contenteditable="true"]');
  }

  async function initializeDesktop() {
    desktopInitialized = true;
    await loadBattleHistories();
    await Promise.all([
      loadRankedUsers(),
      battlePage ? loadBattleTmpState() : loadGroupingHistories(),
    ]);
    await tick();
    await resolveNames();
  }

  async function resolveNames() {
    if (!businessRuntime || names.length === 0) {
      resolutionRequest += 1;
      resolvedNames = [];
      resolvingNames = false;
      return;
    }
    const request = ++resolutionRequest;
    resolvingNames = true;
    try {
      const resolved = await invoke<ResolvedGroupingName[]>('resolve_grouping_names', { names });
      if (request === resolutionRequest) {
        const uniquePeople = uniqueResolvedGroupingPeople(resolved);
        resolvedNames = uniquePeople;
        if (uniquePeople.length !== names.length) {
          const keepDraft = sourceTextDirty;
          confirmedSourceText = uniquePeople.map((person) => person.inputName).join('\n');
          if (!keepDraft) sourceText = confirmedSourceText;
          historyStatus = 'idle';
          await tick();
        }
      }
    } catch (reason) {
      if (request === resolutionRequest) {
        resolvedNames = [];
        rankingError = messageFrom(reason, '无法核对名称别名');
        error = rankingError;
      }
    } finally {
      if (request === resolutionRequest) resolvingNames = false;
    }
  }

  async function commitSourceNames(nextNames: readonly string[]) {
    const text = uniqueGroupingNames(nextNames).join('\n');
    confirmedSourceText = text;
    sourceText = text;
    historyStatus = 'idle';
    error = '';
    await tick();
    await resolveNames();
  }

  async function confirmSourceText() {
    cancelPreviewInsertion();
    await commitSourceNames(parseOptionText(sourceText));
  }

  async function sortBattlePreviewByRank() {
    if (!battleRankReady || battleTmpSnapshot) return;
    cancelPreviewInsertion();
    try {
      await commitSourceNames(orderBattleNamesForCurrentVariant(
        names,
        resolvedNames,
        battleConfiguredFixedCount,
        variant,
      ));
    } catch (reason) {
      error = messageFrom(reason, '排名预览失败');
    }
  }

  function orderBattleNamesForCurrentVariant(
    currentNames: readonly string[],
    currentPeople: readonly ResolvedGroupingName[],
    fixedCount: number,
    currentVariant: AppVariant,
  ): string[] {
    return currentVariant === 'caimi' && fixedCount > 0
      ? orderCaimiBattleNamesByFixedRank(currentNames, currentPeople, fixedCount)
      : orderBattleNamesByFixedRank(currentNames, currentPeople, fixedCount);
  }

  async function sortGroupingPreviewByRank() {
    if (!canGenerateGroupingByRank) return;
    cancelPreviewInsertion();
    try {
      await commitSourceNames(orderPartiallyResolvedGroupingNames(resolvedNames));
    } catch (reason) {
      error = messageFrom(reason, '排名预览失败');
    }
  }

  function orderedNamesForGrouping(orderMode: GroupingOrderMode): string[] {
    if (orderMode === 'random') {
      return shuffleGroupingNames(names);
    }
    if (!businessRuntime) return names;
    if (orderMode === 'input') {
      return resolvedNames.map((person) => person.inputName);
    }
    return orderPartiallyResolvedGroupingNames(resolvedNames);
  }

  function rankScoresForGrouping(
    orderedNames: readonly string[],
    currentPeople: readonly ResolvedGroupingName[] = resolvedNames,
  ): number[] {
    if (!businessRuntime) return orderedNames.map((_, index) => index + 1);
    const rankByName = new Map(
      currentPeople.flatMap((person) => (
        person.rank === null
          ? []
          : [[person.inputName.toLocaleLowerCase('zh-CN'), person.rank] as const]
      )),
    );
    return orderedNames.map((name, index) => (
      rankByName.get(name.toLocaleLowerCase('zh-CN')) ?? 10_000 + index
    ));
  }

  async function generate(orderMode: GroupingOrderMode = businessRuntime ? 'rank' : 'input') {
    error = '';
    historyStatus = 'idle';
    try {
      if (businessRuntime) {
        const unresolvedCount = unrankedGroupingNameCount(names, resolvedNames);
        const allowedUnresolvedCount = groupingLastTierSize(names.length, Number(groupCount));
        if (
          orderMode === 'rank'
          && unresolvedCount > allowedUnresolvedCount
        ) {
          throw new Error(`末档限 ${allowedUnresolvedCount} 个未排名，还差 ${unresolvedCount - allowedUnresolvedCount} 个`);
        }
      }
      const orderedNames = orderedNamesForGrouping(orderMode);
      const rankingSnapshot = orderMode === 'rank'
        ? createGroupingRankingSnapshot(orderedNames, resolvedNames, true)
        : [];
      const generated = createRandomGrouping(orderedNames, Number(groupCount));
      result = variant === 'caimi' && orderMode !== 'random'
        ? applyCaimiGroupingSwap(generated, rankScoresForGrouping(orderedNames))
        : generated;
      resultOrderMode = orderMode;
      resultSourceNames = [...names];
      resultOrderedNames = orderedNames;
      groupCount = result.groupCount;
      const createdAt = Date.now();
      resultHistory = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `grouping-${createdAt}-${Math.random().toString(16).slice(2)}`,
        createdAt,
        input: {
          title: groupingTitle.trim() || null,
          sourceNames: resultSourceNames,
          orderedNames,
          groupCount,
          orderMode,
          ...(orderMode === 'rank' ? { rankingSnapshot } : {}),
        },
        result,
      };
      const resolvedSignature = orderMode === 'random'
        ? 'random'
        : businessRuntime
        ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
        : 'web';
      resultSignature = `${groupCount}|${names.join('\u0000')}|${resolvedSignature}`;
      resetGroupingReveal();
    } catch (reason) {
      result = null;
      resultHistory = null;
      error = messageFrom(reason, '无法生成分组');
    }
  }

  async function generateBattle() {
    error = '';
    battleHistoryView = null;
    if (battleTitleBeforeHistoryView !== null) {
      battleTitle = battleTitleBeforeHistoryView;
      battleTitleBeforeHistoryView = null;
    }
    if (battleTmpSnapshot) {
      error = '已抽签，请先清空';
      return;
    }
    if (!battleCanExecute) {
      error = battleFormat === 'avoid-first-pair'
        ? `需 8 项，现 ${names.length} 项`
        : battleOrderMode === 'rank'
          ? `固定前 ${battleConfiguredFixedCount} 名，现 ${battleRankedNameCount} 个排名`
          : '至少确认 4 项';
      return;
    }
    try {
      const orderedNames = battleFormat === 'avoid-first-pair'
        ? names
        : battleOrderMode === 'rank'
          ? orderBattleNamesForCurrentVariant(
            names,
            resolvedNames,
            battleConfiguredFixedCount,
            variant,
          )
          : businessRuntime ? resolvedNames.map((person) => person.inputName) : names;
      const createdPlan = battleFormat === 'avoid-first-pair'
        ? createAvoidSameGroupPlan(orderedNames)
        : createSeededBattlePlan(orderedNames, {
          format: battleFormat,
          orderMode: battleOrderMode,
          fixedSeedCount: battleConfiguredFixedCount,
          doubleGrandFinal: battleDoubleGrandFinal,
          caimiRankScores: variant === 'caimi'
            && battleOrderMode === 'rank'
            && battleConfiguredFixedCount > 0
            ? rankScoresForGrouping(orderedNames)
            : undefined,
        });
      lastConfirmedBattleScore = null;
      pendingBattleScoreGroup = null;
      battleTmpSnapshot = createBattleTmpSnapshot(variant, createdPlan);
      battleTmpAvailable = true;
      battleHistorySaved = false;
      resetBattleReveal(true);
      if (businessRuntime) {
        battleSyncStatus = 'saving';
        try {
          await invoke('save_battle_tmp_state', { variant, state: battleTmpSnapshot });
          battleSyncStatus = 'saved';
        } catch (reason) {
          battleSyncStatus = 'error';
          error = messageFrom(reason, '对战已生成，但无法同步临时状态');
        }
      } else {
        battleSyncStatus = 'saved';
      }
      await tick();
      focusGroupingResult();
    } catch (reason) {
      battleTmpSnapshot = null;
      battleHistorySaved = false;
      error = messageFrom(reason, '无法生成对战');
    }
  }

  async function saveHistory(grouping: SavedGrouping) {
    historyStatus = 'saving';
    try {
      await invoke('save_grouping_history', { grouping, variant });
      historyStatus = 'saved';
      await loadGroupingHistories();
    } catch (reason) {
      historyStatus = 'error';
      error = messageFrom(reason, '分组已生成，但无法保存历史');
    }
  }

  async function saveCurrentHistory() {
    if (
      !businessRuntime
      || !result
      || !resultHistory
      || resultOutdated
      || historyStatus === 'saving'
      || historyStatus === 'saved'
    ) return;
    await saveHistory(resultHistory);
  }

  async function exportGroupingJson() {
    if (!resultHistory) return;
    error = '';
    try {
      await downloadFormattedJson('分组结果', createGroupingHistoryTransfer(resultHistory, variant));
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 JSON');
    }
  }

  async function exportGroupingExcel() {
    if (!result) return;
    error = '';
    try {
      await downloadExcel(groupingTitle.trim() || '分组结果', groupingExcelRows(result));
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 Excel');
    }
  }

  function groupingExcelRows(grouping: RandomGrouping): (string | number)[][] {
    return [
      ['档位', ...grouping.groupNames.map((group) => `${group}组`)],
      ...grouping.tiers.map((tier, tierIndex) => [
        `t${tierIndex + 1}`,
        ...tier.map((entry) => entry?.name ?? ''),
      ]),
    ];
  }

  function historyResult(history: SavedGrouping): RandomGrouping | null {
    const candidate = history.result as Partial<RandomGrouping>;
    if (!Array.isArray(candidate.groupNames) || !Array.isArray(candidate.tiers)) return null;
    return candidate as RandomGrouping;
  }

  async function exportGroupingHistoryJson(history: SavedGrouping) {
    if (historyExporting) return;
    historyExporting = { id: history.id, format: 'json' };
    historyError = '';
    try {
      await downloadFormattedJson('分组结果', createGroupingHistoryTransfer(history, variant));
    } catch (reason) {
      historyError = messageFrom(reason, '无法导出分组历史 JSON');
    } finally {
      historyExporting = null;
    }
  }

  async function exportGroupingHistoryExcel(history: SavedGrouping) {
    if (historyExporting) return;
    const historicalResult = historyResult(history);
    if (!historicalResult) {
      historyError = '这条历史记录内容不完整';
      return;
    }
    historyExporting = { id: history.id, format: 'excel' };
    historyError = '';
    try {
      await downloadExcel(groupingHistoryTitle(history) || '分组结果', groupingExcelRows(historicalResult));
    } catch (reason) {
      historyError = messageFrom(reason, '无法导出分组历史 Excel');
    } finally {
      historyExporting = null;
    }
  }

  async function loadRankedUsers() {
    if (!businessRuntime) return;
    rankingLoading = true;
    rankingError = '';
    try {
      rankedUsers = await invoke<RankedUser[]>('list_ranked_users');
      if (!rankedUsers.some((user) => user.id === selectedRankedUserId)) {
        selectedRankedUserId = rankedUsers[0]?.id ?? null;
      }
    } catch (reason) {
      rankingError = messageFrom(reason, '无法读取排名表');
    } finally {
      rankingLoading = false;
    }
  }

  async function exportRanking() {
    rankingError = '';
    try {
      await downloadFormattedJson('排名', createRankingTransfer(rankedUsers));
    } catch (reason) {
      rankingError = messageFrom(reason, '无法导出排名 JSON');
    }
  }

  function openRankingImporter() {
    if (rankedUsers.length > 0 || rankingImporting) return;
    rankingFileInput?.click();
  }

  async function readRankingFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || rankedUsers.length > 0 || rankingImporting) return;
    if (file.name.split('.').pop()?.toLocaleLowerCase('zh-CN') !== 'json') {
      showImportError('排名导入失败', '排名同步只支持 JSON 文件');
      return;
    }
    try {
      pendingRankingImport = parseRankingTransfer(await file.text());
    } catch (reason) {
      showImportError('排名文件格式错误', messageFrom(reason, '无法读取排名文件'));
    }
  }

  async function confirmRankingImport() {
    const users = pendingRankingImport;
    if (!users || rankedUsers.length > 0 || rankingImporting) return;
    rankingImporting = true;
    rankingError = '';
    try {
      rankedUsers = await invoke<RankedUser[]>('replace_ranked_users', { users });
      pendingRankingImport = null;
      resetUserForm();
      cancelKeyboardRankMove();
      selectedRankedUserId = rankedUsers[0]?.id ?? null;
      await resolveNames();
    } catch (reason) {
      pendingRankingImport = null;
      showImportError('排名导入失败', messageFrom(reason, '无法导入排名'));
      await loadRankedUsers();
    } finally {
      rankingImporting = false;
    }
  }

  function applyBattleTmpSnapshot(state: BattleTmpSnapshot) {
    battleTmpSnapshot = structuredClone(state);
    battleTmpAvailable = true;
    // 悬念只属于刚抽签的首次展示，恢复临时表不重复隐藏选手。
    resetBattleReveal();
    battleFormat = state.format;
    battleOrderMode = state.orderMode;
    battleFixedSeedCount = state.fixedSeedCount;
    battleDoubleGrandFinal = state.matches.some((match) => match.matchId === 'GF-RESET-M1');
    const restoredNames = [...state.participants]
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .map((participant) => participant.name)
      .join('\n');
    confirmedSourceText = restoredNames;
    sourceText = restoredNames;
  }

  async function readBattleTmpState(): Promise<BattleTmpSnapshot | null> {
    const value = await invoke<unknown | null>('load_battle_tmp_state', { variant });
    return value === null ? null : parseBattleTmpSnapshot(value, variant);
  }

  async function loadBattleTmpHistoryStatus(): Promise<void> {
    const status = await invoke<{ updatedAt: number; historySaved: boolean } | null>(
      'load_battle_tmp_history_status',
      { variant },
    );
    battleHistorySaved = status?.historySaved === true
      && status.updatedAt === battleTmpSnapshot?.updatedAt;
  }

  async function loadBattleTmpState(showEmptyError = false): Promise<boolean> {
    if (!businessRuntime || !battlePage) return false;
    battleSyncStatus = 'loading';
    try {
      const state = await readBattleTmpState();
      if (state === null) {
        battleSyncStatus = 'idle';
        battleTmpAvailable = false;
        if (showEmptyError) error = '当前临时表为空，没有可以加载的对战';
        return false;
      }
      applyBattleTmpSnapshot(state);
      await loadBattleTmpHistoryStatus();
      battleSyncStatus = 'saved';
      error = '';
      return true;
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, '无法读取对战临时状态');
      return false;
    }
  }

  async function requestBattleLoad(target: BattleLoadTarget) {
    if (battleLoadingTarget) return;
    if (target.kind === 'current') {
      await performBattleLoad(target);
      return;
    }
    if (battleTmpSnapshot && battleHistorySaved) {
      await performBattleLoad(target);
      return;
    }
    if (battleTmpSnapshot) {
      pendingBattleLoad = { target, confirmation: 1 };
      return;
    }
    battleLoadingTarget = true;
    let current: BattleTmpSnapshot | null = null;
    let currentHistorySaved = false;
    try {
      current = await readBattleTmpState();
      if (current) {
        const status = await invoke<{ updatedAt: number; historySaved: boolean } | null>(
          'load_battle_tmp_history_status',
          { variant },
        );
        currentHistorySaved = status?.historySaved === true
          && status.updatedAt === current.updatedAt;
      }
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, '无法确认当前对战临时表状态');
      return;
    } finally {
      battleLoadingTarget = false;
    }
    if (current) {
      if (currentHistorySaved) {
        await performBattleLoad(target);
      } else {
        pendingBattleLoad = { target, confirmation: 1 };
      }
      return;
    }
    await performBattleLoad(target);
  }

  async function confirmBattleLoad() {
    const pending = pendingBattleLoad;
    if (!pending || battleLoadingTarget) return;
    if (pending.confirmation < 3) {
      pendingBattleLoad = {
        ...pending,
        confirmation: (pending.confirmation + 1) as 2 | 3,
      };
      return;
    }
    pendingBattleLoad = null;
    await performBattleLoad(pending.target);
  }

  async function performBattleLoad(target: BattleLoadTarget) {
    if (!businessRuntime || !battlePage || battleLoadingTarget) return;
    battleLoadingTarget = true;
    try {
      let loaded = false;
      if (target.kind === 'current') {
        loaded = await loadBattleTmpState(true);
      } else {
        const snapshot = parseBattleTmpSnapshot(structuredClone(target.history.snapshot), variant);
        const current = await readBattleTmpState();
        battleTmpAvailable = current !== null;
        battleSyncStatus = 'saving';
        await invoke('save_battle_tmp_state', {
          variant,
          state: snapshot,
          historySaved: true,
        });
        applyBattleTmpSnapshot(snapshot);
        battleHistorySaved = true;
        battleSyncStatus = 'saved';
        error = '';
        loaded = true;
      }
      if (loaded) {
        battleHistoryView = null;
        if (battleTitleBeforeHistoryView !== null) {
          battleTitle = battleTitleBeforeHistoryView;
          battleTitleBeforeHistoryView = null;
        }
        await tick();
        await resolveNames();
        focusGroupingResult();
      }
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, target.kind === 'current' ? '无法加载当前临时表' : '无法把历史加载到临时表');
    } finally {
      battleLoadingTarget = false;
    }
  }

  function battleLoadTargetLabel(target: BattleLoadTarget): string {
    return target.kind === 'current'
      ? '当前数据库临时表'
      : `${formatHistoryDate(target.history.createdAt)} 的历史签表`;
  }

  function battleLoadConfirmationTitle(pending: PendingBattleLoad): string {
    const label = battleLoadTargetLabel(pending.target);
    if (pending.confirmation === 1) return `1/3 用${label}替换编辑区？`;
    if (pending.confirmation === 2) {
      return pending.target.kind === 'current'
        ? '2/3 以数据库内容覆盖页面状态？'
        : '2/3 将历史副本写入临时表？';
    }
    return pending.target.kind === 'current'
      ? '3/3 重新载入当前临时表？'
      : '3/3 覆盖并加载这条历史？';
  }

  function battleLoadConfirmationDetail(pending: PendingBattleLoad): string {
    if (pending.confirmation === 1) {
      return '当前编辑区的参赛者、赛制、全部场次和比分会离开页面。';
    }
    if (pending.confirmation === 2) {
      return pending.target.kind === 'current'
        ? '将重新读取数据库中的关系化临时表；页面内容全部以数据库为准。'
        : '现有临时签表不会自动保存；未手动保存的状态会被所选历史覆盖。';
    }
    return pending.target.kind === 'current'
      ? '加载完成后配置继续锁定，只有签表中的比分可以修改。'
      : '原历史记录保持不变；后续比分只写入新生成的临时表副本。';
  }

  function battleLoadConfirmationAction(pending: PendingBattleLoad): string {
    if (pending.confirmation < 3) return '继续检查';
    return pending.target.kind === 'current' ? '重新读取' : '覆盖并加载';
  }

  async function viewBattleHistory(history: BattleHistory) {
    if (battleHistoryView === null) battleTitleBeforeHistoryView = battleTitle;
    battleTitle = history.title ?? '';
    battleHistoryView = {
      ...history,
      snapshot: structuredClone(history.snapshot),
    };
    await tick();
    focusGroupingResult();
  }

  async function returnToCurrentBattle() {
    battleHistoryView = null;
    if (battleTitleBeforeHistoryView !== null) {
      battleTitle = battleTitleBeforeHistoryView;
      battleTitleBeforeHistoryView = null;
    }
    await tick();
    focusGroupingResult();
  }

  async function loadBattleHistories() {
    if (!battlePage) return;
    battleHistoryError = '';
    try {
      battleHistories = await invoke<BattleHistory[]>('list_battle_histories', { variant });
    } catch (reason) {
      battleHistories = [];
      battleHistoryError = messageFrom(reason, '无法读取对战历史数据库');
    }
  }

  async function archiveBattleHistory(
    snapshot: BattleTmpSnapshot,
    markCurrent = false,
    titleOverride?: string | null,
  ): Promise<boolean> {
    const savedAt = Date.now();
    const record: BattleHistory = {
      id: `battle-${savedAt}-${Math.random().toString(16).slice(2)}`,
      createdAt: savedAt,
      updatedAt: snapshot.updatedAt,
      title: titleOverride === undefined ? (battleTitle.trim() || null) : (titleOverride?.trim() || null),
      snapshot: structuredClone(snapshot),
    };
    try {
      await invoke('save_battle_history', {
        variant,
        history: record,
        markCurrent,
      });
      await loadBattleHistories();
      if (markCurrent) battleHistorySaved = true;
      return !battleHistoryError;
    } catch (reason) {
      battleHistoryError = messageFrom(reason, '无法保存对战历史数据库');
      return false;
    }
  }

  /** 手动存档不会影响仍可继续编辑的临时签表。 */
  async function saveCurrentBattleHistory() {
    if (!battleTmpSnapshot || battleHistorySaved) return;
    const previousHistoryError = battleHistoryError;
    if (!await archiveBattleHistory(battleTmpSnapshot, true)) error = battleHistoryError;
    else if (error === previousHistoryError) error = '';
  }

  async function importBattleHistoryFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || battleHistoryImporting) return;
    if (file.name.split('.').pop()?.toLocaleLowerCase('zh-CN') !== 'json') {
      showImportError('对战历史导入失败', '只支持 JSON 文件');
      return;
    }
    battleHistoryImporting = true;
    try {
      const value = JSON.parse((await file.text()).replace(/^\uFEFF/u, '')) as unknown;
      const transfer = parseBattleHistoryTransferRecord(value, variant);
      if (!await archiveBattleHistory(transfer.snapshot, false, transfer.title)) throw new Error(battleHistoryError);
    } catch (reason) {
      showImportError('对战历史导入失败', messageFrom(reason, '无法读取对战历史'));
    } finally {
      battleHistoryImporting = false;
    }
  }

  async function exportBattleHistoryJson(history: BattleHistory) {
    if (battleHistoryExporting) return;
    battleHistoryExporting = { id: history.id, format: 'json' };
    battleHistoryError = '';
    try {
      await downloadFormattedJson(history.title || '对战历史', createBattleHistoryTransfer(history.snapshot, history.title));
    } catch (reason) {
      battleHistoryError = messageFrom(reason, '无法导出对战历史 JSON');
    } finally {
      battleHistoryExporting = null;
    }
  }

  async function exportBattleHistoryExcel(history: BattleHistory) {
    if (battleHistoryExporting) return;
    battleHistoryExporting = { id: history.id, format: 'excel' };
    battleHistoryError = '';
    try {
      await downloadExcelBytes(history.title || '对战签表', await createBattleBracketWorkbook(history.snapshot));
    } catch (reason) {
      battleHistoryError = messageFrom(reason, '无法导出对战历史 Excel');
    } finally {
      battleHistoryExporting = null;
    }
  }

  function requestClearBattleHistories() {
    if (battleHistories.length > 0) battleHistoryDeleteConfirmation = 1;
  }

  function requestDeleteBattleHistory(history: BattleHistory) {
    pendingBattleHistoryDeletion = history;
  }

  async function confirmDeleteBattleHistory() {
    const history = pendingBattleHistoryDeletion;
    if (!history) return;
    try {
      await invoke('delete_battle_history', { variant, id: history.id });
      await loadBattleHistories();
      if (battleHistoryView?.id === history.id) {
        battleHistoryView = null;
        if (battleTitleBeforeHistoryView !== null) {
          battleTitle = battleTitleBeforeHistoryView;
          battleTitleBeforeHistoryView = null;
        }
      }
    } catch (reason) {
      battleHistoryError = messageFrom(reason, '无法删除对战历史数据库');
    }
    pendingBattleHistoryDeletion = null;
  }

  async function confirmClearBattleHistories() {
    if (battleHistoryDeleteConfirmation === 1) {
      battleHistoryDeleteConfirmation = 2;
      return;
    }
    if (battleHistoryDeleteConfirmation !== 2) return;
    try {
      await invoke('clear_battle_histories', { variant });
      await loadBattleHistories();
    } catch (reason) {
      battleHistoryError = messageFrom(reason, '无法清空对战历史数据库');
    }
    battleHistoryDeleteConfirmation = 0;
  }

  async function loadGroupingHistories() {
    if (!businessRuntime) return;
    historyLoading = true;
    historyError = '';
    try {
      groupingHistories = await invoke<SavedGrouping[]>('list_grouping_histories', { variant });
    } catch (reason) {
      historyError = messageFrom(reason, '无法读取分组历史');
    } finally {
      historyLoading = false;
    }
  }

  function requestDeleteGroupingHistory(history: SavedGrouping) {
    pendingGroupingHistoryDeletion = { kind: 'one', history };
  }

  function requestClearGroupingHistories() {
    if (groupingHistories.length > 0) {
      pendingGroupingHistoryDeletion = { kind: 'all', confirmation: 1 };
    }
  }

  async function confirmGroupingHistoryDeletion() {
    const pending = pendingGroupingHistoryDeletion;
    if (!businessRuntime || !pending || historyDeleting) return;
    if (pending.kind === 'all' && pending.confirmation === 1) {
      pendingGroupingHistoryDeletion = { kind: 'all', confirmation: 2 };
      return;
    }

    historyDeleting = true;
    historyError = '';
    historyImportStatus = '';
    try {
      if (pending.kind === 'one') {
        await invoke('delete_grouping_history', { variant, id: pending.history.id });
        groupingHistories = groupingHistories.filter((history) => history.id !== pending.history.id);
      } else {
        await invoke('clear_grouping_histories', { variant });
        groupingHistories = [];
      }
      pendingGroupingHistoryDeletion = null;
    } catch (reason) {
      historyError = messageFrom(reason, pending.kind === 'one' ? '无法删除分组历史' : '无法清空分组历史');
      pendingGroupingHistoryDeletion = null;
    } finally {
      historyDeleting = false;
    }
  }

  async function editRankedUser(user: RankedUser, focus: 'name' | 'aliases') {
    cancelKeyboardRankMove();
    desktopPanel = 'ranking';
    selectedRankedUserId = user.id;
    editingUserId = user.id;
    editingRankField = focus;
    userName = user.name;
    userAliases = '';
    await tick();
    if (editingRankField === 'name') {
      userNameInput?.focus();
      userNameInput?.select();
    } else if (focus === 'aliases') {
      userAliasInput?.focus();
    }
  }

  async function addUnknownPerson(name: string) {
    const normalizedName = name.trim();
    if (!businessRuntime || !normalizedName || rankingSaving) return;
    cancelAliasLink();
    cancelKeyboardRankMove();
    resetUserForm();
    rankingSaving = true;
    rankingError = '';
    try {
      const created = await invoke<RankedUser>('save_ranked_user', {
        user: {
          id: null,
          name: normalizedName,
          rank: 10_000,
          aliases: [],
        },
      });
      selectedRankedUserId = created.id;
      await loadRankedUsers();
      await resolveNames();
      await openDesktopPanel('ranking');
    } catch (reason) {
      rankingError = messageFrom(reason, '无法录入排名');
    } finally {
      rankingSaving = false;
    }
  }

  async function startAliasLink(name: string) {
    cancelKeyboardRankMove();
    resetUserForm();
    aliasLinkName = name;
    resetRankSelectionShortcut();
    await openDesktopPanel('ranking');
    if (rankedUsers.length > 0) {
      await selectRankedUser(
        rankedUsers.some((user) => user.id === selectedRankedUserId)
          ? selectedRankedUserId!
          : rankedUsers[0].id,
      );
    }
  }

  function cancelAliasLink() {
    aliasLinkName = null;
    resetRankSelectionShortcut();
  }

  function updateAliasLinkRankShortcut(key: string) {
    updateRankSelectionShortcut(key);
    aliasLinkRankInput = rankSelectionShortcutInput;
  }

  function resetRankSelectionShortcut() {
    rankSelectionShortcutInput = '';
    rankSelectionShortcutAt = 0;
    aliasLinkRankInput = '';
  }

  function updateRankSelectionShortcut(key: string) {
    const now = Date.now();
    const current = now - rankSelectionShortcutAt <= 900 ? rankSelectionShortcutInput : '';
    let next = updateRankShortcutInput(current, key);
    if (/^\d$/u.test(key) && !rankedUsers.some((user) => user.rank < 10_000 && String(user.rank).startsWith(next))) {
      next = key;
    }
    rankSelectionShortcutInput = next;
    rankSelectionShortcutAt = now;
    const userId = rankedUserIdAtShortcut(rankedUsers, next);
    if (userId !== null) void selectRankedUser(userId);
  }

  async function confirmAliasLink() {
    const alias = aliasLinkName;
    const userId = selectedRankedUserId;
    if (!alias || userId === null || rankingSaving) return;
    rankingSaving = true;
    rankingError = '';
    try {
      const updated = await invoke<RankedUser>('add_ranked_user_alias', { userId, alias });
      rankedUsers = rankedUsers.map((user) => user.id === updated.id ? updated : user);
      aliasLinkName = null;
      resetRankSelectionShortcut();
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法关联名称');
    } finally {
      rankingSaving = false;
    }
  }

  function resetGroupingReveal() {
    revealedGroupingCells = new Set();
    allGroupingCellsRevealed = false;
  }

  function resetBattleReveal(fresh = false) {
    revealedBattleSlots = new Set();
    allBattleSlotsRevealed = !fresh;
    battleRevealFresh = fresh;
  }

  function updateSlowReveal(enabled: boolean) {
    slowRevealEnabled = enabled;
    resetGroupingReveal();
    if (!slowRevealEnabled) resetBattleReveal();
  }

  function groupingCellKey(tierIndex: number, groupIndex: number): string {
    return `${tierIndex}:${groupIndex}`;
  }

  function isGroupingCellHidden(tierIndex: number, groupIndex: number): boolean {
    return hiddenGroupingCellKeys.has(groupingCellKey(tierIndex, groupIndex));
  }

  function revealGroupingCell(tierIndex: number, groupIndex: number) {
    if (!isGroupingCellHidden(tierIndex, groupIndex)) return;
    revealedGroupingCells = new Set(revealedGroupingCells).add(groupingCellKey(tierIndex, groupIndex));
  }

  function revealAllGroupingCells() {
    allGroupingCellsRevealed = true;
  }

  function battleSlotKey(match: BattleTmpMatch, slot: 'up' | 'down'): string {
    return `${match.matchId}:${slot}`;
  }

  function revealBattleSlot(match: BattleTmpMatch, slot: 'up' | 'down') {
    revealedBattleSlots = new Set(revealedBattleSlots).add(battleSlotKey(match, slot));
  }

  function revealAllBattleSlots() {
    allBattleSlotsRevealed = true;
  }

  async function openPreviewInsertion(index: number) {
    insertIndex = Math.min(names.length, Math.max(0, index));
    insertName = '';
    insertError = '';
    await tick();
    insertInput?.focus();
  }

  function confirmPreviewInsertion() {
    if (insertIndex === null) return;
    try {
      const updated = insertGroupingPreviewName(names, insertIndex, insertName);
      cancelPreviewInsertion();
      void commitSourceNames(updated);
    } catch (reason) {
      insertError = messageFrom(reason, '无法插入姓名');
    }
  }

  function cancelPreviewInsertion() {
    insertIndex = null;
    insertName = '';
    insertError = '';
    insertInput = null;
  }

  function updatePreviewName(index: number, value: string) {
    cancelPreviewInsertion();
    const updated = [...names];
    const name = value.trim();
    if (!name) {
      updated.splice(index, 1);
    } else {
      updated[index] = name;
    }
    void commitSourceNames(updated);
  }

  function removePreviewName(index: number) {
    cancelPreviewInsertion();
    const updated = [...names];
    updated.splice(index, 1);
    void commitSourceNames(updated);
  }

  function toggleDesktopPanel(panel: DesktopPanel) {
    if (desktopPanel === panel) {
      if (panel === 'ranking' && !rankingFocusActive) {
        void openDesktopPanel('ranking');
        return;
      }
      cancelKeyboardRankMove();
      if (panel === 'ranking') {
        rankingFocusActive = false;
        selectedRankedUserId = null;
        rankedUserActionIndex = -1;
      }
      desktopPanel = null;
      return;
    }
    void openDesktopPanel(panel);
  }

  function historySummary(history: SavedGrouping): string {
    const input = history.input as Partial<{ sourceNames: unknown[]; groupCount: number; orderMode: GroupingOrderMode }>;
    const peopleCount = Array.isArray(input.sourceNames) ? input.sourceNames.length : 0;
    const mode = input.orderMode === 'input' ? '输入顺序' : input.orderMode === 'random' ? '全随机' : '排名';
    return `${peopleCount} 项 · ${Number(input.groupCount) || '—'} 组 · ${mode}`;
  }

  function groupingHistoryTitle(history: SavedGrouping): string | null {
    const input = history.input as { title?: unknown };
    return typeof input.title === 'string' && input.title.trim() ? input.title.trim() : null;
  }

  function openGroupingHistoryImporter() {
    historyFileInput?.click();
  }

  async function importGroupingHistoryFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLocaleLowerCase('zh-CN');
    if (extension !== 'json') {
      showImportError('分组历史导入失败', '只支持单条分组历史 JSON 文件');
      return;
    }
    historyImporting = true;
    historyError = '';
    historyImportStatus = '';
    try {
      const history = parseGroupingHistoryTransfer(await file.text());
      groupingHistories = await invoke<SavedGrouping[]>('import_grouping_history', {
        variant,
        history,
      });
      historyImportStatus = '已导入 1 条';
    } catch (reason) {
      showImportError('分组历史导入失败', messageFrom(reason, '无法导入分组历史'));
    } finally {
      historyImporting = false;
    }
  }

  async function openGroupingDatabaseFolder() {
    rankingError = '';
    try {
      await invoke('open_database_folder');
    } catch (reason) {
      rankingError = messageFrom(reason, '无法打开数据库文件夹');
    }
  }

  function openDatabaseImporter() {
    if (nativeRuntime || databaseImporting) return;
    databaseFileInput?.click();
  }

  async function readDatabaseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || nativeRuntime || databaseImporting) return;
    const extension = file.name.split('.').pop()?.toLocaleLowerCase('zh-CN');
    if (extension !== 'sqlite' && extension !== 'sqlite3') {
      showImportError('SQLite 导入失败', '只支持 .sqlite 或 .sqlite3 文件');
      return;
    }
    try {
      pendingDatabaseImport = {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      };
    } catch (reason) {
      showImportError('SQLite 导入失败', messageFrom(reason, '无法读取 SQLite 文件'));
    }
  }

  async function confirmDatabaseImport() {
    if (!pendingDatabaseImport || databaseImporting) return;
    databaseImporting = true;
    try {
      await importWebDatabase(pendingDatabaseImport.bytes);
      pendingDatabaseImport = null;
      window.location.reload();
    } catch (reason) {
      pendingDatabaseImport = null;
      showImportError('SQLite 导入失败', messageFrom(reason, '无法恢复 SQLite 数据库'));
    } finally {
      databaseImporting = false;
    }
  }

  async function openGroupingDownloadFolder() {
    error = '';
    try {
      await invoke('open_download_folder');
    } catch (reason) {
      error = messageFrom(reason, '无法打开下载目录');
    }
  }

  function isDatabaseFileError(message: string): boolean {
    return message.startsWith('数据库文件错误：');
  }

  async function viewHistory(history: SavedGrouping) {
    const historicalResult = historyResult(history);
    if (!historicalResult) {
      historyError = '这条历史记录内容不完整';
      return;
    }
    result = historicalResult;
    resultHistory = history;
    groupingTitle = groupingHistoryTitle(history) ?? '';
    const input = history.input as Partial<{
      orderMode: GroupingOrderMode;
      orderedNames: unknown[];
      sourceNames: unknown[];
    }>;
    resultOrderMode = input.orderMode === 'input'
      ? 'input'
      : input.orderMode === 'random' ? 'random' : 'rank';
    resultSourceNames = Array.isArray(input.sourceNames)
      ? input.sourceNames.filter((name): name is string => typeof name === 'string')
      : [];
    const savedNames = Array.isArray(input.orderedNames) ? input.orderedNames : input.sourceNames;
    resultOrderedNames = Array.isArray(savedNames)
      ? savedNames.filter((name): name is string => typeof name === 'string')
      : [];
    resultSignature = inputSignature;
    historyStatus = 'saved';
    resetGroupingReveal();
    await tick();
    focusGroupingResult();
  }

  function formatHistoryDate(createdAt: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(createdAt));
  }

  function formatDateTime(value: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  function historyCountLabel(filtered: number, limit: number): string {
    return `${Math.min(limit, filtered)}/${filtered}条`;
  }

  function resetUserForm() {
    editingUserId = null;
    editingRankField = 'name';
    userName = '';
    userAliases = '';
    userNameInput = null;
    userAliasInput = null;
  }

  async function cancelRankedUserEdit() {
    const userId = editingUserId;
    resetUserForm();
    await tick();
    rankingFocusActive = true;
    if (userId !== null && rankedUsers.some((user) => user.id === userId)) {
      await selectRankedUser(userId);
    }
  }

  function handleRankedUserEditCancel(event: KeyboardEvent) {
    if (!isTextEditCancel(event)) return;
    event.preventDefault();
    void cancelRankedUserEdit();
  }

  async function focusRankingAdd() {
    cancelKeyboardRankMove();
    resetUserForm();
    await openDesktopPanel('ranking');
    rankingFocusActive = true;
    await tick();
    document.querySelector<HTMLInputElement>('.rank-person-form input')?.focus({ preventScroll: true });
  }

  async function selectRankedUser(userId: number) {
    selectedRankedUserId = userId;
    rankedUserActionIndex = -1;
    await tick();
    const card = document.querySelector<HTMLElement>(`[data-rank-user-id="${userId}"]`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'nearest' });
  }

  function selectRankedUserFromPointer(userId: number) {
    selectedRankedUserId = userId;
    rankedUserActionIndex = -1;
  }

  function setRankedUserActionFocus(userId: number, index: number) {
    selectedRankedUserId = userId;
    rankedUserActionIndex = index;
  }

  function leaveRankedUserActions(event: FocusEvent) {
    const manager = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    // 保存按钮禁用时浏览器可能临时清空焦点，此时不能把连续添加表单收起。
    if (rankingSaving) return;
    if (next instanceof HTMLElement && next.closest('.desktop-accordion-toggle')) return;
    if (next instanceof Node && manager.contains(next)) return;
    rankingFocusActive = false;
    selectedRankedUserId = null;
    rankedUserActionIndex = -1;
    cancelKeyboardRankMove();
  }

  async function moveRankedUserActionFocus(direction: 'left' | 'right') {
    resetRankSelectionShortcut();
    const userId = selectedRankedUserId;
    if (userId === null) return;
    const card = document.querySelector<HTMLElement>(`[data-rank-user-id="${userId}"]`);
    if (!card) return;
    const actions = [...card.querySelectorAll<HTMLElement>('[data-rank-action]')]
      .filter((action) => !action.matches(':disabled'));
    const nextIndex = nextRankedUserActionIndex(rankedUserActionIndex, direction, actions.length);
    rankedUserActionIndex = nextIndex;
    await tick();
    if (nextIndex < 0) card.focus({ preventScroll: true });
    else actions[nextIndex]?.focus({ preventScroll: true });
  }

  function moveRankedUserSelection(delta: -1 | 1) {
    resetRankSelectionShortcut();
    if (rankedUsers.length === 0) return;
    const currentIndex = rankedUsers.findIndex((user) => user.id === selectedRankedUserId);
    const nextIndex = currentIndex < 0
      ? delta > 0 ? 0 : rankedUsers.length - 1
      : (currentIndex + delta + rankedUsers.length) % rankedUsers.length;
    void selectRankedUser(rankedUsers[nextIndex].id);
  }

  function keyboardRankDropPoints() {
    const sourceId = keyboardMovingUserId ?? selectedRankedUserId;
    return rankedUserKeyboardDropPoints(
      rankedPeople.map((user) => user.id),
      unrankedPeople.map((user) => user.id),
      rankMoveSourceCanSwap(sourceId),
    );
  }

  function keyboardRankDropPointIsNoop(point: ReturnType<typeof keyboardRankDropPoints>[number]): boolean {
    const sourceId = keyboardMovingUserId ?? selectedRankedUserId;
    if (sourceId === null) return false;
    const sourceIndex = rankedPeople.findIndex((user) => user.id === sourceId);
    if (sourceIndex < 0) return false;
    if (point.target.kind === 'swap') return point.target.userId === sourceId;
    if (point.target.kind === 'insert') {
      // 移除源项后插回原位置，或原位置之后，结果都不会改变。
      return point.target.index === sourceIndex || point.target.index === sourceIndex + 1;
    }
    return false;
  }

  function rankMoveSourceCanSwap(userId: number | null): boolean {
    return userId !== null
      && rankedUsers.some((user) => user.id === userId && user.rank < 10_000);
  }

  async function showKeyboardRankDropPoint(index: number) {
    const points = keyboardRankDropPoints();
    if (points.length === 0) return;
    keyboardDropPointIndex = (index + points.length) % points.length;
    const point = points[keyboardDropPointIndex];
    activeRankDropTarget = point.target;
    activeRankDropCardId = point.cardId;
    activeRankDropPosition = point.position === 'unranked' ? null : point.position;
    await tick();
    const target = point.cardId === null
      ? document.querySelector<HTMLElement>('[data-rank-zone="unranked"]')
      : document.querySelector<HTMLElement>(`[data-rank-user-id="${point.cardId}"]`);
    target?.scrollIntoView({ block: 'nearest' });
  }

  function beginKeyboardRankMove() {
    if (rankingReordering || selectedRankedUserId === null) return;
    const points = keyboardRankDropPoints();
    const selected = rankedUsers.find((user) => user.id === selectedRankedUserId);
    const sourcePoint = selected?.rank === 10_000
      ? points.findIndex((point) => point.target.kind === 'unranked')
      : points.findIndex(
        (point) => point.target.kind === 'swap' && point.target.userId === selectedRankedUserId,
      );
    if (sourcePoint < 0) return;
    clearRankDragState();
    resetRankSelectionShortcut();
    keyboardMovingUserId = selectedRankedUserId;
    // 当前项作为移动锚点；上下移动时会跳过当前项的无效落点。
    void showKeyboardRankDropPoint(sourcePoint);
  }

  function moveKeyboardRankDropPoint(delta: -1 | 1) {
    if (keyboardMovingUserId === null) return;
    const points = keyboardRankDropPoints();
    if (points.length === 0) return;
    let nextIndex = keyboardDropPointIndex;
    for (let step = 0; step < points.length; step += 1) {
      nextIndex = (nextIndex + delta + points.length) % points.length;
      if (!keyboardRankDropPointIsNoop(points[nextIndex])) {
        void showKeyboardRankDropPoint(nextIndex);
        return;
      }
    }
  }

  function moveKeyboardRankDropPointByShortcut(key: string) {
    if (keyboardMovingUserId === null) return;
    const points = keyboardRankDropPoints();
    if (points.length === 0) return;

    const now = Date.now();
    const current = now - rankSelectionShortcutAt <= 900 ? rankSelectionShortcutInput : '';
    let next = updateRankShortcutInput(current, key);
    const numberedUsers = rankedUsers.filter((user) => user.rank < 10_000);
    if (/^\d$/u.test(key) && !numberedUsers.some((user) => String(user.rank).startsWith(next))) {
      next = key;
    }
    rankSelectionShortcutInput = next;
    rankSelectionShortcutAt = now;

    const targetUser = numberedUsers.find((user) => String(user.rank) === next)
      ?? numberedUsers.find((user) => String(user.rank).startsWith(next));
    if (!targetUser) return;
    const targetIndex = points.findIndex((point) => (
      point.target.kind === 'swap' && point.target.userId === targetUser.id
    ));
    const fallbackIndex = points.findIndex((point) => (
      point.target.kind === 'insert' && point.target.index === targetUser.rank - 1
    ));
    const pointIndex = targetIndex >= 0 ? targetIndex : fallbackIndex;
    if (pointIndex >= 0 && !keyboardRankDropPointIsNoop(points[pointIndex])) {
      void showKeyboardRankDropPoint(pointIndex);
    }
  }

  function cancelKeyboardRankMove() {
    keyboardMovingUserId = null;
    keyboardDropPointIndex = -1;
    activeRankDropTarget = null;
    activeRankDropCardId = null;
    activeRankDropPosition = null;
  }

  function confirmKeyboardRankMove() {
    const userId = keyboardMovingUserId;
    const point = keyboardRankDropPoints()[keyboardDropPointIndex];
    if (userId === null || !point || keyboardRankDropPointIsNoop(point)) return;
    cancelKeyboardRankMove();
    void moveRankedUser(userId, point.target);
  }

  function toggleKeyboardRankMove() {
    if (keyboardMovingUserId === null) beginKeyboardRankMove();
    else confirmKeyboardRankMove();
  }

  function handleRankingKeydown(event: KeyboardEvent) {
    if (keyboardMovingUserId === null) return;
    if (/^\d$/u.test(event.key) || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      moveKeyboardRankDropPointByShortcut(event.key);
    }
  }

  function keyboardRankDropLabel(): string {
    if (keyboardMovingUserId === null) {
      return rankedUsers.find((user) => user.id === selectedRankedUserId)?.name ?? '选择一项';
    }
    const point = keyboardRankDropPoints()[keyboardDropPointIndex];
    if (!point) return '选择落点';
    if (point.target.kind === 'unranked') return '放到无排名';
    if (point.target.kind === 'insert') {
      if (point.position === 'after') return '插入排名末尾';
      const target = rankedUsers.find((user) => user.id === point.cardId);
      return `插入 ${target?.name ?? `第 ${point.target.index + 1} 位`} 前`;
    }
    if (point.target.kind === 'swap') {
      const targetUserId = point.target.userId;
      const target = rankedUsers.find((user) => user.id === targetUserId);
      return `替换 ${target?.name ?? '当前项'}`;
    }
    return '选择落点';
  }

  async function openDesktopPanel(panel: DesktopPanel) {
    if (panel !== 'ranking') cancelKeyboardRankMove();
    desktopPanel = panel;
    rankingFocusActive = panel === 'ranking';
    if (panel === 'ranking' && rankedUsers.length > 0) {
      await selectRankedUser(selectedRankedUserId ?? rankedUsers[0].id);
    }
  }

  function toggleDesktopPanelShortcut(panel: DesktopPanel) {
    toggleDesktopPanel(panel);
  }

  function otherAliasSummary(user: RankedUser): string {
    const aliases = user.aliases
      .filter((alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'))
      .map((alias) => alias.name);
    return aliases.join('、');
  }

  function hasOtherAliases(user: RankedUser): boolean {
    return user.aliases.some(
      (alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'),
    );
  }

  function beginRankPointerDrag(event: PointerEvent, userId: number) {
    resetRankSelectionShortcut();
    // 鼠标重新选中条目时结束键盘排序，避免两种移动状态互相覆盖。
    cancelKeyboardRankMove();
    selectRankedUserFromPointer(userId);
    if (aliasLinkName !== null || rankingReordering || keyboardMovingUserId !== null || event.button !== 0) return;
    // 名称占据卡片的大部分区域，也应当可以作为拖拽起点；右侧操作按钮仍只执行自身操作。
    if ((event.target as HTMLElement).closest('[data-rank-action], input, textarea, select, form')) return;
    // 阻止浏览器默认点击行为，避免拖拽结束时误触发名称编辑；无拖动时在松开后补焦点。
    event.preventDefault();
    suppressRankNameClickUserId = null;
    pendingRankDragUserId = userId;
    rankDragPointerId = event.pointerId;
    rankDragStartX = event.clientX;
    rankDragStartY = event.clientY;
    rankDragX = event.clientX;
    rankDragY = event.clientY;
    activeRankDropTarget = null;
  }

  function rankDropTargetAt(x: number, y: number): RankedUserDropTarget | null {
    activeRankDropCardId = null;
    activeRankDropPosition = null;
    const pointed = document.elementFromPoint(x, y) as HTMLElement | null;
    const card = pointed?.closest<HTMLElement>('[data-rank-user-id]');
    if (card) {
      const userId = Number(card.dataset.rankUserId);
      if (!Number.isInteger(userId)) return null;
      const rankIndex = Number(card.dataset.rankIndex);
      activeRankDropCardId = userId;
      if (Number.isInteger(rankIndex)) {
        const rect = card.getBoundingClientRect();
        const verticalRatio = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
        const sourceId = draggingUserId ?? pendingRankDragUserId;
        const target = rankedUserDropTargetForCard(
          userId,
          rankIndex,
          verticalRatio,
          rankMoveSourceCanSwap(sourceId),
        );
        activeRankDropPosition = target.kind === 'insert'
          ? target.index === rankIndex ? 'before' : 'after'
          : target.kind === 'swap' ? 'swap' : null;
        return target;
      }
      activeRankDropCardId = null;
      return { kind: 'unranked' };
    }

    const zone = pointed?.closest<HTMLElement>('[data-rank-zone]')?.dataset.rankZone;
    if (zone === 'unranked') return { kind: 'unranked' };
    if (zone === 'ranked') return { kind: 'insert', index: rankedPeople.length };
    return null;
  }

  function moveRankPointerDrag(event: PointerEvent) {
    if (event.pointerId !== rankDragPointerId || pendingRankDragUserId === null) return;
    rankDragX = event.clientX;
    rankDragY = event.clientY;
    if (
      draggingUserId === null
      && Math.hypot(event.clientX - rankDragStartX, event.clientY - rankDragStartY) < 6
    ) return;

    draggingUserId = pendingRankDragUserId;
    suppressRankNameClickUserId = pendingRankDragUserId;
    activeRankDropTarget = rankDropTargetAt(event.clientX, event.clientY);
    event.preventDefault();
  }

  function finishRankPointerDrag(event: PointerEvent) {
    if (event.pointerId !== rankDragPointerId) return;
    const userId = draggingUserId;
    const clickedUserId = pendingRankDragUserId;
    // pointermove 可能被浏览器合并，松手坐标才是最终落点；旧落点只在移出列表时兜底。
    const target = rankDropTargetAt(event.clientX, event.clientY) ?? activeRankDropTarget;
    clearRankDragState();
    if (userId === null && clickedUserId !== null) {
      rankingFocusActive = true;
      document.querySelector<HTMLElement>(`[data-rank-user-id="${clickedUserId}"]`)
        ?.focus({ preventScroll: true });
    }
    if (userId !== null) {
      // pointerup 之后浏览器仍可能派发名称按钮的 click，需要跳过这一次，不能误入编辑。
      event.preventDefault();
      window.setTimeout(() => {
        if (suppressRankNameClickUserId === userId) suppressRankNameClickUserId = null;
      }, 0);
      if (target !== null) void moveRankedUser(userId, target);
    }
  }

  function cancelRankPointerDrag(event: PointerEvent) {
    if (event.pointerId !== rankDragPointerId) return;
    clearRankDragState();
  }

  function clearRankDragState() {
    pendingRankDragUserId = null;
    draggingUserId = null;
    activeRankDropTarget = null;
    activeRankDropCardId = null;
    activeRankDropPosition = null;
    rankDragPointerId = null;
  }

  function handleRankNameClick(user: RankedUser) {
    if (suppressRankNameClickUserId === user.id) {
      suppressRankNameClickUserId = null;
      return;
    }
    void editRankedUser(user, 'name');
  }

  async function moveRankedUser(userId: number, target: RankedUserDropTarget) {
    if (rankingReordering) return;

    rankingReordering = true;
    rankingError = '';
    try {
      rankedUsers = await invoke<RankedUser[]>('move_ranked_user', { draggedId: userId, target });
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法调整选项排名');
      await loadRankedUsers();
    } finally {
      rankingReordering = false;
      clearRankDragState();
    }
  }

  async function saveRankedUser() {
    if (!userName.trim()) return;
    if (editingUserId !== null && editingRankField === 'aliases' && !userAliases.trim()) return;
    const keepAdding = editingUserId === null;
    const editedUserId = editingUserId;
    rankingSaving = true;
    rankingError = '';
    let continueAdding = false;
    try {
      if (editingUserId !== null && editingRankField === 'aliases') {
        await invoke('add_ranked_user_alias', {
          userId: editingUserId,
          alias: userAliases.trim(),
        });
      } else {
        const currentRank = editingUserId === null
          ? 10_000
          : rankedUsers.find((user) => user.id === editingUserId)?.rank ?? 10_000;
        await invoke('save_ranked_user', {
          user: {
            id: editingUserId,
            name: userName.trim(),
            rank: currentRank,
            aliases: [],
          },
        });
      }
      if (keepAdding) {
        userName = '';
        userAliases = '';
      } else {
        resetUserForm();
      }
      await loadRankedUsers();
      await resolveNames();
      continueAdding = keepAdding;
    } catch (reason) {
      rankingError = messageFrom(reason, '无法保存排名选项');
    } finally {
      rankingSaving = false;
      if (continueAdding) {
        rankingFocusActive = true;
        await tick();
        // 只取重新渲染后仍在页面里的输入框，避免旧 bind:this 引用吞掉 focus。
        const input = document.querySelector<HTMLInputElement>('.rank-person-form input');
        input?.focus({ preventScroll: true });
        input?.select();
      } else if (editedUserId !== null && rankedUsers.some((user) => user.id === editedUserId)) {
        rankingFocusActive = true;
        await selectRankedUser(editedUserId);
      }
    }
  }

  function requestDeleteRankedUser(user: RankedUser) {
    cancelKeyboardRankMove();
    selectedRankedUserId = user.id;
    pendingDeleteUser = user;
    rankingError = '';
  }

  function requestClearRankedUserAliases(user: RankedUser) {
    if (!hasOtherAliases(user)) return;
    cancelKeyboardRankMove();
    selectedRankedUserId = user.id;
    pendingAliasClearUser = user;
    rankingError = '';
  }

  function requestClearAllRankings() {
    if (rankedUsers.length === 0 || clearingAllRankings) return;
    cancelKeyboardRankMove();
    clearAllRankingsConfirmation = 1;
    rankingError = '';
  }

  function continueClearAllRankings() {
    if (clearAllRankingsConfirmation === 1) clearAllRankingsConfirmation = 2;
  }

  function cancelClearAllRankings() {
    if (clearingAllRankings) return;
    clearAllRankingsConfirmation = 0;
  }

  async function confirmClearAllRankings() {
    if (clearAllRankingsConfirmation !== 2 || clearingAllRankings) return;
    clearingAllRankings = true;
    rankingError = '';
    try {
      rankedUsers = await invoke<RankedUser[]>('replace_ranked_users', { users: [] });
      clearAllRankingsConfirmation = 0;
      selectedRankedUserId = null;
      resetUserForm();
      cancelKeyboardRankMove();
      await resolveNames();
    } catch (reason) {
      clearAllRankingsConfirmation = 0;
      rankingError = messageFrom(reason, '无法删除全部排名');
      await loadRankedUsers();
    } finally {
      clearingAllRankings = false;
    }
  }

  async function confirmDeleteRankedUser() {
    const user = pendingDeleteUser;
    if (!user || deletingUserId !== null) return;
    deletingUserId = user.id;
    rankingError = '';
    try {
      await invoke('delete_ranked_user', { id: user.id });
      if (editingUserId === user.id) resetUserForm();
      pendingDeleteUser = null;
      await loadRankedUsers();
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法删除排名选项');
    } finally {
      deletingUserId = null;
    }
  }

  async function confirmClearRankedUserAliases() {
    const user = pendingAliasClearUser;
    if (!user || clearingAliasesUserId !== null) return;
    clearingAliasesUserId = user.id;
    rankingError = '';
    try {
      await invoke('clear_ranked_user_aliases', { userId: user.id });
      pendingAliasClearUser = null;
      if (editingUserId === user.id) resetUserForm();
      await loadRankedUsers();
      await resolveNames();
      rankingFocusActive = true;
      if (rankedUsers.some((candidate) => candidate.id === user.id)) {
        await selectRankedUser(user.id);
      }
    } catch (reason) {
      rankingError = messageFrom(reason, '无法删除全部别名');
    } finally {
      clearingAliasesUserId = null;
    }
  }

  function handleGroupingKeydown(event: KeyboardEvent) {
    const target = event.target;
    const battleFocusActive = battlePage
      && target instanceof Node
      && Boolean(groupingResultElement?.contains(target));
    const battleMagicFocusActive = battleFocusActive || (
      battlePage
      && lastConfirmedBattleScore !== null
      && (target === document.body || target === groupingResultElement)
    );
    const key = event.key.toLowerCase();
    if (
      battlePage
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && (target === document.body || target === groupingResultElement)
      && moveFromLastConfirmedBattleScore(event)
    ) return;
    if (
      battleFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && key === 'f'
      && (target === groupingResultElement || target === document.body)
    ) {
      event.preventDefault();
      void setBattleFullscreen(!battleFullscreen);
      return;
    }
    if (
      battleFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && ['g', 'b', 'v', 'n'].includes(key)
    ) {
      event.preventDefault();
      scrollBattleByKey(key);
      return;
    }
    if (
      battlePage
      && event.target === groupingResultElement
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
    ) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>('.battle-result .battle-side input:not(:disabled)')
        ?.focus({ preventScroll: true });
      return;
    }
    if (
      battleMagicFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && key === 's'
      && ['single-elimination', 'avoid-first-pair'].includes(battleTmpSnapshot?.format ?? battleFormat)
    ) {
      event.preventDefault();
      focusBattleScoreGroup('single');
      return;
    }
    if (
      battleMagicFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && key === 'w'
      && (battleTmpSnapshot?.format ?? battleFormat) === 'double-elimination'
    ) {
      event.preventDefault();
      focusBattleScoreGroup('winner');
      return;
    }
    if (
      battleMagicFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && key === 'l'
      && (battleTmpSnapshot?.format ?? battleFormat) === 'double-elimination'
    ) {
      event.preventDefault();
      focusBattleScoreGroup('loser');
      return;
    }
    // 比分输入框按 Esc 后先聚焦当前对战框；再次按 Esc 才回到整个对战区。
    // 全屏对战区也保留这一级返回操作，避免只能用鼠标重新选择对战区。
    const focusedBattleMatch = target instanceof Element
      ? target.closest<HTMLElement>('.battle-match')
      : null;
    if (battlePage && event.key === 'Escape' && focusedBattleMatch) {
      event.preventDefault();
      groupingResultElement?.focus({ preventScroll: true });
      return;
    }
    if (battleFullscreen && battleFocusActive) return;
    if (target === sourceTextarea && isMultilineTextConfirm(event)) {
      event.preventDefault();
      void confirmSourceText();
      return;
    }
    if (target === sourceTextarea && isTextEditCancel(event)) {
      event.preventDefault();
      sourceText = confirmedSourceText;
      (target as HTMLTextAreaElement).blur();
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'text' && isSingleLineTextConfirm(event)) {
      event.preventDefault();
      if (target.form) target.form.requestSubmit();
      else target.blur();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (importErrorDialog) {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        importErrorDialog = null;
      }
      return;
    }

    if (pendingDatabaseImport) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingDatabaseImport = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmDatabaseImport();
      }
      return;
    }

    if (pendingBattleLoad) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingBattleLoad = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmBattleLoad();
      }
      return;
    }

    if (clearGroupingConfirmation) {
      if (event.key === 'Escape') {
        event.preventDefault();
        // 第三次确认的取消按钮只保留设置和名单，但仍必须清空当前对战区。
        if (battlePage && clearGroupingConfirmation === 3) void cancelClearAll();
        else clearGroupingConfirmation = 0;
      } else if (key === 'n') {
        event.preventDefault();
        void cancelClearAll();
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmClearAll();
      }
      return;
    }

    if (battleHistoryDeleteConfirmation) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        battleHistoryDeleteConfirmation = 0;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmClearBattleHistories();
      }
      return;
    }

    if (pendingBattleHistoryDeletion) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingBattleHistoryDeletion = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmDeleteBattleHistory();
      }
      return;
    }

    if (pendingGroupingHistoryDeletion) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingGroupingHistoryDeletion = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmGroupingHistoryDeletion();
      }
      return;
    }

    if (pendingRankingImport) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingRankingImport = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmRankingImport();
      }
      return;
    }

      if (businessRuntime && clearAllRankingsConfirmation !== 0) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        cancelClearAllRankings();
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        if (clearAllRankingsConfirmation === 1) continueClearAllRankings();
        else void confirmClearAllRankings();
      }
      return;
    }

      if (businessRuntime && (pendingDeleteUser || pendingAliasClearUser)) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingDeleteUser = null;
        pendingAliasClearUser = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        if (pendingDeleteUser) void confirmDeleteRankedUser();
        else void confirmClearRankedUserAliases();
      }
      return;
    }

    if (aliasLinkName !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelAliasLink();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveRankedUserSelection(event.key === 'ArrowUp' ? -1 : 1);
      } else if (event.code === 'Space') {
        event.preventDefault();
        void confirmAliasLink();
      } else if (event.key === 'Enter') {
        // 位置型操作统一使用空格，关联模式下禁用回车的按钮默认激活行为。
        event.preventDefault();
      } else if (/^\d$/u.test(event.key) || event.key === 'Backspace') {
        event.preventDefault();
        updateAliasLinkRankShortcut(event.key);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (keyboardMovingUserId !== null) {
        cancelKeyboardRankMove();
        return;
      }
      const hadLocalOperation = editingUserId !== null
        || selectedRankedUserId !== null
        || rankingFocusActive
        || insertIndex !== null
        || pendingRankDragUserId !== null
        || draggingUserId !== null;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      cancelPreviewInsertion();
      resetUserForm();
      selectedRankedUserId = null;
      rankedUserActionIndex = -1;
      resetRankSelectionShortcut();
      clearRankDragState();
      if (!hadLocalOperation && businessRuntime) desktopPanel = null;
      return;
    }

    if (isTextEditingTarget(event.target)) return;
    if (battlePage && battleFullscreen && ['a', 'z'].includes(key)) {
      event.preventDefault();
      return;
    }
    if (key === 'x') {
      event.preventDefault();
      cancelKeyboardRankMove();
      focusGroupingResult();
      return;
    }
    if (key === 'w') {
      event.preventDefault();
      sourceTextarea?.focus({ preventScroll: true });
      return;
    }
    if (battleFocusActive) return;
    if (!businessRuntime) return;
    if (key === 'n') {
      event.preventDefault();
      void focusRankingAdd();
      return;
    }
    if (key === 'a') {
      event.preventDefault();
      toggleDesktopPanelShortcut('ranking');
      return;
    }
    if (key === 'z') {
      event.preventDefault();
      toggleDesktopPanelShortcut('history');
      return;
    }
    if (desktopPanel !== 'ranking') {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        document.querySelector<HTMLElement>('.desktop-accordion.open .desktop-accordion-content')
          ?.scrollBy({ top: event.key === 'ArrowUp' ? -240 : 240, behavior: 'smooth' });
      }
      return;
    }
    if (keyboardMovingUserId !== null) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveKeyboardRankDropPoint(event.key === 'ArrowUp' ? -1 : 1);
      } else if (/^\d$/u.test(event.key) || event.key === 'Backspace') {
        event.preventDefault();
        moveKeyboardRankDropPointByShortcut(event.key);
      } else if (event.code === 'Space') {
        event.preventDefault();
        confirmKeyboardRankMove();
      } else if (event.key === 'Enter') {
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
      void moveRankedUserActionFocus(direction);
      return;
    }
    if (rankingFocusActive && (/^\d$/u.test(event.key) || event.key === 'Backspace')) {
      event.preventDefault();
      // 数字快捷键只用于选择源项；鼠标或键盘移动进行中不切换源项，
      // 否则会让当前落点与拖拽源不一致，导致空格无法提交。
      if (pendingRankDragUserId !== null || draggingUserId !== null) return;
      updateRankSelectionShortcut(event.key);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveRankedUserSelection(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (rankedUserActionIndex >= 0) {
      // 操作按钮保留原生空格/回车点击，上下切换后由整条接管焦点。
      return;
    }

    const selected = rankedUsers.find((user) => user.id === selectedRankedUserId);
    if (!selected) return;
    if (event.code === 'Space') {
      event.preventDefault();
      beginKeyboardRankMove();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void editRankedUser(selected, 'name');
    } else if (key === 's') {
      event.preventDefault();
      void editRankedUser(selected, 'aliases');
    } else if (key === 'd') {
      event.preventDefault();
      requestDeleteRankedUser(selected);
    } else if (key === 'f') {
      event.preventDefault();
      requestClearRankedUserAliases(selected);
    }
  }

  function scrollBattleByKey(key: string) {
    if (!groupingResultElement) return;
    if (key === 'v' || key === 'n') {
      const scroller = groupingResultElement.querySelector<HTMLElement>(
        '.double-battle-scroll, .single-battle-bracket, .battle-bracket',
      );
      scroller?.scrollBy({
        left: (key === 'v' ? -1 : 1) * 36,
        behavior: 'smooth',
      });
      return;
    }
    groupingResultElement.scrollBy({
      top: (key === 'g' ? -1 : 1) * 36,
      behavior: 'smooth',
    });
  }

  function focusBattleScoreGroup(group: BattleScoreGroup) {
    if (!groupingResultElement) return;
    const selector = group === 'single'
      ? '.single-battle-bracket .battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"]) input:not(:disabled)'
      : `.double-${group}-section .battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"]) input:not(:disabled)`;
    const inputs = [...groupingResultElement.querySelectorAll<HTMLInputElement>(selector)];
    // 魔法键按“未填写优先、层级优先、签位顺序”找目标，不能让左侧已完成的首轮把右侧首轮空位挤掉。
    const orderedInputs = inputs
      .map((input, index) => ({
        input,
        index,
        empty: input.value.trim() === '',
        level: Number(input.closest<HTMLElement>('.battle-match')?.dataset.battleLevel) || Number.MAX_SAFE_INTEGER,
        position: Number(input.closest<HTMLElement>('.battle-match')?.dataset.battlePosition) || Number.MAX_SAFE_INTEGER,
        side: input.dataset.battleSide === 'down' ? 1 : 0,
      }))
      .sort((left, right) => (
        Number(right.empty) - Number(left.empty)
        || left.level - right.level
        || left.position - right.position
        || left.side - right.side
        || left.index - right.index
      ));
    const target = orderedInputs[0]?.input;
    if (!target && battleSyncStatus === 'saving') {
      pendingBattleScoreGroup = group;
      return;
    }
    pendingBattleScoreGroup = null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  async function focusPendingBattleScoreGroup() {
    const group = pendingBattleScoreGroup;
    if (!group) return;
    pendingBattleScoreGroup = null;
    await tick();
    focusBattleScoreGroup(group);
  }

  function handleBattleMatchKeydown(event: KeyboardEvent) {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.shiftKey
      || isTextEditingTarget(event.target)
    ) return;
    const current = event.currentTarget as HTMLElement;
    const currentInputs = [...current.querySelectorAll<HTMLInputElement>(
      '.battle-side input:not(:disabled)',
    )];
    // 对战框本身获得焦点时，上下键先进入框内对应一侧，保持键盘入口稳定。
    const target = event.key === 'ArrowUp'
      ? currentInputs[0]
      : event.key === 'ArrowDown'
        ? currentInputs.at(-1) ?? null
        : closestBattleElement(
            current,
            [...document.querySelectorAll<HTMLInputElement>('.battle-result .battle-side input:not(:disabled)')],
            event.key,
          );
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function closestBattleElement<T extends HTMLElement>(
    current: HTMLElement,
    candidates: T[],
    key: string,
  ): T | null {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const currentMatch = current.closest<HTMLElement>('.battle-match');
      const targetSide = key === 'ArrowUp' ? 'up' : 'down';
      const currentSide = current.dataset.battleSide;
      if (currentMatch && currentSide !== targetSide) {
        const sameMatchTarget = candidates.find((candidate) => (
          candidate.closest('.battle-match') === currentMatch
          && candidate.dataset.battleSide === targetSide
        ));
        if (sameMatchTarget) return sameMatchTarget;
      }
    }
    const logicalSingleTarget = closestSingleBattleVerticalElement(current, candidates, key);
    if (logicalSingleTarget) return logicalSingleTarget;
    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };
    const direction = key.replace('Arrow', '').toLocaleLowerCase('zh-CN');
    const entries = candidates
      .filter((candidate) => candidate !== current)
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const dx = center.x - currentCenter.x;
        const dy = center.y - currentCenter.y;
        const inDirection = direction === 'left' ? dx < -8
          : direction === 'right' ? dx > 8
            : direction === 'up' ? dy < -8
              : dy > 8;
        const horizontal = direction === 'left' || direction === 'right';
        const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
        const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
        return { candidate, inDirection, distance: primary + secondary * 0.55 };
      });
    const directional = entries
      .filter((entry) => entry.inDirection)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    if (directional) return directional;

    // 边缘没有同向目标时绕到另一侧，保证每个输入框都能到达。
    return entries
      .sort((left, right) => {
        const leftRect = left.candidate.getBoundingClientRect();
        const rightRect = right.candidate.getBoundingClientRect();
        const leftAxis = direction === 'left' || direction === 'right'
          ? leftRect.left + leftRect.width / 2
          : leftRect.top + leftRect.height / 2;
        const rightAxis = direction === 'left' || direction === 'right'
          ? rightRect.left + rightRect.width / 2
          : rightRect.top + rightRect.height / 2;
        const edgeOrder = direction === 'left' || direction === 'up'
          ? rightAxis - leftAxis
          : leftAxis - rightAxis;
        return edgeOrder || left.distance - right.distance;
      })[0]?.candidate ?? null;
  }

  function closestSingleBattleVerticalElement<T extends HTMLElement>(
    current: HTMLElement,
    candidates: T[],
    key: string,
  ): T | null {
    if (!['ArrowUp', 'ArrowDown'].includes(key)) return null;
    const currentMatch = current.closest<HTMLElement>('.single-battle-bracket .battle-match[data-battle-stage="single"]');
    const level = currentMatch?.dataset.battleLevel;
    if (!currentMatch || !level) return null;
    const levelInputs = candidates
      .filter((candidate) => {
        const match = candidate.closest<HTMLElement>('.battle-match[data-battle-stage="single"]');
        return match?.dataset.battleLevel === level;
      })
      .sort((left, right) => {
        const leftMatch = left.closest<HTMLElement>('.battle-match')!;
        const rightMatch = right.closest<HTMLElement>('.battle-match')!;
        const positionDifference = Number(leftMatch.dataset.battlePosition) - Number(rightMatch.dataset.battlePosition);
        if (positionDifference !== 0) return positionDifference;
        const leftSide = left.dataset.battleSide === 'down' ? 1 : 0;
        const rightSide = right.dataset.battleSide === 'down' ? 1 : 0;
        return leftSide - rightSide;
      });
    if (levelInputs.length === 0) return null;
    const currentInputIndex = levelInputs.findIndex((input) => input === current);
    if (currentInputIndex >= 0) {
      const offset = key === 'ArrowUp' ? -1 : 1;
      return levelInputs[(currentInputIndex + offset + levelInputs.length) % levelInputs.length] ?? null;
    }
    const currentPosition = Number(currentMatch.dataset.battlePosition);
    const targetPosition = currentPosition + (key === 'ArrowUp' ? -1 : 1);
    const positions = [...new Set(levelInputs.map((input) => Number(
      input.closest<HTMLElement>('.battle-match')?.dataset.battlePosition,
    )))].sort((left, right) => left - right);
    const wrappedPosition = positions.includes(targetPosition)
      ? targetPosition
      : key === 'ArrowUp' ? positions.at(-1) : positions[0];
    return levelInputs.find((input) => Number(
      input.closest<HTMLElement>('.battle-match')?.dataset.battlePosition,
    ) === wrappedPosition) ?? null;
  }

  function moveFromLastConfirmedBattleScore(event: KeyboardEvent): boolean {
    const remembered = lastConfirmedBattleScore;
    if (!remembered) return false;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.battle-result .battle-side input')];
    const current = inputs.find((input) => (
      input.dataset.battleMatchId === remembered.matchId
      && input.dataset.battleSide === remembered.side
    ));
    if (!current) {
      lastConfirmedBattleScore = null;
      return false;
    }
    event.preventDefault();
    const enabledInputs = inputs.filter((input) => !input.disabled);
    const next = closestBattleElement(current, enabledInputs, event.key);
    const target = next ?? (!current.disabled ? current : enabledInputs[0]);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    return true;
  }

  function handleBattleScoreFocus(event: FocusEvent) {
    const target = event.target instanceof HTMLInputElement
      ? event.target
      : event.currentTarget as HTMLInputElement;
    battleScoreFocusValues.set(target, target.value);
  }

  function handleBattleScoreKeydown(
    match: BattleTmpMatch,
    side: 'up' | 'down',
    event: KeyboardEvent,
  ) {
    if (event.defaultPrevented) return;
    const target = event.target instanceof HTMLInputElement
      ? event.target
      : event.currentTarget as HTMLInputElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      target.value = battleScoreFocusValues.get(target) ?? target.defaultValue;
      target.blur();
      target.closest<HTMLElement>('.battle-match')?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (target.value.trim() === '') target.value = '0';
      battleScoreFocusValues.set(target, target.value);
      lastConfirmedBattleScore = { matchId: match.matchId, side };
      void updateBattleScore(match, side, event);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (target.value.trim() === '') target.value = '0';
      else if (event.key === 'ArrowUp') target.stepUp();
      else target.stepDown();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = closestBattleElement(
      target,
      [...document.querySelectorAll<HTMLInputElement>('.battle-result .battle-side input:not(:disabled)')],
      event.key,
    );
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function requestClearAll() {
    if (!battlePage) {
      if (sourceText || confirmedSourceText) clearGroupingConfirmation = 1;
      return;
    }
    if (battleTmpSnapshot && battleHistorySaved) {
      void clearAll(false);
      return;
    }
    if (battleTmpSnapshot) clearGroupingConfirmation = 1;
  }

  function clearConfirmationTitle(step: 0 | 1 | 2 | 3): string {
    if (!battlePage) return '同时清空名单预览？';
    if (step === 1) return '1/3 删除当前签表和全部比分？';
    if (step === 2) {
      return nativeRuntime ? '2/3 直接删除桌面对战临时表？' : '2/3 放弃当前页面的对战状态？';
    }
    return '3/3 是否同时清空设置和名单？';
  }

  function clearConfirmationDetail(step: 0 | 1 | 2 | 3): string {
    if (!battlePage) return '名单、名单预览和当前分组结果都会清空。';
    if (step === 1) {
      return '胜者组、败者组、总决赛以及已经录入的所有比分都会一起删除。';
    }
    if (step === 2) {
      return nativeRuntime
        ? '删除后即使关闭并重新启动软件，也无法恢复这场对战。'
        : '清空后当前签表不会保留，刷新页面也无法恢复。';
    }
    return '无论选择哪一项，当前签表和临时表都会删除；只决定是否重置对战设置和名单。';
  }

  function clearConfirmationAction(step: 0 | 1 | 2 | 3): string {
    if (!battlePage) return '确认清空';
    if (step === 1) return '删除签表和比分';
    if (step === 2) return nativeRuntime ? '删除临时表' : '放弃当前对战';
    return '清空设置和名单';
  }

  async function confirmClearAll() {
    if (clearingBattleTmp) return;
    if (battlePage && clearGroupingConfirmation < 3) {
      clearGroupingConfirmation = (clearGroupingConfirmation + 1) as 2 | 3;
      return;
    }
    await clearAll(true);
  }

  async function cancelClearAll() {
    if (clearingBattleTmp) return;
    if (battlePage && clearGroupingConfirmation === 3) {
      await clearAll(false);
      return;
    }
    clearGroupingConfirmation = 0;
  }

  async function clearAll(clearBattleSetup = true) {
    if (battlePage) {
      if (businessRuntime) {
        clearingBattleTmp = true;
        try {
          await invoke('clear_battle_tmp_state', { variant });
        } catch (reason) {
          battleSyncStatus = 'error';
          error = messageFrom(reason, '无法清空对战临时状态');
          return;
        } finally {
          clearingBattleTmp = false;
        }
      }
      clearGroupingConfirmation = 0;
      battleTmpSnapshot = null;
      battleTmpAvailable = false;
      battleHistorySaved = false;
      clearedBattlePreviewSignature = clearBattleSetup ? null : battlePreviewSignature;
      resetBattleReveal();
      lastConfirmedBattleScore = null;
      pendingBattleScoreGroup = null;
      battleSyncStatus = 'idle';
      error = '';
      if (clearBattleSetup) {
        sourceText = '';
        confirmedSourceText = '';
        resolutionRequest += 1;
        resolvedNames = [];
        resolvingNames = false;
        battleFormat = 'avoid-first-pair';
        battleOrderMode = 'input';
        battleFixedSeedCount = 0;
        battleDoubleGrandFinal = false;
      }
      return;
    }
    clearGroupingConfirmation = 0;
    sourceText = '';
    confirmedSourceText = '';
    resolutionRequest += 1;
    resolvedNames = [];
    resolvingNames = false;
    result = null;
    resultHistory = null;
    error = '';
    historyStatus = 'idle';
  }

  function focusGroupingResult() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    groupingResultElement?.focus({ preventScroll: true });
    groupingResultElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function createBattlePreviewSnapshot(
    isBattlePage: boolean,
    currentSnapshot: BattleTmpSnapshot | null,
    currentVariant: AppVariant,
    format: BattleFormat,
    orderMode: BattleOrderMode,
    orderedNames: readonly string[],
    fixedSeedCount: number,
    doubleGrandFinal: boolean,
    caimiRankScores: readonly number[] | undefined,
  ): BattleTmpSnapshot | null {
    if (
      !isBattlePage
      || currentSnapshot
      || format === 'avoid-first-pair'
      || orderedNames.length < 4
    ) return null;
    try {
      return createBattleTmpSnapshot(currentVariant, createSeededBattlePlan(orderedNames, {
        format,
        orderMode,
        fixedSeedCount,
        doubleGrandFinal,
        caimiRankScores,
        // 预览只显示固定签位，未固定项的随机次序不会暴露。
        random: () => 0.5,
      }), 1);
    } catch {
      return null;
    }
  }

  function battleTmpFormatLabel(format: BattleFormat): string {
    if (format === 'avoid-first-pair') return '同组不对战1对2';
    if (format === 'single-elimination') return '单败';
    return '双败';
  }

  async function updateBattleScore(match: BattleTmpMatch, side: 'up' | 'down', event: Event) {
    const target = event.target instanceof HTMLInputElement
      ? event.target
      : event.currentTarget as HTMLInputElement;
    const score = target.value.trim() === '' ? null : Number(target.value);
    if (score !== null && (!Number.isSafeInteger(score) || score < 0)) {
      error = '对战比分必须是非负整数';
      target.value = String(side === 'up' ? match.upResult ?? '' : match.downResult ?? '');
      return;
    }
    if (
      !battleTmpSnapshot
      || battleSyncStatus === 'saving'
      || match.up === null
      || match.down === null
      || match.status === 'pending'
      || match.status === 'skipped'
    ) return;
    const { upResult, downResult } = battleTmpScoresWithMagicFill(
      battleTmpSnapshot,
      match.matchId,
      side,
      score,
    );
    const next = updateBattleTmpResult(battleTmpSnapshot, match.matchId, upResult, downResult);
    battleTmpSnapshot = next;
    battleHistorySaved = false;
    if (!businessRuntime) return;
    battleSyncStatus = 'saving';
    try {
      const saved = await invoke<unknown>('update_battle_tmp_result', {
        variant,
        matchId: match.matchId,
        upResult,
        downResult,
        updatedAt: next.updatedAt,
      });
      battleTmpSnapshot = parseBattleTmpSnapshot(saved, variant);
      battleSyncStatus = 'saved';
      error = '';
    } catch (reason) {
      const syncError = messageFrom(reason, '无法同步对战结果');
      battleSyncStatus = 'error';
      const restored = await loadBattleTmpState();
      if (restored) {
        battleSyncStatus = 'error';
        error = syncError;
      }
    } finally {
      await focusPendingBattleScoreGroup();
    }
  }

  async function exportBattleTmpJson() {
    if (!battleTmpSnapshot || battleExporting) return;
    battleExporting = 'json';
    try {
      await downloadFormattedJson('对战状态', battleTmpSnapshot);
      error = '';
    } catch (reason) {
      error = messageFrom(reason, '无法导出对战状态 JSON');
    } finally {
      battleExporting = null;
    }
  }

  async function exportBattleTmpExcel() {
    if (!battleTmpSnapshot || battleExporting) return;
    battleExporting = 'excel';
    try {
      await downloadExcelBytes(battleTitle.trim() || '对战签表', await createBattleBracketWorkbook(battleTmpSnapshot));
      error = '';
    } catch (reason) {
      error = messageFrom(reason, '无法导出对战签表 Excel');
    } finally {
      battleExporting = null;
    }
  }

  function showImportError(title: string, detail: string) {
    importErrorDialog = { title, detail };
  }

  function messageFrom(reason: unknown, fallback: string): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' && reason ? reason : fallback;
  }
</script>

<svelte:window
  on:keydown={handleGroupingKeydown}
  on:pointermove={moveRankPointerDrag}
  on:pointerup={finishRankPointerDrag}
  on:pointercancel={cancelRankPointerDrag}
/>

<main class:battle-page={battlePage} class:battle-fullscreen-active={battleFullscreen} class="grouping-page app-page-frame" id={battlePage ? 'battle' : 'grouping'} aria-keyshortcuts={battlePage ? 'A Z X W S L F G B V N' : undefined}>
  <!-- Web 端也启用了完整业务工作区，宽屏布局需要与 Tauri 保持一致。 -->
  <div class:battle-workbench={battlePage} class:desktop={desktopRuntime || businessRuntime} class:web-layout={!desktopRuntime && businessRuntime} class="grouping-workbench">
    {#if businessRuntime}
      <aside class:battle-sidebar={battlePage} class:ranking-open={desktopPanel === 'ranking'} class:history-open={desktopPanel === 'history'} class="grouping-sidebar">
        <section class:open={desktopPanel === 'ranking'} class="desktop-accordion">
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('ranking')}>
            <span>排名</span><strong>{rankedUsers.length} 项</strong><i>{desktopPanel === 'ranking' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'ranking'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div role="region" aria-label="排名管理" class:dragging={draggingUserId !== null} class:keyboard-moving={keyboardMovingUserId !== null} class:reordering={rankingReordering} class="desktop-accordion-content rank-manager" on:focusin={() => (rankingFocusActive = true)} on:focusout={leaveRankedUserActions} on:keydown={handleRankingKeydown}>
              {#if rankingError}
                <div class="ranking-error" role="alert">{rankingError}</div>
                {#if isDatabaseFileError(rankingError)}
                  <UiButton size="xs" tone="danger" on:click={openGroupingDatabaseFolder}>打开文件夹</UiButton>
                {/if}
              {/if}
              <input bind:this={rankingFileInput} class="grouping-file-input" type="file" accept=".json,application/json" on:change={readRankingFile} />
              <input bind:this={databaseFileInput} class="grouping-file-input" type="file" accept=".sqlite,.sqlite3,application/vnd.sqlite3" on:change={readDatabaseFile} />
              {#if rankingFocusActive}
                <div class="ranking-transfer-actions">
                  <UiButton size="xs" disabled={rankedUsers.length === 0} on:click={exportRanking}>导出 JSON</UiButton>
                  {#if nativeRuntime}
                    <UiButton size="xs" on:click={openGroupingDownloadFolder}>打开下载</UiButton>
                  {:else}
                    <UiButton size="xs" on:click={openGroupingDatabaseFolder}>导出 SQLite</UiButton>
                    <UiButton size="xs" disabled={databaseImporting} on:click={openDatabaseImporter}>导入 SQLite</UiButton>
                  {/if}
                  <UiButton
                    size="xs"
                    title={rankedUsers.length > 0 ? '全部删除后才可导入' : '导入排名 JSON'}
                    disabled={rankedUsers.length > 0 || rankingImporting}
                    on:click={openRankingImporter}
                  >导入 JSON</UiButton>
                  <UiButton size="xs" tone="danger" disabled={rankedUsers.length === 0 || clearingAllRankings} on:click={requestClearAllRankings}>删除全部</UiButton>
                </div>
                {#if aliasLinkName !== null}
                  <div class="rank-keyboard-order active alias-link-order">
                    <span><strong>关联 {aliasLinkName}</strong><small>{rankedUsers.find((user) => user.id === selectedRankedUserId)?.name ?? '选择一项'}{aliasLinkRankInput ? ` · 排名 ${aliasLinkRankInput}` : ''}</small></span>
                    <button type="button" aria-keyshortcuts="Space" disabled={selectedRankedUserId === null || rankingSaving} on:click={confirmAliasLink}>确认</button>
                    <button type="button" class="cancel-rank-move" aria-keyshortcuts="Escape" on:click={cancelAliasLink}>取消</button>
                  </div>
                {:else}
                  <div class:active={keyboardMovingUserId !== null} class="rank-keyboard-order">
                    <span>
                      <strong>{keyboardMovingUserId === null ? '键盘排序' : rankedUsers.find((user) => user.id === keyboardMovingUserId)?.name}</strong>
                      <small>{keyboardRankLabel}</small>
                    </span>
                    <button type="button" disabled={selectedRankedUserId === null || rankingReordering} on:click={toggleKeyboardRankMove}>{keyboardMovingUserId === null ? '选中' : '放下'}</button>
                    {#if keyboardMovingUserId !== null}<button type="button" class="cancel-rank-move" on:click={cancelKeyboardRankMove}>取消</button>{/if}
                  </div>
                {/if}
              {/if}
              <div class="ranked-user-list">
                {#if rankingLoading}
                  <p>正在读取排名表…</p>
                {:else}
                  <section class="rank-zone" data-rank-zone="ranked">
                    {#if rankedPeople.length === 0}
                      <div class:active={activeRankDropTarget?.kind === 'insert'} class="empty-ranked-drop">拖入排名</div>
                    {/if}
                    {#each rankedPeople as user, index (user.id)}
                      <!-- 卡片上下两区分别表示前插和后插。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        tabindex="-1"
                        class:keyboard-selected={selectedRankedUserId === user.id}
                        class:insert-before={activeRankDropCardId === user.id && activeRankDropPosition === 'before'}
                        class:replace-target={activeRankDropCardId === user.id && activeRankDropPosition === 'swap'}
                        class:insert-after={activeRankDropCardId === user.id && activeRankDropPosition === 'after'}
                        class:drag-source={rankMoveSourceId === user.id}
                        data-rank-user-id={user.id}
                        data-rank-index={index}
                        on:focus={() => selectRankedUserFromPointer(user.id)}
                        on:pointerdown={(event) => beginRankPointerDrag(event, user.id)}
                      >
                        <span class="rank-number"><span>{user.rank}</span></span>
                        <div class="ranked-user-content">
                          {#if editingUserId === user.id}
                            <form class="inline-rank-edit" on:submit|preventDefault={saveRankedUser}>
                              <div>
                                {#if editingRankField === 'name'}
                                  <input bind:this={userNameInput} maxlength="80" required bind:value={userName} aria-label="修改名称" on:keydown|stopPropagation={handleRankedUserEditCancel} />
                                {:else}
                                  <strong>{userName}</strong>
                                {/if}
                                <span><button type="submit" aria-label="保存">✓</button><button type="button" aria-label="取消" on:click={() => void cancelRankedUserEdit()}>×</button></span>
                              </div>
                              {#if editingRankField === 'aliases'}
                                <input bind:this={userAliasInput} bind:value={userAliases} maxlength="80" required aria-label="添加新别名" placeholder="输入新别名" on:keydown|stopPropagation={handleRankedUserEditCancel} />
                              {:else}
                                <small>{otherAliasSummary(user)}</small>
                              {/if}
                            </form>
                          {:else}
                            <div
                              class="ranked-user-heading"
                              class:actions-active={selectedRankedUserId === user.id && rankedUserActionIndex >= 0}
                            >
                              <button type="button" class="user-name" on:click={() => handleRankNameClick(user)}>{user.name}</button>
                              <div class="ranked-user-actions">
                                <button type="button" class="alias-action" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 0)} on:click={() => editRankedUser(user, 'aliases')}>添加别名</button>
                                <button type="button" class="delete-user" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 1)} on:click={() => requestDeleteRankedUser(user)}>删除</button>
                                {#if hasOtherAliases(user)}
                                  <button type="button" class="clear-aliases" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 2)} on:click={() => requestClearRankedUserAliases(user)}>删除全部别名</button>
                                {/if}
                              </div>
                            </div>
                            <div class="ranked-user-aliases">
                              <small>{otherAliasSummary(user)}</small>
                            </div>
                          {/if}
                        </div>
                        {#if rankMoveSourceId !== null && rankMoveSourceId !== user.id}
                          <div class:insert-only={!rankMoveSwapAllowed} class="rank-drop-guides" aria-hidden="true">
                            <i></i>{#if rankMoveSwapAllowed}<i></i>{/if}<i></i>
                          </div>
                        {/if}
                      </article>
                    {/each}
                  </section>

                  <section
                    class:drop-active={activeRankDropTarget?.kind === 'unranked'}
                    class="rank-zone unranked-zone"
                    data-rank-zone="unranked"
                  >
                    <div class="rank-zone-heading"><strong>无排名</strong><span>{unrankedPeople.length}</span></div>
                    {#each unrankedPeople as user (user.id)}
                      <!-- 卡片整体提供桌面拖拽，内部按钮保留独立操作。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        tabindex="-1"
                        class:keyboard-selected={selectedRankedUserId === user.id}
                        class:drag-source={rankMoveSourceId === user.id}
                        data-rank-user-id={user.id}
                        on:focus={() => selectRankedUserFromPointer(user.id)}
                        on:pointerdown={(event) => beginRankPointerDrag(event, user.id)}
                      >
                        <span class="rank-number">—</span>
                        <div class="ranked-user-content">
                          {#if editingUserId === user.id}
                            <form class="inline-rank-edit" on:submit|preventDefault={saveRankedUser}>
                              <div>
                                {#if editingRankField === 'name'}
                                  <input bind:this={userNameInput} maxlength="80" required bind:value={userName} aria-label="修改名称" on:keydown|stopPropagation={handleRankedUserEditCancel} />
                                {:else}
                                  <strong>{userName}</strong>
                                {/if}
                                <span><button type="submit" aria-label="保存">✓</button><button type="button" aria-label="取消" on:click={() => void cancelRankedUserEdit()}>×</button></span>
                              </div>
                              {#if editingRankField === 'aliases'}
                                <input bind:this={userAliasInput} bind:value={userAliases} maxlength="80" required aria-label="添加新别名" placeholder="输入新别名" on:keydown|stopPropagation={handleRankedUserEditCancel} />
                              {:else}
                                <small>{otherAliasSummary(user)}</small>
                              {/if}
                            </form>
                          {:else}
                            <div
                              class="ranked-user-heading"
                              class:actions-active={selectedRankedUserId === user.id && rankedUserActionIndex >= 0}
                            >
                              <button type="button" class="user-name" on:click={() => handleRankNameClick(user)}>{user.name}</button>
                              <div class="ranked-user-actions">
                                <button type="button" class="alias-action" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 0)} on:click={() => editRankedUser(user, 'aliases')}>添加别名</button>
                                <button type="button" class="delete-user" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 1)} on:click={() => requestDeleteRankedUser(user)}>删除</button>
                                {#if hasOtherAliases(user)}
                                  <button type="button" class="clear-aliases" data-rank-action on:focus={() => setRankedUserActionFocus(user.id, 2)} on:click={() => requestClearRankedUserAliases(user)}>删除全部别名</button>
                                {/if}
                              </div>
                            </div>
                            <div class="ranked-user-aliases">
                              <small>{otherAliasSummary(user)}</small>
                            </div>
                          {/if}
                        </div>
                      </article>
                    {/each}
                  </section>
                {/if}
              </div>
              {#if rankingFocusActive && editingUserId === null}
              <form class="rank-person-form" on:submit|preventDefault={saveRankedUser}>
                <div class="rank-form-heading">
                  <strong>添加</strong>
                </div>
                <label><span>名称</span><input bind:this={userNameInput} maxlength="80" required bind:value={userName} placeholder="名称" /></label>
                <button type="submit" class="save-user" aria-keyshortcuts="Enter" disabled={rankingSaving || !userName.trim()}>{rankingSaving ? '保存中…' : '保存'}</button>
              </form>
              {/if}
            </div>
          {/if}
        </section>

        <section class:open={desktopPanel === 'history'} class="desktop-accordion">
          <button
            type="button"
            class="desktop-accordion-toggle"
            aria-expanded={desktopPanel === 'history'}
            on:click={() => toggleDesktopPanel('history')}
          >
            <span>{battlePage ? '对战历史' : '分组历史'}</span><strong>{battlePage
              ? historyCountLabel(filteredBattleHistories.length, BATTLE_HISTORY_DISPLAY_LIMIT)
              : historyCountLabel(filteredGroupingHistories.length, GROUPING_HISTORY_DISPLAY_LIMIT)}</strong><i>{desktopPanel === 'history' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'history'}
            {#if battlePage}
              <div class="desktop-accordion-content history-panel">
                <input bind:this={battleHistoryFileInput} class="grouping-file-input" type="file" accept=".json,application/json" on:change={importBattleHistoryFile} />
                <UiHistoryPanel
                  bind:start={battleHistoryStart}
                  bind:end={battleHistoryEnd}
                  empty={visibleBattleHistories.length === 0}
                  emptyText="日期范围内没有对战记录"
                >
                    {#each visibleBattleHistories as history (history.id)}
                      <UiHistoryRow
                        eyebrow={formatHistoryDate(history.createdAt)}
                        title={history.title ?? `${history.snapshot.participantCount} 人 · ${battleTmpFormatLabel(history.snapshot.format)}`}
                        hint="查看比赛 →"
                        active={battleHistoryView?.id === history.id}
                        on:select={() => viewBattleHistory(history)}
                      >
                        <UiButton size="xs" disabled={battleLoadingTarget} on:click={() => requestBattleLoad({ kind: 'history', history })}>编辑</UiButton>
                        <UiButton size="xs" data-export="battle-history-excel" disabled={battleHistoryExporting !== null} on:click={() => void exportBattleHistoryExcel(history)}>{battleHistoryExporting?.id === history.id && battleHistoryExporting.format === 'excel' ? '导出中…' : 'Excel'}</UiButton>
                        <UiButton size="xs" data-export="battle-history-json" disabled={battleHistoryExporting !== null} on:click={() => void exportBattleHistoryJson(history)}>{battleHistoryExporting?.id === history.id && battleHistoryExporting.format === 'json' ? '导出中…' : 'JSON'}</UiButton>
                        <UiButton size="xs" tone="danger" aria-label={`删除 ${formatHistoryDate(history.createdAt)} 的对战历史`} on:click={() => requestDeleteBattleHistory(history)}>删除</UiButton>
                      </UiHistoryRow>
                    {/each}
                  <svelte:fragment slot="notice">
                    {#if battleHistoryError}<div class="ranking-error" role="alert">{battleHistoryError}</div>{/if}
                  </svelte:fragment>
                  <svelte:fragment slot="actions">
                    <UiButton size="xs" disabled={!battleTmpAvailable || battleLoadingTarget} on:click={() => requestBattleLoad({ kind: 'current' })}>加载当前</UiButton>
                    <UiButton size="xs" disabled={battleHistoryImporting} on:click={() => battleHistoryFileInput?.click()}>{battleHistoryImporting ? '导入中…' : '导入 JSON'}</UiButton>
                  {#if nativeRuntime}<UiButton size="xs" on:click={openGroupingDownloadFolder}>打开下载</UiButton>{/if}
                    <UiButton size="xs" tone="danger" disabled={battleHistories.length === 0} on:click={requestClearBattleHistories}>删除全部</UiButton>
                  </svelte:fragment>
                </UiHistoryPanel>
              </div>
            {:else}
              <div class="desktop-accordion-content history-panel">
              <input bind:this={historyFileInput} class="grouping-file-input" type="file" accept=".json,application/json" on:change={importGroupingHistoryFile} />
              <UiHistoryPanel
                bind:start={historyStart}
                bind:end={historyEnd}
                loading={historyLoading}
                loadingText="正在读取分组历史…"
                empty={visibleHistories.length === 0}
                emptyText="日期范围内没有分组记录"
              >
                  {#each visibleHistories as history (history.id)}
                    <UiHistoryRow
                      eyebrow={formatHistoryDate(history.createdAt)}
                      title={groupingHistoryTitle(history) ?? historySummary(history)}
                      hint="查看分组 →"
                      on:select={() => viewHistory(history)}
                    >
                      <UiButton size="xs" data-export="grouping-history-excel" disabled={historyExporting !== null} on:click={() => void exportGroupingHistoryExcel(history)}>{historyExporting?.id === history.id && historyExporting.format === 'excel' ? '导出中…' : 'Excel'}</UiButton>
                      <UiButton size="xs" data-export="grouping-history-json" disabled={historyExporting !== null} on:click={() => void exportGroupingHistoryJson(history)}>{historyExporting?.id === history.id && historyExporting.format === 'json' ? '导出中…' : 'JSON'}</UiButton>
                      <UiButton
                        size="xs"
                        tone="danger"
                        aria-label={`删除 ${formatHistoryDate(history.createdAt)} 的分组历史`}
                        disabled={historyDeleting}
                        on:click={() => requestDeleteGroupingHistory(history)}
                      >删除</UiButton>
                    </UiHistoryRow>
                  {/each}
                <svelte:fragment slot="notice">
                  {#if historyError}<div class="ranking-error" role="alert">{historyError}</div>{/if}
                </svelte:fragment>
                <svelte:fragment slot="actions">
                  <UiButton size="xs" disabled={historyImporting} on:click={openGroupingHistoryImporter}>{historyImporting ? '导入中…' : '导入 JSON'}</UiButton>
                  <UiButton size="xs" tone="danger" disabled={groupingHistories.length === 0 || historyDeleting} on:click={requestClearGroupingHistories}>删除全部</UiButton>
                </svelte:fragment>
                <svelte:fragment slot="status">
                  {#if historyImportStatus}<div class="history-import-status" role="status">{historyImportStatus}</div>{/if}
                </svelte:fragment>
              </UiHistoryPanel>
              </div>
            {/if}
          {/if}
        </section>
      </aside>
    {/if}

    <section class="grouping-center" aria-live="polite">
      <fieldset class="preview-panel app-surface-dark" disabled={battlePage && battleTmpSnapshot !== null}>
        <div class="result-heading">
          <div><div><h2>{battlePage ? '对战设置' : '名单预览'}</h2></div></div>
          <strong class:warning={businessRuntime && unresolvedPreviewCount > 0} class="preview-status">
            {resolvingNames ? '核对中…' : businessRuntime && unresolvedPreviewCount > 0 ? `${unresolvedPreviewCount} 项未识别` : `${names.length} 项`}
          </strong>
        </div>

        {#if previewRows.length > 0}
          <div class="preview-list">
            {#each previewRows as row, index}
              {#if !battlePage && previewTierStarts.has(index)}
                <div class:first-tier={index === 0} class="preview-tier-divider" role="separator" aria-label={`第 ${Math.floor(index / Math.max(2, Number(groupCount) || 2)) + 1} 档`}>
                  <i></i><span>t{Math.floor(index / Math.max(2, Number(groupCount) || 2)) + 1}</span><i></i>
                </div>
              {/if}
              {#if insertIndex === index}
                <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                  <label>
                    <span>插入到 {row.name} 前</span>
                    <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label={`插入到 ${row.name} 前`} on:keydown|stopPropagation={(event) => isTextEditCancel(event) && cancelPreviewInsertion()} />
                  </label>
                  <button type="submit">插入</button>
                  <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                  {#if insertError}<small role="alert">{insertError}</small>{/if}
                </form>
              {/if}
              <GroupingPreviewRow
                variant={battlePage ? 'battle' : 'grouping'}
                name={row.name}
                {index}
                resolved={row.resolved}
                desktopRuntime={businessRuntime}
                {resolvingNames}
                unknown={businessRuntime && !resolvingNames && !isResolvedGroupingName(row.name, row.resolved)}
                insertActive={insertIndex === index}
                {rankingSaving}
                onRename={(name) => updatePreviewName(index, name)}
                onInsert={() => openPreviewInsertion(index)}
                onLink={() => startAliasLink(row.name)}
                onRecord={() => addUnknownPerson(row.name)}
                onRemove={() => removePreviewName(index)}
              />
            {/each}
            {#if insertIndex === previewRows.length}
              <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                <label>
                  <span>添加到名单末尾</span>
                  <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label="添加到名单末尾" on:keydown|stopPropagation={(event) => isTextEditCancel(event) && cancelPreviewInsertion()} />
                </label>
                <button type="submit">添加</button>
                <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                {#if insertError}<small role="alert">{insertError}</small>{/if}
              </form>
            {/if}
            <button
              type="button"
              class="append-preview-user"
              on:click={() => openPreviewInsertion(names.length)}
            >＋ 添加到名单末尾</button>
          </div>
        {:else}
          <div class="preview-empty">
            {#if insertIndex === 0}
              <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                <label>
                  <span>添加第一项</span>
                  <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label="添加第一项" on:keydown|stopPropagation={(event) => isTextEditCancel(event) && cancelPreviewInsertion()} />
                </label>
                <button type="submit">添加</button>
                <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                {#if insertError}<small role="alert">{insertError}</small>{/if}
              </form>
            {:else}
              <button type="button" class="append-preview-user" on:click={() => openPreviewInsertion(0)}>＋ 添加第一项</button>
            {/if}
          </div>
        {/if}

        {#if battlePage}
          <div class="battle-preview-settings">
            <div class="battle-option-groups">
              <fieldset class="battle-radio-group battle-format-group">
                <legend>赛制</legend>
                <UiRadio battle name="battle-format" value="avoid-first-pair" bind:group={battleFormat}>同组不对战1对2</UiRadio>
                <UiRadio battle name="battle-format" value="single-elimination" bind:group={battleFormat}>单败</UiRadio>
                <UiRadio battle name="battle-format" value="double-elimination" bind:group={battleFormat}>双败</UiRadio>
                {#if battleFormat === 'double-elimination'}
                  <UiCheckbox compact bind:checked={battleDoubleGrandFinal}>双总决赛</UiCheckbox>
                {/if}
              </fieldset>
              {#if battleFormat !== 'avoid-first-pair'}
                <fieldset class="battle-radio-group battle-order-group">
                  <legend>名单顺序</legend>
                  <UiRadio battle name="battle-order" value="input" bind:group={battleOrderMode}>按输入顺序</UiRadio>
                  <UiRadio battle name="battle-order" value="rank" bind:group={battleOrderMode} disabled={!businessRuntime} title={businessRuntime ? '' : '网页版没有排名数据库'}>按排名</UiRadio>
                  {#if businessRuntime && battleOrderMode === 'rank'}
                    <button
                      type="button"
                      class="rank-preview-button battle-rank-preview-button"
                      title={sourceTextDirty ? '先确认名单' : battleRankReady ? `固定前 ${battleConfiguredFixedCount} 名` : `还差 ${Math.max(0, battleConfiguredFixedCount - battleRankedNameCount)} 个排名`}
                      disabled={!battleRankReady}
                      on:click={sortBattlePreviewByRank}
                    >按排名预览</button>
                  {/if}
                </fieldset>
                <fieldset class="battle-radio-group battle-fixed-group">
                  <legend>固定位置</legend>
                  <UiRadio battle name="battle-fixed-seeds" value={0} bind:group={battleFixedSeedCount}>全随机</UiRadio>
                  {#each battleFixedOptions as count}
                    <UiRadio battle name="battle-fixed-seeds" value={count} bind:group={battleFixedSeedCount}>前 {count} 固定</UiRadio>
                  {/each}
                </fieldset>
              {/if}
            </div>
            <div class:desktop-actions={desktopRuntime} class="battle-option-actions">
              <div class:valid={battleCanExecute} class="battle-count-status">
                {#if battleTmpSnapshot}
                  已抽签，清空后重来
                {:else if sourceTextDirty}
                  名单已改，请确认
                {:else if battleFormat === 'avoid-first-pair' && !battleCanExecute}
                  需 8 项
                {:else if battleOrderMode === 'rank' && !battleRankReady}
                  固定前 {battleConfiguredFixedCount} 名，现 {battleRankedNameCount} 个排名
                {:else if battleCanExecute}
                  可以抽签
                {:else}
                  至少 4 项
                {/if}
              </div>
              <UiCheckbox compact reveal battleAction class="slow-reveal-setting battle-reveal-setting" bind:checked={slowRevealEnabled} on:change={() => updateSlowReveal(slowRevealEnabled)}>悬念揭晓</UiCheckbox>
              {#if businessRuntime}
                <button
                  type="button"
                  class:battle-control-hidden={!battleTmpAvailable || battleTmpSnapshot !== null}
                  class="battle-load-current-button"
                  aria-hidden={!battleTmpAvailable || battleTmpSnapshot !== null}
                  tabindex={!battleTmpAvailable || battleTmpSnapshot !== null ? -1 : undefined}
                  disabled={!battleTmpAvailable || battleTmpSnapshot !== null || battleLoadingTarget}
                  on:click={() => void requestBattleLoad({ kind: 'current' })}
                >加载当前</button>
              {/if}
              <button type="button" class="generate-button battle-generate-button" title={battleTmpSnapshot ? '清空后重来' : ''} disabled={!battleCanExecute} on:click={generateBattle}><span>抽签</span><i>→</i></button>
            </div>
          </div>
        {/if}

        {#if error}<div class="grouping-error" role="alert">{error}</div>{/if}

        {#if businessRuntime && !resolvingNames && (battlePage ? battleOrderMode === 'rank' && !battleRankCountReady : groupingUnrankedCount > 0)}
          <div class="rank-order-lock" role="status">
            {#if battlePage}
              固定前 {battleConfiguredFixedCount} 名，现 {battleRankedNameCount} 个排名。
            {:else if groupingUnresolvedOverflow > 0}
              末档限 {groupingUnresolvedCapacity} 个未排名，还差 {groupingUnresolvedOverflow} 个。
            {:else}
              {groupingUnrankedCount} 个未排名将进末档。
            {/if}
          </div>
        {/if}

        {#if !battlePage}
          <UiCheckbox compact reveal class="slow-reveal-setting" bind:checked={slowRevealEnabled} on:change={() => updateSlowReveal(slowRevealEnabled)}>悬念揭晓</UiCheckbox>
        {/if}
        {#if !battlePage}
          <div class="grouping-actions" class:desktop-actions={desktopRuntime}>
            {#if businessRuntime}
            <button type="button" class="rank-preview-button" title={sourceTextDirty ? '先确认名单' : groupingUnresolvedOverflow > 0 ? `末档限 ${groupingUnresolvedCapacity} 个，还差 ${groupingUnresolvedOverflow} 个` : groupingUnrankedCount > 0 ? '未排名按原序置后' : '按排名预览'} disabled={!canGenerateGroupingByRank} on:click={sortGroupingPreviewByRank}>按排名顺序预览</button>
            <button type="button" class="generate-button rank-generate-button" title={sourceTextDirty ? '先确认名单' : groupingUnresolvedOverflow > 0 ? `末档限 ${groupingUnresolvedCapacity} 个，还差 ${groupingUnresolvedOverflow} 个` : groupingUnrankedCount > 0 ? '未排名进入末档' : '按排名分档'} disabled={!canGenerateGroupingByRank} on:click={() => generate('rank')}><span>按排名顺序分组</span><i>→</i></button>
            <button type="button" class="input-order-button" title="忽略排名，按当前名单顺序分档" disabled={!canGenerateByInput} on:click={() => generate('input')}>按输入顺序分组</button>
            <button type="button" class="input-order-button" title="忽略排名和输入顺序，随机分组且各组人数最多相差 1 人" disabled={!canGenerateByRandom} on:click={() => generate('random')}>全随机分组</button>
            {:else}
              <button type="button" class="generate-button" disabled={!canGenerateByInput} on:click={() => generate('input')}><span>开始分组</span><i>→</i></button>
              <button type="button" class="input-order-button" title="忽略排名和输入顺序，随机分组且各组人数最多相差 1 人" disabled={!canGenerateByRandom} on:click={() => generate('random')}>全随机分组</button>
            {/if}
          </div>
        {/if}
      </fieldset>

      <div
        bind:this={groupingResultElement}
        class:battle-result={battlePage}
        class:battle-fullscreen={battleFullscreen}
        class="grouping-result app-surface-dark"
        style={battlePage ? `--battle-background-color: ${battleColors.background}; --battle-text-color: ${battleColors.text}; --battle-participant-color: ${battleColors.participant}; --battle-match-color: ${battleColors.match};` : undefined}
        tabindex="-1"
        aria-keyshortcuts={battlePage ? 'F G B V N L W S' : undefined}
      >
        {#if battlePage}
          <div class="battle-result-toolbar">
            <button type="button" class="battle-fullscreen-button" aria-pressed={battleFullscreen} aria-keyshortcuts="F" disabled={battleFullscreenChanging} on:click={() => setBattleFullscreen(!battleFullscreen)}>{battleFullscreen ? '返回' : '全屏'}</button>
            {#if battleTmpSnapshot && !battleHistoryView}
              <button type="button" class="battle-clear-button" disabled={clearingBattleTmp} on:click={requestClearAll}>清空对战</button>
            {/if}
            <fieldset class="battle-color-controls">
              <legend>对战颜色</legend>
              <div class="battle-color-presets" role="group" aria-label="配色预设">
                {#each BATTLE_COLOR_PRESET_OPTIONS as [name, preset]}
                  <button
                    type="button"
                    class:selected={battleColorPreset === name}
                    aria-pressed={battleColorPreset === name}
                    style={`--battle-preset-gradient: linear-gradient(135deg, ${preset.colors.background} 0 42%, ${preset.colors.match} 42% 70%, ${preset.colors.participant} 70% 86%, ${preset.colors.text} 86% 100%); --battle-preset-accent: ${preset.colors.participant};`}
                    on:click={() => selectBattleColorPreset(name)}
                  >{preset.label}</button>
                {/each}
              </div>
              <div class="battle-color-custom">
                <UiColorPalette label="背景框颜色" value={battleColors.background} on:input={(event) => updateBattleColor('background', event)} />
                <UiColorPalette label="文字颜色" value={battleColors.text} on:input={(event) => updateBattleColor('text', event)} />
                <UiColorPalette label="选手文字颜色" value={battleColors.participant} on:input={(event) => updateBattleColor('participant', event)} />
                <UiColorPalette label="对战框颜色" value={battleColors.match} on:input={(event) => updateBattleColor('match', event)} />
              </div>
              <div class="battle-color-actions" role="group" aria-label="配色存档">
                <UiButton size="sm" on:click={saveBattleColorSnapshot}>保存配色</UiButton>
                <UiButton size="sm" disabled={!battleColorSnapshotAvailable} on:click={loadBattleColorSnapshot}>加载配色</UiButton>
              </div>
            </fieldset>
          </div>
            <div class="result-heading">
            <div><div><h2>{battleTitle.trim() || (battleHistoryView ? '历史对战' : '对战')}</h2></div></div>
            {#if battleHistoryView}
              <div class="result-output-actions">
                <UiButton size="sm" on:click={returnToCurrentBattle}>返回当前对战</UiButton>
              </div>
            {:else if battleTmpSnapshot}
              <div class="result-output-actions">
                {#if hiddenBattleSlotCount > 0}
                  <UiButton size="md" tone="accent" on:click={revealAllBattleSlots}>显示全部</UiButton>
                {/if}
                <UiButton size="md" tone="accent" disabled={battleHistorySaved} on:click={() => void saveCurrentBattleHistory()}>{battleHistorySaved ? '历史已保存' : '保存历史'}</UiButton>
                <UiButton size="md" data-export="battle-excel" disabled={battleExporting !== null} on:click={exportBattleTmpExcel}>{battleExporting === 'excel' ? '导出中…' : 'Excel'}</UiButton>
                <UiButton size="md" data-export="battle-json" disabled={battleExporting !== null} on:click={exportBattleTmpJson}>{battleExporting === 'json' ? '导出中…' : 'JSON'}</UiButton>
                {#if nativeRuntime}
                  <UiButton size="md" on:click={openGroupingDownloadFolder}>打开下载</UiButton>
                {/if}
              </div>
            {/if}
          </div>
          {#if battleTmpSnapshot && !battleHistoryView}
            <div class="battle-time-meta" aria-label="对战时间">
              <span>创建时间：{formatDateTime(battleTmpSnapshot.createdAt)}</span>
              <span>更新时间：{formatDateTime(battleTmpSnapshot.updatedAt)}</span>
            </div>
          {/if}
          {#if battleHistoryView}
            <div class="battle-history-bracket" aria-label="历史对战只读查看">
              {#key `history-${battleHistoryView.id}`}
                <BattleBracketViewer snapshot={battleHistoryView.snapshot} />
              {/key}
            </div>
          {:else if battleTmpSnapshot}
            {#key 'battle-editor'}
              <BattleBracketEditor
                snapshot={battleTmpSnapshot}
                hiddenSlotKeys={hiddenBattleSlotKeys}
                saving={battleSyncStatus === 'saving'}
                onMatchKeydown={handleBattleMatchKeydown}
                onScoreFocus={handleBattleScoreFocus}
                onScoreKeydown={handleBattleScoreKeydown}
                onScoreChange={updateBattleScore}
                onReveal={revealBattleSlot}
              />
            {/key}
          {:else if battlePreviewSnapshot}
            <div class="battle-preview-bracket" aria-label="只读对战查看">
              {#key 'battle-preview'}
                <BattleBracketViewer snapshot={battlePreviewSnapshot} maskUnfixed viewOnly />
              {/key}
            </div>
          {:else}
            <div class="empty-result battle-empty-result"><div class="empty-grid"><i>A</i><i>VS</i><i>B</i></div><p>{battleFormat === 'avoid-first-pair' ? '固定 8 项：相邻两项为一组，第 1 对异组第 2，单败晋级' : '确认名单并选择固定位置'}</p></div>
          {/if}
        {:else}
        <div class="result-heading">
          <div><div><h2>{groupingTitle.trim() || '分组结果'}</h2></div></div>
          {#if result}
            <div class="result-output-actions">
              {#if hiddenGroupingCellCount > 0}
                <UiButton size="sm" tone="accent" on:click={revealAllGroupingCells}>显示全部</UiButton>
              {/if}
              <UiButton size="sm" on:click={exportGroupingExcel}>Excel</UiButton>
              <UiButton size="sm" on:click={exportGroupingJson}>JSON</UiButton>
              {#if nativeRuntime}
                <UiButton size="sm" on:click={openGroupingDownloadFolder}>打开下载</UiButton>
              {/if}
              {#if businessRuntime}
                <div class="history-save-control">
                  <button
                    type="button"
                    class="history-save-button"
                    disabled={resultOutdated || historyStatus === 'saving' || historyStatus === 'saved'}
                    on:click={saveCurrentHistory}
                  >{historyStatus === 'saving' ? '保存中' : historyStatus === 'saved' ? '已保存' : historyStatus === 'error' ? '重试保存' : '保存到历史'}</button>
                  {#if historyStatus === 'idle' || historyStatus === 'error'}
                    <span class:error={historyStatus === 'error'} class="history-status" role="status">
                      {historyStatus === 'idle' ? '尚未保存' : '保存失败'}
                    </span>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
        {#if resultOutdated}<div class="outdated-notice">名单、排名或组数已变化，请重新分组。</div>{/if}
        {#if result}
          <div class:outdated={resultOutdated} class="grouping-table-wrap">
            <table style={`--grouping-group-count: ${result.groupCount}`}>
              <thead><tr><th scope="col">档位</th>{#each result.groupNames as group}<th scope="col"><span>{group}</span>组</th>{/each}</tr></thead>
              <tbody>
                {#each result.tiers as tier, tierIndex}
                  <tr>
                    <th scope="row"><span>t{tierIndex + 1}</span><small>第 {tierIndex + 1} 档</small></th>
                    {#each tier as entry, groupIndex}
                      <td class:empty={!entry} class:caimi-swapped={Boolean(entry?.caimiSwap)} class:caimi-favored={entry?.caimiSwap?.kind === 'favored'} class:slow-hidden={hiddenGroupingCellKeys.has(groupingCellKey(tierIndex, groupIndex))}>
                        {#if hiddenGroupingCellKeys.has(groupingCellKey(tierIndex, groupIndex))}
                          <button type="button" class="slow-reveal-cell" aria-label={`显示 t${tierIndex + 1} ${result.groupNames[groupIndex]} 组`} on:click={() => revealGroupingCell(tierIndex, groupIndex)}>·</button>
                        {:else if entry}
                          {#if entry.caimiSwap}<i class="caimi-swap-badge">{entry.caimiSwap.kind === 'favored' ? '守护' : '支援'}</i>{/if}
                          <strong>{entry.name}</strong><small>#{entry.sourceIndex + 1}{entry.caimiSwap ? ` · 原 ${result.groupNames[entry.caimiSwap.fromGroupIndex]} 组` : ''}</small>
                        {:else}<span>—</span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-result"><div class="empty-grid"><i>A</i><i>B</i><i>C</i><i>D</i><i>E</i><i>F</i></div></div>
        {/if}
        {/if}
      </div>
    </section>

    <aside class:battle-config={battlePage} class="grouping-config app-surface-light">
      <div class="config-heading"><div><span>01</span><h2>名单</h2></div><strong>{names.length}<small>项</small></strong></div>
      <label class="names-field"><span>每行一个，也支持空格、逗号和 Excel 粘贴</span><UiTextarea bind:element={sourceTextarea} bind:value={sourceText} stretch={desktopRuntime} aria-keyshortcuts="Alt+Enter" placeholder="粘贴名称…" spellcheck="false" disabled={battlePage && battleTmpSnapshot !== null} /></label>
      <div class="list-actions">
        <button type="button" class="confirm-list" aria-keyshortcuts="Alt+Enter" disabled={!sourceTextDirty || battlePage && battleTmpSnapshot !== null} on:click={confirmSourceText}>确认</button>
        {#if !battlePage}
          <button type="button" class="clear-list" disabled={!sourceText && !confirmedSourceText} on:click={requestClearAll}>清空</button>
        {/if}
      </div>
      <label class="grouping-title-field">
        <span>{battlePage ? '对战名称（可选）' : '分组名称（可选）'}</span>
        {#if battlePage}
          <input bind:value={battleTitle} maxlength="40" placeholder="例如：周五单败赛" />
        {:else}
          <input bind:value={groupingTitle} maxlength="40" placeholder="例如：季度分组" />
        {/if}
      </label>
      {#if !battlePage}
        <div class="group-setting"><label for="grouping-group-count"><span>组数</span><input id="grouping-group-count" type="number" min="2" max="26" step="1" bind:value={groupCount} /></label><div><span>预计档位</span><strong>{tierPreview || '—'}</strong></div></div>
      {/if}
    </aside>
  </div>
</main>

{#if clearGroupingConfirmation}
  <UiConfirmDialog
    titleId="clear-grouping-title"
    detailId="clear-grouping-detail"
    title={clearConfirmationTitle(clearGroupingConfirmation)}
    detail={clearConfirmationDetail(clearGroupingConfirmation)}
    confirmLabel={clearConfirmationAction(clearGroupingConfirmation)}
    cancelLabel={battlePage && clearGroupingConfirmation === 3 ? '保留设置和名单' : '取消'}
    cancelShortcuts={battlePage && clearGroupingConfirmation === 3 ? 'N' : 'N Escape'}
    confirmDisabled={clearingBattleTmp}
    cancelDisabled={clearingBattleTmp}
    on:cancel={cancelClearAll}
    on:confirm={confirmClearAll}
  />
{/if}

{#if draggingUserId !== null}
  <div class="rank-drag-ghost" style={`left: ${rankDragX}px; top: ${rankDragY}px;`} aria-hidden="true">
    {rankedUsers.find((user) => user.id === draggingUserId)?.name ?? '选项'}
  </div>
{/if}

{#if battleHistoryDeleteConfirmation}
  <UiConfirmDialog
    titleId="clear-battle-history-title"
    detailId="clear-battle-history-detail"
    icon="×"
    title={battleHistoryDeleteConfirmation === 1 ? '删除全部对战历史？' : '真的删除全部对战历史？'}
    detail={battleHistoryDeleteConfirmation === 1 ? '全部对战历史都会删除。' : '删除后无法恢复。'}
    on:cancel={() => (battleHistoryDeleteConfirmation = 0)}
    on:confirm={confirmClearBattleHistories}
  />
{/if}

{#if pendingBattleHistoryDeletion}
  <UiConfirmDialog
    titleId="delete-battle-history-title"
    detailId="delete-battle-history-detail"
    icon="×"
    title="删除这条对战历史？"
    detail="删除后无法恢复。"
    on:cancel={() => (pendingBattleHistoryDeletion = null)}
    on:confirm={confirmDeleteBattleHistory}
  />
{/if}

{#if pendingBattleLoad}
  <UiConfirmDialog
    titleId="load-battle-title"
    detailId="load-battle-detail"
    dialogClass="battle-load-confirm-dialog"
    icon="↻"
    title={battleLoadConfirmationTitle(pendingBattleLoad)}
    detail={battleLoadConfirmationDetail(pendingBattleLoad)}
    confirmLabel={battleLoadConfirmationAction(pendingBattleLoad)}
    confirmDisabled={battleLoadingTarget}
    cancelDisabled={battleLoadingTarget}
    on:cancel={() => (pendingBattleLoad = null)}
    on:confirm={confirmBattleLoad}
  />
{/if}

{#if pendingGroupingHistoryDeletion}
  <UiConfirmDialog
    titleId="delete-grouping-history-title"
    detailId="delete-grouping-history-detail"
    icon="×"
    title={pendingGroupingHistoryDeletion.kind === 'one'
        ? '删除这条分组历史？'
        : pendingGroupingHistoryDeletion.confirmation === 1
          ? '删除全部分组历史？'
          : '真的删除全部分组历史？'}
    detail={pendingGroupingHistoryDeletion.kind === 'all' && pendingGroupingHistoryDeletion.confirmation === 1
        ? '全部分组历史都会删除。'
        : '删除后无法恢复。'}
    confirmLabel={historyDeleting ? '删除中…' : '确认'}
    confirmDisabled={historyDeleting}
    cancelDisabled={historyDeleting}
    on:cancel={() => (pendingGroupingHistoryDeletion = null)}
    on:confirm={confirmGroupingHistoryDeletion}
  />
{/if}

{#if pendingDeleteUser}
  <UiConfirmDialog
    titleId="delete-ranked-title"
    detailId="delete-ranked-detail"
    icon="×"
    title={`删除“${pendingDeleteUser.name}”？`}
    detail="当前名称、全部别名和排名都会一起删除，此操作无法撤销。"
    confirmLabel={deletingUserId === null ? '确认' : '删除中…'}
    confirmDisabled={deletingUserId !== null}
    cancelDisabled={deletingUserId !== null}
    on:cancel={() => (pendingDeleteUser = null)}
    on:confirm={confirmDeleteRankedUser}
  />
{/if}

{#if pendingAliasClearUser}
  <UiConfirmDialog
    titleId="clear-alias-title"
    detailId="clear-alias-detail"
    icon="−"
    title={`删除“${pendingAliasClearUser.name}”的全部别名？`}
    detail="当前名称会保留，其他别名会全部删除。"
    confirmLabel={clearingAliasesUserId === null ? '确认' : '删除中…'}
    tone="accent"
    confirmDisabled={clearingAliasesUserId !== null}
    cancelDisabled={clearingAliasesUserId !== null}
    on:cancel={() => (pendingAliasClearUser = null)}
    on:confirm={confirmClearRankedUserAliases}
  />
{/if}

{#if clearAllRankingsConfirmation !== 0}
  <UiConfirmDialog
    titleId="clear-all-rankings-title"
    detailId="clear-all-rankings-detail"
    icon="×"
    title={clearAllRankingsConfirmation === 1 ? '删除全部排名？' : '真的删除全部排名？'}
    detail={clearAllRankingsConfirmation === 1 ? '全部名称、别名和排名都会删除。' : '此操作无法撤销。'}
    confirmLabel={clearingAllRankings ? '删除中…' : '确认'}
    confirmDisabled={clearAllRankingsConfirmation !== 1 && clearingAllRankings}
    cancelDisabled={clearingAllRankings}
    on:cancel={cancelClearAllRankings}
    on:confirm={clearAllRankingsConfirmation === 1 ? continueClearAllRankings : confirmClearAllRankings}
  />
{/if}

{#if pendingRankingImport}
  <UiConfirmDialog
    titleId="ranking-import-title"
    detailId="ranking-import-detail"
    icon="⇄"
    title={`导入 ${pendingRankingImport.length} 项排名？`}
    detail="文件内容将导入排名和别名。"
    confirmLabel={rankingImporting ? '导入中…' : '确认'}
    tone="accent"
    confirmDisabled={rankingImporting}
    cancelDisabled={rankingImporting}
    on:cancel={() => (pendingRankingImport = null)}
    on:confirm={confirmRankingImport}
  />
{/if}

{#if pendingDatabaseImport}
  <UiConfirmDialog
    titleId="database-import-title"
    detailId="database-import-detail"
    icon="⇄"
    title="导入 SQLite 数据库？"
    detail={`当前浏览器数据库会被 ${pendingDatabaseImport.name} 完全替换，页面将自动刷新。`}
    confirmLabel={databaseImporting ? '导入中…' : '替换并刷新'}
    confirmDisabled={databaseImporting}
    cancelDisabled={databaseImporting}
    on:cancel={() => (pendingDatabaseImport = null)}
    on:confirm={confirmDatabaseImport}
  />
{/if}

{#if importErrorDialog}
  <UiConfirmDialog
    titleId="import-error-title"
    detailId="import-error-detail"
    title={importErrorDialog.title}
    detail={importErrorDialog.detail}
    confirmLabel="知道了"
    cancelLabel={null}
    tone="accent"
    on:confirm={() => (importErrorDialog = null)}
  />
{/if}

<style>
  .grouping-page {
    --grouping-muted-on-dark: var(--on-dark-muted);
    --grouping-dim-on-dark: color-mix(in srgb, var(--on-dark-muted) 84%, transparent);
    --grouping-muted-on-light: var(--color-app-text);
    --grouping-dim-on-light: var(--color-app-muted);
    --grouping-layout-scale: calc(0.667 + var(--font-scale, 1) * 0.333);
    --battle-control-width: calc(115px + 135px * var(--font-scale, 1));
    --battle-control-height: calc(56px * var(--app-component-scale, 1));
    min-height: 0;
    padding: clamp(24px, 4vw, 58px);
    border: 1px solid var(--app-frame-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--app-frame-radius, 25px);
    overflow: hidden;
    background:
      radial-gradient(circle at 82% 8%, rgb(var(--app-accent-rgb, 231 255 114) / 0.09), transparent 28%),
      var(--app-frame-background, #20211b);
    color: var(--on-dark);
    box-shadow: var(--app-frame-shadow, 0 28px 80px rgba(0, 0, 0, 0.28));
  }

  /* 页面画布使用隔离层；全屏签表需抬到顶栏之上才能接收点击。 */
  .grouping-page.battle-fullscreen-active { z-index: 20; }

  .config-heading,
  .group-setting,
  .result-heading,
  .result-heading > div {
    display: flex;
  }

  .config-heading span {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: calc(12px * var(--font-scale, 1));
    letter-spacing: 0.14em;
  }

  .config-heading span {
    color: var(--accent-ink);
  }

  .grouping-workbench {
    --ranking-width-scale: 0.85;
    --ranking-row-height-scale: 0.9;
    --workspace-font-scale: var(--font-scale, 1);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 370px);
    align-items: stretch;
    gap: calc(clamp(18px, 2.5vw, 34px) * var(--grouping-layout-scale, 1));
    max-width: 1580px;
    margin: 0 auto;
  }

  .grouping-workbench.desktop {
    grid-template-columns:
      minmax(calc(260px * var(--grouping-layout-scale, 1) * var(--ranking-width-scale, 1)), calc(310px * var(--grouping-layout-scale, 1) * var(--ranking-width-scale, 1)))
      minmax(0, 1fr)
      minmax(calc(300px * var(--grouping-layout-scale, 1)), calc(360px * var(--grouping-layout-scale, 1)));
    gap: calc(clamp(14px, 1.7vw, 25px) * var(--grouping-layout-scale, 1));
  }

  .grouping-config,
  .preview-panel,
  .grouping-result {
    border: 1px solid var(--app-surface-border, rgba(255, 255, 255, 0.08));
    border-radius: var(--app-surface-radius, calc(19px * var(--grouping-layout-scale, 1)));
  }

  .grouping-config {
    min-width: 0;
    align-self: start;
    padding: calc(22px * var(--grouping-layout-scale, 1));
    background: var(--app-surface-background, #efede6);
    color: var(--app-surface-color, #24251f);
  }

  .config-heading,
  .result-heading {
    align-items: center;
    justify-content: space-between;
    gap: calc(16px * var(--grouping-layout-scale, 1));
  }

  .config-heading > div { display: flex; align-items: baseline; gap: calc(9px * var(--grouping-layout-scale, 1)); }
  .config-heading h2,
  .result-heading h2 { font-size: calc(23px * var(--font-scale, 1)); letter-spacing: -0.04em; }
  .config-heading > strong { font-size: calc(27px * var(--font-scale, 1)); }
  .config-heading small { margin-left: 2px; color: var(--grouping-dim-on-light); font-size: calc(12px * var(--font-scale, 1)); }

  .names-field { display: block; margin-top: calc(18px * var(--grouping-layout-scale, 1)); }
  .names-field > span { color: var(--grouping-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .grouping-file-input { display: none; }

  .list-actions { display: flex; justify-content: flex-end; gap: calc(7px * var(--grouping-layout-scale, 1)); margin-top: calc(7px * var(--grouping-layout-scale, 1)); }
  .list-actions button {
    padding: calc(6px * var(--grouping-layout-scale, 1)) calc(9px * var(--grouping-layout-scale, 1));
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    background: var(--surface-field);
    color: var(--color-app-text);
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
  }
  .list-actions .confirm-list { border-color: color-mix(in srgb, var(--accent-strong) 55%, transparent); background: var(--accent-soft); color: var(--accent-ink); }
  .list-actions .confirm-list:hover:not(:disabled) { border-color: var(--accent-strong); background: color-mix(in srgb, var(--accent-soft) 75%, var(--accent)); color: var(--accent-ink); }
  .list-actions .clear-list { border-color: #c5a49d; background: #fbf0ed; color: #7e3c31; }
  .list-actions .clear-list:hover:not(:disabled) { border-color: #b85b49; background: #f7ded8; color: #6d2419; }

  .grouping-title-field { display: grid; gap: 5px; margin-top: 12px; }
  .grouping-title-field > span { color: var(--grouping-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .grouping-title-field input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--line-subtle);
    border-radius: 8px;
    background: var(--color-app-surface-raised);
    color: var(--color-app-text);
    font-size: calc(13px * var(--font-scale, 1));
  }

  .group-setting {
    align-items: stretch;
    gap: 9px;
    margin-top: 18px;
  }
  .group-setting > * {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    padding: 10px 11px;
    border: 1px solid var(--line-subtle);
    border-radius: 10px;
    background: var(--color-app-surface-raised);
  }
  .group-setting span { color: var(--grouping-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .group-setting input {
    width: 56px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-app-text);
    font-family: var(--font-mono);
    font-size: calc(20px * var(--font-scale, 1));
    font-weight: 800;
    text-align: right;
  }
  .group-setting strong { font-family: var(--font-mono); font-size: calc(20px * var(--font-scale, 1)); font-weight: 800; }

  .battle-radio-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: calc(7px * var(--grouping-layout-scale, 1));
    margin: calc(17px * var(--grouping-layout-scale, 1)) 0 0;
    padding: 0;
    border: 0;
  }
  .battle-format-group { grid-template-columns: minmax(0, 1fr); }
  .battle-fixed-group { grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
  .battle-radio-group legend { width: 100%; margin-bottom: calc(7px * var(--grouping-layout-scale, 1)); color: var(--grouping-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-count-status { margin-top: calc(10px * var(--grouping-layout-scale, 1)); padding: calc(9px * var(--grouping-layout-scale, 1)) calc(11px * var(--grouping-layout-scale, 1)); border-radius: calc(8px * var(--grouping-layout-scale, 1)); background: rgba(218, 91, 63, 0.1); color: #ad4b35; font-size: calc(12px * var(--font-scale, 1)); }
  .battle-count-status.valid { background: rgba(138, 153, 62, 0.13); color: #52601d; }
  .battle-preview-settings {
    display: grid;
    gap: calc(6px * var(--grouping-layout-scale, 1));
    margin-top: calc(18px * var(--grouping-layout-scale, 1));
    padding-top: calc(12px * var(--grouping-layout-scale, 1));
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    min-width: 0;
    overflow-x: hidden;
  }
  .battle-option-groups,
  .battle-option-actions {
    display: grid;
    width: 100%;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--battle-control-width)), 1fr));
    align-items: stretch;
    gap: calc(10px * var(--grouping-layout-scale, 1));
  }
  .battle-option-groups {
    align-items: start;
  }
  .battle-option-actions .battle-count-status { grid-column: 1 / -1; }
  .battle-control-hidden { visibility: hidden; pointer-events: none; }
  .battle-preview-settings .battle-radio-group {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    flex: 0 0 auto;
    align-content: start;
    margin: 0;
    gap: calc(6px * var(--grouping-layout-scale, 1));
    padding: calc(6px * var(--grouping-layout-scale, 1));
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: calc(10px * var(--grouping-layout-scale, 1));
    background: rgba(255, 255, 255, 0.025);
  }
  .battle-preview-settings .battle-format-group,
  .battle-preview-settings .battle-order-group { grid-template-columns: minmax(0, 1fr); }
  .battle-preview-settings .battle-fixed-group {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(50px + 70px * var(--font-scale, 1))), 1fr));
  }
  .battle-preview-settings .battle-fixed-group legend { grid-column: 1 / -1; }
  .battle-preview-settings .battle-radio-group legend {
    color: var(--grouping-muted-on-dark);
    font-weight: 850;
    letter-spacing: 0.08em;
  }
  .battle-preview-settings .battle-rank-preview-button {
    width: 100%;
    max-width: 100%;
    min-height: var(--battle-control-height);
    padding: calc(4px * var(--grouping-layout-scale, 1)) calc(6px * var(--grouping-layout-scale, 1));
    border-radius: calc(8px * var(--grouping-layout-scale, 1));
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 900;
    line-height: 1;
  }
  .battle-preview-settings .battle-count-status {
    display: flex;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: var(--battle-control-height);
    box-sizing: border-box;
    align-items: center;
    margin-top: 0;
    border: 1px solid rgba(218, 91, 63, 0.18);
    background: rgba(218, 91, 63, 0.08);
    color: #e1a092;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .battle-preview-settings .battle-count-status.valid { border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.17); background: rgb(var(--app-accent-rgb, 231 255 114) / 0.07); color: var(--on-dark); }
  .battle-preview-settings .battle-generate-button,
  .battle-preview-settings .battle-load-current-button {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: var(--battle-control-height);
    margin: 0;
    padding: calc(4px * var(--grouping-layout-scale, 1)) calc(6px * var(--grouping-layout-scale, 1));
    border-radius: calc(8px * var(--grouping-layout-scale, 1));
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 900;
    line-height: 1.2;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .battle-preview-settings .battle-generate-button {
    border: 1px solid color-mix(in srgb, var(--accent-strong) 68%, white);
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 72%, var(--accent-strong)));
    box-shadow: 0 7px 18px rgb(var(--app-accent-rgb, 231 255 114) / 0.22);
    color: var(--accent-ink);
  }
  .battle-preview-settings .battle-generate-button:hover:not(:disabled) {
    border-color: var(--accent);
    filter: brightness(1.05);
    transform: translateY(-1px);
  }
  .battle-preview-settings .battle-load-current-button {
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.07);
    color: var(--on-dark);
    cursor: pointer;
  }
  .battle-preview-settings .battle-load-current-button:hover:not(:disabled) {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.48);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.13);
  }
  .battle-preview-settings .battle-generate-button i {
    color: var(--accent-ink);
    font-size: calc(15px * var(--font-scale, 1));
  }

  .grouping-error,
  .outdated-notice {
    margin-top: 10px;
    padding: 9px 11px;
    border-radius: 8px;
    font-size: calc(12px * var(--font-scale, 1));
  }
  .grouping-error { background: rgba(218, 91, 63, 0.1); color: #ad4b35; }
  .outdated-notice { background: rgb(var(--app-accent-rgb, 231 255 114) / 0.1); color: var(--on-dark); }

  .generate-button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding: 13px 15px;
    border: 0;
    border-radius: 11px;
    background: var(--workspace-deep);
    color: var(--on-dark);
    cursor: pointer;
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 800;
  }
  .generate-button i { color: var(--accent); font-family: var(--font-mono); font-size: calc(21px * var(--font-scale, 1)); font-style: normal; }

  .grouping-result {
    min-width: 0;
    padding: calc(clamp(20px, 3vw, 34px) * var(--grouping-layout-scale, 1));
    background: var(--app-surface-background, rgba(11, 12, 9, 0.27));
  }

  .grouping-result:focus {
    outline: 2px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.42);
    outline-offset: 3px;
  }

  .grouping-result.battle-result {
    --accent: var(--battle-participant-color);
    --app-accent-rgb: 231 255 114;
    --accent-strong: #829638;
    --accent-ink: #465318;
    --accent-soft: #f2f6df;
    --workspace-deep: #22231d;
    --workspace-highlight: #35372b;
    --on-dark: #f6f3ea;
    --on-dark-muted: #c4c7bd;
    --app-surface-background: rgb(11 12 9 / 27%);
    /* 签表基础间距加大；字号每增加 1 倍，间距只增加半倍（100% 到 200%）。 */
    --battle-layout-scale: calc(0.5 + var(--font-scale, 1) * 0.5);

    background: var(--battle-background-color);
    color: var(--battle-text-color);
  }

  .grouping-result.battle-fullscreen {
    position: fixed;
    z-index: 900;
    inset: 0;
    width: 100vw;
    height: 100vh;
    margin: 0 !important;
    padding: clamp(16px, 2.5vw, 34px);
    border: 0;
    border-radius: 0;
    overflow: auto;
  }

  .battle-result-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 18px;
  }

  .battle-time-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: -8px 0 16px;
    color: var(--grouping-dim-on-dark);
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
  }

  .battle-clear-button {
    min-width: 92px;
    padding: 10px 14px;
    border: 1px solid rgba(255, 155, 140, 0.52);
    border-radius: 9px;
    background: rgba(196, 69, 52, 0.22);
    color: #ffd6ce;
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 850;
  }
  .battle-clear-button:hover:not(:disabled) {
    border-color: #ff9b8c;
    background: rgba(196, 69, 52, 0.38);
  }
  .battle-clear-button:disabled { cursor: not-allowed; opacity: 0.42; }

  .battle-fullscreen-button {
    align-self: flex-start;
    min-width: 68px;
    padding: 8px 13px;
    border: 1px solid color-mix(in srgb, var(--battle-text-color) 38%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--battle-text-color) 10%, transparent);
    color: var(--battle-text-color);
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 800;
  }

  .battle-fullscreen-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .battle-color-controls {
    display: grid;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    align-items: center;
    grid-template-columns: max-content max-content max-content;
    gap: 8px 15px;
  }

  .battle-color-controls legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .battle-color-presets {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .battle-color-presets button {
    min-width: 58px;
    padding: 8px 10px;
    border: 2px solid color-mix(in srgb, var(--battle-text-color) 20%, transparent);
    border-radius: 8px;
    background: var(--battle-preset-gradient);
    box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.14);
    color: #fff;
    cursor: pointer;
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 800;
    text-shadow: 0 1px 3px #000;
  }

  .battle-color-presets button.selected {
    border-color: var(--battle-preset-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--battle-preset-accent) 28%, transparent), inset 0 0 0 999px rgba(0, 0, 0, 0.04);
  }

  .battle-color-custom {
    display: grid;
    grid-template-columns: repeat(4, minmax(116px, 1fr));
    align-items: center;
    gap: 5px;
  }

  .battle-color-actions { display: flex; flex-direction: column; align-items: stretch; gap: 5px; }

  .grouping-center {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: calc(18px * var(--grouping-layout-scale, 1));
  }

  .preview-panel {
    min-width: 0;
    margin: 0;
    padding: calc(clamp(20px, 2.4vw, 30px) * var(--grouping-layout-scale, 1));
    background: var(--app-surface-background, rgba(11, 12, 9, 0.27));
  }
  .result-heading > div { align-items: center; gap: 11px; }
  .result-output-actions,
  .history-save-control { display: flex; align-items: center; gap: 8px; }
  .result-output-actions { justify-content: flex-end; flex-wrap: wrap; }
  .result-heading .history-save-button {
    padding: 8px 11px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.48);
    border-radius: 8px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.14);
    color: var(--accent);
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
  }
  .result-heading .history-save-button:disabled { cursor: default; opacity: 0.58; }

  .grouping-table-wrap { margin-top: calc(20px * var(--grouping-layout-scale, 1)); overflow: auto; transition: opacity 180ms ease; }
  .grouping-table-wrap.outdated { opacity: 0.45; }
  .battle-fullscreen .result-heading { justify-content: flex-end; }
  .battle-fullscreen .result-heading > div:first-child { display: none; }
  .battle-fullscreen .battle-result-toolbar { margin-bottom: 8px; }
  .battle-preview-bracket { overflow: hidden; }
  table {
    width: 100%;
    min-width: max(650px, calc(68px + var(--grouping-group-count, 4) * 140px));
    border-collapse: separate;
    border-spacing: calc(7px * var(--grouping-layout-scale, 1));
    table-layout: fixed;
  }
  th, td { padding: calc(8px + 5px * var(--grouping-layout-scale, 1)) calc(6px + 3px * var(--grouping-layout-scale, 1)); border-radius: calc(7px + 3px * var(--grouping-layout-scale, 1)); text-align: center; }
  thead th { color: var(--grouping-muted-on-dark); font-size: calc(11px * var(--font-scale, 1)); font-weight: 600; }
  thead th:first-child { width: 68px; }
  thead th span { margin-right: 4px; color: var(--accent); font-family: var(--font-mono); font-size: calc(20px * var(--font-scale, 1)); font-weight: 900; }
  tbody th { background: rgba(255, 255, 255, 0.04); color: var(--grouping-muted-on-dark); }
  tbody th span,
  tbody th small,
  td strong,
  td small { display: block; }
  tbody th span { color: var(--accent); font-family: var(--font-mono); font-size: calc(16px * var(--font-scale, 1)); font-weight: 800; }
  tbody th small { margin-top: 3px; font-size: calc(10px * var(--font-scale, 1)); font-weight: 500; }
  td { border: 1px solid rgba(255, 255, 255, 0.07); background: rgba(255, 255, 255, 0.045); }
  td strong { overflow: hidden; color: var(--on-dark); font-size: calc(14px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  td small { margin-top: 4px; color: var(--grouping-dim-on-dark); font-family: var(--font-mono); font-size: calc(10px * var(--font-scale, 1)); }
  td.empty { color: var(--grouping-dim-on-dark); }
  td.slow-hidden {
    padding: 4px;
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.1);
    background: rgba(255, 255, 255, 0.025);
    box-shadow: none;
  }
  .slow-reveal-cell {
    width: 100%;
    min-height: 58px;
    border: 1px dashed rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
    border-radius: 8px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.025);
    color: var(--on-dark-muted);
    cursor: pointer;
    font-size: calc(24px * var(--font-scale, 1));
    line-height: 1;
  }
  .slow-reveal-cell:hover {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.42);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.08);
    color: var(--accent);
  }
  td.caimi-swapped {
    position: relative;
    border-color: rgba(255, 151, 174, 0.58);
    background: rgba(255, 151, 174, 0.13);
    box-shadow: inset 0 0 0 1px rgba(255, 151, 174, 0.12);
  }
  td.caimi-favored {
    border-color: rgba(255, 218, 96, 0.78);
    background: linear-gradient(145deg, rgba(255, 218, 96, 0.22), rgba(255, 129, 164, 0.16));
    box-shadow: 0 0 20px rgba(255, 205, 91, 0.14), inset 0 0 0 1px rgba(255, 218, 96, 0.18);
  }
  td.slow-hidden.caimi-swapped,
  td.slow-hidden.caimi-favored {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.1);
    background: rgba(255, 255, 255, 0.025);
    box-shadow: none;
  }
  .caimi-swap-badge {
    position: absolute;
    top: -6px;
    right: -5px;
    padding: 2px 5px;
    border-radius: 5px;
    background: #ff8aaa;
    color: #35151e;
    font-size: calc(8px * var(--font-scale, 1));
    font-style: normal;
    font-weight: 950;
    letter-spacing: 0.06em;
  }
  td.caimi-favored .caimi-swap-badge { background: #ffdc65; }

  .empty-result {
    display: grid;
    min-height: 0;
    align-content: center;
    justify-items: center;
    color: var(--grouping-dim-on-dark);
    text-align: center;
  }
  .battle-empty-result { gap: 8px; }
  .battle-empty-result p { color: var(--grouping-dim-on-dark); font-size: calc(12px * var(--font-scale, 1)); text-align: center; }
  .empty-grid { display: grid; grid-template-columns: repeat(3, 42px); gap: 7px; margin-bottom: 18px; transform: rotate(-4deg); }
  .empty-grid i { display: grid; height: 42px; border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.2); border-radius: 9px; background: rgb(var(--app-accent-rgb, 231 255 114) / 0.055); color: var(--accent); font-family: var(--font-mono); font-size: calc(14px * var(--font-scale, 1)); font-style: normal; place-items: center; }

  .preview-status {
    color: var(--on-dark-muted);
    font-size: calc(12px * var(--font-scale, 1));
  }

  .preview-status.warning { color: #dca797; }

  .preview-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: calc(7px * var(--grouping-layout-scale, 1));
    margin-top: calc(18px * var(--grouping-layout-scale, 1));
  }

  /* 三列工作区在大字号下会压缩中间列，卡片不足一列时自动降为单列。 */
  .grouping-workbench.desktop .preview-list {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  }

  .preview-tier-divider {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 9px;
    margin: 9px 0 2px;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  .preview-tier-divider.first-tier { margin-top: 0; }

  .preview-tier-divider i {
    height: 1px;
    flex: 1;
    background: linear-gradient(90deg, transparent, rgb(var(--app-accent-rgb, 231 255 114) / 0.38));
  }

  .preview-tier-divider i:last-child {
    background: linear-gradient(90deg, rgb(var(--app-accent-rgb, 231 255 114) / 0.38), transparent);
  }

  .append-preview-user,
  .preview-insert-form button {
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.05);
    color: var(--accent);
    cursor: pointer;
  }

  .append-preview-user:hover,
  .preview-insert-form button:hover {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.48);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.12);
    color: var(--accent);
  }

  .append-preview-user {
    grid-column: 1 / -1;
    justify-self: center;
    padding: 6px 11px;
    border-radius: 8px;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .preview-insert-form {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 7px;
    width: 100%;
    padding: 9px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.34);
    border-radius: 9px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.07);
    box-sizing: border-box;
  }

  .preview-insert-form label {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(80px, 1fr);
    align-items: center;
    gap: 8px;
    color: var(--on-dark-muted);
    font-size: calc(11px * var(--font-scale, 1));
  }

  .preview-insert-form input {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 6px;
    outline: none;
    background: rgba(3, 5, 5, 0.45);
    color: var(--on-dark);
    font: inherit;
  }

  .preview-insert-form input:focus { border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.55); }

  .preview-insert-form button {
    padding: 5px 9px;
    border-radius: 6px;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .preview-insert-form button.cancel {
    border-color: rgba(255, 255, 255, 0.1);
    background: transparent;
    color: var(--grouping-dim-on-dark);
  }

  .preview-insert-form small {
    grid-column: 1 / -1;
    color: #ff957d;
    font-size: calc(10px * var(--font-scale, 1));
  }

  .preview-empty {
    display: grid;
    min-height: 80px;
    margin-top: 16px;
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: var(--grouping-dim-on-dark);
    font-size: calc(12px * var(--font-scale, 1));
    gap: 12px;
    padding: 18px;
    place-items: center;
  }

  .rank-order-lock {
    margin-top: 12px;
    padding: 9px 11px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.18);
    border-radius: 9px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.045);
    color: var(--on-dark-muted);
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.55;
  }

  .grouping-actions {
    display: flex;
    align-items: stretch;
    gap: calc(9px * var(--grouping-layout-scale, 1));
    margin-top: calc(13px * var(--grouping-layout-scale, 1));
  }

  .grouping-actions.desktop-actions {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 4fr) minmax(0, 3fr);
  }
  .battle-page .grouping-actions.desktop-actions { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .grouping-actions .generate-button {
    min-height: 48px;
    flex: 1;
    margin-top: 0;
  }

  .grouping-actions .rank-generate-button {
    width: auto;
    padding: 10px 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 72%, white);
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    box-shadow: 0 8px 22px rgb(var(--app-accent-rgb, 231 255 114) / 0.22);
    color: var(--accent-ink);
    font-size: calc(14px * var(--font-scale, 1));
  }

  .grouping-actions .rank-generate-button i {
    margin-left: 12px;
    color: var(--accent-ink);
    font-size: calc(17px * var(--font-scale, 1));
  }

  .rank-preview-button {
    min-height: 48px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--accent-strong) 42%, transparent);
    border-radius: 11px;
    background: linear-gradient(145deg, var(--accent-soft), color-mix(in srgb, var(--accent) 38%, var(--color-app-surface-raised)));
    box-shadow: 0 6px 16px rgb(var(--app-accent-rgb, 231 255 114) / 0.13);
    color: var(--accent-ink);
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
  }

  .rank-preview-button:hover:not(:disabled) {
    border-color: var(--accent-strong);
    background: linear-gradient(145deg, var(--accent-soft), color-mix(in srgb, var(--accent) 52%, var(--color-app-surface-raised)));
    color: var(--accent-ink);
    transform: translateY(-1px);
  }

  .grouping-actions .rank-preview-button:disabled,
  .grouping-actions .rank-generate-button:disabled {
    cursor: not-allowed;
    filter: grayscale(0.8);
    opacity: 0.32;
  }

  .input-order-button {
    min-height: 48px;
    min-width: 0;
    padding: 10px 13px;
    border: 1px solid color-mix(in srgb, var(--accent-strong) 35%, transparent);
    border-radius: 11px;
    background: linear-gradient(145deg, var(--color-app-surface-raised), var(--accent-soft));
    box-shadow: 0 6px 16px rgb(var(--app-accent-rgb, 231 255 114) / 0.1);
    color: var(--accent-ink);
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
  }

  .input-order-button:hover:not(:disabled) {
    border-color: var(--accent-strong);
    background: linear-gradient(145deg, var(--accent-soft), color-mix(in srgb, var(--accent) 32%, var(--color-app-surface-raised)));
    color: var(--accent-ink);
    transform: translateY(-1px);
  }

  .input-order-button:disabled {
    cursor: not-allowed;
    filter: grayscale(0.8);
    opacity: 0.32;
  }

  .grouping-sidebar {
    /* 排名区使用略紧凑的字号，避免缩小列宽后内容显得拥挤。 */
    --font-scale: calc(var(--workspace-font-scale, 1) * 0.9);
    display: grid;
    height: 100%;
    min-height: 0;
    min-width: 0;
    align-content: start;
    align-self: stretch;
    gap: calc(9px * var(--grouping-layout-scale, 1));
    /* 排名只跟随右侧两排的高度，自身条目数量不能反向撑开页面。 */
    contain: size;
  }

  .grouping-sidebar.ranking-open { grid-template-rows: minmax(0, 1fr) auto; }
  .grouping-sidebar.history-open { grid-template-rows: auto minmax(0, 1fr); }

  .desktop-accordion {
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 13px;
    background: var(--color-app-surface);
    color: var(--color-app-text);
  }

  .desktop-accordion-toggle {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) auto 18px;
    align-items: center;
    gap: calc(8px * var(--grouping-layout-scale, 1));
    padding: calc(13px * var(--grouping-layout-scale, 1)) calc(14px * var(--grouping-layout-scale, 1));
    border: 0;
    background: transparent;
    color: var(--color-app-text);
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
    text-align: left;
  }

  .desktop-accordion-toggle strong {
    color: var(--accent-strong);
    font-size: calc(11px * var(--font-scale, 1));
  }

  .desktop-accordion-toggle i {
    color: var(--grouping-dim-on-light);
    font-family: var(--font-mono);
    font-size: calc(16px * var(--font-scale, 1));
    font-style: normal;
    text-align: right;
  }

  .desktop-accordion.open .desktop-accordion-toggle {
    border-bottom: 1px solid rgba(36, 37, 31, 0.08);
  }

  .desktop-accordion.open {
    display: flex;
    min-height: 0;
    flex-direction: column;
  }

  .desktop-accordion-content { padding: calc(12px * var(--grouping-layout-scale, 1)); }

  .rank-manager {
    --rank-gold: var(--accent);
    --rank-lime: var(--accent);
    --rank-ink: var(--workspace-deep);
    --rank-number-size: calc(40px * var(--grouping-layout-scale, 1));
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    background:
      radial-gradient(circle at 18% 0%, rgb(var(--app-accent-rgb, 231 255 114) / 0.2), transparent 29%),
      radial-gradient(circle at 92% 18%, rgb(var(--app-accent-rgb, 231 255 114) / 0.12), transparent 26%),
      linear-gradient(155deg, var(--color-app-workspace), var(--workspace-deep) 58%, var(--color-app-workspace));
    color: var(--on-dark);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08);
  }

  .rank-manager form {
    display: grid;
    gap: 8px;
  }

  .rank-person-form {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.38);
    border-radius: 12px;
    background:
      linear-gradient(135deg, rgb(var(--app-accent-rgb, 231 255 114) / 0.12), rgb(var(--app-accent-rgb, 231 255 114) / 0.05)),
      color-mix(in srgb, var(--workspace-deep) 72%, transparent);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.18);
  }

  .rank-form-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .rank-form-heading strong {
    color: var(--rank-gold);
    font-size: calc(15px * var(--font-scale, 1));
    letter-spacing: 0.08em;
  }

  .rank-manager form > label {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
  }

  .rank-manager label > span {
    color: var(--on-dark-muted);
    font-size: calc(12px * var(--font-scale, 1));
  }

  .rank-manager input {
    width: 100%;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.42);
    border-radius: 8px;
    outline: 0;
    background: var(--surface-field);
    color: var(--color-app-text);
    font-family: var(--font-sans);
    font-size: calc(14px * var(--font-scale, 1));
  }

  .rank-manager input:focus {
    border-color: var(--rank-lime);
    box-shadow: 0 0 0 3px rgb(var(--app-accent-rgb, 231 255 114) / 0.17), 0 0 20px rgb(var(--app-accent-rgb, 231 255 114) / 0.1);
  }

  .save-user {
    padding: 9px;
    border: 0;
    border-radius: 7px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.55);
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    color: var(--accent-ink);
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 900;
    box-shadow: 0 6px 18px rgb(var(--app-accent-rgb, 231 255 114) / 0.19);
  }

  .ranking-error {
    margin-top: 8px;
    padding: 7px;
    border-radius: 6px;
    background: rgba(210, 83, 54, 0.09);
    color: #ad4832;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .ranking-transfer-actions {
    display: flex;
    justify-content: flex-end;
    gap: calc(6px * var(--grouping-layout-scale, 1));
    margin: calc(3px * var(--grouping-layout-scale, 1)) 0 calc(8px * var(--grouping-layout-scale, 1));
  }

  .rank-keyboard-order {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: calc(5px * var(--grouping-layout-scale, 1));
    margin: calc(2px * var(--grouping-layout-scale, 1)) 0 calc(7px * var(--grouping-layout-scale, 1));
    padding: calc(7px * var(--grouping-layout-scale, 1)) calc(8px * var(--grouping-layout-scale, 1));
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.36);
    border-radius: 10px;
    background: linear-gradient(135deg, rgb(var(--app-accent-rgb, 231 255 114) / 0.15), rgb(var(--app-accent-rgb, 231 255 114) / 0.07));
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.07);
  }

  .rank-keyboard-order.active {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.74);
    background: linear-gradient(135deg, rgb(var(--app-accent-rgb, 231 255 114) / 0.23), rgb(var(--app-accent-rgb, 231 255 114) / 0.12));
    box-shadow: 0 0 24px rgb(var(--app-accent-rgb, 231 255 114) / 0.12);
  }

  .rank-keyboard-order > span { min-width: 0; }
  .rank-keyboard-order strong,
  .rank-keyboard-order small { display: inline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-keyboard-order strong { color: var(--on-dark); font-size: calc(13px * var(--font-scale, 1)); }
  .rank-keyboard-order small { margin-left: 6px; color: var(--on-dark-muted); font-size: calc(12px * var(--font-scale, 1)); }
  .rank-keyboard-order button {
    padding: calc(5px * var(--grouping-layout-scale, 1)) calc(7px * var(--grouping-layout-scale, 1));
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.4);
    border-radius: 6px;
    background: var(--workspace-highlight);
    color: var(--on-dark);
    cursor: pointer;
    font-size: calc(11px * var(--font-scale, 1));
    font-weight: 800;
  }
  .rank-keyboard-order .cancel-rank-move { border-color: rgba(255, 127, 99, 0.42); color: #ffc0b0; }

  .ranked-user-list {
    display: grid;
    height: auto;
    min-height: 240px;
    flex: 1;
    align-content: start;
    margin-top: calc(4px * var(--grouping-layout-scale, 1));
    padding: calc(9px * var(--grouping-layout-scale, 1)) calc(3px * var(--grouping-layout-scale, 1)) calc(13px * var(--grouping-layout-scale, 1)) 0;
    overflow-y: auto;
  }

  .rank-manager.reordering .ranked-user-list {
    opacity: 0.68;
    pointer-events: none;
  }

  .ranked-user-list > p {
    padding: 12px 3px;
    color: var(--on-dark-muted);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .rank-zone {
    display: grid;
    align-content: start;
    gap: calc(8px * var(--grouping-layout-scale, 1));
  }

  .rank-zone.unranked-zone {
    margin-top: calc(13px * var(--grouping-layout-scale, 1));
    padding-top: calc(9px * var(--grouping-layout-scale, 1));
    border-top: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.28);
    transition: border-color 120ms ease, background 120ms ease;
  }

  .rank-zone.unranked-zone.drop-active {
    border-top-color: var(--accent-strong);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.08);
  }

  .rank-zone-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 3px;
  }

  .rank-zone-heading strong {
    color: var(--on-dark);
    font-size: calc(15px * var(--font-scale, 1));
    letter-spacing: 0.08em;
  }

  .rank-zone-heading span {
    color: var(--on-dark-muted);
    font-size: calc(12px * var(--font-scale, 1));
    text-align: right;
  }

  .empty-ranked-drop {
    display: grid;
    min-height: 76px;
    padding: 10px;
    border: 1px dashed rgb(var(--app-accent-rgb, 231 255 114) / 0.32);
    border-radius: 10px;
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.04);
    color: var(--on-dark-muted);
    font-size: calc(11px * var(--font-scale, 1));
    line-height: 1.45;
    text-align: center;
    place-items: center;
  }

  .empty-ranked-drop.active {
    border-color: var(--accent-strong);
    background: rgb(var(--app-accent-rgb, 231 255 114) / 0.13);
  }

  .ranked-user-list article {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: calc((70px + 24px * var(--workspace-font-scale, 1)) * var(--ranking-row-height-scale, 1));
    grid-template-columns: var(--rank-number-size) minmax(0, 1fr);
    align-items: center;
    gap: calc(4px + 4px * var(--font-scale, 1));
    padding: calc(4px + 8px * var(--font-scale, 1)) calc(3px + 8px * var(--font-scale, 1));
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.52);
    border-radius: 14px;
    overflow: hidden;
    background:
      radial-gradient(circle at 96% 0%, rgb(var(--app-accent-rgb, 231 255 114) / 0.16), transparent 29%),
      linear-gradient(135deg, var(--surface-field), var(--color-app-surface));
    cursor: grab;
    touch-action: none;
    user-select: none;
    box-shadow: 0 9px 24px rgba(0, 0, 0, 0.24), inset 0 1px rgba(255, 255, 255, 0.9);
    transform: translate3d(0, 0, 0);
    transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease, transform 120ms ease;
  }

  .ranked-user-list article:active { cursor: grabbing; }

  .ranked-user-list article:hover {
    border-color: rgb(var(--app-accent-rgb, 231 255 114) / 0.82);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 18px rgb(var(--app-accent-rgb, 231 255 114) / 0.11);
  }

  .ranked-user-list article.keyboard-selected {
    z-index: 3;
    border-color: #1fbbe5;
    outline: 4px solid #55dcff;
    outline-offset: 3px;
    background:
      radial-gradient(circle at 96% 0%, rgba(85, 220, 255, 0.38), transparent 34%),
      linear-gradient(135deg, #ffffff, #dff8ff);
    box-shadow:
      0 6px 0 #087a99,
      0 18px 34px rgba(0, 0, 0, 0.48),
      0 0 30px rgba(85, 220, 255, 0.52),
      inset 0 1px rgba(255, 255, 255, 0.95);
    transform: translate3d(0, -5px, 0);
  }

  .ranked-user-list article.keyboard-selected .rank-number {
    border-color: #b8f4ff;
    background: linear-gradient(145deg, #087e9f, #053b50);
    color: #ffffff;
    box-shadow:
      inset 0 1px rgba(255, 255, 255, 0.24),
      0 6px 0 #032b3a,
      0 10px 18px rgba(4, 64, 84, 0.35);
  }

  .ranked-user-list article.insert-before {
    border-top-color: var(--accent-strong);
    box-shadow: inset 0 5px rgb(var(--app-accent-rgb, 231 255 114) / 0.3);
  }

  .ranked-user-list article.insert-after {
    border-bottom-color: var(--accent-strong);
    box-shadow: inset 0 -5px rgb(var(--app-accent-rgb, 231 255 114) / 0.3);
  }

  .ranked-user-list article.replace-target {
    border-color: rgba(182, 106, 53, 0.72);
    box-shadow: inset 0 0 0 4px rgba(205, 128, 66, 0.24);
  }

  .ranked-user-list article.drag-source { opacity: 0.44; }

  .rank-number {
    display: grid;
    width: var(--rank-number-size);
    height: var(--rank-number-size);
    align-self: center;
    justify-self: center;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.78);
    border-radius: calc(8px + 4px * var(--font-scale, 1));
    background: linear-gradient(145deg, var(--workspace-highlight), var(--workspace-deep));
    color: var(--rank-lime);
    font-family: var(--font-mono);
    font-size: calc(19px * var(--font-scale, 1));
    font-weight: 950;
    text-align: center;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.1), 0 5px 12px rgba(0, 0, 0, 0.24);
    place-items: center;
  }

  .rank-number > span {
    display: grid;
    width: 100%;
    height: 100%;
    line-height: 1;
    place-items: center;
  }

  .ranked-user-content { min-width: 0; }

  .ranked-user-heading {
    position: relative;
    display: block;
    min-width: 0;
    min-height: calc(26px * var(--font-scale, 1));
  }

  .ranked-user-heading button {
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .ranked-user-heading .user-name {
    display: block;
    width: 66.666%;
    min-width: 0;
    overflow: visible;
    color: var(--color-app-text);
    font-size: calc(18px * var(--font-scale, 1));
    font-weight: 950;
    line-height: calc(26px * var(--font-scale, 1));
    text-align: center;
  }

  .ranked-user-actions {
    position: absolute;
    z-index: 2;
    top: 50%;
    right: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0 4px 14px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--surface-field) 97%, transparent), var(--accent-soft) 14px);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-50%);
    transition: opacity 100ms ease, visibility 0s linear 100ms;
  }

  .alias-action,
  .delete-user,
  .clear-aliases {
    padding: 4px 5px !important;
    border: 1px solid color-mix(in srgb, var(--accent-strong) 34%, transparent) !important;
    border-radius: 6px;
    background: var(--accent-soft) !important;
    color: var(--accent-ink);
    font-size: calc(11px * var(--font-scale, 1));
  }

  .ranked-user-heading:hover .ranked-user-actions,
  .ranked-user-heading.actions-active .ranked-user-actions {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
  }

  .ranked-user-heading button:focus-visible,
  .clear-aliases:focus-visible {
    border-radius: 4px;
    outline: 2px solid rgba(56, 111, 171, 0.55);
    outline-offset: 2px;
  }

  .delete-user,
  .clear-aliases {
    border-color: rgba(159, 65, 47, 0.34) !important;
    background: #f9dfd8 !important;
    color: #8f382b;
  }

  .alias-action:hover { color: var(--accent-ink); }
  .delete-user:hover,
  .clear-aliases:hover { color: #a92f1b; }

  .ranked-user-aliases {
    display: block;
    min-width: 0;
    margin-top: 7px;
  }

  .ranked-user-aliases > small {
    display: block;
    max-height: 70px;
    overflow-x: hidden;
    overflow-y: auto;
    padding-right: 4px;
    color: #9c4f91;
    font-weight: 750;
    font-size: calc(14px * var(--font-scale, 1));
    line-height: 1.45;
    overflow-wrap: anywhere;
    scrollbar-color: #888b7c #e7e4da;
    scrollbar-width: thin;
  }

  .clear-aliases {
    padding: 3px 5px;
    border: 1px solid rgba(159, 65, 47, 0.24);
    border-radius: 5px;
    background: #fbefec;
    cursor: pointer;
    white-space: nowrap;
  }

  .inline-rank-edit {
    display: grid;
    min-width: 0;
    gap: 6px !important;
  }

  .inline-rank-edit > div {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }

  .inline-rank-edit > div > input,
  .inline-rank-edit > div > strong {
    min-width: 0;
    flex: 1;
  }

  .inline-rank-edit > div > strong {
    overflow: hidden;
    font-size: calc(14px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline-rank-edit input {
    padding: 5px 7px;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .inline-rank-edit > div > span {
    display: flex;
    gap: 4px;
  }

  .inline-rank-edit button {
    width: 25px;
    height: 25px;
    padding: 0;
    border: 1px solid rgba(36, 37, 31, 0.12);
    border-radius: 6px;
    background: var(--color-app-surface-raised);
    color: var(--accent-ink);
    cursor: pointer;
  }

  .inline-rank-edit button:last-child { color: #9b5a4b; }

  .inline-rank-edit small {
    overflow: hidden;
    color: var(--grouping-dim-on-light);
    font-size: calc(11px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rank-drop-guides {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    grid-template-rows: 1fr 2fr 1fr;
    background: color-mix(in srgb, var(--surface-field) 76%, transparent);
    pointer-events: none;
  }

  .rank-drop-guides.insert-only {
    grid-template-rows: 1fr 1fr;
  }

  .rank-drop-guides i {
    display: block;
    border-block: 1px dashed rgb(var(--app-accent-rgb, 231 255 114) / 0.2);
    background: rgba(67, 128, 193, 0.11);
    opacity: 0.72;
  }

  .insert-before .rank-drop-guides i:first-child,
  .insert-after .rank-drop-guides i:last-child {
    background: rgba(48, 119, 194, 0.42);
    opacity: 1;
  }

  .replace-target .rank-drop-guides i:nth-child(2) {
    background: rgba(205, 128, 66, 0.46);
    opacity: 1;
  }

  .rank-drag-ghost {
    position: fixed;
    z-index: 1000;
    display: flex;
    max-width: 240px;
    align-items: center;
    gap: 8px;
    padding: 9px 13px;
    border: 1px solid rgb(var(--app-accent-rgb, 231 255 114) / 0.58);
    border-radius: 10px;
    overflow: hidden;
    background: color-mix(in srgb, var(--workspace-deep) 94%, transparent);
    color: var(--on-dark);
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
    pointer-events: none;
    text-overflow: ellipsis;
    transform: translate(14px, 14px);
    white-space: nowrap;
  }

  .history-import-status {
    margin-top: 7px;
    color: var(--accent-ink);
    font-size: calc(10px * var(--font-scale, 1));
    text-align: right;
  }

  .history-status {
    margin: 0;
    color: var(--accent-strong);
    font-size: calc(11px * var(--font-scale, 1));
    white-space: nowrap;
  }

  .history-status.error { color: #dc725b; }

  @media (min-width: 1251px) {
    .grouping-workbench:not(.desktop) .grouping-sidebar {
      grid-column: 1 / -1;
      grid-row: 3;
      height: auto;
      contain: none;
    }
    .grouping-workbench:not(.desktop) .grouping-center { display: contents; }
    .grouping-workbench:not(.desktop) .preview-panel { grid-column: 1; grid-row: 1; }
    .grouping-workbench:not(.desktop) .grouping-config { grid-column: 2; grid-row: 1; }
    .grouping-workbench:not(.desktop) .grouping-result {
      grid-column: 1 / 3;
      grid-row: 2;
      margin-top: clamp(18px, 2.5vw, 34px);
    }
    .grouping-workbench.desktop {
      grid-template-rows: minmax(360px, 1fr) auto;
    }
    .grouping-workbench.desktop.web-layout {
      /* Web 端字号放大时保留三列位置，同时不让侧栏按字号挤占中间预览区。 */
      grid-template-columns: minmax(calc(260px * var(--ranking-width-scale, 1)), calc(310px * var(--ranking-width-scale, 1))) minmax(0, 1fr) minmax(300px, 360px);
      gap: clamp(14px, 1.7vw, 25px);
    }
    .grouping-workbench.desktop .grouping-center { display: contents; }
    .grouping-workbench.desktop .grouping-sidebar { grid-column: 1; grid-row: 1 / span 2; }
    .grouping-workbench.desktop .preview-panel {
      grid-column: 2;
      grid-row: 1;
    }
    .grouping-workbench.desktop .grouping-config {
      display: flex;
      grid-column: 3;
      grid-row: 1;
      align-self: stretch;
      flex-direction: column;
    }
    .grouping-workbench.desktop .names-field {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
    .grouping-workbench.desktop .grouping-result {
      grid-column: 2 / 4;
      grid-row: 2;
      margin-top: clamp(18px, 2.5vw, 34px);
    }
  }

  @media (max-width: 1250px) {
    .grouping-workbench:not(.desktop) .grouping-sidebar {
      grid-column: 1 / -1;
      grid-row: 3;
      height: auto;
      contain: none;
    }
    .grouping-workbench.desktop {
      grid-template-columns:
        minmax(calc(250px * var(--grouping-layout-scale, 1) * var(--ranking-width-scale, 1)), calc(290px * var(--grouping-layout-scale, 1) * var(--ranking-width-scale, 1)))
        minmax(0, 1fr);
    }

    .grouping-workbench.desktop .grouping-sidebar { grid-column: 1; grid-row: 1 / span 2; }
    .grouping-workbench.desktop .grouping-center { grid-column: 2; grid-row: 1; }
    .grouping-workbench.desktop .grouping-config { grid-column: 2; grid-row: 2; width: min(100%, 420px); }

    /* 对战结果区在中等窗口也会比整页窄，颜色控件需要换到工具栏下一行，不能横向裁掉。 */
    .battle-result-toolbar { flex-wrap: wrap; }
    .battle-color-controls {
      flex: 1 1 100%;
      grid-template-columns: max-content minmax(0, 1fr) max-content;
    }
    .battle-color-custom { min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 900px) {
    .grouping-page { min-height: 0; border-radius: 19px 19px 0 0; }
    .grouping-workbench,
    .grouping-workbench.desktop { grid-template-columns: minmax(0, 1fr); }
    .grouping-workbench.desktop .grouping-sidebar,
    .grouping-workbench.desktop .grouping-center,
    .grouping-workbench.desktop .grouping-config { grid-column: 1; grid-row: auto; width: 100%; }
    .grouping-config { width: 100%; }
    .grouping-sidebar,
    .grouping-sidebar.ranking-open,
    .grouping-sidebar.history-open { height: auto; grid-template-rows: auto; contain: none; }
    .ranked-user-list { height: min(540px, 56vh); flex: none; }
    .battle-preview-settings { grid-template-columns: minmax(0, 1fr); }
    .battle-preview-settings .battle-fixed-group { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 600px) {
    .grouping-page { padding: 24px 14px; }
    .grouping-config, .preview-panel, .grouping-result { padding: 17px; }
    .preview-list { grid-template-columns: minmax(0, 1fr); }
    .battle-result-toolbar { align-items: flex-start; flex-direction: column; }
    .battle-color-controls { grid-template-columns: minmax(0, 1fr); }
    .battle-color-actions { flex-direction: row; }
    .battle-color-actions :global(button) { flex: 1; }
    .grouping-actions { flex-direction: column; }
    .grouping-actions.desktop-actions { grid-template-columns: minmax(0, 1fr); }
  }
</style>
