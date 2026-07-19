<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { AppVariant } from './app-variant';
  import { downloadCsv, downloadFormattedJson } from './file-export';
  import {
    createLineupHistoryTransfer,
    lineupHistoryCsvRows,
    parseLineupHistoryTransfer,
    type LineupHistoryFileFormat,
  } from './lineup-history-transfer';
  import { parseOptionText } from './parse-options';
  import {
    createRankingTransfer,
    parseRankingTransfer,
    type RankedUserTransfer,
  } from './ranking-transfer';
  import {
    applyCaimiLineupSwap,
    createRandomLineup,
    hasPendingLineupNameInput,
    insertLineupPreviewName,
    isResolvedLineupName,
    lineupOrderAvailability,
    lineupPreviewTierStarts,
    moveLineupPreviewName,
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
  import type { RankedUser, ResolvedLineupName, SavedLineup } from './types';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';

  type LineupOrderMode = 'rank' | 'input';
  type DesktopPanel = 'ranking' | 'history';

  let sourceText = '';
  let groupCount = 4;
  let result: RandomLineup | null = null;
  let resultSignature = '';
  let error = '';
  let mounted = false;
  let desktopInitialized = false;
  let resolvingNames = false;
  let resolvedNames: ResolvedLineupName[] = [];
  let resolveTimer: ReturnType<typeof setTimeout> | undefined;
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
  let rankingReordering = false;
  let keyboardMovingUserId: number | null = null;
  let keyboardDropPointIndex = -1;
  let rankedUserActionIndex = -1;
  let rankingFocusActive = false;
  let keyboardRankLabel = '选择一项';
  let aliasLinkName: string | null = null;
  let aliasLinkRankInput = '';
  let historyStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let resultOrderMode: LineupOrderMode = 'input';
  let resultSourceNames: string[] = [];
  let resultOrderedNames: string[] = [];
  let lineupHistories: SavedLineup[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyImportStatus = '';
  let historyStart = '';
  let historyEnd = '';
  let insertIndex: number | null = null;
  let insertName = '';
  let insertError = '';
  let insertInput: HTMLInputElement | null = null;
  let previewMoveSourceIndex: number | null = null;
  let previewKeyboardIndex: number | null = null;
  let rankingFileInput: HTMLInputElement | null = null;
  let historyFileInput: HTMLInputElement | null = null;
  let pendingRankingImport: RankedUserTransfer[] | null = null;
  let rankingImporting = false;
  let historyImporting = false;
  let importErrorDialog: { title: string; detail: string } | null = null;
  let lineupResultElement: HTMLElement | null = null;
  let slowRevealEnabled = true;
  let revealedLineupCells = new Set<string>();
  let allLineupCellsRevealed = false;
  let hiddenLineupCellKeys = new Set<string>();

  $: names = uniqueLineupNames(parseOptionText(sourceText));
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
    if (!result || !desktopRuntime || !slowRevealEnabled || allLineupCellsRevealed) {
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
  $: canGenerateByInput = orderAvailability.input;
  $: canGenerateByRank = orderAvailability.rank;
  $: if (mounted && desktopRuntime && !desktopInitialized) {
    void initializeDesktop();
  }
  $: if (mounted && desktopRuntime && desktopInitialized) {
    namesSignature;
    scheduleNameResolution();
  }

  onMount(() => {
    mounted = true;
  });

  onDestroy(() => {
    mounted = false;
    if (resolveTimer) clearTimeout(resolveTimer);
  });

  function isTextEditingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && target.matches('input, textarea, select, [contenteditable="true"]');
  }

  async function initializeDesktop() {
    desktopInitialized = true;
    await Promise.all([loadRankedUsers(), loadLineupHistories()]);
    await resolveNames();
  }

  function scheduleNameResolution() {
    if (resolveTimer) clearTimeout(resolveTimer);
    if (names.length === 0) {
      resolvedNames = [];
      resolvingNames = false;
      return;
    }
    resolveTimer = setTimeout(() => {
      resolveTimer = undefined;
      void resolveNames();
    }, 220);
  }

  async function resolveNames(finalizeSourceText = false) {
    if (!desktopRuntime || names.length === 0) {
      resolvedNames = [];
      return;
    }
    const request = ++resolutionRequest;
    resolvingNames = true;
    try {
      const resolved = await invoke<ResolvedLineupName[]>('resolve_lineup_names', { names });
      if (request === resolutionRequest) {
        const uniquePeople = uniqueResolvedLineupPeople(resolved);
        if (
          !finalizeSourceText
          && uniquePeople.length !== names.length
          && hasPendingLineupNameInput(sourceText)
        ) {
          // 保留正在输入的最后一项，避免输入“12”时先输入的“1”被别名去重弹走。
          resolvedNames = resolved;
          return;
        }
        resolvedNames = uniquePeople;
        if (uniquePeople.length !== names.length) {
          sourceText = uniquePeople.map((person) => person.inputName).join('\n');
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
        if (resolveTimer) clearTimeout(resolveTimer);
        await resolveNames(true);
        if (
          orderMode === 'rank'
          && unresolvedLineupNameCount(names, resolvedNames) > 0
        ) {
          throw new Error('请先在排名表中补齐所有未关联项');
        }
      }
      const orderedNames = orderedNamesForLineup(orderMode);
      const generated = createRandomLineup(orderedNames, Number(groupCount));
      result = variant === 'caimi'
        ? applyCaimiLineupSwap(generated, rankScoresForLineup(orderedNames))
        : generated;
      resultOrderMode = orderMode;
      resultSourceNames = [...names];
      resultOrderedNames = orderedNames;
      groupCount = result.groupCount;
      const resolvedSignature = desktopRuntime
        ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
        : 'web';
      resultSignature = `${groupCount}|${names.join('\u0000')}|${resolvedSignature}`;
      resetLineupReveal();
    } catch (reason) {
      result = null;
      error = messageFrom(reason, '无法生成分组');
    }
  }

  async function saveHistory(
    orderedNames: string[],
    lineupResult: RandomLineup,
    orderMode: LineupOrderMode,
  ) {
    historyStatus = 'saving';
    const createdAt = Date.now();
    const lineup: SavedLineup = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `lineup-${createdAt}-${Math.random().toString(16).slice(2)}`,
      createdAt,
      input: {
        sourceNames: resultSourceNames,
        resolvedNames,
        orderedNames,
        groupCount,
        orderMode,
      },
      result: lineupResult,
    };
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
      || resultOutdated
      || historyStatus === 'saving'
      || historyStatus === 'saved'
    ) return;
    await saveHistory(resultOrderedNames, result, resultOrderMode);
  }

  async function exportLineupJson() {
    if (!result) return;
    error = '';
    try {
      await downloadFormattedJson('分组结果', {
        exportedAt: new Date().toISOString(),
        kind: 'random-lineup',
        input: {
          sourceNames: resultSourceNames,
          orderedNames: resultOrderedNames,
          groupCount: result.groupCount,
          orderMode: resultOrderMode,
        },
        result,
      });
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 JSON');
    }
  }

  async function exportLineupCsv() {
    if (!result) return;
    error = '';
    try {
      await downloadCsv('分组结果', [
        ['档位', ...result.groupNames.map((group) => `${group}组`)],
        ...result.tiers.map((tier, tierIndex) => [
          `t${tierIndex + 1}`,
          ...tier.map((entry) => entry?.name ?? ''),
        ]),
      ]);
    } catch (reason) {
      error = messageFrom(reason, '无法导出分组结果 CSV');
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
    rankingFileInput?.click();
  }

  async function readRankingFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
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
    if (!users || rankingImporting) return;
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

  function addUnknownPerson(name: string) {
    cancelAliasLink();
    resetUserForm();
    desktopPanel = 'ranking';
    userName = name;
  }

  async function startAliasLink(name: string) {
    cancelKeyboardRankMove();
    resetUserForm();
    aliasLinkName = name;
    aliasLinkRankInput = '';
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
    aliasLinkRankInput = '';
  }

  function updateAliasLinkRankShortcut(key: string) {
    aliasLinkRankInput = updateRankShortcutInput(aliasLinkRankInput, key);
    const userId = rankedUserIdAtShortcut(rankedUsers, aliasLinkRankInput);
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
      aliasLinkRankInput = '';
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
    cancelPreviewMove();
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
      sourceText = updated.join('\n');
      historyStatus = 'idle';
      cancelPreviewMove();
      cancelPreviewInsertion();
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
    cancelPreviewMove();
    const updated = [...names];
    const name = value.trim();
    if (!name) {
      updated.splice(index, 1);
    } else {
      updated[index] = name;
    }
    sourceText = updated.join('\n');
    historyStatus = 'idle';
  }

  function removePreviewName(index: number) {
    cancelPreviewInsertion();
    cancelPreviewMove();
    const updated = [...names];
    updated.splice(index, 1);
    sourceText = updated.join('\n');
    historyStatus = 'idle';
  }

  function cancelPreviewMove() {
    previewMoveSourceIndex = null;
    previewKeyboardIndex = null;
  }

  async function focusPreviewPosition(index: number) {
    if (names.length === 0) return;
    previewKeyboardIndex = Math.min(names.length, Math.max(0, index));
    await tick();
    document.querySelector<HTMLElement>(`[data-preview-position="${previewKeyboardIndex}"]`)
      ?.focus({ preventScroll: true });
    document.querySelector<HTMLElement>(`[data-preview-position="${previewKeyboardIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  async function confirmPreviewMove(insertAt: number) {
    if (previewMoveSourceIndex === null) return;
    const source = previewMoveSourceIndex;
    const updated = moveLineupPreviewName(names, source, insertAt);
    const movedIndex = source < insertAt ? insertAt - 1 : insertAt;
    sourceText = updated.join('\n');
    historyStatus = 'idle';
    cancelPreviewMove();
    await focusPreviewPosition(Math.min(updated.length - 1, movedIndex));
  }

  function selectOrConfirmPreviewMove(index: number) {
    if (previewMoveSourceIndex === null) {
      previewMoveSourceIndex = index;
      previewKeyboardIndex = index;
    } else {
      void confirmPreviewMove(index);
    }
  }

  function handlePreviewPositionKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      void focusPreviewPosition(index + (event.key === 'ArrowUp' ? -1 : 1));
    } else if (event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      selectOrConfirmPreviewMove(index);
    } else if (event.key === 'Escape' && previewMoveSourceIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      previewMoveSourceIndex = null;
    }
  }

  function handlePreviewEndKeydown(event: KeyboardEvent) {
    if (previewMoveSourceIndex === null) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      void focusPreviewPosition(event.key === 'ArrowUp' ? names.length - 1 : 0);
    } else if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void confirmPreviewMove(names.length);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      previewMoveSourceIndex = null;
      void focusPreviewPosition(names.length - 1);
    }
  }

  function handlePreviewEndClick(event: MouseEvent) {
    // 键盘触发的合成 click 已由 keydown 处理，避免确认移动后又打开添加框。
    if (event.detail === 0) return;
    if (previewMoveSourceIndex === null) void openPreviewInsertion(names.length);
    else void confirmPreviewMove(names.length);
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
    const mode = input.orderMode === 'input' ? '输入顺序' : '数据库排名';
    return `${peopleCount} 项 · ${Number(input.groupCount) || '—'} 组 · ${mode}`;
  }

  async function exportLineupHistoryCsv(history: SavedLineup) {
    historyError = '';
    try {
      await downloadCsv('分组历史', lineupHistoryCsvRows([history]));
    } catch (reason) {
      historyError = messageFrom(reason, '无法导出分组历史 CSV');
    }
  }

  async function exportLineupHistoryJson(history: SavedLineup) {
    historyError = '';
    try {
      await downloadFormattedJson('分组历史', createLineupHistoryTransfer([history], variant));
    } catch (reason) {
      historyError = messageFrom(reason, '无法导出分组历史 JSON');
    }
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
    if (extension !== 'csv' && extension !== 'json') {
      showImportError('分组历史导入失败', '只支持 CSV 或 JSON 文件');
      return;
    }
    historyImporting = true;
    historyError = '';
    historyImportStatus = '';
    try {
      const histories = parseLineupHistoryTransfer(
        await file.text(),
        extension as LineupHistoryFileFormat,
      );
      lineupHistories = await invoke<SavedLineup[]>('import_lineup_histories', {
        variant,
        histories,
      });
      historyImportStatus = `已导入 ${histories.length} 条`;
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
      await invoke('open_database_folder');
    } catch (reason) {
      const message = messageFrom(reason, '无法打开数据库文件夹');
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
    if (next instanceof HTMLElement && next.closest('.desktop-accordion-toggle')) return;
    if (next instanceof Node && manager.contains(next)) return;
    rankingFocusActive = false;
    selectedRankedUserId = null;
    rankedUserActionIndex = -1;
    cancelKeyboardRankMove();
  }

  async function moveRankedUserActionFocus(direction: 'left' | 'right') {
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
    if (rankedUsers.length === 0) return;
    const currentIndex = rankedUsers.findIndex((user) => user.id === selectedRankedUserId);
    const nextIndex = currentIndex < 0
      ? delta > 0 ? 0 : rankedUsers.length - 1
      : (currentIndex + delta + rankedUsers.length) % rankedUsers.length;
    void selectRankedUser(rankedUsers[nextIndex].id);
  }

  function keyboardRankDropPoints() {
    return rankedUserKeyboardDropPoints(
      rankedPeople.map((user) => user.id),
      unrankedPeople.map((user) => user.id),
    );
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
    selectRankedUserFromPointer(userId);
    if (aliasLinkName !== null || rankingReordering || keyboardMovingUserId !== null || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, form')) return;
    pendingRankDragUserId = userId;
    rankDragPointerId = event.pointerId;
    rankDragStartX = event.clientX;
    rankDragStartY = event.clientY;
    rankDragX = event.clientX;
    rankDragY = event.clientY;
    activeRankDropTarget = null;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
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
        const target = rankedUserDropTargetForCard(userId, rankIndex, verticalRatio);
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
    activeRankDropTarget = rankDropTargetAt(event.clientX, event.clientY);
    event.preventDefault();
  }

  function finishRankPointerDrag(event: PointerEvent) {
    if (event.pointerId !== rankDragPointerId) return;
    const userId = draggingUserId;
    const target = activeRankDropTarget ?? rankDropTargetAt(event.clientX, event.clientY);
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    clearRankDragState();
    if (userId !== null && target !== null) void moveRankedUser(userId, target);
  }

  function cancelRankPointerDrag(event: PointerEvent) {
    if (event.pointerId !== rankDragPointerId) return;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
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
        const input = userNameInput
          ?? document.querySelector<HTMLInputElement>('.rank-person-form input');
        input?.focus({ preventScroll: true });
        input?.select();
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
    } catch (reason) {
      rankingError = messageFrom(reason, '无法删除全部别名');
    } finally {
      clearingAliasesUserId = null;
    }
  }

  function handleLineupKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();

    if (importErrorDialog) {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        importErrorDialog = null;
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
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void confirmAliasLink();
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
      } else if (event.key === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        confirmKeyboardRankMove();
      }
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
      void moveRankedUserActionFocus(direction);
      return;
    }
    if (rankedUserActionIndex >= 0) {
      // 操作按钮保留原生空格/回车点击，其他单键不触发排名排序。
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveRankedUserSelection(event.key === 'ArrowUp' ? -1 : 1);
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
    } else if (key === 'e') {
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

  function clearAll() {
    cancelPreviewMove();
    sourceText = '';
    result = null;
    error = '';
    historyStatus = 'idle';
  }

  function finalizeSourceNames() {
    if (resolveTimer) {
      clearTimeout(resolveTimer);
      resolveTimer = undefined;
    }
    void resolveNames(true);
  }

  function focusLineupResult() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    lineupResultElement?.focus({ preventScroll: true });
    lineupResultElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showImportError(title: string, detail: string) {
    importErrorDialog = { title, detail };
  }

  function messageFrom(reason: unknown, fallback: string): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' && reason ? reason : fallback;
  }
</script>

<svelte:window on:keydown={handleLineupKeydown} />

<main class="lineup-page" id="lineup">
  <div class:desktop={desktopRuntime} class="lineup-workbench">
    {#if desktopRuntime}
      <aside class:ranking-open={desktopPanel === 'ranking'} class:history-open={desktopPanel === 'history'} class="lineup-sidebar">
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
                  <button type="button" on:click={openRankingImporter}>导入 JSON</button>
                  <button type="button" class="delete-all-rankings" disabled={rankedUsers.length === 0 || clearingAllRankings} on:click={requestClearAllRankings}>删除全部</button>
                </div>
                {#if aliasLinkName !== null}
                  <div class="rank-keyboard-order active alias-link-order">
                    <span><strong>关联 {aliasLinkName}</strong><small>{rankedUsers.find((user) => user.id === selectedRankedUserId)?.name ?? '选择一项'}{aliasLinkRankInput ? ` · 排名 ${aliasLinkRankInput}` : ''}</small></span>
                    <button type="button" aria-keyshortcuts="Enter" disabled={selectedRankedUserId === null || rankingSaving} on:click={confirmAliasLink}>确认</button>
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
                        on:pointermove={moveRankPointerDrag}
                        on:pointerup={finishRankPointerDrag}
                        on:pointercancel={cancelRankPointerDrag}
                      >
                        <span class="rank-number">{user.rank}</span>
                        <div class="ranked-user-content">
                          {#if editingUserId === user.id}
                            <form class="inline-rank-edit" on:submit|preventDefault={saveRankedUser}>
                              <div>
                                {#if editingRankField === 'name'}
                                  <input bind:this={userNameInput} maxlength="80" required bind:value={userName} aria-label="修改名称" on:keydown={(event) => event.key === 'Escape' && resetUserForm()} />
                                {:else}
                                  <strong>{userName}</strong>
                                {/if}
                                <span><button type="submit" aria-label="保存">✓</button><button type="button" aria-label="取消" on:click={resetUserForm}>×</button></span>
                              </div>
                              {#if editingRankField === 'aliases'}
                                <input bind:this={userAliasInput} bind:value={userAliases} maxlength="80" required aria-label="添加新别名" placeholder="输入新别名" on:keydown={(event) => event.key === 'Escape' && resetUserForm()} />
                              {:else}
                                <small>{otherAliasSummary(user)}</small>
                              {/if}
                            </form>
                          {:else}
                            <div
                              class="ranked-user-heading"
                              class:actions-active={selectedRankedUserId === user.id && rankedUserActionIndex >= 0}
                            >
                              <button type="button" class="user-name" on:click={() => editRankedUser(user, 'name')}>{user.name}</button>
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
                          <div class="rank-drop-guides" aria-hidden="true"><i></i><i></i><i></i></div>
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
                        on:pointermove={moveRankPointerDrag}
                        on:pointerup={finishRankPointerDrag}
                        on:pointercancel={cancelRankPointerDrag}
                      >
                        <span class="rank-number">—</span>
                        <div class="ranked-user-content">
                          {#if editingUserId === user.id}
                            <form class="inline-rank-edit" on:submit|preventDefault={saveRankedUser}>
                              <div>
                                {#if editingRankField === 'name'}
                                  <input bind:this={userNameInput} maxlength="80" required bind:value={userName} aria-label="修改名称" on:keydown={(event) => event.key === 'Escape' && resetUserForm()} />
                                {:else}
                                  <strong>{userName}</strong>
                                {/if}
                                <span><button type="submit" aria-label="保存">✓</button><button type="button" aria-label="取消" on:click={resetUserForm}>×</button></span>
                              </div>
                              {#if editingRankField === 'aliases'}
                                <input bind:this={userAliasInput} bind:value={userAliases} maxlength="80" required aria-label="添加新别名" placeholder="输入新别名" on:keydown={(event) => event.key === 'Escape' && resetUserForm()} />
                              {:else}
                                <small>{otherAliasSummary(user)}</small>
                              {/if}
                            </form>
                          {:else}
                            <div
                              class="ranked-user-heading"
                              class:actions-active={selectedRankedUserId === user.id && rankedUserActionIndex >= 0}
                            >
                              <button type="button" class="user-name" on:click={() => editRankedUser(user, 'name')}>{user.name}</button>
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
            <span>分组历史</span><strong>最近 5 条</strong><i>{desktopPanel === 'history' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'history'}
            <div class="desktop-accordion-content history-panel">
              <input bind:this={historyFileInput} class="lineup-file-input" type="file" accept=".csv,.json,text/csv,application/json" on:change={importLineupHistoryFile} />
              <div class="history-dates">
                <label><span>开始日期</span><input type="date" bind:value={historyStart} /></label>
                <label><span>结束日期</span><input type="date" bind:value={historyEnd} /></label>
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
                        <small>查看结果 →</small>
                      </button>
                      <div class="history-item-actions">
                        <button type="button" on:click={() => exportLineupHistoryCsv(history)}>CSV</button>
                        <button type="button" on:click={() => exportLineupHistoryJson(history)}>JSON</button>
                      </div>
                    </article>
                  {/each}
                {/if}
              </div>
              <div class="history-export-actions">
                <button type="button" disabled={historyImporting} on:click={openLineupHistoryImporter}>{historyImporting ? '导入中…' : '导入 CSV/JSON'}</button>
                <button type="button" on:click={() => openLineupDatabaseFolder('history')}>打开文件夹</button>
              </div>
              {#if historyImportStatus}<div class="history-import-status" role="status">{historyImportStatus}</div>{/if}
            </div>
          {/if}
        </section>
      </aside>
    {/if}

    <section class="lineup-center" aria-live="polite">
      <div class="preview-panel">
        <div class="result-heading">
          <div><span>02</span><div><h2>名单预览</h2><p>可直接修正名字；桌面端会核对别名表</p></div></div>
          <strong class:warning={desktopRuntime && unresolvedPreviewCount > 0} class="preview-status">
            {resolvingNames ? '核对中…' : desktopRuntime && unresolvedPreviewCount > 0 ? `${unresolvedPreviewCount} 项未识别` : `${names.length} 项`}
          </strong>
        </div>

        {#if previewRows.length > 0}
          <div class="preview-list">
            {#each previewRows as row, index}
              {#if previewTierStarts.has(index)}
                <div class:first-tier={index === 0} class="preview-tier-divider" role="separator" aria-label={`第 ${Math.floor(index / Math.max(2, Number(groupCount) || 2)) + 1} 档`}>
                  <i></i><span>t{Math.floor(index / Math.max(2, Number(groupCount) || 2)) + 1}</span><i></i>
                </div>
              {/if}
              {#if insertIndex === index}
                <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                  <label>
                    <span>插入到 {row.name} 前</span>
                    <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label={`插入到 ${row.name} 前`} on:keydown={(event) => event.key === 'Escape' && cancelPreviewInsertion()} />
                  </label>
                  <button type="submit">插入</button>
                  <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                  {#if insertError}<small role="alert">{insertError}</small>{/if}
                </form>
              {/if}
              <div
                class:keyboard-position={previewKeyboardIndex === index}
                class:preview-move-source={previewMoveSourceIndex === index}
                class:preview-move-target={previewMoveSourceIndex !== null && previewKeyboardIndex === index}
                class:unknown={desktopRuntime && !resolvingNames && !isResolvedLineupName(row.name, row.resolved)}
                class="preview-row"
              >
                <button type="button" class:active={insertIndex === index} class="insert-before-button" title={`在 ${row.name} 前插入`} aria-label={`在 ${row.name} 前插入`} on:click={() => openPreviewInsertion(index)}>＋</button>
                <button
                  type="button"
                  class="preview-move-handle"
                  data-preview-position={index}
                  aria-label={`${row.name}，空格选择移动，方向键选择插入位置`}
                  on:focus={() => (previewKeyboardIndex = index)}
                  on:keydown={(event) => handlePreviewPositionKeydown(event, index)}
                >{String(index + 1).padStart(2, '0')}</button>
                <div>
                  <input value={row.name} aria-label={`第 ${index + 1} 个名称`} on:change={(event) => updatePreviewName(index, (event.currentTarget as HTMLInputElement).value)} />
                  {#if desktopRuntime}
                    <small>{resolvingNames
                      ? '核对中'
                      : row.resolved?.known
                        ? `本名 ${row.resolved.canonicalName} · 排名 ${row.resolved.rank}`
                        : '别名表中没有对应选项'}</small>
                  {/if}
                </div>
                {#if desktopRuntime && !resolvingNames && !isResolvedLineupName(row.name, row.resolved)}
                  <div class="preview-link-actions">
                    <button type="button" class="link-preview-user" title="关联到现有排名" on:click={() => startAliasLink(row.name)}>关联</button>
                    <button type="button" class="add-preview-user" title="添加到排名表" on:click={() => addUnknownPerson(row.name)}>录入</button>
                  </div>
                {/if}
                <button type="button" class="remove-preview-user" title={`移除 ${row.name}`} on:click={() => removePreviewName(index)}>×</button>
              </div>
            {/each}
            {#if insertIndex === previewRows.length}
              <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                <label>
                  <span>添加到名单末尾</span>
                  <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label="添加到名单末尾" on:keydown={(event) => event.key === 'Escape' && cancelPreviewInsertion()} />
                </label>
                <button type="submit">添加</button>
                <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                {#if insertError}<small role="alert">{insertError}</small>{/if}
              </form>
            {/if}
            <button
              type="button"
              class:preview-move-target={previewMoveSourceIndex !== null && previewKeyboardIndex === previewRows.length}
              class="append-preview-user"
              data-preview-position={previewRows.length}
              on:focus={() => (previewKeyboardIndex = previewRows.length)}
              on:keydown={handlePreviewEndKeydown}
              on:click={handlePreviewEndClick}
            >{previewMoveSourceIndex === null ? '＋ 添加到名单末尾' : '放到末尾'}</button>
          </div>
        {:else}
          <div class="preview-empty">
            <span>请先在右侧粘贴名单</span>
            {#if insertIndex === 0}
              <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                <label>
                  <span>添加第一项</span>
                  <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label="添加第一项" on:keydown={(event) => event.key === 'Escape' && cancelPreviewInsertion()} />
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

        {#if error}<div class="lineup-error" role="alert">{error}</div>{/if}

        {#if desktopRuntime && !resolvingNames && unresolvedPreviewCount > 0}
          <div class="rank-order-lock" role="status">还有未关联项，数据库排名分组暂不可用；可以使用输入顺序分组。</div>
        {/if}

        {#if desktopRuntime}
          <label class="slow-reveal-setting"><input type="checkbox" checked={slowRevealEnabled} on:change={updateSlowReveal} /><span>缓慢开启</span></label>
        {/if}
        <div class="lineup-actions">
          {#if desktopRuntime}
            <button type="button" class="generate-button rank-generate-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按数据库排名分组' : '按数据库排名分档'} disabled={!canGenerateByRank} on:click={() => generate('rank')}><span>按数据库排名分组</span><i>→</i></button>
            <button type="button" class="input-order-button" title="忽略数据库排名，按当前名单顺序分档" disabled={!canGenerateByInput} on:click={() => generate('input')}>仅按输入顺序分组</button>
          {:else}
            <button type="button" class="generate-button" disabled={!canGenerateByInput} on:click={() => generate('input')}><span>开始分组</span><i>→</i></button>
          {/if}
        </div>
      </div>

      <div bind:this={lineupResultElement} class="lineup-result" tabindex="-1">
        <div class="result-heading">
          <div><span>03</span><div><h2>分组结果</h2><p>{result ? `${result.peopleCount} 项 · ${result.groupCount} 组 · ${result.tiers.length} 档 · ${resultOrderMode === 'rank' ? '数据库排名' : '输入顺序'}` : '点击上方分组后生成表格'}</p></div></div>
          {#if result}
            <div class="result-output-actions">
              {#if hiddenLineupCellCount > 0}
                <button type="button" class="result-export-button reveal-all-button" on:click={revealAllLineupCells}>显示全部</button>
              {/if}
              <button type="button" class="result-export-button" on:click={exportLineupCsv}>CSV</button>
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
      </div>
    </section>

    <aside class="lineup-config">
      <div class="config-heading"><div><span>01</span><h2>名单</h2></div><strong>{names.length}<small>项</small></strong></div>
      <label class="names-field"><span>每行一个，也支持空格、逗号和 Excel 粘贴</span><textarea bind:value={sourceText} placeholder="粘贴名称…" spellcheck="false" on:input={cancelPreviewMove} on:blur={finalizeSourceNames}></textarea></label>
      <div class="list-actions"><button type="button" disabled={!sourceText} on:click={clearAll}>清空</button></div>
      <div class="group-setting"><label for="lineup-group-count"><span>组数</span><input id="lineup-group-count" type="number" min="2" max="26" step="1" bind:value={groupCount} /></label><div><span>预计档位</span><strong>{tierPreview || '—'}</strong></div></div>
    </aside>
  </div>
</main>

{#if draggingUserId !== null}
  <div class="rank-drag-ghost" style={`left: ${rankDragX}px; top: ${rankDragY}px;`} aria-hidden="true">
    {rankedUsers.find((user) => user.id === draggingUserId)?.name ?? '选项'}
  </div>
{/if}

{#if pendingDeleteUser}
  <div class="delete-confirm-backdrop">
    <div class="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-ranked-title" aria-describedby="delete-ranked-detail" tabindex="-1">
      <span class="delete-confirm-icon">×</span>
      <h2 id="delete-ranked-title">删除“{pendingDeleteUser.name}”？</h2>
      <p id="delete-ranked-detail">当前名称、全部别名和排名都会一起删除，此操作无法撤销。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={deletingUserId !== null} on:click={() => (pendingDeleteUser = null)}><span>取消</span><kbd>N / Esc</kbd></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={deletingUserId !== null} on:click={confirmDeleteRankedUser}><span>{deletingUserId === null ? '确认删除' : '删除中…'}</span><kbd>Y / Enter</kbd></button>
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
        <button type="button" aria-keyshortcuts="N Escape" disabled={clearingAliasesUserId !== null} on:click={() => (pendingAliasClearUser = null)}><span>取消</span><kbd>N / Esc</kbd></button>
        <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={clearingAliasesUserId !== null} on:click={confirmClearRankedUserAliases}><span>{clearingAliasesUserId === null ? '确认删除' : '删除中…'}</span><kbd>Y / Enter</kbd></button>
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
        <button type="button" aria-keyshortcuts="N Escape" disabled={clearingAllRankings} on:click={cancelClearAllRankings}><span>取消</span><kbd>N / Esc</kbd></button>
        {#if clearAllRankingsConfirmation === 1}
          <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" on:click={continueClearAllRankings}><span>继续</span><kbd>Y / Enter</kbd></button>
        {:else}
          <button type="button" class="confirm-delete" aria-keyshortcuts="Y Enter" disabled={clearingAllRankings} on:click={confirmClearAllRankings}><span>{clearingAllRankings ? '删除中…' : '确认删除'}</span><kbd>Y / Enter</kbd></button>
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
      <p id="ranking-import-detail">当前排名和别名会被文件内容完整替换。</p>
      <div>
        <button type="button" aria-keyshortcuts="N Escape" disabled={rankingImporting} on:click={() => (pendingRankingImport = null)}><span>取消</span><kbd>N / Esc</kbd></button>
        <button type="button" class="confirm-import" aria-keyshortcuts="Y Enter" disabled={rankingImporting} on:click={confirmRankingImport}><span>{rankingImporting ? '导入中…' : '确认导入'}</span><kbd>Y / Enter</kbd></button>
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
    grid-template-columns: minmax(350px, 410px) minmax(0, 1fr) minmax(300px, 360px);
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

  .list-actions { display: flex; justify-content: flex-end; margin-top: 7px; }
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
  .list-actions button { border-color: #c5a49d; background: #fbf0ed; color: #7e3c31; }
  .list-actions button:hover:not(:disabled) { border-color: #b85b49; background: #f7ded8; color: #6d2419; }

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
    min-height: 180px;
    align-content: center;
    justify-items: center;
    color: var(--lineup-dim-on-dark);
    text-align: center;
  }
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
    grid-template-columns: 22px 25px minmax(0, 1fr) auto 22px;
    align-items: center;
    gap: 6px;
    padding: 7px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.035);
  }

  .preview-row.unknown {
    border-color: rgba(221, 151, 132, 0.24);
    background: rgba(221, 151, 132, 0.035);
    box-shadow: inset 2px 0 rgba(221, 151, 132, 0.5);
  }

  .preview-row.keyboard-position {
    outline: 1px solid rgba(231, 255, 114, 0.32);
    outline-offset: 1px;
  }

  .preview-row.preview-move-source {
    opacity: 0.56;
  }

  .preview-row.preview-move-target::before {
    position: absolute;
    right: 8px;
    bottom: calc(100% + 2px);
    left: 8px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent);
    content: '';
  }

  .preview-move-handle {
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lineup-dim-on-dark);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

  .preview-move-handle:focus-visible { color: var(--accent); }

  .preview-row > div { min-width: 0; }

  .preview-row input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: #f4f1e8;
    font-family: var(--font-sans);
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 750;
  }

  .preview-row small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: var(--lineup-muted-on-dark);
    font-size: calc(10px * var(--font-scale, 1));
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

  .append-preview-user.preview-move-target {
    border-color: rgba(231, 255, 114, 0.68);
    background: rgba(231, 255, 114, 0.14);
    color: var(--accent);
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

  .slow-reveal-setting {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    color: var(--lineup-muted-on-dark);
    cursor: pointer;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .slow-reveal-setting input {
    width: 15px;
    height: 15px;
    accent-color: #bcca63;
  }

  .lineup-actions .generate-button {
    flex: 1;
    margin-top: 0;
  }

  .lineup-actions .rank-generate-button {
    width: auto;
    flex: 0 1 auto;
    padding: 9px 12px;
    font-size: calc(13px * var(--font-scale, 1));
  }

  .lineup-actions .rank-generate-button i {
    margin-left: 14px;
    font-size: calc(16px * var(--font-scale, 1));
  }

  .input-order-button {
    padding: 10px 13px;
    border: 1px solid rgba(231, 255, 114, 0.17);
    border-radius: 11px;
    background: rgba(231, 255, 114, 0.05);
    color: #e1eab0;
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 700;
  }

  .lineup-sidebar {
    display: grid;
    height: 100%;
    min-width: 0;
    align-content: start;
    gap: 9px;
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
    padding-right: 3px;
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
    transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease;
  }

  .ranked-user-list article:active { cursor: grabbing; }

  .ranked-user-list article:hover {
    border-color: rgba(223, 246, 108, 0.82);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 18px rgba(223, 246, 108, 0.11);
  }

  .ranked-user-list article.keyboard-selected {
    outline: 3px solid rgba(223, 246, 108, 0.82);
    outline-offset: 2px;
    background:
      radial-gradient(circle at 96% 0%, rgba(247, 214, 109, 0.28), transparent 31%),
      linear-gradient(135deg, #fffef7, #eef3c9);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3), 0 0 24px rgba(223, 246, 108, 0.18);
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

  .delete-confirm-dialog button kbd {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: var(--font-mono);
    font-size: calc(9px * var(--font-scale, 1));
    opacity: 0.72;
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
    .lineup-workbench.desktop .lineup-center { display: contents; }
    .lineup-workbench.desktop .lineup-sidebar { grid-column: 1; grid-row: 1 / span 2; }
    .lineup-workbench.desktop .preview-panel { grid-column: 2; grid-row: 1; }
    .lineup-workbench.desktop .lineup-config { grid-column: 3; grid-row: 1; }
    .lineup-workbench.desktop .lineup-result {
      grid-column: 2 / 4;
      grid-row: 2;
      margin-top: clamp(18px, 2.5vw, 34px);
    }
  }

  @media (max-width: 1250px) {
    .lineup-workbench.desktop {
      grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
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
    .lineup-sidebar.history-open { height: auto; grid-template-rows: auto; }
    .ranked-user-list { height: min(540px, 56vh); flex: none; }
    textarea { min-height: 220px; }
  }

  @media (max-width: 600px) {
    .lineup-page { padding: 24px 14px; }
    .lineup-config, .preview-panel, .lineup-result { padding: 17px; }
    .preview-list { grid-template-columns: minmax(0, 1fr); }
    .lineup-actions { flex-direction: column; }
  }
</style>
