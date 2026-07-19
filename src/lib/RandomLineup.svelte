<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { AppVariant } from './app-variant';
  import { downloadCsv, downloadFormattedJson } from './file-export';
  import { parseLineupFile, type LineupFileFormat } from './lineup-file-import';
  import { parseOptionText } from './parse-options';
  import {
    applyCaimiLineupSwap,
    createRandomLineup,
    insertLineupPreviewName,
    isResolvedLineupName,
    lineupOrderAvailability,
    lineupPreviewTierStarts,
    orderResolvedLineupNames,
    rankedUserDropTargetForCard,
    rankedUserKeyboardDropPoints,
    recentLineupHistories,
    unresolvedLineupNameCount,
    type RankedUserDropTarget,
    type RandomLineup,
  } from './random-lineup';
  import type { RankedUser, ResolvedLineupName, SavedLineup } from './types';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';

  type LineupOrderMode = 'rank' | 'input';
  type DesktopPanel = 'ranking' | 'history';

  const sampleNames = Array.from({ length: 24 }, (_, index) => `选手${String(index + 1).padStart(2, '0')}`).join('\n');

  let sourceText = '';
  let groupCount = 6;
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
  let deletingUserId: number | null = null;
  let clearingAliasesUserId: number | null = null;
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
  let keyboardRankLabel = '选择一项';
  let historyStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let resultOrderMode: LineupOrderMode = 'input';
  let resultSourceNames: string[] = [];
  let resultOrderedNames: string[] = [];
  let lineupHistories: SavedLineup[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyStart = '';
  let historyEnd = '';
  let insertIndex: number | null = null;
  let insertName = '';
  let insertError = '';
  let insertInput: HTMLInputElement | null = null;
  let lineupFileInput: HTMLInputElement | null = null;
  let fileImportError = '';

  $: names = parseOptionText(sourceText);
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

  async function resolveNames() {
    if (!desktopRuntime || names.length === 0) {
      resolvedNames = [];
      return;
    }
    const request = ++resolutionRequest;
    resolvingNames = true;
    try {
      const resolved = await invoke<ResolvedLineupName[]>('resolve_lineup_names', { names });
      if (request === resolutionRequest) resolvedNames = resolved;
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
      return resolvedNames.map((person) => person.canonicalName ?? person.inputName);
    }
    return orderResolvedLineupNames(resolvedNames);
  }

  function rankScoresForLineup(orderedNames: readonly string[]): number[] {
    if (!desktopRuntime) return orderedNames.map((_, index) => index + 1);
    const rankByName = new Map(
      resolvedNames.flatMap((person) => (
        person.canonicalName === null || person.rank === null
          ? []
          : [[person.canonicalName.toLocaleLowerCase('zh-CN'), person.rank] as const]
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
        await resolveNames();
        if (
          orderMode === 'rank'
          && unresolvedLineupNameCount(names, resolvedNames) > 0
        ) {
          throw new Error('请先在排名表中补齐所有高亮选项');
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

  function exportLineupJson() {
    if (!result) return;
    downloadFormattedJson('分组结果', {
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
  }

  function exportLineupCsv() {
    if (!result) return;
    downloadCsv('分组结果', [
      ['档位', ...result.groupNames.map((group) => `${group}组`)],
      ...result.tiers.map((tier, tierIndex) => [
        `t${tierIndex + 1}`,
        ...tier.map((entry) => entry?.name ?? ''),
      ]),
    ]);
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
    resetUserForm();
    desktopPanel = 'ranking';
    userName = name;
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
      sourceText = updated.join('\n');
      historyStatus = 'idle';
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
    const updated = [...names];
    updated.splice(index, 1);
    sourceText = updated.join('\n');
    historyStatus = 'idle';
  }

  function toggleDesktopPanel(panel: DesktopPanel) {
    if (panel !== 'ranking' || desktopPanel === panel) cancelKeyboardRankMove();
    desktopPanel = desktopPanel === panel ? null : panel;
  }

  function historySummary(history: SavedLineup): string {
    const input = history.input as Partial<{ sourceNames: unknown[]; groupCount: number; orderMode: LineupOrderMode }>;
    const peopleCount = Array.isArray(input.sourceNames) ? input.sourceNames.length : 0;
    const mode = input.orderMode === 'input' ? '输入顺序' : '数据库排名';
    return `${peopleCount} 项 · ${Number(input.groupCount) || '—'} 组 · ${mode}`;
  }

  function exportLineupHistoriesCsv() {
    if (visibleHistories.length === 0) return;
    downloadCsv('分组历史查询', [
      ['时间', '名单项数', '组数', '分组方式'],
      ...visibleHistories.map((history) => {
        const input = history.input as Partial<{
          sourceNames: unknown[];
          groupCount: number;
          orderMode: LineupOrderMode;
        }>;
        return [
          new Date(history.createdAt).toLocaleString('zh-CN', { hour12: false }),
          Array.isArray(input.sourceNames) ? input.sourceNames.length : 0,
          Number(input.groupCount) || '',
          input.orderMode === 'input' ? '输入顺序' : '数据库排名',
        ];
      }),
    ]);
  }

  function exportLineupHistoriesJson() {
    if (visibleHistories.length === 0) return;
    downloadFormattedJson('分组历史查询', {
      exportedAt: new Date().toISOString(),
      kind: 'lineup-history-query',
      variant,
      filters: { start: historyStart || null, end: historyEnd || null },
      histories: visibleHistories,
    });
  }

  async function openLineupDatabaseFolder() {
    historyError = '';
    try {
      await invoke('open_database_folder');
    } catch (reason) {
      historyError = messageFrom(reason, '无法打开数据库文件夹');
    }
  }

  function viewHistory(history: SavedLineup) {
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
    await tick();
    document.querySelector<HTMLElement>(`[data-rank-user-id="${userId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
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
    keyboardDropPointIndex = Math.min(points.length - 1, Math.max(0, index));
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
    const sourcePoint = points.findIndex(
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
    if (point.target.kind === 'insert') return `插入第 ${point.target.index + 1} 位`;
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
    if (panel === 'ranking' && rankedUsers.length > 0) {
      await selectRankedUser(selectedRankedUserId ?? rankedUsers[0].id);
    }
  }

  function otherAliasSummary(user: RankedUser): string {
    const aliases = user.aliases
      .filter((alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'))
      .map((alias) => alias.name);
    return aliases.length > 0 ? aliases.join('、') : '暂无其他别名';
  }

  function hasOtherAliases(user: RankedUser): boolean {
    return user.aliases.some(
      (alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'),
    );
  }

  function beginRankPointerDrag(event: PointerEvent, userId: number) {
    selectedRankedUserId = userId;
    if (rankingReordering || keyboardMovingUserId !== null || event.button !== 0) return;
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
          : 'swap';
        return target;
      }
      activeRankDropPosition = 'swap';
      return rankedUserDropTargetForCard(userId, null, 0.5);
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
    if (target.kind === 'swap' && target.userId === userId) {
      clearRankDragState();
      return;
    }

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
    rankingSaving = true;
    rankingError = '';
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
      resetUserForm();
      await loadRankedUsers();
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法保存排名选项');
    } finally {
      rankingSaving = false;
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
    if (!desktopRuntime || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();

    if (pendingDeleteUser || pendingAliasClearUser) {
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

    if (event.key === 'Escape') {
      event.preventDefault();
      if (keyboardMovingUserId !== null) {
        cancelKeyboardRankMove();
        return;
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      resetUserForm();
      selectedRankedUserId = null;
      clearRankDragState();
      return;
    }

    if (isTextEditingTarget(event.target)) return;
    if (key === 'a') {
      event.preventDefault();
      void openDesktopPanel('ranking');
      return;
    }
    if (key === 'z') {
      event.preventDefault();
      void openDesktopPanel('history');
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

  function fillSample() {
    sourceText = sampleNames;
    groupCount = 6;
    error = '';
    result = null;
  }

  function clearAll() {
    sourceText = '';
    result = null;
    error = '';
    historyStatus = 'idle';
  }

  function openLineupFileImporter() {
    fileImportError = '';
    lineupFileInput?.click();
  }

  async function importLineupFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLocaleLowerCase('zh-CN');
    if (extension !== 'csv' && extension !== 'json') {
      fileImportError = '只支持 CSV 或 JSON 文件';
      return;
    }

    try {
      const importedNames = parseLineupFile(await file.text(), extension as LineupFileFormat);
      sourceText = importedNames.join('\n');
      historyStatus = 'idle';
      error = '';
      fileImportError = '';
    } catch (reason) {
      fileImportError = messageFrom(reason, '无法导入名单');
    }
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
      <aside class="lineup-sidebar">
        <section class:open={desktopPanel === 'ranking'} class="desktop-accordion">
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('ranking')}>
            <span>排名</span><strong>{rankedUsers.length} 项</strong><i>{desktopPanel === 'ranking' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'ranking'}
            <div class:dragging={draggingUserId !== null} class:keyboard-moving={keyboardMovingUserId !== null} class:reordering={rankingReordering} class="desktop-accordion-content rank-manager">
              {#if rankingError}<div class="ranking-error" role="alert">{rankingError}</div>{/if}
              <div class:active={keyboardMovingUserId !== null} class="rank-keyboard-order">
                <span>
                  <strong>{keyboardMovingUserId === null ? '键盘排序' : rankedUsers.find((user) => user.id === keyboardMovingUserId)?.name}</strong>
                  <small>{keyboardRankLabel}</small>
                </span>
                <button type="button" disabled={selectedRankedUserId === null || rankingReordering} on:click={toggleKeyboardRankMove}>{keyboardMovingUserId === null ? '选中' : '放下'}</button>
                {#if keyboardMovingUserId !== null}<button type="button" class="cancel-rank-move" on:click={cancelKeyboardRankMove}>取消</button>{/if}
              </div>
              <div class="ranked-user-list">
                {#if rankingLoading}
                  <p>正在读取排名表…</p>
                {:else}
                  <section class="rank-zone" data-rank-zone="ranked">
                    <div class="rank-zone-heading"><strong>已排名</strong><span>{rankedPeople.length}</span></div>
                    {#if rankedPeople.length === 0}
                      <div class:active={activeRankDropTarget?.kind === 'insert'} class="empty-ranked-drop">拖入排名</div>
                    {/if}
                    {#each rankedPeople as user, index (user.id)}
                      <!-- 卡片用纵向四分区处理插入与替换，内部按钮保留独立操作。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        class:keyboard-selected={selectedRankedUserId === user.id}
                        class:drop-target={activeRankDropCardId === user.id && activeRankDropPosition === 'swap'}
                        class:insert-before={activeRankDropCardId === user.id && activeRankDropPosition === 'before'}
                        class:insert-after={activeRankDropCardId === user.id && activeRankDropPosition === 'after'}
                        class:drag-source={rankMoveSourceId === user.id}
                        data-rank-user-id={user.id}
                        data-rank-index={index}
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
                            <div class="ranked-user-heading">
                              <button type="button" class="user-name" on:click={() => editRankedUser(user, 'name')}>{user.name}</button>
                              <button type="button" class="alias-action" on:click={() => editRankedUser(user, 'aliases')}>添加别名</button>
                              <button type="button" class="delete-user" on:click={() => requestDeleteRankedUser(user)}>删除</button>
                            </div>
                            <div class="ranked-user-aliases">
                              <small>{otherAliasSummary(user)}</small>
                              {#if hasOtherAliases(user)}
                                <button type="button" class="clear-aliases" on:click={() => requestClearRankedUserAliases(user)}>删除全部别名</button>
                              {/if}
                            </div>
                          {/if}
                        </div>
                        <span class="drag-handle" title="拖动调整排名">⠿</span>
                        {#if rankMoveSourceId !== null && rankMoveSourceId !== user.id}
                          <div class="rank-drop-guides" aria-hidden="true"><i></i><i></i><i></i></div>
                        {/if}
                      </article>
                    {/each}
                  </section>

                  <section class="rank-zone unranked-zone" data-rank-zone="unranked">
                    <div class="rank-zone-heading"><strong>无排名</strong><span>{unrankedPeople.length}</span></div>
                    <div class:active={activeRankDropTarget?.kind === 'unranked'} class="unranked-drop-zone">拖入无排名</div>
                    {#if unrankedPeople.length === 0}
                      <p class="empty-rank-zone">暂无无排名选项</p>
                    {/if}
                    {#each unrankedPeople as user (user.id)}
                      <!-- 卡片整体提供桌面拖拽，内部按钮保留独立操作。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        class:keyboard-selected={selectedRankedUserId === user.id}
                        class:drop-target={activeRankDropCardId === user.id && activeRankDropPosition === 'swap'}
                        class:drag-source={rankMoveSourceId === user.id}
                        data-rank-user-id={user.id}
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
                            <div class="ranked-user-heading">
                              <button type="button" class="user-name" on:click={() => editRankedUser(user, 'name')}>{user.name}</button>
                              <button type="button" class="alias-action" on:click={() => editRankedUser(user, 'aliases')}>添加别名</button>
                              <button type="button" class="delete-user" on:click={() => requestDeleteRankedUser(user)}>删除</button>
                            </div>
                            <div class="ranked-user-aliases">
                              <small>{otherAliasSummary(user)}</small>
                              {#if hasOtherAliases(user)}
                                <button type="button" class="clear-aliases" on:click={() => requestClearRankedUserAliases(user)}>删除全部别名</button>
                              {/if}
                            </div>
                          {/if}
                        </div>
                        <span class="drag-handle" title="拖动调整排名">⠿</span>
                        {#if rankMoveSourceId !== null && rankMoveSourceId !== user.id}<div class="swap-drop-guide" aria-hidden="true"></div>{/if}
                      </article>
                    {/each}
                  </section>
                {/if}
              </div>
              {#if editingUserId === null}
              <form class="rank-person-form" on:submit|preventDefault={saveRankedUser}>
                <div class="rank-form-heading">
                  <strong>添加</strong>
                </div>
                <label><span>名称</span><input bind:this={userNameInput} maxlength="80" required bind:value={userName} placeholder="名称" /></label>
                <button type="submit" class="save-user" disabled={rankingSaving || !userName.trim()}>{rankingSaving ? '保存中…' : '保存'}</button>
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
                    <button type="button" on:click={() => viewHistory(history)}>
                      <span>{formatHistoryDate(history.createdAt)}</span>
                      <strong>{historySummary(history)}</strong>
                      <small>查看结果 →</small>
                    </button>
                  {/each}
                {/if}
              </div>
              <div class="history-export-actions">
                <button type="button" disabled={visibleHistories.length === 0} on:click={exportLineupHistoriesCsv}>CSV</button>
                <button type="button" disabled={visibleHistories.length === 0} on:click={exportLineupHistoriesJson}>JSON</button>
                <button type="button" on:click={openLineupDatabaseFolder}>打开文件夹</button>
              </div>
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
              <div class:unknown={desktopRuntime && !resolvingNames && !isResolvedLineupName(row.name, row.resolved)} class="preview-row">
                <button type="button" class:active={insertIndex === index} class="insert-before-button" title={`在 ${row.name} 前插入`} aria-label={`在 ${row.name} 前插入`} on:click={() => openPreviewInsertion(index)}>＋</button>
                <span>{String(index + 1).padStart(2, '0')}</span>
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
                  <button type="button" class="add-preview-user" title="添加到排名表" on:click={() => addUnknownPerson(row.name)}>录入</button>
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
            <button type="button" class="append-preview-user" on:click={() => openPreviewInsertion(previewRows.length)}>＋ 添加到名单末尾</button>
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
          <div class="rank-order-lock" role="status">名单中还有红名，数据库排名分组已锁定；可以先使用输入顺序分组。</div>
        {/if}

        <div class="lineup-actions">
          {#if desktopRuntime}
            <button type="button" class="generate-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按数据库排名分组' : '按数据库排名分档'} disabled={!canGenerateByRank} on:click={() => generate('rank')}><span>按数据库排名分组</span><i>→</i></button>
            <button type="button" class="input-order-button" title="忽略数据库排名，按当前名单顺序分档" disabled={!canGenerateByInput} on:click={() => generate('input')}>仅按输入顺序分组</button>
          {:else}
            <button type="button" class="generate-button" disabled={!canGenerateByInput} on:click={() => generate('input')}><span>开始分组</span><i>→</i></button>
          {/if}
        </div>
      </div>

      <div class="lineup-result">
        <div class="result-heading">
          <div><span>03</span><div><h2>分组结果</h2><p>{result ? `${result.peopleCount} 项 · ${result.groupCount} 组 · ${result.tiers.length} 档 · ${resultOrderMode === 'rank' ? '数据库排名' : '输入顺序'}` : '点击上方分组后生成表格'}</p></div></div>
          {#if result}
            <div class="result-output-actions">
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
            <table>
              <thead><tr><th scope="col">档位</th>{#each result.groupNames as group}<th scope="col"><span>{group}</span>组</th>{/each}</tr></thead>
              <tbody>
                {#each result.tiers as tier, tierIndex}
                  <tr><th scope="row"><span>t{tierIndex + 1}</span><small>第 {tierIndex + 1} 档</small></th>{#each tier as entry}<td class:empty={!entry} class:caimi-swapped={Boolean(entry?.caimiSwap)} class:caimi-favored={entry?.caimiSwap?.kind === 'favored'}>{#if entry}{#if entry.caimiSwap}<i class="caimi-swap-badge">{entry.caimiSwap.kind === 'favored' ? '守护' : '支援'}</i>{/if}<strong>{entry.name}</strong><small>#{entry.sourceIndex + 1}{entry.caimiSwap ? ` · 原 ${result.groupNames[entry.caimiSwap.fromGroupIndex]} 组` : ''}</small>{:else}<span>—</span>{/if}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-result"><div class="empty-grid"><i>A</i><i>B</i><i>C</i><i>D</i><i>E</i><i>F</i></div><strong>分组表会显示在这里</strong><p>例如 24 项、6 组，将得到 A–F 六组与 t1–t4 四档。</p></div>
        {/if}
      </div>
    </section>

    <aside class="lineup-config">
      <div class="config-heading"><div><span>01</span><h2>名单</h2></div><strong>{names.length}<small>项</small></strong></div>
      <label class="names-field"><span>每行一个，也支持空格、逗号和 Excel 粘贴</span><textarea bind:value={sourceText} placeholder="粘贴名称…" spellcheck="false"></textarea></label>
      <input bind:this={lineupFileInput} class="lineup-file-input" type="file" accept=".csv,.json,text/csv,application/json" on:change={importLineupFile} />
      <div class="sample-actions"><button type="button" on:click={openLineupFileImporter}>导入 CSV/JSON</button><button type="button" on:click={fillSample}>填入 24 项示例</button><button type="button" disabled={!sourceText} on:click={clearAll}>清空</button></div>
      {#if fileImportError}<div class="file-import-error" role="alert">{fileImportError}</div>{/if}
      <div class="group-setting"><label for="lineup-group-count"><span>组数</span><input id="lineup-group-count" type="number" min="2" max="26" step="1" bind:value={groupCount} /></label><div><span>预计档位</span><strong>{tierPreview || '—'}</strong></div></div>
      <div class="rule-note"><span>分档方式</span><p>{desktopRuntime ? `默认按数据库排名每 ${Math.max(2, Number(groupCount) || 2)} 项一档，无排名记为 10000。` : `按输入顺序每 ${Math.max(2, Number(groupCount) || 2)} 项划为一档。`}</p></div>
    </aside>
  </div>
</main>

{#if draggingUserId !== null}
  <div class="rank-drag-ghost" style={`left: ${rankDragX}px; top: ${rankDragY}px;`} aria-hidden="true">
    <span>⠿</span>{rankedUsers.find((user) => user.id === draggingUserId)?.name ?? '选项'}
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
  .result-heading > div > span,
  .rule-note > span {
    color: #c9d66f;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--font-scale, 1));
    letter-spacing: 0.14em;
  }

  .config-heading span,
  .rule-note > span {
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
  .file-import-error { margin-top: 7px; color: #ad4b35; font-size: calc(11px * var(--font-scale, 1)); }
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

  .sample-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 7px; }
  .sample-actions button {
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
  .sample-actions button:hover:not(:disabled) { border-color: #7f923f; background: #eef4d8; color: #34420f; }
  .sample-actions button:first-child { border-color: rgba(105, 119, 43, 0.42); background: #f1f5df; color: #526020; }
  .sample-actions button:last-child { border-color: #c5a49d; background: #fbf0ed; color: #7e3c31; }
  .sample-actions button:last-child:hover:not(:disabled) { border-color: #b85b49; background: #f7ded8; color: #6d2419; }

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

  .rule-note {
    margin-top: 15px;
    padding-top: 14px;
    border-top: 1px solid rgba(36, 37, 31, 0.09);
  }
  .rule-note p { margin-top: 5px; color: var(--lineup-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); line-height: 1.6; }

  .lineup-result {
    min-width: 0;
    padding: clamp(20px, 3vw, 34px);
    background: rgba(11, 12, 9, 0.27);
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
  table { width: 100%; min-width: 650px; border-collapse: separate; border-spacing: 7px; table-layout: fixed; }
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
  .empty-result strong { color: #dedfd8; font-size: calc(16px * var(--font-scale, 1)); }
  .empty-result p { max-width: 340px; margin-top: 7px; font-size: calc(12px * var(--font-scale, 1)); line-height: 1.6; }

  .preview-status {
    color: #dde2c2;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .preview-status.warning { color: #ff8e74; }

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
    border-color: rgba(255, 117, 87, 0.42);
    background: rgba(255, 117, 87, 0.08);
    box-shadow: inset 3px 0 #ff7657;
  }

  .preview-row > span {
    color: var(--lineup-dim-on-dark);
    font-family: var(--font-mono);
    font-size: calc(11px * var(--font-scale, 1));
    text-align: center;
  }

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

  .preview-row.unknown small { color: #ff957d; }

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

  .add-preview-user,
  .remove-preview-user {
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .add-preview-user {
    padding: 4px 6px;
    border: 1px solid rgba(255, 142, 116, 0.28);
    border-radius: 6px;
    color: #ff9b84;
    font-size: calc(10px * var(--font-scale, 1));
  }

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
    border: 1px solid rgba(255, 117, 87, 0.24);
    border-radius: 9px;
    background: rgba(255, 117, 87, 0.08);
    color: #ffab97;
    font-size: calc(12px * var(--font-scale, 1));
    line-height: 1.55;
  }

  .lineup-actions {
    display: flex;
    align-items: stretch;
    gap: 9px;
    margin-top: 13px;
  }

  .lineup-actions .generate-button {
    flex: 1;
    margin-top: 0;
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
    min-width: 0;
    align-content: start;
    gap: 9px;
  }

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

  .desktop-accordion-content { padding: 12px; }

  .rank-manager {
    background: #efede6;
  }

  .rank-manager form {
    display: grid;
    gap: 8px;
  }

  .rank-person-form {
    margin-top: 14px;
    padding-top: 13px;
    border-top: 1px solid rgba(36, 37, 31, 0.1);
  }

  .rank-form-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .rank-form-heading strong {
    font-size: calc(13px * var(--font-scale, 1));
  }

  .rank-manager form > label {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
  }

  .rank-manager label > span {
    color: var(--lineup-muted-on-light);
    font-size: calc(11px * var(--font-scale, 1));
  }

  .rank-manager input {
    width: 100%;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid rgba(36, 37, 31, 0.12);
    border-radius: 7px;
    outline: 0;
    background: #fffdf8;
    color: #24251f;
    font-family: var(--font-sans);
    font-size: calc(12px * var(--font-scale, 1));
  }

  .rank-manager input:focus {
    border-color: #8a993e;
  }

  .save-user {
    padding: 8px;
    border: 0;
    border-radius: 7px;
    background: #292a23;
    color: #f7f5ed;
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 750;
  }

  .ranking-error {
    margin-top: 8px;
    padding: 7px;
    border-radius: 6px;
    background: rgba(210, 83, 54, 0.09);
    color: #ad4832;
    font-size: calc(11px * var(--font-scale, 1));
  }

  .rank-keyboard-order {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 6px;
    margin: 3px 0 10px;
    padding: 8px;
    border: 1px solid rgba(36, 37, 31, 0.13);
    border-radius: 8px;
    background: #e5e2d8;
  }

  .rank-keyboard-order.active {
    border-color: rgba(105, 120, 42, 0.46);
    background: #eef3d5;
  }

  .rank-keyboard-order > span { min-width: 0; }
  .rank-keyboard-order strong,
  .rank-keyboard-order small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-keyboard-order strong { color: #292b24; font-size: calc(11px * var(--font-scale, 1)); }
  .rank-keyboard-order small { margin-top: 2px; color: #4b4e45; font-size: calc(9px * var(--font-scale, 1)); }
  .rank-keyboard-order button {
    padding: 5px 7px;
    border: 1px solid rgba(86, 101, 30, 0.32);
    border-radius: 6px;
    background: #f7f8ed;
    color: #4d5a1e;
    cursor: pointer;
    font-size: calc(10px * var(--font-scale, 1));
    font-weight: 800;
  }
  .rank-keyboard-order .cancel-rank-move { border-color: rgba(137, 66, 51, 0.24); color: #833f33; }

  .ranked-user-list {
    display: grid;
    max-height: 540px;
    gap: 13px;
    margin-top: 4px;
    overflow: auto;
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
    gap: 8px;
  }

  .rank-zone.unranked-zone {
    padding-top: 11px;
    border-top: 1px solid rgba(36, 37, 31, 0.1);
  }

  .rank-zone-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 3px;
  }

  .rank-zone-heading strong {
    color: #303229;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .rank-zone-heading span {
    color: var(--lineup-dim-on-light);
    font-size: calc(9px * var(--font-scale, 1));
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

  .unranked-drop-zone {
    padding: 7px;
    border: 1px dashed rgba(36, 37, 31, 0.16);
    border-radius: 7px;
    background: rgba(36, 37, 31, 0.025);
    color: var(--lineup-dim-on-light);
    font-size: calc(10px * var(--font-scale, 1));
  }

  .rank-manager.dragging .unranked-drop-zone,
  .rank-manager.keyboard-moving .unranked-drop-zone {
    border-color: rgba(122, 132, 47, 0.46);
    color: #626c26;
  }

  .unranked-drop-zone.active {
    border-color: #7a842f;
    background: rgba(122, 132, 47, 0.12);
    color: #535b1f;
  }

  .empty-rank-zone {
    padding: 4px 3px 1px !important;
    text-align: left !important;
  }

  .ranked-user-list article {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 78px;
    grid-template-columns: 36px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 8px;
    padding: 11px 9px;
    border: 1px solid rgba(36, 37, 31, 0.08);
    border-radius: 10px;
    overflow: hidden;
    background: #fffdf8;
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }

  .ranked-user-list article:active { cursor: grabbing; }

  .ranked-user-list article.keyboard-selected {
    outline: 2px solid rgba(56, 111, 171, 0.48);
    outline-offset: 1px;
  }

  .ranked-user-list article.drop-target {
    border-color: #7a842f;
    box-shadow: 0 0 0 3px rgba(122, 132, 47, 0.14);
  }

  .ranked-user-list article.insert-before {
    border-top-color: #7a842f;
    box-shadow: inset 0 5px rgba(122, 132, 47, 0.3);
  }

  .ranked-user-list article.insert-after {
    border-bottom-color: #7a842f;
    box-shadow: inset 0 -5px rgba(122, 132, 47, 0.3);
  }

  .ranked-user-list article.drag-source { opacity: 0.44; }

  .rank-number {
    color: #7a842f;
    font-family: var(--font-mono);
    font-size: calc(16px * var(--font-scale, 1));
    font-weight: 800;
    text-align: center;
  }

  .ranked-user-content { min-width: 0; }

  .ranked-user-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }

  .ranked-user-heading button {
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .ranked-user-heading .user-name {
    min-width: 0;
    flex: 1;
    display: block;
    overflow: hidden;
    color: #24251f;
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 800;
    text-align: left;
    text-overflow: ellipsis;
  }

  .alias-action,
  .delete-user,
  .clear-aliases {
    color: #72782e;
    font-size: calc(10px * var(--font-scale, 1));
  }

  .delete-user,
  .clear-aliases { color: #8f4437; }

  .alias-action:hover { color: #4f5819; }
  .delete-user:hover,
  .clear-aliases:hover { color: #a92f1b; }

  .ranked-user-aliases {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 7px;
    margin-top: 7px;
  }

  .ranked-user-aliases > small {
    display: block;
    max-height: 70px;
    overflow-x: hidden;
    overflow-y: auto;
    padding-right: 4px;
    color: var(--lineup-dim-on-light);
    font-size: calc(12px * var(--font-scale, 1));
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

  .drag-handle {
    color: var(--lineup-dim-on-light);
    font-size: calc(18px * var(--font-scale, 1));
    line-height: 1;
    text-align: center;
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

  .rank-drop-guides i:nth-child(2) {
    background: rgba(130, 145, 57, 0.12);
  }

  .insert-before .rank-drop-guides i:first-child,
  .insert-after .rank-drop-guides i:last-child {
    background: rgba(48, 119, 194, 0.42);
    opacity: 1;
  }

  .drop-target .rank-drop-guides i:nth-child(2) {
    background: rgba(123, 145, 42, 0.42);
    opacity: 1;
  }

  .swap-drop-guide {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    background: rgba(130, 145, 57, 0.13);
    pointer-events: none;
    place-items: center;
  }

  .drop-target .swap-drop-guide { background: rgba(123, 145, 42, 0.42); }

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

  .rank-drag-ghost span { color: #ddec75; }

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

  .lineup-history-list > button {
    display: grid;
    width: 100%;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid rgba(36, 37, 31, 0.08);
    border-radius: 8px;
    background: #fffdf8;
    color: #24251f;
    cursor: pointer;
    text-align: left;
  }

  .lineup-history-list span { color: var(--lineup-dim-on-light); font-family: var(--font-mono); font-size: calc(10px * var(--font-scale, 1)); }
  .lineup-history-list strong { overflow: hidden; font-size: calc(12px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  .lineup-history-list small { color: #7a842f; font-size: calc(10px * var(--font-scale, 1)); }

  .history-export-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
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

  .history-status {
    margin: 0;
    color: #909b51;
    font-size: calc(11px * var(--font-scale, 1));
    white-space: nowrap;
  }

  .history-status.error { color: #dc725b; }

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
    textarea { min-height: 220px; }
  }

  @media (max-width: 600px) {
    .lineup-page { padding: 24px 14px; }
    .lineup-config, .preview-panel, .lineup-result { padding: 17px; }
    .preview-list { grid-template-columns: minmax(0, 1fr); }
    .lineup-actions { flex-direction: column; }
  }
</style>
