<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, tick } from 'svelte';
  import type { AppVariant } from './app-variant';
  import {
    battleFixedSeedOptions,
    battleTmpScoresWithMagicFill,
    battleTmpSlotOrigin,
    battleTmpWinnerId,
    createAvoidSameGroupPlan,
    createBattleTmpSnapshot,
    createFixedBattlePositions,
    createSeededBattlePlan,
    parseBattleTmpSnapshot,
    updateBattleTmpResult,
    type BattleFormat,
    type BattleOrderMode,
    type BattlePosition,
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from './battle';
  import { createBattleBracketWorkbook } from './battle-excel';
  import { downloadExcel, downloadExcelBytes, downloadFormattedJson } from './file-export';
  import {
    createLineupHistoryTransfer,
    parseLineupHistoryTransfer,
  } from './lineup-history-transfer';
  import { parseOptionText } from './parse-options';
  import {
    createRankingTransfer,
    parseRankingTransfer,
    type RankedUserTransfer,
  } from './ranking-transfer';
  import {
    applyCaimiLineupSwap,
    createLineupRankingSnapshot,
    createRandomLineup,
    insertLineupPreviewName,
    isResolvedLineupName,
    lineupOrderAvailability,
    lineupPreviewTierStarts,
    nextRankedUserActionIndex,
    orderResolvedLineupNames,
    rankedUserIdAtShortcut,
    rankedUserDropTargetForCard,
    rankedUserKeyboardDropPoints,
    recentLineupHistories,
    unresolvedLineupNameCount,
    uniqueLineupNames,
    uniqueResolvedLineupPeople,
    updateRankShortcutInput,
    type RankedUserDropTarget,
    type RandomLineup,
  } from './random-lineup';
  import { isMultilineTextConfirm, isSingleLineTextConfirm, isTextEditCancel } from './text-shortcuts';
  import type { RankedUser, ResolvedLineupName, SavedLineup } from './types';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';
  export let purpose: 'grouping' | 'battle' = 'grouping';

  type LineupOrderMode = 'rank' | 'input';
  type BattleColorName = 'background' | 'text' | 'participant' | 'match';
  type BattleColors = Record<BattleColorName, string>;
  type DesktopPanel = 'ranking' | 'history';
  type LineupHistoryDeletion =
    | { kind: 'one'; history: SavedLineup }
    | { kind: 'all'; confirmation: 1 | 2 };

  let sourceText = '';
  let confirmedSourceText = '';
  let sourceTextarea: HTMLTextAreaElement | null = null;
  let groupCount = 4;
  let result: RandomLineup | null = null;
  let resultSignature = '';
  let error = '';
  let mounted = false;
  let desktopInitialized = false;
  let resolvingNames = false;
  let resolvedNames: ResolvedLineupName[] = [];
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
  let resultOrderMode: LineupOrderMode = 'input';
  let resultSourceNames: string[] = [];
  let resultOrderedNames: string[] = [];
  let resultHistory: SavedLineup | null = null;
  let lineupHistories: SavedLineup[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyImportStatus = '';
  let historyStart = '';
  let historyEnd = '';
  let pendingLineupHistoryDeletion: LineupHistoryDeletion | null = null;
  let historyDeleting = false;
  let insertIndex: number | null = null;
  let insertName = '';
  let insertError = '';
  let insertInput: HTMLInputElement | null = null;
  let rankingFileInput: HTMLInputElement | null = null;
  let historyFileInput: HTMLInputElement | null = null;
  let pendingRankingImport: RankedUserTransfer[] | null = null;
  let rankingImporting = false;
  let historyImporting = false;
  let importErrorDialog: { title: string; detail: string } | null = null;
  let clearLineupConfirmation = false;
  let lineupResultElement: HTMLElement | null = null;
  const battleScoreFocusValues = new WeakMap<HTMLInputElement, string>();
  let lastConfirmedBattleScore: { matchId: string; side: 'up' | 'down' } | null = null;
  let slowRevealEnabled = true;
  let revealedLineupCells = new Set<string>();
  let allLineupCellsRevealed = false;
  let hiddenLineupCellKeys = new Set<string>();
  let battleFormat: BattleFormat = 'avoid-first-pair';
  let battleOrderMode: BattleOrderMode = 'input';
  let battleFixedSeedCount = 2;
  let battleDoubleGrandFinal = false;
  let battlePlanSignature = '';
  let battleTmpSnapshot: BattleTmpSnapshot | null = null;
  let battleSyncStatus: 'idle' | 'loading' | 'saving' | 'saved' | 'error' = 'idle';
  let battleFullscreen = false;
  let bodyOverflowBeforeBattleFullscreen = '';
  let battleColors: BattleColors = {
    background: '#191a16',
    text: '#f6f3ea',
    participant: '#f4f5ec',
    match: '#292a25',
  };

  $: battlePage = purpose === 'battle';
  $: names = uniqueLineupNames(parseOptionText(confirmedSourceText));
  $: sourceTextDirty = sourceText !== confirmedSourceText;
  $: namesSignature = names.join('\u0000');
  $: desktopRankSignature = desktopRuntime
    ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
    : 'web';
  $: inputSignature = `${groupCount}|${namesSignature}|${desktopRankSignature}`;
  $: resultOutdated = result !== null && resultSignature !== inputSignature;
  $: tierPreview = names.length > 0 ? Math.ceil(names.length / Math.max(2, Number(groupCount) || 2)) : 0;
  $: unresolvedPreviewCount = desktopRuntime
    ? unresolvedLineupNameCount(names, resolvedNames)
    : 0;
  $: previewRows = names.map((name, index) => ({
    name,
    resolved: resolvedNames[index]?.inputName === name ? resolvedNames[index] : null,
  }));
  $: previewTierStarts = new Set(lineupPreviewTierStarts(names.length, Number(groupCount)));
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
  $: visibleHistories = recentLineupHistories(lineupHistories, historyStart, historyEnd);
  $: hiddenLineupCellKeys = (() => {
    if (!result || !slowRevealEnabled || allLineupCellsRevealed) {
      return new Set<string>();
    }
    return new Set(result.tiers.flatMap((tier, tierIndex) => (
      tierIndex === 0
        ? []
        : tier.map((_, groupIndex) => lineupCellKey(tierIndex, groupIndex))
          .filter((key) => !revealedLineupCells.has(key))
    )));
  })();
  $: hiddenLineupCellCount = hiddenLineupCellKeys.size;
  $: orderAvailability = lineupOrderAvailability(
    names.length,
    desktopRuntime,
    resolvingNames,
    unresolvedPreviewCount,
  );
  $: canGenerateByInput = !sourceTextDirty && orderAvailability.input;
  $: canGenerateByRank = !sourceTextDirty && orderAvailability.rank;
  $: battleFixedOptions = battleFixedSeedOptions(names.length);
  $: if (battleFixedOptions.length > 0 && !battleFixedOptions.includes(battleFixedSeedCount)) {
    battleFixedSeedCount = battleFixedOptions[0];
  }
  $: battleConfiguredFixedCount = battleFixedOptions.length > 0 ? battleFixedSeedCount : 0;
  $: battleOrderedPreviewNames = battleOrderMode === 'rank'
    && desktopRuntime
    && !resolvingNames
    && unresolvedPreviewCount === 0
      ? orderResolvedLineupNames(resolvedNames)
      : names;
  $: battleCanExecute = !sourceTextDirty && (
    battleFormat === 'avoid-first-pair'
      ? names.length >= 4 && names.length % 2 === 0
      : battleOrderMode === 'rank' ? canGenerateByRank : canGenerateByInput
  );
  $: currentBattleSignature = [
    namesSignature,
    battleFormat,
    battleOrderMode,
    battleConfiguredFixedCount,
    battleFormat === 'double-elimination' && battleDoubleGrandFinal ? 'double-final' : 'single-final',
    battleOrderMode === 'rank' ? desktopRankSignature : 'input',
  ].join('|');
  $: battleResultOutdated = battleTmpSnapshot !== null && battlePlanSignature !== currentBattleSignature;
  $: battleTmpGroups = groupBattleTmpMatches(battleTmpSnapshot);
  $: battleTmpWinnerGroups = battleTmpGroups.filter((group) => group.stage === 'winner');
  $: battleTmpLoserGroups = battleTmpGroups.filter((group) => group.stage === 'loser');
  $: battleTmpFinalGroups = battleTmpGroups.filter((group) => group.stage === 'final');
  $: singleBattleLayout = createSingleBattleLayout(battleTmpSnapshot);
  $: battleTmpCompletedCount = battleTmpSnapshot?.matches.filter((match) => (
    match.status === 'completed' || match.status === 'skipped'
  )).length ?? 0;
  $: battleFixedPreviewPositions = battlePage
    && battleFormat !== 'avoid-first-pair'
    && battleOrderedPreviewNames.length >= 2
      ? createFixedBattlePositions(battleOrderedPreviewNames, battleConfiguredFixedCount)
      : [];
  $: battleFixedPreviewMatches = pairBattlePositions(battleFixedPreviewPositions);
  $: if (mounted && desktopRuntime && !desktopInitialized) {
    void initializeDesktop();
  }

  onMount(() => {
    mounted = true;
    if (battlePage) loadBattleColors();
    return () => {
      if (battleFullscreen) document.body.style.overflow = bodyOverflowBeforeBattleFullscreen;
    };
  });

  function battleColorStorageKey(): string {
    return `battle-colors-v1:${variant}`;
  }

  function loadBattleColors() {
    try {
      const saved = JSON.parse(localStorage.getItem(battleColorStorageKey()) ?? '{}') as Partial<BattleColors>;
      battleColors = Object.fromEntries(Object.entries(battleColors).map(([name, fallback]) => [
        name,
        typeof saved[name as BattleColorName] === 'string'
          && /^#[0-9a-f]{6}$/iu.test(saved[name as BattleColorName]!)
            ? saved[name as BattleColorName]
            : fallback,
      ])) as unknown as BattleColors;
    } catch {
      // 本地颜色损坏时继续使用默认值，不影响对战操作。
    }
  }

  function updateBattleColor(name: BattleColorName, event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    battleColors = { ...battleColors, [name]: value };
    try {
      localStorage.setItem(battleColorStorageKey(), JSON.stringify(battleColors));
    } catch {
      // 浏览器禁用本地存储时仍允许本次临时调色。
    }
  }

  async function setBattleFullscreen(fullscreen: boolean) {
    if (!battlePage || battleFullscreen === fullscreen) return;
    if (fullscreen) {
      bodyOverflowBeforeBattleFullscreen = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = bodyOverflowBeforeBattleFullscreen;
    }
    battleFullscreen = fullscreen;
    await tick();
    lineupResultElement?.focus({ preventScroll: true });
  }

  function isTextEditingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && target.matches('input, textarea, select, [contenteditable="true"]');
  }

  async function initializeDesktop() {
    desktopInitialized = true;
    await Promise.all([
      loadRankedUsers(),
      battlePage ? loadBattleTmpState() : loadLineupHistories(),
    ]);
    await tick();
    await resolveNames();
    if (battleTmpSnapshot) {
      await tick();
      battlePlanSignature = currentBattleSignature;
    }
  }

  async function resolveNames() {
    if (!desktopRuntime || names.length === 0) {
      resolutionRequest += 1;
      resolvedNames = [];
      resolvingNames = false;
      return;
    }
    const request = ++resolutionRequest;
    resolvingNames = true;
    try {
      const resolved = await invoke<ResolvedLineupName[]>('resolve_lineup_names', { names });
      if (request === resolutionRequest) {
        const uniquePeople = uniqueResolvedLineupPeople(resolved);
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
    const text = uniqueLineupNames(nextNames).join('\n');
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

  async function sortPreviewByRank() {
    if (!canGenerateByRank) return;
    cancelPreviewInsertion();
    try {
      await commitSourceNames(orderResolvedLineupNames(resolvedNames));
    } catch (reason) {
      error = messageFrom(reason, '无法按排名排序名单预览');
    }
  }

  function orderedNamesForLineup(orderMode: LineupOrderMode): string[] {
    if (!desktopRuntime) return names;
    if (orderMode === 'input') {
      return resolvedNames.map((person) => person.inputName);
    }
    return orderResolvedLineupNames(resolvedNames);
  }

  function rankScoresForLineup(orderedNames: readonly string[]): number[] {
    if (!desktopRuntime) return orderedNames.map((_, index) => index + 1);
    const rankByName = new Map(
      resolvedNames.flatMap((person) => (
        person.rank === null
          ? []
          : [[person.inputName.toLocaleLowerCase('zh-CN'), person.rank] as const]
      )),
    );
    return orderedNames.map((name, index) => (
      rankByName.get(name.toLocaleLowerCase('zh-CN')) ?? index + 1
    ));
  }

  async function generate(orderMode: LineupOrderMode = desktopRuntime ? 'rank' : 'input') {
    error = '';
    historyStatus = 'idle';
    try {
      if (desktopRuntime) {
        if (
          orderMode === 'rank'
          && unresolvedLineupNameCount(names, resolvedNames) > 0
        ) {
          throw new Error('请先在排名表中补齐所有未关联项');
        }
      }
      const orderedNames = orderedNamesForLineup(orderMode);
      const rankingSnapshot = orderMode === 'rank'
        ? createLineupRankingSnapshot(orderedNames, resolvedNames)
        : [];
      const generated = createRandomLineup(orderedNames, Number(groupCount));
      result = variant === 'caimi'
        ? applyCaimiLineupSwap(generated, rankScoresForLineup(orderedNames))
        : generated;
      resultOrderMode = orderMode;
      resultSourceNames = [...names];
      resultOrderedNames = orderedNames;
      groupCount = result.groupCount;
      const createdAt = Date.now();
      resultHistory = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `lineup-${createdAt}-${Math.random().toString(16).slice(2)}`,
        createdAt,
        input: {
          sourceNames: resultSourceNames,
          orderedNames,
          groupCount,
          orderMode,
          ...(orderMode === 'rank' ? { rankingSnapshot } : {}),
        },
        result,
      };
      const resolvedSignature = desktopRuntime
        ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
        : 'web';
      resultSignature = `${groupCount}|${names.join('\u0000')}|${resolvedSignature}`;
      resetLineupReveal();
    } catch (reason) {
      result = null;
      resultHistory = null;
      error = messageFrom(reason, '无法生成分组');
    }
  }

  async function generateBattle() {
    error = '';
    if (!battleCanExecute) {
      error = battleFormat === 'avoid-first-pair'
        ? `同组不对战1对2需要已确认的偶数名单且至少 4 项，当前为 ${names.length} 项。`
        : '请先确认名单并补齐排名关联';
      return;
    }
    try {
      const orderedNames = battleFormat === 'avoid-first-pair'
        ? names
        : orderedNamesForLineup(battleOrderMode);
      const createdPlan = battleFormat === 'avoid-first-pair'
        ? createAvoidSameGroupPlan(orderedNames)
        : createSeededBattlePlan(orderedNames, {
          format: battleFormat,
          orderMode: battleOrderMode,
          fixedSeedCount: battleConfiguredFixedCount,
          doubleGrandFinal: battleDoubleGrandFinal,
        });
      lastConfirmedBattleScore = null;
      battleTmpSnapshot = createBattleTmpSnapshot(variant, createdPlan);
      battlePlanSignature = currentBattleSignature;
      if (desktopRuntime) {
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
    } catch (reason) {
      battleTmpSnapshot = null;
      error = messageFrom(reason, '无法生成对战');
    }
  }

  async function saveHistory(lineup: SavedLineup) {
    historyStatus = 'saving';
    try {
      await invoke('save_lineup_history', { lineup, variant });
      historyStatus = 'saved';
      await loadLineupHistories();
    } catch (reason) {
      historyStatus = 'error';
      error = messageFrom(reason, '分组已生成，但无法保存历史');
    }
  }

  async function saveCurrentHistory() {
    if (
      !desktopRuntime
      || !result
      || !resultHistory
      || resultOutdated
      || historyStatus === 'saving'
      || historyStatus === 'saved'
    ) return;
    await saveHistory(resultHistory);
  }

  async function exportLineupJson() {
    if (!resultHistory) return;
    error = '';
    try {
      await downloadFormattedJson('分组结果', createLineupHistoryTransfer(resultHistory, variant));
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 JSON');
    }
  }

  async function exportLineupExcel() {
    if (!result) return;
    error = '';
    try {
      await downloadExcel('分组结果', [
        ['档位', ...result.groupNames.map((group) => `${group}组`)],
        ...result.tiers.map((tier, tierIndex) => [
          `t${tierIndex + 1}`,
          ...tier.map((entry) => entry?.name ?? ''),
        ]),
      ]);
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 Excel');
    }
  }

  async function loadRankedUsers() {
    if (!desktopRuntime) return;
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

  async function loadBattleTmpState() {
    if (!desktopRuntime || !battlePage) return;
    battleSyncStatus = 'loading';
    try {
      const value = await invoke<unknown | null>('load_battle_tmp_state', { variant });
      if (value === null) {
        battleSyncStatus = 'idle';
        return;
      }
      const state = parseBattleTmpSnapshot(value, variant);
      battleTmpSnapshot = state;
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
      battleSyncStatus = 'saved';
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, '无法读取对战临时状态');
    }
  }

  async function loadLineupHistories() {
    if (!desktopRuntime) return;
    historyLoading = true;
    historyError = '';
    try {
      lineupHistories = await invoke<SavedLineup[]>('list_lineup_histories', { variant });
    } catch (reason) {
      historyError = messageFrom(reason, '无法读取分组历史');
    } finally {
      historyLoading = false;
    }
  }

  function requestDeleteLineupHistory(history: SavedLineup) {
    pendingLineupHistoryDeletion = { kind: 'one', history };
  }

  function requestClearLineupHistories() {
    if (lineupHistories.length > 0) {
      pendingLineupHistoryDeletion = { kind: 'all', confirmation: 1 };
    }
  }

  async function confirmLineupHistoryDeletion() {
    const pending = pendingLineupHistoryDeletion;
    if (!desktopRuntime || !pending || historyDeleting) return;
    if (pending.kind === 'all' && pending.confirmation === 1) {
      pendingLineupHistoryDeletion = { kind: 'all', confirmation: 2 };
      return;
    }

    historyDeleting = true;
    historyError = '';
    historyImportStatus = '';
    try {
      if (pending.kind === 'one') {
        await invoke('delete_lineup_history', { variant, id: pending.history.id });
        lineupHistories = lineupHistories.filter((history) => history.id !== pending.history.id);
      } else {
        await invoke('clear_lineup_histories', { variant });
        lineupHistories = [];
      }
      pendingLineupHistoryDeletion = null;
    } catch (reason) {
      historyError = messageFrom(reason, pending.kind === 'one' ? '无法删除分组历史' : '无法清空分组历史');
      pendingLineupHistoryDeletion = null;
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
    if (!desktopRuntime || !normalizedName || rankingSaving) return;
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

  function resetLineupReveal() {
    revealedLineupCells = new Set();
    allLineupCellsRevealed = false;
  }

  function updateSlowReveal(event: Event) {
    slowRevealEnabled = (event.currentTarget as HTMLInputElement).checked;
    resetLineupReveal();
  }

  function lineupCellKey(tierIndex: number, groupIndex: number): string {
    return `${tierIndex}:${groupIndex}`;
  }

  function isLineupCellHidden(tierIndex: number, groupIndex: number): boolean {
    return hiddenLineupCellKeys.has(lineupCellKey(tierIndex, groupIndex));
  }

  function revealLineupCell(tierIndex: number, groupIndex: number) {
    if (!isLineupCellHidden(tierIndex, groupIndex)) return;
    revealedLineupCells = new Set(revealedLineupCells).add(lineupCellKey(tierIndex, groupIndex));
  }

  function revealAllLineupCells() {
    allLineupCellsRevealed = true;
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
      const updated = insertLineupPreviewName(names, insertIndex, insertName);
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

  function historySummary(history: SavedLineup): string {
    const input = history.input as Partial<{ sourceNames: unknown[]; groupCount: number; orderMode: LineupOrderMode }>;
    const peopleCount = Array.isArray(input.sourceNames) ? input.sourceNames.length : 0;
    const mode = input.orderMode === 'input' ? '输入顺序' : '排名';
    return `${peopleCount} 项 · ${Number(input.groupCount) || '—'} 组 · ${mode}`;
  }

  function openLineupHistoryImporter() {
    historyFileInput?.click();
  }

  async function importLineupHistoryFile(event: Event) {
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
      const history = parseLineupHistoryTransfer(await file.text());
      lineupHistories = await invoke<SavedLineup[]>('import_lineup_history', {
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

  async function openLineupDatabaseFolder(source: 'ranking' | 'history' = 'history') {
    if (source === 'ranking') rankingError = '';
    else historyError = '';
    try {
      await invoke(source === 'history' ? 'open_download_folder' : 'open_database_folder');
    } catch (reason) {
      const message = messageFrom(reason, source === 'history' ? '无法打开下载文件夹' : '无法打开数据库文件夹');
      if (source === 'ranking') rankingError = message;
      else historyError = message;
    }
  }

  function isDatabaseFileError(message: string): boolean {
    return message.startsWith('数据库文件错误：');
  }

  async function viewHistory(history: SavedLineup) {
    const historicalResult = history.result as Partial<RandomLineup>;
    if (!Array.isArray(historicalResult.groupNames) || !Array.isArray(historicalResult.tiers)) {
      historyError = '这条历史记录内容不完整';
      return;
    }
    result = historicalResult as RandomLineup;
    resultHistory = history;
    const input = history.input as Partial<{
      orderMode: LineupOrderMode;
      orderedNames: unknown[];
      sourceNames: unknown[];
    }>;
    resultOrderMode = input.orderMode === 'input' ? 'input' : 'rank';
    resultSourceNames = Array.isArray(input.sourceNames)
      ? input.sourceNames.filter((name): name is string => typeof name === 'string')
      : [];
    const savedNames = Array.isArray(input.orderedNames) ? input.orderedNames : input.sourceNames;
    resultOrderedNames = Array.isArray(savedNames)
      ? savedNames.filter((name): name is string => typeof name === 'string')
      : [];
    resultSignature = inputSignature;
    historyStatus = 'saved';
    resetLineupReveal();
    await tick();
    focusLineupResult();
  }

  function formatHistoryDate(createdAt: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(createdAt));
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
    keyboardMovingUserId = selectedRankedUserId;
    void showKeyboardRankDropPoint(sourcePoint);
  }

  function moveKeyboardRankDropPoint(delta: -1 | 1) {
    if (keyboardMovingUserId === null) return;
    void showKeyboardRankDropPoint(keyboardDropPointIndex + delta);
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
    if (userId === null || !point) return;
    cancelKeyboardRankMove();
    void moveRankedUser(userId, point.target);
  }

  function toggleKeyboardRankMove() {
    if (keyboardMovingUserId === null) beginKeyboardRankMove();
    else confirmKeyboardRankMove();
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
    selectRankedUserFromPointer(userId);
    if (aliasLinkName !== null || rankingReordering || keyboardMovingUserId !== null || event.button !== 0) return;
    // 名称占据卡片的大部分区域，也应当可以作为拖拽起点；右侧操作按钮仍只执行自身操作。
    if ((event.target as HTMLElement).closest('[data-rank-action], input, textarea, select, form')) return;
    // 避免按下时焦点让顶部操作区突然出现，导致整列卡片在拖拽开始后向下跳动。
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
    // pointermove 可能被浏览器合并，松手坐标才是最终落点；旧落点只在移出列表时兜底。
    const target = rankDropTargetAt(event.clientX, event.clientY) ?? activeRankDropTarget;
    clearRankDragState();
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

  function handleLineupKeydown(event: KeyboardEvent) {
    const target = event.target;
    const battleFocusActive = battlePage
      && target instanceof Node
      && Boolean(lineupResultElement?.contains(target));
    const key = event.key.toLowerCase();
    if (
      battlePage
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      && (target === document.body || target === lineupResultElement)
      && moveFromLastConfirmedBattleScore(event)
    ) return;
    if (
      battleFocusActive
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey
      && key === 'f'
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
      && ['i', 'j', 'k', 'l'].includes(key)
    ) {
      event.preventDefault();
      scrollBattleByKey(key);
      return;
    }
    if (
      battlePage
      && event.target === lineupResultElement
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>('.battle-result .battle-side input:not(:disabled)')
        ?.focus({ preventScroll: true });
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

    if (clearLineupConfirmation) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        clearLineupConfirmation = false;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        clearAll();
      }
      return;
    }

    if (pendingLineupHistoryDeletion) {
      if (event.key === 'Escape' || key === 'n') {
        event.preventDefault();
        pendingLineupHistoryDeletion = null;
      } else if (event.key === 'Enter' || key === 'y') {
        event.preventDefault();
        void confirmLineupHistoryDeletion();
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

    if (desktopRuntime && clearAllRankingsConfirmation !== 0) {
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

    if (desktopRuntime && (pendingDeleteUser || pendingAliasClearUser)) {
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
      if (!hadLocalOperation && desktopRuntime) desktopPanel = null;
      return;
    }

    if (isTextEditingTarget(event.target)) return;
    if (key === 'x') {
      event.preventDefault();
      cancelKeyboardRankMove();
      focusLineupResult();
      return;
    }
    if (!desktopRuntime) return;
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
    if (/^\d$/u.test(event.key) || event.key === 'Backspace') {
      event.preventDefault();
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
    if (!lineupResultElement) return;
    if (key === 'j' || key === 'l') {
      const scroller = lineupResultElement.querySelector<HTMLElement>(
        '.double-battle-scroll, .single-battle-bracket, .battle-bracket',
      );
      scroller?.scrollBy({
        left: (key === 'j' ? -1 : 1) * Math.max(280, scroller.clientWidth * 0.7),
        behavior: 'smooth',
      });
      return;
    }
    lineupResultElement.scrollBy({
      top: (key === 'i' ? -1 : 1) * Math.max(240, lineupResultElement.clientHeight * 0.65),
      behavior: 'smooth',
    });
  }

  function handleBattleMatchKeydown(event: KeyboardEvent) {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      || isTextEditingTarget(event.target)
    ) return;
    const current = event.currentTarget as HTMLElement;
    const target = closestBattleElement(
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
    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };
    const direction = key.replace('Arrow', '').toLocaleLowerCase('zh-CN');
    return candidates
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
      })
      .filter((entry) => entry.inDirection)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate ?? null;
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
    const target = event.currentTarget as HTMLInputElement;
    battleScoreFocusValues.set(target, target.value);
  }

  function handleBattleScoreKeydown(
    match: BattleTmpMatch,
    side: 'up' | 'down',
    event: KeyboardEvent,
  ) {
    const target = event.currentTarget as HTMLInputElement;
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
    if (sourceText || confirmedSourceText || battleTmpSnapshot) clearLineupConfirmation = true;
  }

  function clearAll() {
    clearLineupConfirmation = false;
    sourceText = '';
    confirmedSourceText = '';
    resolutionRequest += 1;
    resolvedNames = [];
    resolvingNames = false;
    result = null;
    resultHistory = null;
    battleTmpSnapshot = null;
    lastConfirmedBattleScore = null;
    battlePlanSignature = '';
    battleSyncStatus = 'idle';
    error = '';
    historyStatus = 'idle';
    if (desktopRuntime && battlePage) void clearPersistedBattleTmp();
  }

  function focusLineupResult() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    lineupResultElement?.focus({ preventScroll: true });
    lineupResultElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function pairBattlePositions(positions: readonly BattlePosition[]): [BattlePosition, BattlePosition][] {
    return Array.from({ length: positions.length / 2 }, (_, index) => [
      positions[index * 2],
      positions[index * 2 + 1],
    ]);
  }

  async function clearPersistedBattleTmp() {
    try {
      await invoke('clear_battle_tmp_state', { variant });
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, '无法清空对战临时状态');
    }
  }

  function groupBattleTmpMatches(snapshot: BattleTmpSnapshot | null): {
    id: string;
    label: string;
    stage: BattleTmpMatch['stage'];
    matches: BattleTmpMatch[];
  }[] {
    if (!snapshot) return [];
    const groups = new Map<string, {
      id: string;
      label: string;
      stage: BattleTmpMatch['stage'];
      matches: BattleTmpMatch[];
    }>();
    for (const match of snapshot.matches) {
      const id = `${match.stage}-${match.level}`;
      const group = groups.get(id) ?? { id, label: '', stage: match.stage, matches: [] };
      group.matches.push(match);
      groups.set(id, group);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      label: battleTmpColumnLabel(group.stage, group.matches[0].level, group.matches.length),
    }));
  }

  function createSingleBattleLayout(snapshot: BattleTmpSnapshot | null): {
    left: ReturnType<typeof groupBattleTmpMatches>;
    right: ReturnType<typeof groupBattleTmpMatches>;
    final: BattleTmpMatch | null;
  } {
    if (!snapshot || snapshot.format !== 'single-elimination') {
      return { left: [], right: [], final: null };
    }
    const levels = groupBattleTmpMatches(snapshot).filter((group) => group.stage === 'single');
    const finalGroup = levels.at(-1);
    const sideLevels = levels.slice(0, -1);
    const left = sideLevels.map((group) => ({
      ...group,
      matches: group.matches.slice(0, Math.ceil(group.matches.length / 2)),
    }));
    const right = sideLevels.map((group) => ({
      ...group,
      matches: group.matches.slice(Math.ceil(group.matches.length / 2)).reverse(),
    })).reverse();
    return { left, right, final: finalGroup?.matches[0] ?? null };
  }

  function battleTmpStageName(stage: BattleTmpMatch['stage']): string {
    if (stage === 'pairing') return '1对2';
    if (stage === 'single') return '单败';
    if (stage === 'winner') return '胜者组';
    if (stage === 'loser') return '败者组';
    return '总决赛';
  }

  function battleTmpColumnLabel(
    stage: BattleTmpMatch['stage'],
    level: number,
    matchCount: number,
  ): string {
    if (stage === 'pairing') return '1对2';
    if (stage === 'final') return level === 2 ? '重赛' : '总决赛';
    if (matchCount === 1) return '决赛';
    if (matchCount === 2) return '半决赛';
    return `1/${matchCount}`;
  }

  function battleTmpMatchCode(match: BattleTmpMatch): string {
    const stage = match.stage === 'pairing' ? 'P'
      : match.stage === 'single' ? 'S'
        : match.stage === 'winner' ? 'W'
          : match.stage === 'loser' ? 'L'
            : 'F';
    return `${stage}${match.level} P${match.position}`;
  }

  function battleTmpFormatLabel(format: BattleFormat): string {
    if (format === 'avoid-first-pair') return '同组不对战1对2';
    if (format === 'single-elimination') return '单败';
    return '双败';
  }

  function battleSyncStatusLabel(): string {
    if (battleSyncStatus === 'loading') return '读取中';
    if (battleSyncStatus === 'saving') return '同步中';
    if (battleSyncStatus === 'saved') return '已同步';
    if (battleSyncStatus === 'error') return '同步失败';
    return '尚未执行';
  }

  function battleTmpParticipantName(id: number | null): string {
    if (id === null) return '等待上游';
    return battleTmpSnapshot?.participants.find((participant) => participant.id === id)?.name ?? `#${id}`;
  }

  function battleTmpSlotName(match: BattleTmpMatch, slot: 'up' | 'down'): string {
    const participantId = slot === 'up' ? match.up : match.down;
    if (participantId !== null) return battleTmpParticipantName(participantId);
    if (!battleTmpSnapshot) return '待定';
    const origin = battleTmpSlotOrigin(battleTmpSnapshot, match, slot);
    if (!origin) return '待定';
    const originMatch = battleTmpSnapshot.matches.find((candidate) => candidate.matchId === origin.matchId);
    if (!originMatch) return '待定';
    return battleTmpMatchCode(originMatch);
  }

  function battleTmpParticipantWon(match: BattleTmpMatch, id: number | null): boolean {
    return id !== null && battleTmpWinnerId(match) === id;
  }

  function battleTmpParticipantFixed(id: number | null): boolean {
    if (id === null || !battleTmpSnapshot) return false;
    const participant = battleTmpSnapshot.participants.find((item) => item.id === id);
    return Boolean(participant && participant.seed <= battleTmpSnapshot.fixedSeedCount);
  }

  async function updateBattleScore(match: BattleTmpMatch, side: 'up' | 'down', event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const score = target.value.trim() === '' ? null : Number(target.value);
    if (score !== null && (!Number.isSafeInteger(score) || score < 0)) {
      error = '对战比分必须是非负整数';
      target.value = String(side === 'up' ? match.upResult ?? '' : match.downResult ?? '');
      return;
    }
    if (
      !battleTmpSnapshot
      || battleResultOutdated
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
    if (!desktopRuntime) return;
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
    } catch (reason) {
      battleSyncStatus = 'error';
      error = messageFrom(reason, '无法同步对战结果');
      await loadBattleTmpState();
    }
  }

  async function exportBattleTmpJson() {
    if (!battleTmpSnapshot) return;
    await downloadFormattedJson('对战状态', battleTmpSnapshot);
  }

  async function exportBattleTmpExcel() {
    if (!battleTmpSnapshot) return;
    await downloadExcelBytes('对战签表', await createBattleBracketWorkbook(battleTmpSnapshot));
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
  on:keydown={handleLineupKeydown}
  on:pointermove={moveRankPointerDrag}
  on:pointerup={finishRankPointerDrag}
  on:pointercancel={cancelRankPointerDrag}
/>

{#snippet battleMatchCard(match: BattleTmpMatch)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <article class="battle-match" tabindex="0" aria-label={`${battleTmpMatchCode(match)} 对战`} data-battle-stage={match.stage} data-battle-level={match.level} data-battle-position={match.position} on:keydown={handleBattleMatchKeydown}>
    <small>{battleTmpMatchCode(match)}</small>
    <div
      class:fixed={battleTmpParticipantFixed(match.up)}
      class:winner={battleTmpParticipantWon(match, match.up)}
      class:waiting={match.up === null}
      class="battle-side"
    >
      <div><strong>{battleTmpSlotName(match, 'up')}</strong></div>
      <input type="number" min="0" step="1" inputmode="numeric" data-battle-match-id={match.matchId} data-battle-side="up" aria-label={`${battleTmpSlotName(match, 'up')} 上方比分`} value={match.upResult ?? ''} disabled={match.up === null || match.down === null || battleResultOutdated || battleSyncStatus === 'saving' || match.status === 'skipped'} on:focus={handleBattleScoreFocus} on:keydown={(event) => handleBattleScoreKeydown(match, 'up', event)} on:change={(event) => updateBattleScore(match, 'up', event)} />
    </div>
    <div
      class:fixed={battleTmpParticipantFixed(match.down)}
      class:winner={battleTmpParticipantWon(match, match.down)}
      class:waiting={match.down === null}
      class="battle-side"
    >
      <div><strong>{battleTmpSlotName(match, 'down')}</strong></div>
      <input type="number" min="0" step="1" inputmode="numeric" data-battle-match-id={match.matchId} data-battle-side="down" aria-label={`${battleTmpSlotName(match, 'down')} 下方比分`} value={match.downResult ?? ''} disabled={match.up === null || match.down === null || battleResultOutdated || battleSyncStatus === 'saving' || match.status === 'skipped'} on:focus={handleBattleScoreFocus} on:keydown={(event) => handleBattleScoreKeydown(match, 'down', event)} on:change={(event) => updateBattleScore(match, 'down', event)} />
    </div>
  </article>
{/snippet}

<main class:battle-page={battlePage} class="lineup-page" id={battlePage ? 'battle' : 'lineup'}>
  <div class:battle-workbench={battlePage} class:desktop={desktopRuntime} class="lineup-workbench">
    {#if desktopRuntime}
      <aside class:battle-sidebar={battlePage} class:ranking-open={desktopPanel === 'ranking'} class:history-open={desktopPanel === 'history'} class="lineup-sidebar">
        <section class:open={desktopPanel === 'ranking'} class="desktop-accordion">
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('ranking')}>
            <span>排名</span><strong>{rankedUsers.length} 项</strong><i>{desktopPanel === 'ranking' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'ranking'}
            <div class:dragging={draggingUserId !== null} class:keyboard-moving={keyboardMovingUserId !== null} class:reordering={rankingReordering} class="desktop-accordion-content rank-manager" on:focusin={() => (rankingFocusActive = true)} on:focusout={leaveRankedUserActions}>
              {#if rankingError}
                <div class="ranking-error" role="alert">{rankingError}</div>
                {#if isDatabaseFileError(rankingError)}
                  <button type="button" class="database-folder-button" on:click={() => openLineupDatabaseFolder('ranking')}>打开文件夹</button>
                {/if}
              {/if}
              <input bind:this={rankingFileInput} class="lineup-file-input" type="file" accept=".json,application/json" on:change={readRankingFile} />
              {#if rankingFocusActive}
                <div class="ranking-transfer-actions">
                  <button type="button" disabled={rankedUsers.length === 0} on:click={exportRanking}>导出 JSON</button>
                  <button
                    type="button"
                    class="ranking-import-button"
                    title={rankedUsers.length > 0 ? '全部删除后才可导入' : '导入排名 JSON'}
                    disabled={rankedUsers.length > 0 || rankingImporting}
                    on:click={openRankingImporter}
                  >导入 JSON</button>
                  <button type="button" class="delete-all-rankings" disabled={rankedUsers.length === 0 || clearingAllRankings} on:click={requestClearAllRankings}>删除全部</button>
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
                        <span class="rank-number">{user.rank}</span>
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
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('history')}>
            <span>{battlePage ? '对战状态' : '分组历史'}</span><strong>{battlePage ? '实时同步' : '最近 5 条'}</strong><i>{desktopPanel === 'history' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'history'}
            {#if battlePage}
              <div class="desktop-accordion-content history-panel battle-state-panel">
                {#if battleTmpSnapshot}
                  <div class:error={battleSyncStatus === 'error'} class:saving={battleSyncStatus === 'saving'} class="battle-state-sync" role="status">
                    <i></i><strong>{battleSyncStatusLabel()}</strong><span>{formatHistoryDate(battleTmpSnapshot.updatedAt)}</span>
                  </div>
                  <dl>
                    <div><dt>赛制</dt><dd>{battleTmpFormatLabel(battleTmpSnapshot.format)}</dd></div>
                    <div><dt>参赛者</dt><dd>{battleTmpSnapshot.participantCount} 人</dd></div>
                    <div><dt>场次行</dt><dd>{battleTmpSnapshot.matches.length} 行</dd></div>
                    <div><dt>已处理</dt><dd>{battleTmpCompletedCount} / {battleTmpSnapshot.matches.length}</dd></div>
                  </dl>
                  <p>所有赛程行已关系化保存；修改赛果时只同步该场及受影响的下游。</p>
                  <div class="history-export-actions battle-state-actions">
                    <button type="button" on:click={exportBattleTmpExcel}>导出 Excel</button>
                    <button type="button" on:click={exportBattleTmpJson}>导出 JSON</button>
                  </div>
                {:else}
                  <p class="battle-state-empty">执行对战后，这里会显示实时数据库状态。</p>
                {/if}
              </div>
            {:else}
              <div class="desktop-accordion-content history-panel">
              <input bind:this={historyFileInput} class="lineup-file-input" type="file" accept=".json,application/json" on:change={importLineupHistoryFile} />
              <div class="history-dates">
                <label><span>开始日期</span><input type="date" bind:value={historyStart} /></label>
                <label title="所选日期当天不计入结果"><span>结束前（不含）</span><input type="date" bind:value={historyEnd} /></label>
              </div>
              {#if historyError}<div class="ranking-error" role="alert">{historyError}</div>{/if}
              <div class="lineup-history-list">
                {#if historyLoading}
                  <p>正在读取分组历史…</p>
                {:else if visibleHistories.length === 0}
                  <p>日期范围内没有分组记录。</p>
                {:else}
                  {#each visibleHistories as history (history.id)}
                    <article>
                      <button type="button" class="history-view" on:click={() => viewHistory(history)}>
                        <span>{formatHistoryDate(history.createdAt)}</span>
                        <strong>{historySummary(history)}</strong>
                        <small>预览 →</small>
                      </button>
                      <div class="history-item-actions">
                        <button
                          type="button"
                          class="history-delete"
                          aria-label={`删除 ${formatHistoryDate(history.createdAt)} 的分组历史`}
                          disabled={historyDeleting}
                          on:click={() => requestDeleteLineupHistory(history)}
                        >删除</button>
                      </div>
                    </article>
                  {/each}
                {/if}
              </div>
              <div class="history-export-actions">
                <button type="button" disabled={historyImporting} on:click={openLineupHistoryImporter}>{historyImporting ? '导入中…' : '导入 JSON'}</button>
                <button type="button" on:click={() => openLineupDatabaseFolder('history')}>打开下载文件夹</button>
                <button type="button" class="history-delete-all" disabled={lineupHistories.length === 0 || historyDeleting} on:click={requestClearLineupHistories}>删除全部</button>
              </div>
              {#if historyImportStatus}<div class="history-import-status" role="status">{historyImportStatus}</div>{/if}
              </div>
            {/if}
          {/if}
        </section>
      </aside>
    {/if}

    <section class="lineup-center" aria-live="polite">
      <div class="preview-panel">
        <div class="result-heading">
          <div><span>02</span><div><h2>{battlePage ? '对战预览' : '名单预览'}</h2><p>可直接修正名字；桌面端会核对别名表</p></div></div>
          <strong class:warning={desktopRuntime && unresolvedPreviewCount > 0} class="preview-status">
            {resolvingNames ? '核对中…' : desktopRuntime && unresolvedPreviewCount > 0 ? `${unresolvedPreviewCount} 项未识别` : `${names.length} 项`}
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
              <div
                class:unknown={desktopRuntime && !resolvingNames && !isResolvedLineupName(row.name, row.resolved)}
                class="preview-row"
              >
                <button type="button" class:active={insertIndex === index} class="insert-before-button" title={`在 ${row.name} 前插入`} aria-label={`在 ${row.name} 前插入`} on:click={() => openPreviewInsertion(index)}>＋</button>
                <span class="preview-position">{String(index + 1).padStart(2, '0')}</span>
                <div class="preview-name">
                  <input value={row.name} aria-label={`第 ${index + 1} 个名称`} on:change={(event) => updatePreviewName(index, (event.currentTarget as HTMLInputElement).value)} />
                  {#if desktopRuntime}
                    <small>{resolvingNames
                      ? '核对中'
                      : row.resolved?.known
                        ? `本名 ${row.resolved.canonicalName} · 排名 ${row.resolved.rank}`
                        : '未录入排名'}</small>
                  {/if}
                </div>
                {#if desktopRuntime && !resolvingNames && !isResolvedLineupName(row.name, row.resolved)}
                  <div class="preview-link-actions">
                    <button type="button" class="link-preview-user" title="关联到现有排名" on:click={() => startAliasLink(row.name)}>关联</button>
                    <button type="button" class="add-preview-user" title="直接加入无排名" disabled={rankingSaving} on:click={() => addUnknownPerson(row.name)}>录入</button>
                  </div>
                {/if}
                <button type="button" class="remove-preview-user" title={`移除 ${row.name}`} on:click={() => removePreviewName(index)}>×</button>
              </div>
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
            <span>请先在右侧粘贴名单</span>
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
            <fieldset class="battle-radio-group battle-format-group">
              <legend>赛制</legend>
              <label><input type="radio" name="battle-format" value="avoid-first-pair" bind:group={battleFormat} /><span>同组不对战1对2</span></label>
              <label><input type="radio" name="battle-format" value="single-elimination" bind:group={battleFormat} /><span>单败</span></label>
              <label><input type="radio" name="battle-format" value="double-elimination" bind:group={battleFormat} /><span>双败</span></label>
              {#if battleFormat === 'double-elimination'}
                <label class="battle-double-final-option"><input type="checkbox" bind:checked={battleDoubleGrandFinal} /><span>双总决赛</span></label>
              {/if}
            </fieldset>
            {#if battleFormat !== 'avoid-first-pair'}
              <fieldset class="battle-radio-group">
                <legend>名单顺序</legend>
                <label title={desktopRuntime ? '' : '网页版没有排名数据库'}><input type="radio" name="battle-order" value="rank" bind:group={battleOrderMode} disabled={!desktopRuntime} /><span>按排名</span></label>
                <label><input type="radio" name="battle-order" value="input" bind:group={battleOrderMode} /><span>按输入顺序</span></label>
              </fieldset>
              <fieldset class="battle-radio-group battle-fixed-group">
                <legend>固定位置</legend>
                {#each battleFixedOptions as count}
                  <label><input type="radio" name="battle-fixed-seeds" value={count} bind:group={battleFixedSeedCount} /><span>前 {count} 固定</span></label>
                {:else}
                  <div class="battle-radio-empty">确认至少 3 项后生成选项</div>
                {/each}
              </fieldset>
            {/if}
            <div class:valid={battleCanExecute} class="battle-count-status">
              {#if sourceTextDirty}
                修改名单后请先确认
              {:else if battleFormat === 'avoid-first-pair' && !battleCanExecute}
                需要偶数名单且至少 4 项
              {:else if battleCanExecute}
                配置有效，可以执行
              {:else}
                至少需要 2 项
              {/if}
            </div>
          </div>
        {/if}

        {#if error}<div class="lineup-error" role="alert">{error}</div>{/if}

        {#if desktopRuntime && !resolvingNames && unresolvedPreviewCount > 0}
          <div class="rank-order-lock" role="status">还有未关联项，按排名操作暂不可用；可以使用输入顺序{battlePage ? '执行' : '分组'}。</div>
        {/if}

        {#if !battlePage}
          <label class="slow-reveal-setting"><input type="checkbox" checked={slowRevealEnabled} on:change={updateSlowReveal} /><span>悬念揭晓</span></label>
        {/if}
        <div class="lineup-actions" class:desktop-actions={desktopRuntime}>
          {#if battlePage}
            {#if desktopRuntime && battleFormat !== 'avoid-first-pair' && battleOrderMode === 'rank'}
              <button type="button" class="rank-preview-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按排名排序' : '按排名重新排列对战预览'} disabled={!canGenerateByRank} on:click={sortPreviewByRank}>按排名预览</button>
            {/if}
            <button type="button" class="generate-button battle-generate-button" disabled={!battleCanExecute} on:click={generateBattle}><span>{battleTmpSnapshot && !battleResultOutdated ? '重新执行' : '执行'}</span><i>→</i></button>
          {:else if desktopRuntime}
            <button type="button" class="rank-preview-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按排名排序' : '按排名重新排列名单预览'} disabled={!canGenerateByRank} on:click={sortPreviewByRank}>按排名顺序预览</button>
            <button type="button" class="generate-button rank-generate-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按排名分组' : '按排名分档'} disabled={!canGenerateByRank} on:click={() => generate('rank')}><span>按排名顺序分组</span><i>→</i></button>
            <button type="button" class="input-order-button" title="忽略排名，按当前名单顺序分档" disabled={!canGenerateByInput} on:click={() => generate('input')}>按输入顺序分组</button>
          {:else}
            <button type="button" class="generate-button" disabled={!canGenerateByInput} on:click={() => generate('input')}><span>开始分组</span><i>→</i></button>
          {/if}
        </div>
      </div>

      <div
        bind:this={lineupResultElement}
        class:battle-result={battlePage}
        class:battle-fullscreen={battleFullscreen}
        class="lineup-result"
        style={battlePage ? `--battle-background-color: ${battleColors.background}; --battle-text-color: ${battleColors.text}; --battle-participant-color: ${battleColors.participant}; --battle-match-color: ${battleColors.match};` : undefined}
        tabindex="-1"
      >
        {#if battlePage}
          <div class="battle-result-toolbar">
            <button type="button" class="battle-fullscreen-button" aria-pressed={battleFullscreen} aria-keyshortcuts="F" on:click={() => setBattleFullscreen(!battleFullscreen)}>{battleFullscreen ? '返回' : '全屏'}</button>
            <fieldset class="battle-color-controls">
              <legend>对战颜色</legend>
              <label><span>背景框</span><input type="color" aria-label="背景框颜色" value={battleColors.background} on:input={(event) => updateBattleColor('background', event)} /></label>
              <label><span>文字</span><input type="color" aria-label="文字颜色" value={battleColors.text} on:input={(event) => updateBattleColor('text', event)} /></label>
              <label><span>选手文字</span><input type="color" aria-label="选手文字颜色" value={battleColors.participant} on:input={(event) => updateBattleColor('participant', event)} /></label>
              <label><span>对战框</span><input type="color" aria-label="对战框颜色" value={battleColors.match} on:input={(event) => updateBattleColor('match', event)} /></label>
            </fieldset>
          </div>
          <div class="result-heading">
            <div><span>03</span><div><h2>对战</h2><p>{battleTmpSnapshot ? `${battleTmpSnapshot.participantCount} 项 · ${battleTmpFormatLabel(battleTmpSnapshot.format)} · ${battleTmpSnapshot.orderMode === 'rank' ? '排名' : '输入顺序'}` : battleFixedPreviewMatches.length > 0 ? '固定签位会立即显示，其他位置执行时随机' : '点击上方执行后生成对战'}</p></div></div>
            {#if battleTmpSnapshot}
              <div class="result-output-actions">
                <button type="button" class="result-export-button" on:click={exportBattleTmpExcel}>Excel</button>
                <button type="button" class="result-export-button" on:click={exportBattleTmpJson}>JSON</button>
              </div>
            {/if}
          </div>
          {#if battleResultOutdated}<div class="outdated-notice">名单、排名或配置已变化，请重新执行。</div>{/if}
          {#if battleTmpSnapshot}
            {#if battleTmpSnapshot.format === 'single-elimination'}
              <div class:outdated={battleResultOutdated} class="single-battle-bracket">
                <div class="single-bracket-side left">
                  {#each singleBattleLayout.left as round (round.id)}
                    <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>
                  {/each}
                </div>
                <section class="single-bracket-final">
                  <h3>决赛</h3>
                  {#if singleBattleLayout.final}{@render battleMatchCard(singleBattleLayout.final)}{/if}
                </section>
                <div class="single-bracket-side right">
                  {#each singleBattleLayout.right as round (round.id)}
                    <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>
                  {/each}
                </div>
              </div>
            {:else if battleTmpSnapshot.format === 'double-elimination'}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div class="double-battle-scroll" tabindex="0" role="application" aria-label="双败横向签表" aria-keyshortcuts="I J K L">
                <div class:outdated={battleResultOutdated} class="double-battle-bracket">
                  <div class="double-battle-groups">
                    <section class="double-stage-section double-winner-section"><h3>胜者组</h3><div class="battle-bracket">{#each battleTmpWinnerGroups as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
                    <section class="double-stage-section double-loser-section"><h3>败者组</h3><div class="battle-bracket">{#each battleTmpLoserGroups as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
                  </div>
                  <section class="double-final-section"><div class="battle-bracket">{#each battleTmpFinalGroups as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
                </div>
              </div>
            {:else}
              <div class:outdated={battleResultOutdated} class="battle-bracket">
                {#each battleTmpGroups as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}
              </div>
            {/if}
          {:else if battleFixedPreviewMatches.length > 0}
            <div class="battle-fixed-preview">
              {#each battleFixedPreviewMatches as positions, index}
                <article class="battle-match">
                  <small>首轮 · 第 {index + 1} 场</small>
                  {#each positions as position}
                    <div class:fixed={position.fixed} class:waiting={!position.participant}>
                      <strong>{position.participant?.name ?? '待随机'}</strong>
                    </div>
                  {/each}
                </article>
              {/each}
            </div>
          {:else}
            <div class="empty-result battle-empty-result"><div class="empty-grid"><i>A</i><i>VS</i><i>B</i></div><p>{battleFormat === 'avoid-first-pair' ? '名单每相邻两项为一组，依次为第 1 和第 2' : '确认名单并选择固定位置'}</p></div>
          {/if}
        {:else}
        <div class="result-heading">
          <div><span>03</span><div><h2>分组结果</h2><p>{result ? `${result.peopleCount} 项 · ${result.groupCount} 组 · ${result.tiers.length} 档 · ${resultOrderMode === 'rank' ? '排名' : '输入顺序'}` : '点击上方分组后生成表格'}</p></div></div>
          {#if result}
            <div class="result-output-actions">
              {#if hiddenLineupCellCount > 0}
                <button type="button" class="result-export-button reveal-all-button" on:click={revealAllLineupCells}>显示全部</button>
              {/if}
              <button type="button" class="result-export-button" on:click={exportLineupExcel}>Excel</button>
              <button type="button" class="result-export-button" on:click={exportLineupJson}>JSON</button>
              {#if desktopRuntime}
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
          <div class:outdated={resultOutdated} class="lineup-table-wrap">
            <table style={`--lineup-group-count: ${result.groupCount}`}>
              <thead><tr><th scope="col">档位</th>{#each result.groupNames as group}<th scope="col"><span>{group}</span>组</th>{/each}</tr></thead>
              <tbody>
                {#each result.tiers as tier, tierIndex}
                  <tr>
                    <th scope="row"><span>t{tierIndex + 1}</span><small>第 {tierIndex + 1} 档</small></th>
                    {#each tier as entry, groupIndex}
                      <td class:empty={!entry} class:caimi-swapped={Boolean(entry?.caimiSwap)} class:caimi-favored={entry?.caimiSwap?.kind === 'favored'} class:slow-hidden={hiddenLineupCellKeys.has(lineupCellKey(tierIndex, groupIndex))}>
                        {#if hiddenLineupCellKeys.has(lineupCellKey(tierIndex, groupIndex))}
                          <button type="button" class="slow-reveal-cell" aria-label={`显示 t${tierIndex + 1} ${result.groupNames[groupIndex]} 组`} on:click={() => revealLineupCell(tierIndex, groupIndex)}>·</button>
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

    <aside class:battle-config={battlePage} class="lineup-config">
      <div class="config-heading"><div><span>01</span><h2>名单</h2></div><strong>{names.length}<small>项</small></strong></div>
      <label class="names-field"><span>每行一个，也支持空格、逗号和 Excel 粘贴</span><textarea bind:this={sourceTextarea} bind:value={sourceText} aria-keyshortcuts="Alt+Enter" placeholder="粘贴名称…" spellcheck="false"></textarea></label>
      <div class="list-actions">
        <button type="button" class="confirm-list" aria-keyshortcuts="Alt+Enter" disabled={!sourceTextDirty} on:click={confirmSourceText}>确认</button>
        <button type="button" class="clear-list" disabled={!sourceText && !confirmedSourceText} on:click={requestClearAll}>清空</button>
      </div>
      {#if !battlePage}
        <div class="group-setting"><label for="lineup-group-count"><span>组数</span><input id="lineup-group-count" type="number" min="2" max="26" step="1" bind:value={groupCount} /></label><div><span>预计档位</span><strong>{tierPreview || '—'}</strong></div></div>
      {/if}
    </aside>
  </div>
</main>

{#if clearLineupConfirmation}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-lineup-title" aria-describedby="clear-lineup-detail" tabindex="-1">
      <span class="delete-confirm-icon">!</span>
      <h2 id="clear-lineup-title">同时清空{battlePage ? '对战' : '名单'}预览？</h2>
      <p id="clear-lineup-detail">名单、{battlePage ? '对战预览和当前对战' : '名单预览和当前分组结果'}都会清空。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" on:click={() => (clearLineupConfirmation = false)}><span>取消</span></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" on:click={clearAll}><span>确认</span></button>
      </div>
    </div>
  </div>
{/if}

{#if draggingUserId !== null}
  <div class="rank-drag-ghost" style={`left: ${rankDragX}px; top: ${rankDragY}px;`} aria-hidden="true">
    {rankedUsers.find((user) => user.id === draggingUserId)?.name ?? '选项'}
  </div>
{/if}

{#if pendingLineupHistoryDeletion}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-lineup-history-title" aria-describedby="delete-lineup-history-detail" tabindex="-1">
      <span class="delete-confirm-icon">×</span>
      <h2 id="delete-lineup-history-title">{pendingLineupHistoryDeletion.kind === 'one'
        ? '删除这条分组历史？'
        : pendingLineupHistoryDeletion.confirmation === 1
          ? '删除全部分组历史？'
          : '真的删除全部分组历史？'}</h2>
      <p id="delete-lineup-history-detail">{pendingLineupHistoryDeletion.kind === 'all' && pendingLineupHistoryDeletion.confirmation === 1
        ? '全部分组历史都会删除。'
        : '删除后无法恢复。'}</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={historyDeleting} on:click={() => (pendingLineupHistoryDeletion = null)}><span>取消</span></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={historyDeleting} on:click={confirmLineupHistoryDeletion}><span>{historyDeleting ? '删除中…' : '确认'}</span></button>
      </div>
    </div>
  </div>
{/if}

{#if pendingDeleteUser}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-ranked-title" aria-describedby="delete-ranked-detail" tabindex="-1">
      <span class="delete-confirm-icon">×</span>
      <h2 id="delete-ranked-title">删除“{pendingDeleteUser.name}”？</h2>
      <p id="delete-ranked-detail">当前名称、全部别名和排名都会一起删除，此操作无法撤销。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={deletingUserId !== null} on:click={() => (pendingDeleteUser = null)}><span>取消</span></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={deletingUserId !== null} on:click={confirmDeleteRankedUser}><span>{deletingUserId === null ? '确认' : '删除中…'}</span></button>
      </div>
    </div>
  </div>
{/if}

{#if pendingAliasClearUser}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog alias-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-alias-title" aria-describedby="clear-alias-detail" tabindex="-1">
      <span class="delete-confirm-icon">−</span>
      <h2 id="clear-alias-title">删除“{pendingAliasClearUser.name}”的全部别名？</h2>
      <p id="clear-alias-detail">当前名称会保留，其他别名会全部删除。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={clearingAliasesUserId !== null} on:click={() => (pendingAliasClearUser = null)}><span>取消</span></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={clearingAliasesUserId !== null} on:click={confirmClearRankedUserAliases}><span>{clearingAliasesUserId === null ? '确认' : '删除中…'}</span></button>
      </div>
    </div>
  </div>
{/if}

{#if clearAllRankingsConfirmation !== 0}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-all-rankings-title" aria-describedby="clear-all-rankings-detail" tabindex="-1">
      <span class="delete-confirm-icon">×</span>
      <h2 id="clear-all-rankings-title">{clearAllRankingsConfirmation === 1 ? '删除全部排名？' : '真的删除全部排名？'}</h2>
      <p id="clear-all-rankings-detail">{clearAllRankingsConfirmation === 1 ? '全部名称、别名和排名都会删除。' : '此操作无法撤销。'}</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={clearingAllRankings} on:click={cancelClearAllRankings}><span>取消</span></button>
        {#if clearAllRankingsConfirmation === 1}
          <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" on:click={continueClearAllRankings}><span>确认</span></button>
        {:else}
          <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={clearingAllRankings} on:click={confirmClearAllRankings}><span>{clearingAllRankings ? '删除中…' : '确认'}</span></button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if pendingRankingImport}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog ranking-import-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ranking-import-title" aria-describedby="ranking-import-detail" tabindex="-1">
      <span class="delete-confirm-icon">⇄</span>
      <h2 id="ranking-import-title">导入 {pendingRankingImport.length} 项排名？</h2>
      <p id="ranking-import-detail">文件内容将导入排名和别名。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={rankingImporting} on:click={() => (pendingRankingImport = null)}><span>取消</span></button>
        <button type="button" class="confirm-import" aria-keyshortcuts="Y Enter" disabled={rankingImporting} on:click={confirmRankingImport}><span>{rankingImporting ? '导入中…' : '确认'}</span></button>
      </div>
    </div>
  </div>
{/if}

{#if importErrorDialog}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog import-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="import-error-title" aria-describedby="import-error-detail" tabindex="-1">
      <span class="delete-confirm-icon">!</span>
      <h2 id="import-error-title">{importErrorDialog.title}</h2>
      <p id="import-error-detail">{importErrorDialog.detail}</p>
      <div><button type="button" class="confirm-import" on:click={() => (importErrorDialog = null)}>知道了</button></div>
    </div>
  </div>
{/if}

<style>
  .lineup-page {
    --lineup-muted-on-dark: #d9dbd2;
    --lineup-dim-on-dark: #c4c7bd;
    --lineup-muted-on-light: #34362f;
    --lineup-dim-on-light: #484b43;
    min-height: 0;
    padding: clamp(24px, 4vw, 58px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 25px;
    overflow: hidden;
    background:
      radial-gradient(circle at 82% 8%, rgba(231, 255, 114, 0.09), transparent 28%),
      #20211b;
    color: #f6f3ea;
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
  }

  .config-heading,
  .group-setting,
  .result-heading,
  .result-heading > div {
    display: flex;
  }

  .config-heading span,
  .result-heading > div > span {
    color: #c9d66f;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--font-scale, 1));
    letter-spacing: 0.14em;
  }

  .config-heading span {
    color: #626d1f;
  }

  .lineup-workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 370px);
    align-items: stretch;
    gap: clamp(18px, 2.5vw, 34px);
    max-width: 1580px;
    margin: 0 auto;
  }

  .lineup-workbench.desktop {
    grid-template-columns: minmax(260px, 310px) minmax(0, 1fr) minmax(300px, 360px);
    gap: clamp(14px, 1.7vw, 25px);
  }

  .lineup-config,
  .preview-panel,
  .lineup-result {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 19px;
  }

  .lineup-config {
    min-width: 0;
    align-self: start;
    padding: 22px;
    background: #efede6;
    color: #24251f;
  }

  .config-heading,
  .result-heading {
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .config-heading > div { display: flex; align-items: baseline; gap: 9px; }
  .config-heading h2,
  .result-heading h2 { font-size: calc(23px * var(--font-scale, 1)); letter-spacing: -0.04em; }
  .config-heading > strong { font-size: calc(27px * var(--font-scale, 1)); }
  .config-heading small { margin-left: 2px; color: var(--lineup-dim-on-light); font-size: calc(12px * var(--font-scale, 1)); }

  .names-field { display: block; margin-top: 18px; }
  .names-field > span { color: var(--lineup-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .lineup-file-input { display: none; }
  textarea {
    width: 100%;
    min-height: 270px;
    margin-top: 8px;
    padding: 13px;
    border: 1px solid rgba(36, 37, 31, 0.13);
    border-radius: 11px;
    outline: 0;
    resize: vertical;
    background: #f8f6f0;
    color: #24251f;
    font-family: var(--font-mono);
    font-size: calc(15px * var(--font-scale, 1));
    line-height: 1.7;
  }
  textarea::placeholder { color: var(--lineup-dim-on-light); opacity: 1; }
  textarea:focus { border-color: #8a993e; box-shadow: 0 0 0 3px rgba(138, 153, 62, 0.12); }

  .list-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 7px; }
  .list-actions button {
    padding: 6px 9px;
    border: 1px solid rgba(36, 37, 31, 0.24);
    border-radius: 7px;
    background: #fffdf8;
    color: #3e4631;
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
  }
  .list-actions .confirm-list { border-color: #a8b86b; background: #f2f6df; color: #52601d; }
  .list-actions .confirm-list:hover:not(:disabled) { border-color: #829638; background: #e8f1c7; color: #34420f; }
  .list-actions .clear-list { border-color: #c5a49d; background: #fbf0ed; color: #7e3c31; }
  .list-actions .clear-list:hover:not(:disabled) { border-color: #b85b49; background: #f7ded8; color: #6d2419; }

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
    border: 1px solid rgba(36, 37, 31, 0.1);
    border-radius: 10px;
    background: #f8f6f0;
  }
  .group-setting span { color: var(--lineup-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .group-setting input {
    width: 56px;
    border: 0;
    outline: 0;
    background: transparent;
    color: #24251f;
    font-family: var(--font-mono);
    font-size: calc(20px * var(--font-scale, 1));
    font-weight: 800;
    text-align: right;
  }
  .group-setting strong { font-family: var(--font-mono); font-size: calc(20px * var(--font-scale, 1)); font-weight: 800; }

  .battle-radio-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin: 17px 0 0;
    padding: 0;
    border: 0;
  }
  .battle-format-group { grid-template-columns: minmax(0, 1fr); }
  .battle-fixed-group { grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
  .battle-radio-group legend { width: 100%; margin-bottom: 7px; color: var(--lineup-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-radio-group label { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 9px 10px; border: 1px solid rgba(36, 37, 31, 0.13); border-radius: 8px; background: #f8f6f0; color: #34362f; font-size: calc(12px * var(--font-scale, 1)); }
  .battle-radio-group input { accent-color: #7d9134; }
  .battle-radio-group label:has(input:disabled) { cursor: not-allowed; opacity: 0.48; }
  .battle-radio-empty { grid-column: 1 / -1; padding: 9px 10px; border: 1px dashed rgba(36, 37, 31, 0.2); border-radius: 8px; color: var(--lineup-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-count-status { margin-top: 10px; padding: 9px 11px; border-radius: 8px; background: rgba(218, 91, 63, 0.1); color: #ad4b35; font-size: calc(12px * var(--font-scale, 1)); }
  .battle-count-status.valid { background: rgba(138, 153, 62, 0.13); color: #52601d; }
  .battle-preview-settings { margin-top: 18px; padding-top: 2px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .battle-preview-settings .battle-format-group { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .battle-preview-settings .battle-double-final-option { grid-column: 3; }
  .battle-preview-settings .battle-radio-group legend { color: var(--lineup-muted-on-dark); }
  .battle-preview-settings .battle-count-status { border: 1px solid rgba(218, 91, 63, 0.18); background: rgba(218, 91, 63, 0.08); color: #e1a092; }
  .battle-preview-settings .battle-count-status.valid { border-color: rgba(231, 255, 114, 0.17); background: rgba(231, 255, 114, 0.07); color: #dce99b; }

  .lineup-error,
  .outdated-notice {
    margin-top: 10px;
    padding: 9px 11px;
    border-radius: 8px;
    font-size: calc(12px * var(--font-scale, 1));
  }
  .lineup-error { background: rgba(218, 91, 63, 0.1); color: #ad4b35; }
  .outdated-notice { background: rgba(231, 255, 114, 0.1); color: #e2eab3; }

  .generate-button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding: 13px 15px;
    border: 0;
    border-radius: 11px;
    background: #22231d;
    color: #f8f6ef;
    cursor: pointer;
    font-size: calc(15px * var(--font-scale, 1));
    font-weight: 800;
  }
  .generate-button i { color: var(--accent); font-family: var(--font-mono); font-size: calc(21px * var(--font-scale, 1)); font-style: normal; }

  .lineup-result {
    min-width: 0;
    padding: clamp(20px, 3vw, 34px);
    background: rgba(11, 12, 9, 0.27);
  }

  .lineup-result:focus {
    outline: 2px solid rgba(231, 255, 114, 0.42);
    outline-offset: 3px;
  }

  .lineup-result.battle-result {
    background: var(--battle-background-color);
    color: var(--battle-text-color);
  }

  .lineup-result.battle-fullscreen {
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

  .battle-fullscreen-button {
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
    display: flex;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 9px;
    flex-wrap: wrap;
  }

  .battle-color-controls legend {
    color: color-mix(in srgb, var(--battle-text-color) 70%, transparent);
    font-size: calc(10px * var(--font-scale, 1));
  }

  .battle-color-controls label {
    display: flex;
    padding: 5px 7px;
    border: 1px solid color-mix(in srgb, var(--battle-text-color) 18%, transparent);
    border-radius: 8px;
    align-items: center;
    gap: 6px;
    color: var(--battle-text-color);
    font-size: calc(10px * var(--font-scale, 1));
  }

  .battle-color-controls input {
    width: 27px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
  }

  .lineup-center {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: 18px;
  }

  .preview-panel {
    min-width: 0;
    padding: clamp(20px, 2.4vw, 30px);
    background: rgba(11, 12, 9, 0.27);
  }
  .result-heading > div { align-items: center; gap: 11px; }
  .result-heading > div > span { display: grid; width: 31px; height: 31px; border: 1px solid rgba(231, 255, 114, 0.18); border-radius: 50%; place-items: center; }
  .result-heading p { margin-top: 3px; color: var(--lineup-muted-on-dark); font-size: calc(12px * var(--font-scale, 1)); }
  .result-output-actions,
  .history-save-control { display: flex; align-items: center; gap: 8px; }
  .result-output-actions { justify-content: flex-end; flex-wrap: wrap; }
  .result-heading .result-export-button {
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    color: #f4f5ec;
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
  }
  .result-heading .result-export-button:hover:not(:disabled) { border-color: var(--accent); background: rgba(231, 255, 114, 0.14); color: var(--accent); }
  .result-heading .history-save-button {
    padding: 8px 11px;
    border: 1px solid rgba(231, 255, 114, 0.48);
    border-radius: 8px;
    background: rgba(231, 255, 114, 0.14);
    color: var(--accent);
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
  }
  .result-heading .history-save-button:disabled { cursor: default; opacity: 0.58; }

  .lineup-table-wrap { margin-top: 20px; overflow: auto; transition: opacity 180ms ease; }
  .lineup-table-wrap.outdated { opacity: 0.45; }
  .battle-bracket { display: flex; gap: 13px; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .battle-bracket.outdated { opacity: 0.45; }
  .single-battle-bracket { display: grid; grid-template-columns: minmax(max-content, 1fr) minmax(220px, 250px) minmax(max-content, 1fr); gap: 16px; align-items: center; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .single-battle-bracket.outdated,
  .double-battle-bracket.outdated { opacity: 0.45; }
  .single-bracket-side { display: flex; align-items: stretch; gap: 13px; }
  .single-bracket-side.left { justify-content: flex-end; }
  .single-bracket-side.right { justify-content: flex-start; }
  .single-bracket-side .battle-round { display: flex; min-width: 220px; flex-direction: column; justify-content: center; }
  .single-bracket-final { min-width: 220px; padding: 12px; border: 1px solid rgba(231, 255, 114, 0.2); border-radius: 13px; background: rgba(231, 255, 114, 0.045); }
  .single-bracket-final > h3 { margin-bottom: 9px; color: var(--accent); text-align: center; }
  .single-bracket-side.right .battle-match { direction: rtl; }
  .single-bracket-side.right .battle-match > * { direction: ltr; }
  .double-battle-scroll { margin-top: 18px; outline: 0; overflow: auto; scroll-behavior: smooth; }
  .double-battle-scroll:focus { box-shadow: inset 0 -2px 0 rgba(231, 255, 114, 0.34); }
  .double-battle-bracket { display: grid; width: max-content; min-width: 100%; grid-template-columns: max-content max-content; grid-template-rows: max-content max-content; align-items: start; column-gap: clamp(42px, 5vw, 86px); row-gap: clamp(34px, 5vh, 62px); transition: opacity 180ms ease; }
  .double-battle-groups { display: contents; }
  .double-stage-section,
  .double-final-section { display: flex; min-width: 0; padding: 13px; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 13px; background: rgba(255, 255, 255, 0.018); flex-direction: column; }
  .double-stage-section { padding: 0; border: 0; background: transparent; }
  .double-stage-section > h3 { color: var(--accent); font-size: calc(15px * var(--font-scale, 1)); }
  .double-battle-bracket .battle-bracket { gap: clamp(32px, 4vw, 68px); margin-top: 10px; overflow: visible; align-items: stretch; }
  .double-stage-section > .battle-bracket { min-height: 0; }
  .double-winner-section { grid-column: 1; grid-row: 1; }
  .double-loser-section { grid-column: 1; grid-row: 2; }
  .double-final-section { grid-column: 2; grid-row: 2; align-self: start; transform: translateY(-50%); }
  .double-final-section > .battle-bracket { min-height: 180px; align-items: center; margin-top: 0; }
  .double-final-section .battle-round { position: relative; justify-content: center; }
  .double-final-section .battle-round > h3 { position: absolute; bottom: calc(100% + 9px); left: 0; }
  .double-final-section .battle-round > div { margin-top: 0; }
  .double-battle-bracket .battle-round { display: flex; flex-direction: column; }
  .double-battle-bracket .battle-round > div { flex: 1; }
  .double-winner-section .battle-round > div { align-content: end; }
  .double-loser-section .battle-round > div { align-content: start; }
  .double-battle-bracket .battle-match { padding: 6px; }
  .double-battle-bracket .battle-match > small { margin-bottom: 3px; font-size: calc(8px * var(--font-scale, 1)); }
  .double-battle-bracket .battle-match > div { padding: 4px 6px; }
  .double-battle-bracket .battle-match > div + div { margin-top: 2px; }
  .double-battle-bracket .battle-match > .battle-side { gap: 6px; }
  .double-battle-bracket .battle-side input { min-height: 30px; }
  .battle-fullscreen .result-heading { justify-content: flex-end; }
  .battle-fullscreen .result-heading > div:first-child { display: none; }
  .battle-fullscreen .battle-result-toolbar { margin-bottom: 8px; }
  .battle-fullscreen .double-battle-scroll { margin-top: 10px; }
  .battle-round { flex: 0 0 min(235px, 74vw); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1)); }
  .battle-round > div { display: grid; gap: 10px; margin-top: 9px; }
  .battle-fixed-preview { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 18px; }
  .battle-match { min-width: 0; padding: 9px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 11px; background: var(--battle-match-color, rgba(255, 255, 255, 0.035)); }
  .battle-match > small { display: block; margin-bottom: 6px; color: color-mix(in srgb, var(--battle-text-color, var(--lineup-dim-on-dark)) 72%, transparent); font-family: var(--font-mono); font-size: calc(9px * var(--font-scale, 1)); }
  .battle-match > div { width: 100%; min-width: 0; padding: 8px 9px; border: 0; border-left: 2px solid rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.13); color: inherit; font: inherit; text-align: left; }
  .battle-match > div + div { margin-top: 5px; }
  .battle-match > div.fixed { border-left-color: #e7ff72; background: rgba(231, 255, 114, 0.08); }
  .battle-match > div.waiting { color: var(--lineup-dim-on-dark); }
  .battle-match > .battle-side { display: flex; align-items: center; gap: 8px; }
  .battle-side > div { min-width: 0; flex: 1; }
  .battle-side.winner { border-left-color: var(--accent); background: rgba(231, 255, 114, 0.18); color: var(--accent); }
  .battle-side input {
    width: 48px;
    min-height: 36px;
    padding: 4px 5px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 7px;
    outline: 0;
    background: rgba(0, 0, 0, 0.2);
    color: #f4f5ec;
    font-family: var(--font-mono);
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 800;
    text-align: center;
  }
  .battle-side input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(231, 255, 114, 0.12); }
  .battle-side input:disabled { opacity: 0.4; }
  .battle-match strong { display: block; overflow: hidden; color: var(--battle-participant-color, inherit); font-size: calc(12px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  table {
    width: 100%;
    min-width: max(650px, calc(68px + var(--lineup-group-count, 4) * 140px));
    border-collapse: separate;
    border-spacing: 7px;
    table-layout: fixed;
  }
  th, td { padding: 13px 9px; border-radius: 10px; text-align: center; }
  thead th { color: var(--lineup-muted-on-dark); font-size: calc(11px * var(--font-scale, 1)); font-weight: 600; }
  thead th:first-child { width: 68px; }
  thead th span { margin-right: 4px; color: var(--accent); font-family: var(--font-mono); font-size: calc(20px * var(--font-scale, 1)); font-weight: 900; }
  tbody th { background: rgba(255, 255, 255, 0.04); color: var(--lineup-muted-on-dark); }
  tbody th span,
  tbody th small,
  td strong,
  td small { display: block; }
  tbody th span { color: var(--accent); font-family: var(--font-mono); font-size: calc(16px * var(--font-scale, 1)); font-weight: 800; }
  tbody th small { margin-top: 3px; font-size: calc(10px * var(--font-scale, 1)); font-weight: 500; }
  td { border: 1px solid rgba(255, 255, 255, 0.07); background: rgba(255, 255, 255, 0.045); }
  td strong { overflow: hidden; color: #f4f1e8; font-size: calc(14px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  td small { margin-top: 4px; color: var(--lineup-dim-on-dark); font-family: var(--font-mono); font-size: calc(10px * var(--font-scale, 1)); }
  td.empty { color: var(--lineup-dim-on-dark); }
  td.slow-hidden {
    padding: 4px;
    border-color: rgba(231, 255, 114, 0.1);
    background: rgba(255, 255, 255, 0.025);
    box-shadow: none;
  }
  .slow-reveal-cell {
    width: 100%;
    min-height: 58px;
    border: 1px dashed rgba(231, 255, 114, 0.2);
    border-radius: 8px;
    background: rgba(231, 255, 114, 0.025);
    color: #aeb676;
    cursor: pointer;
    font-size: calc(24px * var(--font-scale, 1));
    line-height: 1;
  }
  .slow-reveal-cell:hover {
    border-color: rgba(231, 255, 114, 0.42);
    background: rgba(231, 255, 114, 0.08);
    color: #e7ff72;
  }
  .result-heading .reveal-all-button {
    border-color: rgba(231, 255, 114, 0.46);
    color: #e3ecac;
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
    border-color: rgba(231, 255, 114, 0.1);
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
    color: var(--lineup-dim-on-dark);
    text-align: center;
  }
  .battle-empty-result { gap: 8px; }
  .battle-empty-result p { color: var(--lineup-dim-on-dark); font-size: calc(12px * var(--font-scale, 1)); text-align: center; }
  .empty-grid { display: grid; grid-template-columns: repeat(3, 42px); gap: 7px; margin-bottom: 18px; transform: rotate(-4deg); }
  .empty-grid i { display: grid; height: 42px; border: 1px solid rgba(231, 255, 114, 0.2); border-radius: 9px; background: rgba(231, 255, 114, 0.055); color: #cbd877; font-family: var(--font-mono); font-size: calc(14px * var(--font-scale, 1)); font-style: normal; place-items: center; }

  .preview-status {
    color: #dde2c2;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .preview-status.warning { color: #dca797; }

  .preview-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin-top: 18px;
  }

  .preview-tier-divider {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 9px;
    margin: 9px 0 2px;
    color: #d8e582;
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  .preview-tier-divider.first-tier { margin-top: 0; }

  .preview-tier-divider i {
    height: 1px;
    flex: 1;
    background: linear-gradient(90deg, transparent, rgba(231, 255, 114, 0.38));
  }

  .preview-tier-divider i:last-child {
    background: linear-gradient(90deg, rgba(231, 255, 114, 0.38), transparent);
  }

  .preview-row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 66px;
    grid-template-columns: 24px 29px minmax(0, 1fr) auto 24px;
    align-items: center;
    gap: 6px;
    padding: 9px 10px;
    border: 1px solid rgba(231, 255, 114, 0.13);
    border-radius: 11px;
    background:
      linear-gradient(100deg, rgba(231, 255, 114, 0.065), transparent 54%),
      rgba(255, 255, 255, 0.035);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.035);
  }

  .preview-row.unknown {
    border-color: rgba(221, 151, 132, 0.24);
    background: rgba(221, 151, 132, 0.035);
    box-shadow: inset 2px 0 rgba(221, 151, 132, 0.5);
  }

  .preview-position {
    padding: 0;
    color: var(--lineup-dim-on-dark);
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .preview-row > div { min-width: 0; }

  .preview-row > .preview-name {
    display: grid;
    min-height: 46px;
    align-content: center;
    justify-items: stretch;
    padding: 0 8px;
    text-align: center;
  }

  .preview-row input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: #fffbea;
    font-family: var(--font-sans);
    font-size: calc(18px * var(--font-scale, 1));
    font-weight: 900;
    letter-spacing: 0.025em;
    text-align: center;
    text-shadow: 0 2px 12px rgba(231, 255, 114, 0.14);
  }

  .preview-row input:focus {
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.055);
    box-shadow: 0 0 0 2px rgba(231, 255, 114, 0.2);
  }

  .preview-row small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: var(--lineup-muted-on-dark);
    font-size: calc(9px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-row.unknown small { color: #d8aaa0; }

  .insert-before-button,
  .append-preview-user,
  .preview-insert-form button {
    border: 1px solid rgba(231, 255, 114, 0.2);
    background: rgba(231, 255, 114, 0.05);
    color: #d5e184;
    cursor: pointer;
  }

  .insert-before-button {
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    font-size: calc(14px * var(--font-scale, 1));
    line-height: 1;
  }

  .insert-before-button:hover,
  .insert-before-button.active,
  .append-preview-user:hover,
  .preview-insert-form button:hover {
    border-color: rgba(231, 255, 114, 0.48);
    background: rgba(231, 255, 114, 0.12);
    color: #e7ff72;
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
    border: 1px solid rgba(231, 255, 114, 0.34);
    border-radius: 9px;
    background: rgba(231, 255, 114, 0.07);
    box-sizing: border-box;
  }

  .preview-insert-form label {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(80px, 1fr);
    align-items: center;
    gap: 8px;
    color: #e4e8c8;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .preview-insert-form input {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 6px;
    outline: none;
    background: rgba(3, 5, 5, 0.45);
    color: #f4f1e8;
    font: inherit;
  }

  .preview-insert-form input:focus { border-color: rgba(231, 255, 114, 0.55); }

  .preview-insert-form button {
    padding: 5px 9px;
    border-radius: 6px;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .preview-insert-form button.cancel {
    border-color: rgba(255, 255, 255, 0.1);
    background: transparent;
    color: var(--lineup-dim-on-dark);
  }

  .preview-insert-form small {
    grid-column: 1 / -1;
    color: #ff957d;
    font-size: calc(10px * var(--font-scale, 1));
  }

  .link-preview-user,
  .add-preview-user,
  .remove-preview-user {
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .preview-link-actions {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .link-preview-user,
  .add-preview-user {
    padding: 4px 6px;
    border: 1px solid rgba(221, 170, 155, 0.24);
    border-radius: 6px;
    color: #d8b1a7;
    font-size: calc(10px * var(--font-scale, 1));
  }

  .link-preview-user { border-color: rgba(205, 219, 126, 0.22); color: #cbd58e; }

  .remove-preview-user {
    width: 21px;
    height: 21px;
    border-radius: 50%;
    color: var(--lineup-dim-on-dark);
    font-size: calc(17px * var(--font-scale, 1));
  }

  .remove-preview-user:hover { background: rgba(255, 255, 255, 0.06); color: #d6d8cf; }

  .preview-empty {
    display: grid;
    min-height: 80px;
    margin-top: 16px;
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: var(--lineup-dim-on-dark);
    font-size: calc(12px * var(--font-scale, 1));
    gap: 12px;
    padding: 18px;
    place-items: center;
  }

  .rank-order-lock {
    margin-top: 12px;
    padding: 9px 11px;
    border: 1px solid rgba(210, 181, 117, 0.18);
    border-radius: 9px;
    background: rgba(210, 181, 117, 0.045);
    color: #d4c49e;
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.55;
  }

  .lineup-actions {
    display: flex;
    align-items: stretch;
    gap: 9px;
    margin-top: 13px;
  }

  .lineup-actions.desktop-actions {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 4fr) minmax(0, 3fr);
  }
  .battle-page .lineup-actions.desktop-actions { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .battle-state-panel > p { margin: 10px 2px 0; color: var(--lineup-dim-on-light); font-size: calc(11px * var(--font-scale, 1)); line-height: 1.6; }
  .battle-state-panel > p.battle-state-empty { padding: 18px 8px; margin: 0; font-size: calc(12px * var(--font-scale, 1)); text-align: center; }
  .battle-state-sync { display: flex; align-items: center; gap: 7px; padding: 9px 10px; border: 1px solid rgba(83, 111, 32, 0.18); border-radius: 9px; background: rgba(127, 146, 63, 0.08); color: #52671f; }
  .battle-state-sync i { width: 7px; height: 7px; border-radius: 50%; background: #7f923f; box-shadow: 0 0 0 3px rgba(127, 146, 63, 0.12); }
  .battle-state-sync strong { font-size: calc(11px * var(--font-scale, 1)); }
  .battle-state-sync span { margin-left: auto; color: var(--lineup-dim-on-light); font-size: calc(9px * var(--font-scale, 1)); }
  .battle-state-sync.saving i { animation: battle-sync-pulse 900ms ease-in-out infinite; }
  .battle-state-sync.error { border-color: rgba(161, 48, 48, 0.22); background: rgba(161, 48, 48, 0.08); color: #9c3030; }
  .battle-state-sync.error i { background: #b23e3e; box-shadow: 0 0 0 3px rgba(178, 62, 62, 0.12); }
  .battle-state-panel dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin: 10px 0 0; }
  .battle-state-panel dl div { padding: 8px 9px; border: 1px solid rgba(36, 37, 31, 0.08); border-radius: 8px; background: rgba(255, 255, 255, 0.32); }
  .battle-state-panel dt { color: var(--lineup-dim-on-light); font-size: calc(9px * var(--font-scale, 1)); }
  .battle-state-panel dd { margin: 3px 0 0; color: #363c28; font-size: calc(12px * var(--font-scale, 1)); font-weight: 750; }
  .battle-state-actions { justify-content: stretch; }
  .battle-state-actions button { flex: 1; }
  @keyframes battle-sync-pulse { 50% { opacity: 0.35; transform: scale(0.8); } }

  .slow-reveal-setting {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.035);
    color: var(--lineup-muted-on-dark);
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 700;
  }

  .slow-reveal-setting input {
    width: 15px;
    height: 15px;
    accent-color: #bcca63;
  }

  .lineup-actions .generate-button {
    min-height: 48px;
    flex: 1;
    margin-top: 0;
  }

  .lineup-actions .rank-generate-button {
    width: auto;
    padding: 10px 16px;
    border: 1px solid #f1ff87;
    background: linear-gradient(135deg, #f0ff78, #c7eb4e);
    box-shadow: 0 8px 22px rgba(202, 235, 75, 0.22);
    color: #1d2610;
    font-size: calc(14px * var(--font-scale, 1));
  }

  .lineup-actions .rank-generate-button i {
    margin-left: 12px;
    color: #344514;
    font-size: calc(17px * var(--font-scale, 1));
  }

  .rank-preview-button {
    min-height: 48px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid #b9efa0;
    border-radius: 11px;
    background: linear-gradient(145deg, #b9ee9a, #86d779);
    box-shadow: 0 6px 16px rgba(114, 201, 98, 0.17);
    color: #173117;
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
  }

  .rank-preview-button:hover:not(:disabled) {
    border-color: #dcffbf;
    background: linear-gradient(145deg, #cfffb2, #97e88a);
    color: #102a11;
    transform: translateY(-1px);
  }

  .lineup-actions .rank-preview-button:disabled,
  .lineup-actions .rank-generate-button:disabled {
    cursor: not-allowed;
    filter: grayscale(0.8);
    opacity: 0.32;
  }

  .input-order-button {
    min-height: 48px;
    min-width: 0;
    padding: 10px 13px;
    border: 1px solid #8af1df;
    border-radius: 11px;
    background: linear-gradient(145deg, #85ead6, #4fcbbc);
    box-shadow: 0 6px 16px rgba(74, 203, 187, 0.18);
    color: #102d2a;
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
  }

  .input-order-button:hover:not(:disabled) {
    border-color: #c2fff4;
    background: linear-gradient(145deg, #a0f5e5, #61dccb);
    color: #082622;
    transform: translateY(-1px);
  }

  .input-order-button:disabled {
    cursor: not-allowed;
    filter: grayscale(0.8);
    opacity: 0.32;
  }

  .lineup-sidebar {
    display: grid;
    height: 100%;
    min-height: 0;
    min-width: 0;
    align-content: start;
    align-self: stretch;
    gap: 9px;
    /* 排名只跟随右侧两排的高度，自身条目数量不能反向撑开页面。 */
    contain: size;
  }

  .lineup-sidebar.ranking-open { grid-template-rows: minmax(0, 1fr) auto; }
  .lineup-sidebar.history-open { grid-template-rows: auto minmax(0, 1fr); }

  .desktop-accordion {
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 13px;
    background: #efede6;
    color: #24251f;
  }

  .desktop-accordion-toggle {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) auto 18px;
    align-items: center;
    gap: 8px;
    padding: 13px 14px;
    border: 0;
    background: transparent;
    color: #33362f;
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
    text-align: left;
  }

  .desktop-accordion-toggle strong {
    color: #7a842f;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .desktop-accordion-toggle i {
    color: var(--lineup-dim-on-light);
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

  .desktop-accordion-content { padding: 12px; }

  .rank-manager {
    --rank-gold: #f7d66d;
    --rank-lime: #dff66c;
    --rank-ink: #101711;
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    background:
      radial-gradient(circle at 18% 0%, rgba(223, 246, 108, 0.2), transparent 29%),
      radial-gradient(circle at 92% 18%, rgba(247, 214, 109, 0.16), transparent 26%),
      linear-gradient(155deg, #17231a, #0d1510 58%, #182017);
    color: #f7f3df;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08);
  }

  .rank-manager form {
    display: grid;
    gap: 8px;
  }

  .rank-person-form {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid rgba(247, 214, 109, 0.38);
    border-radius: 12px;
    background:
      linear-gradient(135deg, rgba(247, 214, 109, 0.12), rgba(223, 246, 108, 0.06)),
      rgba(5, 10, 7, 0.52);
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
    color: #e6e8cd;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .rank-manager input {
    width: 100%;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid rgba(247, 214, 109, 0.42);
    border-radius: 8px;
    outline: 0;
    background: #fffdf5;
    color: #182017;
    font-family: var(--font-sans);
    font-size: calc(14px * var(--font-scale, 1));
  }

  .rank-manager input:focus {
    border-color: var(--rank-lime);
    box-shadow: 0 0 0 3px rgba(223, 246, 108, 0.17), 0 0 20px rgba(223, 246, 108, 0.1);
  }

  .save-user {
    padding: 9px;
    border: 0;
    border-radius: 7px;
    border: 1px solid rgba(247, 214, 109, 0.55);
    background: linear-gradient(135deg, #d9ed60, #aebc3f);
    color: #17200e;
    cursor: pointer;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 900;
    box-shadow: 0 6px 18px rgba(175, 197, 66, 0.19);
  }

  .ranking-error {
    margin-top: 8px;
    padding: 7px;
    border-radius: 6px;
    background: rgba(210, 83, 54, 0.09);
    color: #ad4832;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .database-folder-button {
    margin: 6px 0;
    padding: 5px 8px;
    border: 1px solid rgba(159, 65, 47, 0.3);
    border-radius: 6px;
    background: #fbefec;
    color: #7d3d31;
    cursor: pointer;
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 750;
  }

  .ranking-transfer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin: 3px 0 8px;
  }

  .ranking-transfer-actions button {
    padding: 6px 8px;
    border: 1px solid rgba(223, 246, 108, 0.34);
    border-radius: 7px;
    background: linear-gradient(145deg, #26331f, #141d16);
    color: #eef4cd;
    cursor: pointer;
    font-size: calc(11px * var(--font-scale, 1));
    font-weight: 850;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08), 0 4px 12px rgba(0, 0, 0, 0.18);
  }

  .ranking-transfer-actions .ranking-import-button:disabled {
    border-color: rgba(166, 171, 158, 0.2);
    background: linear-gradient(145deg, #252a25, #181b18);
    color: #7d8379;
    filter: grayscale(1);
    box-shadow: none;
  }

  .ranking-transfer-actions button.delete-all-rankings {
    border-color: rgba(255, 127, 99, 0.45);
    background: linear-gradient(145deg, #3b211d, #211311);
    color: #ffb3a2;
  }

  .rank-keyboard-order {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 5px;
    margin: 2px 0 7px;
    padding: 7px 8px;
    border: 1px solid rgba(247, 214, 109, 0.36);
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(247, 214, 109, 0.15), rgba(223, 246, 108, 0.07));
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.07);
  }

  .rank-keyboard-order.active {
    border-color: rgba(223, 246, 108, 0.74);
    background: linear-gradient(135deg, rgba(223, 246, 108, 0.23), rgba(247, 214, 109, 0.12));
    box-shadow: 0 0 24px rgba(223, 246, 108, 0.12);
  }

  .rank-keyboard-order > span { min-width: 0; }
  .rank-keyboard-order strong,
  .rank-keyboard-order small { display: inline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-keyboard-order strong { color: #fff1ba; font-size: calc(13px * var(--font-scale, 1)); }
  .rank-keyboard-order small { margin-left: 6px; color: #e2e7c3; font-size: calc(12px * var(--font-scale, 1)); }
  .rank-keyboard-order button {
    padding: 5px 7px;
    border: 1px solid rgba(223, 246, 108, 0.4);
    border-radius: 6px;
    background: #24311d;
    color: #ecf6b8;
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
    margin-top: 4px;
    padding: 9px 3px 13px 0;
    overflow-y: auto;
  }

  .rank-manager.reordering .ranked-user-list {
    opacity: 0.68;
    pointer-events: none;
  }

  .ranked-user-list > p {
    padding: 12px 3px;
    color: var(--lineup-dim-on-light);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .rank-zone {
    display: grid;
    align-content: start;
    gap: 8px;
  }

  .rank-zone.unranked-zone {
    margin-top: 13px;
    padding-top: 9px;
    border-top: 1px solid rgba(247, 214, 109, 0.28);
    transition: border-color 120ms ease, background 120ms ease;
  }

  .rank-zone.unranked-zone.drop-active {
    border-top-color: #7a842f;
    background: rgba(122, 132, 47, 0.08);
  }

  .rank-zone-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 3px;
  }

  .rank-zone-heading strong {
    color: #f7e5a7;
    font-size: calc(15px * var(--font-scale, 1));
    letter-spacing: 0.08em;
  }

  .rank-zone-heading span {
    color: #d7dfa7;
    font-size: calc(12px * var(--font-scale, 1));
    text-align: right;
  }

  .empty-ranked-drop {
    display: grid;
    min-height: 76px;
    padding: 10px;
    border: 1px dashed rgba(122, 132, 47, 0.32);
    border-radius: 10px;
    background: rgba(122, 132, 47, 0.04);
    color: #69722a;
    font-size: calc(11px * var(--font-scale, 1));
    line-height: 1.45;
    text-align: center;
    place-items: center;
  }

  .empty-ranked-drop.active {
    border-color: #7a842f;
    background: rgba(122, 132, 47, 0.13);
  }

  .ranked-user-list article {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 94px;
    grid-template-columns: 46px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 12px 11px;
    border: 1px solid rgba(247, 214, 109, 0.52);
    border-radius: 14px;
    overflow: hidden;
    background:
      radial-gradient(circle at 96% 0%, rgba(247, 214, 109, 0.2), transparent 29%),
      linear-gradient(135deg, #fffdf4, #f3ecd3);
    cursor: grab;
    touch-action: none;
    user-select: none;
    box-shadow: 0 9px 24px rgba(0, 0, 0, 0.24), inset 0 1px rgba(255, 255, 255, 0.9);
    transform: translate3d(0, 0, 0);
    transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease, transform 120ms ease;
  }

  .ranked-user-list article:active { cursor: grabbing; }

  .ranked-user-list article:hover {
    border-color: rgba(223, 246, 108, 0.82);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 18px rgba(223, 246, 108, 0.11);
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
    border-top-color: #7a842f;
    box-shadow: inset 0 5px rgba(122, 132, 47, 0.3);
  }

  .ranked-user-list article.insert-after {
    border-bottom-color: #7a842f;
    box-shadow: inset 0 -5px rgba(122, 132, 47, 0.3);
  }

  .ranked-user-list article.replace-target {
    border-color: rgba(182, 106, 53, 0.72);
    box-shadow: inset 0 0 0 4px rgba(205, 128, 66, 0.24);
  }

  .ranked-user-list article.drag-source { opacity: 0.44; }

  .rank-number {
    display: grid;
    width: 40px;
    height: 40px;
    border: 1px solid rgba(247, 214, 109, 0.78);
    border-radius: 12px;
    background: linear-gradient(145deg, #24341d, #111a13);
    color: var(--rank-lime);
    font-family: var(--font-mono);
    font-size: calc(19px * var(--font-scale, 1));
    font-weight: 950;
    text-align: center;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.1), 0 5px 12px rgba(0, 0, 0, 0.24);
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
    color: #172018;
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
    background: linear-gradient(90deg, rgba(255, 254, 247, 0.97), #f3f2d8 14px);
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
    border: 1px solid rgba(93, 115, 36, 0.34) !important;
    border-radius: 6px;
    background: #edf3ce !important;
    color: #4f5f19;
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

  .alias-action:hover { color: #4f5819; }
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
    background: #f4f2eb;
    color: #68752b;
    cursor: pointer;
  }

  .inline-rank-edit button:last-child { color: #9b5a4b; }

  .inline-rank-edit small {
    overflow: hidden;
    color: var(--lineup-dim-on-light);
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
    background: rgba(255, 253, 248, 0.76);
    pointer-events: none;
  }

  .rank-drop-guides.insert-only {
    grid-template-rows: 1fr 1fr;
  }

  .rank-drop-guides i {
    display: block;
    border-block: 1px dashed rgba(122, 132, 47, 0.2);
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
    border: 1px solid rgba(231, 255, 114, 0.58);
    border-radius: 10px;
    overflow: hidden;
    background: rgba(35, 37, 29, 0.94);
    color: #f6f3e9;
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 800;
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
    pointer-events: none;
    text-overflow: ellipsis;
    transform: translate(14px, 14px);
    white-space: nowrap;
  }

  .delete-confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: grid;
    padding: 24px;
    background: rgba(8, 9, 7, 0.72);
    backdrop-filter: blur(5px);
    place-items: center;
  }

  .delete-confirm-dialog {
    width: min(100%, 390px);
    padding: 25px;
    border: 1px solid rgba(255, 125, 96, 0.24);
    border-radius: 18px;
    background: #f4f1e9;
    color: #282921;
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.46);
    text-align: center;
  }

  .delete-confirm-icon {
    display: grid;
    width: 42px;
    height: 42px;
    margin: 0 auto 13px;
    border-radius: 50%;
    background: rgba(209, 70, 43, 0.1);
    color: #b63e28;
    font-size: calc(25px * var(--font-scale, 1));
    place-items: center;
  }

  .delete-confirm-dialog h2 { font-size: calc(20px * var(--font-scale, 1)); }

  .delete-confirm-dialog p {
    margin-top: 9px;
    color: #62655b;
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.6;
  }

  .delete-confirm-dialog > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
    margin-top: 20px;
  }

  .delete-confirm-dialog button {
    display: grid;
    padding: 10px;
    border: 1px solid rgba(36, 37, 31, 0.12);
    border-radius: 9px;
    background: #fffdf8;
    color: #4f5248;
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 750;
    gap: 2px;
    place-items: center;
  }

  .delete-confirm-dialog button.confirm-delete {
    border-color: #b84832;
    background: #b84832;
    color: white;
  }

  .alias-confirm-dialog button.confirm-delete {
    border-color: #69772b;
    background: #69772b;
  }

  .delete-confirm-dialog button.confirm-import {
    border-color: #788830;
    background: #e7ff72;
    color: #303714;
  }

  .ranking-import-dialog .delete-confirm-icon {
    background: rgba(114, 132, 43, 0.13);
    color: #667621;
  }

  .import-error-dialog > div { grid-template-columns: minmax(0, 1fr); }

  .history-dates {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .history-dates label { min-width: 0; }
  .history-dates span { display: block; margin-bottom: 4px; color: var(--lineup-muted-on-light); font-size: calc(10px * var(--font-scale, 1)); }
  .history-dates input {
    width: 100%;
    min-width: 0;
    padding: 7px 5px;
    border: 1px solid rgba(36, 37, 31, 0.12);
    border-radius: 7px;
    outline: 0;
    background: #fffdf8;
    color: #55584f;
    font-family: var(--font-mono);
    font-size: calc(10px * var(--font-scale, 1));
  }

  .lineup-history-list {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }

  .lineup-history-list > p {
    padding: 15px 4px;
    color: var(--lineup-dim-on-light);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .lineup-history-list > article {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    border: 1px solid rgba(36, 37, 31, 0.08);
    border-radius: 8px;
    overflow: hidden;
    background: #fffdf8;
  }

  .lineup-history-list .history-view {
    display: grid;
    width: 100%;
    gap: 3px;
    padding: 9px 10px;
    border: 0;
    background: transparent;
    color: #24251f;
    cursor: pointer;
    text-align: left;
  }

  .history-item-actions {
    display: grid;
    align-content: center;
    gap: 4px;
    padding: 5px;
    border-left: 1px solid rgba(36, 37, 31, 0.08);
  }

  .history-item-actions button {
    padding: 3px 5px;
    border: 1px solid rgba(84, 96, 36, 0.24);
    border-radius: 5px;
    background: #f3f4e8;
    color: #4d5920;
    cursor: pointer;
    font-size: calc(9px * var(--font-scale, 1));
    font-weight: 750;
  }

  .history-item-actions .history-delete,
  .history-export-actions .history-delete-all {
    border-color: rgba(156, 64, 52, 0.34);
    background: #fae9e5;
    color: #8b3429;
  }

  .history-item-actions .history-delete:hover:not(:disabled),
  .history-export-actions .history-delete-all:hover:not(:disabled) {
    border-color: #b85243;
    background: #f5d4cd;
    color: #681f17;
  }

  .lineup-history-list span { color: var(--lineup-dim-on-light); font-family: var(--font-mono); font-size: calc(10px * var(--font-scale, 1)); }
  .lineup-history-list strong { overflow: hidden; font-size: calc(12px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  .lineup-history-list small { color: #7a842f; font-size: calc(10px * var(--font-scale, 1)); }

  .history-export-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .history-export-actions button {
    padding: 6px 8px;
    border: 1px solid rgba(36, 37, 31, 0.26);
    border-radius: 7px;
    background: #f3f4e8;
    color: #3d452d;
    cursor: pointer;
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 700;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
  }
  .history-export-actions button:hover:not(:disabled) { border-color: #7f923f; background: #e9f2c9; color: #34420f; }

  .history-import-status {
    margin-top: 7px;
    color: #59651f;
    font-size: calc(10px * var(--font-scale, 1));
    text-align: right;
  }

  .history-status {
    margin: 0;
    color: #909b51;
    font-size: calc(11px * var(--font-scale, 1));
    white-space: nowrap;
  }

  .history-status.error { color: #dc725b; }

  @media (min-width: 1251px) {
    .lineup-workbench:not(.desktop) .lineup-center { display: contents; }
    .lineup-workbench:not(.desktop) .preview-panel { grid-column: 1; grid-row: 1; }
    .lineup-workbench:not(.desktop) .lineup-config { grid-column: 2; grid-row: 1; }
    .lineup-workbench:not(.desktop) .lineup-result {
      grid-column: 1 / 3;
      grid-row: 2;
      margin-top: clamp(18px, 2.5vw, 34px);
    }
    .lineup-workbench.desktop {
      grid-template-rows: minmax(360px, 1fr) auto;
    }
    .lineup-workbench.desktop .lineup-center { display: contents; }
    .lineup-workbench.desktop .lineup-sidebar { grid-column: 1; grid-row: 1 / span 2; }
    .lineup-workbench.desktop .preview-panel {
      grid-column: 2;
      grid-row: 1;
    }
    .lineup-workbench.desktop .lineup-config {
      display: flex;
      grid-column: 3;
      grid-row: 1;
      align-self: stretch;
      flex-direction: column;
    }
    .lineup-workbench.desktop .names-field {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
    .lineup-workbench.desktop .names-field textarea {
      min-height: 160px;
      flex: 1;
    }
    .lineup-workbench.desktop .lineup-result {
      grid-column: 2 / 4;
      grid-row: 2;
      margin-top: clamp(18px, 2.5vw, 34px);
    }
  }

  @media (max-width: 1250px) {
    .lineup-workbench.desktop {
      grid-template-columns: minmax(250px, 290px) minmax(0, 1fr);
    }

    .lineup-workbench.desktop .lineup-sidebar { grid-column: 1; grid-row: 1 / span 2; }
    .lineup-workbench.desktop .lineup-center { grid-column: 2; grid-row: 1; }
    .lineup-workbench.desktop .lineup-config { grid-column: 2; grid-row: 2; width: min(100%, 420px); }
  }

  @media (max-width: 900px) {
    .lineup-page { min-height: 0; border-radius: 19px 19px 0 0; }
    .lineup-workbench,
    .lineup-workbench.desktop { grid-template-columns: minmax(0, 1fr); }
    .lineup-workbench.desktop .lineup-sidebar,
    .lineup-workbench.desktop .lineup-center,
    .lineup-workbench.desktop .lineup-config { grid-column: 1; grid-row: auto; width: 100%; }
    .lineup-config { width: 100%; }
    .lineup-sidebar,
    .lineup-sidebar.ranking-open,
    .lineup-sidebar.history-open { height: auto; grid-template-rows: auto; contain: none; }
    .ranked-user-list { height: min(540px, 56vh); flex: none; }
    textarea { min-height: 220px; }
  }

  @media (max-width: 600px) {
    .lineup-page { padding: 24px 14px; }
    .lineup-config, .preview-panel, .lineup-result { padding: 17px; }
    .preview-list { grid-template-columns: minmax(0, 1fr); }
    .battle-result-toolbar { align-items: flex-start; flex-direction: column; }
    .battle-color-controls { justify-content: flex-start; }
    .lineup-actions { flex-direction: column; }
    .lineup-actions.desktop-actions { grid-template-columns: minmax(0, 1fr); }
  }
</style>
