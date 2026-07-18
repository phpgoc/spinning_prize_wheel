<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onDestroy, onMount, tick } from 'svelte';
  import { parseOptionText } from './parse-options';
  import {
    createRandomLineup,
    insertLineupPreviewName,
    isResolvedLineupName,
    lineupOrderAvailability,
    lineupPreviewTierStarts,
    orderResolvedLineupNames,
    recentLineupHistories,
    unresolvedLineupNameCount,
    type RankedUserDropTarget,
    type RandomLineup,
  } from './random-lineup';
  import type { RankedUser, ResolvedLineupName, SavedLineup } from './types';

  export let desktopRuntime = false;

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
  let userName = '';
  let userAliases = '';
  let userAliasInput: HTMLInputElement | null = null;
  let draggingUserId: number | null = null;
  let activeRankDropTarget: RankedUserDropTarget | null = null;
  let rankingReordering = false;
  let historyStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let resultOrderMode: LineupOrderMode = 'input';
  let lineupHistories: SavedLineup[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyStart = '';
  let historyEnd = '';
  let insertIndex: number | null = null;
  let insertName = '';
  let insertError = '';
  let insertInput: HTMLInputElement | null = null;

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
        rankingError = messageFrom(reason, '无法核对人物别名');
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
          throw new Error('请先在排名表中补齐所有高亮人物');
        }
      }
      const orderedNames = orderedNamesForLineup(orderMode);
      result = createRandomLineup(orderedNames, Number(groupCount));
      resultOrderMode = orderMode;
      groupCount = result.groupCount;
      const resolvedSignature = desktopRuntime
        ? resolvedNames.map((person) => `${person.inputName}:${person.userId}:${person.rank}`).join('|')
        : 'web';
      resultSignature = `${groupCount}|${names.join('\u0000')}|${resolvedSignature}`;
      if (desktopRuntime) await saveHistory(orderedNames, result, orderMode);
    } catch (reason) {
      result = null;
      error = messageFrom(reason, '无法生成排阵');
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
      input: { sourceNames: names, resolvedNames, orderedNames, groupCount, orderMode },
      result: lineupResult,
    };
    try {
      await invoke('save_lineup_history', { lineup });
      historyStatus = 'saved';
      await loadLineupHistories();
    } catch (reason) {
      historyStatus = 'error';
      error = messageFrom(reason, '排阵已生成，但无法保存历史');
    }
  }

  async function loadRankedUsers() {
    if (!desktopRuntime) return;
    rankingLoading = true;
    rankingError = '';
    try {
      rankedUsers = await invoke<RankedUser[]>('list_ranked_users');
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
      lineupHistories = await invoke<SavedLineup[]>('list_lineup_histories');
    } catch (reason) {
      historyError = messageFrom(reason, '无法读取排阵历史');
    } finally {
      historyLoading = false;
    }
  }

  async function editRankedUser(user: RankedUser, focusAliases = false) {
    desktopPanel = 'ranking';
    editingUserId = user.id;
    userName = user.name;
    userAliases = user.aliases
      .filter((alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'))
      .map((alias) => alias.name)
      .join(' ');
    await tick();
    if (focusAliases) userAliasInput?.focus();
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
    desktopPanel = desktopPanel === panel ? null : panel;
  }

  function historySummary(history: SavedLineup): string {
    const input = history.input as Partial<{ sourceNames: unknown[]; groupCount: number; orderMode: LineupOrderMode }>;
    const peopleCount = Array.isArray(input.sourceNames) ? input.sourceNames.length : 0;
    const mode = input.orderMode === 'input' ? '输入顺序' : '数据库排名';
    return `${peopleCount} 人 · ${Number(input.groupCount) || '—'} 组 · ${mode}`;
  }

  function viewHistory(history: SavedLineup) {
    const historicalResult = history.result as Partial<RandomLineup>;
    if (!Array.isArray(historicalResult.groupNames) || !Array.isArray(historicalResult.tiers)) {
      historyError = '这条历史记录内容不完整';
      return;
    }
    result = historicalResult as RandomLineup;
    const input = history.input as Partial<{ orderMode: LineupOrderMode }>;
    resultOrderMode = input.orderMode === 'input' ? 'input' : 'rank';
    resultSignature = inputSignature;
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
    userName = '';
    userAliases = '';
    userAliasInput = null;
  }

  function otherAliasSummary(user: RankedUser): string {
    const aliases = user.aliases
      .filter((alias) => alias.name.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN'))
      .map((alias) => alias.name);
    return aliases.length > 0 ? aliases.join('、') : '暂无其他别名';
  }

  function beginRankDrag(event: DragEvent, userId: number) {
    if (rankingReordering) {
      event.preventDefault();
      return;
    }
    draggingUserId = userId;
    activeRankDropTarget = null;
    event.dataTransfer?.setData('text/plain', String(userId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function markRankDropTarget(target: RankedUserDropTarget) {
    if (draggingUserId !== null && !rankingReordering) activeRankDropTarget = target;
  }

  function clearRankDragState() {
    draggingUserId = null;
    activeRankDropTarget = null;
  }

  async function dropRankedUser(event: DragEvent, target: RankedUserDropTarget) {
    const transferredId = Number.parseInt(event.dataTransfer?.getData('text/plain') ?? '', 10);
    const userId = Number.isInteger(transferredId) ? transferredId : draggingUserId;
    if (userId === null || rankingReordering) return;

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
      rankingError = messageFrom(reason, '无法调整人物排名');
      await loadRankedUsers();
    } finally {
      rankingReordering = false;
      clearRankDragState();
    }
  }

  async function saveRankedUser() {
    if (!userName.trim()) return;
    rankingSaving = true;
    rankingError = '';
    try {
      const currentRank = editingUserId === null
        ? 10_000
        : rankedUsers.find((user) => user.id === editingUserId)?.rank ?? 10_000;
      await invoke('save_ranked_user', {
        user: {
          id: editingUserId,
          name: userName.trim(),
          rank: currentRank,
          aliases: parseOptionText(userAliases),
        },
      });
      resetUserForm();
      await loadRankedUsers();
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法保存排名人物');
    } finally {
      rankingSaving = false;
    }
  }

  async function deleteRankedUser(user: RankedUser) {
    if (!window.confirm(`确定从排名表删除“${user.name}”及其全部别名吗？`)) return;
    rankingError = '';
    try {
      await invoke('delete_ranked_user', { id: user.id });
      if (editingUserId === user.id) resetUserForm();
      await loadRankedUsers();
      await resolveNames();
    } catch (reason) {
      rankingError = messageFrom(reason, '无法删除排名人物');
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

  function messageFrom(reason: unknown, fallback: string): string {
    if (reason instanceof Error) return reason.message;
    return typeof reason === 'string' && reason ? reason : fallback;
  }
</script>

<main class="lineup-page" id="lineup">
  <header class="lineup-hero">
    <div>
      <span>RANDOM LINEUP</span>
      <h1>随机排阵</h1>
      <p>{desktopRuntime ? '数据库排名决定档位，输入别名也能识别到同一个人。' : '输入顺序决定档位，同一档的人会被随机分到不同组。'}</p>
    </div>
    <div class="rule-badge"><i>1</i><span>唯一规则<strong>同档不同组</strong></span></div>
  </header>

  <div class:desktop={desktopRuntime} class="lineup-workbench">
    {#if desktopRuntime}
      <aside class="lineup-sidebar">
        <section class:open={desktopPanel === 'ranking'} class="desktop-accordion">
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('ranking')}>
            <span>排名与别名</span><strong>{rankedUsers.length} 人</strong><i>{desktopPanel === 'ranking' ? '−' : '+'}</i>
          </button>
          {#if desktopPanel === 'ranking'}
            <div class:dragging={draggingUserId !== null} class:reordering={rankingReordering} class="desktop-accordion-content rank-manager">
              <form on:submit|preventDefault={saveRankedUser}>
                <div class="rank-form-heading">
                  <strong>{editingUserId === null ? '添加人物' : '编辑人物'}</strong>
                  {#if editingUserId !== null}<button type="button" on:click={resetUserForm}>取消编辑</button>{/if}
                </div>
                <label><span>本名</span><input maxlength="80" required bind:value={userName} placeholder="人物名称" /></label>
                <label><span>其他别名</span><input bind:this={userAliasInput} bind:value={userAliases} placeholder="本名会自动加入别名表" /></label>
                {#if editingUserId === null}<p class="rank-form-note">新人物会先进入无排名区，保存后拖动即可设置排名。</p>{/if}
                <button type="submit" class="save-user" disabled={rankingSaving || !userName.trim()}>{rankingSaving ? '保存中…' : '保存人物'}</button>
              </form>
              {#if rankingError}<div class="ranking-error" role="alert">{rankingError}</div>{/if}
              <div class="ranked-user-list">
                {#if rankingLoading}
                  <p>正在读取排名表…</p>
                {:else if rankedUsers.length === 0}
                  <p>排名表为空，请先录入人物。</p>
                {:else}
                  <section class="rank-zone">
                    <div class="rank-zone-heading"><strong>已排名</strong><span>{rankedPeople.length} 人 · 拖到间隙插入，拖到人物互换</span></div>
                    {#each rankedPeople as user, index (user.id)}
                      <button
                        type="button"
                        class:active={activeRankDropTarget?.kind === 'insert' && activeRankDropTarget.index === index}
                        class="rank-insert-zone"
                        tabindex="-1"
                        aria-label={`插入到第 ${index + 1} 名`}
                        on:dragenter={() => markRankDropTarget({ kind: 'insert', index })}
                        on:dragover|preventDefault={() => markRankDropTarget({ kind: 'insert', index })}
                        on:drop|preventDefault={(event) => dropRankedUser(event, { kind: 'insert', index })}
                      ><span>插入到这里</span></button>
                      <!-- 卡片整体提供桌面拖拽，内部按钮保留独立操作。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        class:drop-target={activeRankDropTarget?.kind === 'swap' && activeRankDropTarget.userId === user.id}
                        class:drag-source={draggingUserId === user.id}
                        draggable={!rankingReordering}
                        on:dragstart={(event) => beginRankDrag(event, user.id)}
                        on:dragenter={() => markRankDropTarget({ kind: 'swap', userId: user.id })}
                        on:dragover|preventDefault={() => markRankDropTarget({ kind: 'swap', userId: user.id })}
                        on:drop|preventDefault={(event) => dropRankedUser(event, { kind: 'swap', userId: user.id })}
                        on:dragend={clearRankDragState}
                      >
                        <span class="rank-number">{user.rank}</span>
                        <div class="ranked-user-content">
                          <div class="ranked-user-heading">
                            <button type="button" class="user-name" on:click={() => editRankedUser(user)}>{user.name}</button>
                            <button type="button" class="alias-action" on:click={() => editRankedUser(user, true)}>添加别名</button>
                            <button type="button" class="delete-user" on:click={() => deleteRankedUser(user)}>删除</button>
                          </div>
                          <small title={otherAliasSummary(user)}>{otherAliasSummary(user)}</small>
                        </div>
                        <span class="drag-handle" title="拖动调整排名">⠿</span>
                      </article>
                    {/each}
                    <button
                      type="button"
                      class:active={activeRankDropTarget?.kind === 'insert' && activeRankDropTarget.index === rankedPeople.length}
                      class="rank-insert-zone"
                      tabindex="-1"
                      aria-label="插入到排名末尾"
                      on:dragenter={() => markRankDropTarget({ kind: 'insert', index: rankedPeople.length })}
                      on:dragover|preventDefault={() => markRankDropTarget({ kind: 'insert', index: rankedPeople.length })}
                      on:drop|preventDefault={(event) => dropRankedUser(event, { kind: 'insert', index: rankedPeople.length })}
                    ><span>{rankedPeople.length === 0 ? '拖到这里设为第 1 名' : '插入到排名末尾'}</span></button>
                  </section>

                  <section class="rank-zone unranked-zone">
                    <div class="rank-zone-heading"><strong>无排名</strong><span>{unrankedPeople.length} 人 · 新人物默认在这里</span></div>
                    <button
                      type="button"
                      class:active={activeRankDropTarget?.kind === 'unranked'}
                      class="unranked-drop-zone"
                      tabindex="-1"
                      on:dragenter={() => markRankDropTarget({ kind: 'unranked' })}
                      on:dragover|preventDefault={() => markRankDropTarget({ kind: 'unranked' })}
                      on:drop|preventDefault={(event) => dropRankedUser(event, { kind: 'unranked' })}
                    >拖到这里设为无排名</button>
                    {#if unrankedPeople.length === 0}
                      <p class="empty-rank-zone">暂无无排名人物</p>
                    {/if}
                    {#each unrankedPeople as user (user.id)}
                      <!-- 卡片整体提供桌面拖拽，内部按钮保留独立操作。 -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <article
                        class:drop-target={activeRankDropTarget?.kind === 'swap' && activeRankDropTarget.userId === user.id}
                        class:drag-source={draggingUserId === user.id}
                        draggable={!rankingReordering}
                        on:dragstart={(event) => beginRankDrag(event, user.id)}
                        on:dragenter={() => markRankDropTarget({ kind: 'swap', userId: user.id })}
                        on:dragover|preventDefault={() => markRankDropTarget({ kind: 'swap', userId: user.id })}
                        on:drop|preventDefault={(event) => dropRankedUser(event, { kind: 'swap', userId: user.id })}
                        on:dragend={clearRankDragState}
                      >
                        <span class="rank-number">—</span>
                        <div class="ranked-user-content">
                          <div class="ranked-user-heading">
                            <button type="button" class="user-name" on:click={() => editRankedUser(user)}>{user.name}</button>
                            <button type="button" class="alias-action" on:click={() => editRankedUser(user, true)}>添加别名</button>
                            <button type="button" class="delete-user" on:click={() => deleteRankedUser(user)}>删除</button>
                          </div>
                          <small title={otherAliasSummary(user)}>{otherAliasSummary(user)}</small>
                        </div>
                        <span class="drag-handle" title="拖动调整排名">⠿</span>
                      </article>
                    {/each}
                  </section>
                {/if}
              </div>
            </div>
          {/if}
        </section>

        <section class:open={desktopPanel === 'history'} class="desktop-accordion">
          <button type="button" class="desktop-accordion-toggle" on:click={() => toggleDesktopPanel('history')}>
            <span>排阵历史</span><strong>最近 5 条</strong><i>{desktopPanel === 'history' ? '−' : '+'}</i>
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
                  <p>正在读取排阵历史…</p>
                {:else if visibleHistories.length === 0}
                  <p>日期范围内没有排阵记录。</p>
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
            {resolvingNames ? '核对中…' : desktopRuntime && unresolvedPreviewCount > 0 ? `${unresolvedPreviewCount} 人未识别` : `${names.length} 人`}
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
                  <input value={row.name} aria-label={`第 ${index + 1} 个人名`} on:change={(event) => updatePreviewName(index, (event.currentTarget as HTMLInputElement).value)} />
                  {#if desktopRuntime}
                    <small>{resolvingNames
                      ? '核对中'
                      : row.resolved?.known
                        ? `本名 ${row.resolved.canonicalName} · 排名 ${row.resolved.rank}`
                        : '别名表中没有对应人物'}</small>
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
            <span>请先在右侧粘贴参赛名单</span>
            {#if insertIndex === 0}
              <form class="preview-insert-form" on:submit|preventDefault={confirmPreviewInsertion}>
                <label>
                  <span>添加第一个人</span>
                  <input bind:this={insertInput} bind:value={insertName} maxlength="18" aria-label="添加第一个人" on:keydown={(event) => event.key === 'Escape' && cancelPreviewInsertion()} />
                </label>
                <button type="submit">添加</button>
                <button type="button" class="cancel" on:click={cancelPreviewInsertion}>取消</button>
                {#if insertError}<small role="alert">{insertError}</small>{/if}
              </form>
            {:else}
              <button type="button" class="append-preview-user" on:click={() => openPreviewInsertion(0)}>＋ 添加第一个人</button>
            {/if}
          </div>
        {/if}

        {#if error}<div class="lineup-error" role="alert">{error}</div>{/if}

        {#if desktopRuntime && !resolvingNames && unresolvedPreviewCount > 0}
          <div class="rank-order-lock" role="status">名单中还有红名，数据库排名排阵已锁定；可以先使用输入顺序排阵。</div>
        {/if}

        <div class="lineup-actions">
          {#if desktopRuntime}
            <button type="button" class="generate-button" title={unresolvedPreviewCount > 0 ? '先录入所有红名后才能按数据库排名排阵' : '按数据库排名分档'} disabled={!canGenerateByRank} on:click={() => generate('rank')}><span>按数据库排名排阵</span><i>→</i></button>
            <button type="button" class="input-order-button" title="忽略数据库排名，按当前名单顺序分档" disabled={!canGenerateByInput} on:click={() => generate('input')}>仅按输入顺序排阵</button>
          {:else}
            <button type="button" class="generate-button" disabled={!canGenerateByInput} on:click={() => generate('input')}><span>开始排阵</span><i>→</i></button>
          {/if}
        </div>
      </div>

      <div class="lineup-result">
        <div class="result-heading">
          <div><span>03</span><div><h2>排阵结果</h2><p>{result ? `${result.peopleCount} 人 · ${result.groupCount} 组 · ${result.tiers.length} 档 · ${resultOrderMode === 'rank' ? '数据库排名' : '输入顺序'}` : '点击上方排阵后生成表格'}</p></div></div>
          {#if result}<button type="button" on:click={() => generate(resultOrderMode)}>重新随机</button>{/if}
        </div>
        {#if resultOutdated}<div class="outdated-notice">名单、排名或组数已变化，请重新排阵。</div>{/if}
        {#if desktopRuntime && historyStatus !== 'idle'}
          <div class:error={historyStatus === 'error'} class="history-status">{historyStatus === 'saving' ? '正在保存排阵记录…' : historyStatus === 'saved' ? '排阵输入与结果已保存' : '排阵记录保存失败'}</div>
        {/if}
        {#if result}
          <div class:outdated={resultOutdated} class="lineup-table-wrap">
            <table>
              <thead><tr><th scope="col">档位</th>{#each result.groupNames as group}<th scope="col"><span>{group}</span>组</th>{/each}</tr></thead>
              <tbody>
                {#each result.tiers as tier, tierIndex}
                  <tr><th scope="row"><span>t{tierIndex + 1}</span><small>第 {tierIndex + 1} 档</small></th>{#each tier as entry}<td class:empty={!entry}>{#if entry}<strong>{entry.name}</strong><small>#{entry.sourceIndex + 1}</small>{:else}<span>—</span>{/if}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-result"><div class="empty-grid"><i>A</i><i>B</i><i>C</i><i>D</i><i>E</i><i>F</i></div><strong>排阵表会显示在这里</strong><p>例如 24 人、6 组，将得到 A–F 六组与 t1–t4 四档。</p></div>
        {/if}
      </div>
    </section>

    <aside class="lineup-config">
      <div class="config-heading"><div><span>01</span><h2>参赛名单</h2></div><strong>{names.length}<small>人</small></strong></div>
      <label class="names-field"><span>每行一个，也支持空格、逗号和 Excel 粘贴</span><textarea bind:value={sourceText} placeholder="粘贴人名…" spellcheck="false"></textarea></label>
      <div class="sample-actions"><button type="button" on:click={fillSample}>填入 24 人示例</button><button type="button" disabled={!sourceText} on:click={clearAll}>清空</button></div>
      <div class="group-setting"><label for="lineup-group-count"><span>组数</span><input id="lineup-group-count" type="number" min="2" max="26" step="1" bind:value={groupCount} /></label><div><span>预计档位</span><strong>{tierPreview || '—'}</strong></div></div>
      <div class="rule-note"><span>分档方式</span><p>{desktopRuntime ? `默认按数据库排名每 ${Math.max(2, Number(groupCount) || 2)} 人一档，无排名记为 10000。` : `按输入顺序每 ${Math.max(2, Number(groupCount) || 2)} 人划为一档。`}</p></div>
    </aside>
  </div>
</main>

<style>
  .lineup-page {
    --lineup-muted-on-dark: #b4b7ac;
    --lineup-dim-on-dark: #9da096;
    --lineup-muted-on-light: #52554c;
    --lineup-dim-on-light: #65685e;
    min-height: calc(100vh - 130px);
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

  .lineup-hero,
  .config-heading,
  .group-setting,
  .result-heading,
  .result-heading > div,
  .rule-badge {
    display: flex;
  }

  .lineup-hero {
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    max-width: 1420px;
    margin: 0 auto 30px;
  }

  .lineup-hero > div:first-child > span,
  .config-heading span,
  .result-heading > div > span,
  .rule-note > span {
    color: #98a451;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--font-scale, 1));
    letter-spacing: 0.14em;
  }

  .lineup-hero h1 {
    margin-top: 5px;
    font-size: clamp(
      calc(37px * var(--font-scale, 1)),
      calc(5vw * var(--font-scale, 1)),
      calc(69px * var(--font-scale, 1))
    );
    letter-spacing: -0.07em;
    line-height: 0.95;
  }

  .lineup-hero p {
    margin-top: 12px;
    color: var(--lineup-muted-on-dark);
    font-size: calc(16px * var(--font-scale, 1));
  }

  .rule-badge {
    align-items: center;
    gap: 11px;
    padding: 10px 14px;
    border: 1px solid rgba(231, 255, 114, 0.16);
    border-radius: 13px;
    background: rgba(231, 255, 114, 0.05);
  }

  .rule-badge i {
    display: grid;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent);
    color: #1e2017;
    font-style: normal;
    font-weight: 900;
    place-items: center;
  }

  .rule-badge span,
  .rule-badge strong { display: block; }
  .rule-badge span { color: var(--lineup-dim-on-dark); font-size: calc(11px * var(--font-scale, 1)); }
  .rule-badge strong { margin-top: 2px; color: #f6f3ea; font-size: calc(14px * var(--font-scale, 1)); }

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

  .sample-actions { display: flex; justify-content: space-between; margin-top: 7px; }
  .sample-actions button,
  .result-heading button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--lineup-muted-on-light);
    cursor: pointer;
    font-size: calc(12px * var(--font-scale, 1));
  }
  .sample-actions button:first-child { color: #69772b; }

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
  .outdated-notice { background: rgba(231, 255, 114, 0.08); color: #cbd58f; }

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
  .result-heading button { padding: 8px 11px; border: 1px solid rgba(231, 255, 114, 0.17); border-radius: 8px; color: var(--accent); }

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

  .empty-result {
    display: grid;
    min-height: 430px;
    align-content: center;
    justify-items: center;
    color: var(--lineup-dim-on-dark);
    text-align: center;
  }
  .empty-grid { display: grid; grid-template-columns: repeat(3, 42px); gap: 7px; margin-bottom: 18px; transform: rotate(-4deg); }
  .empty-grid i { display: grid; height: 42px; border: 1px solid rgba(231, 255, 114, 0.12); border-radius: 9px; background: rgba(231, 255, 114, 0.035); color: #a8b45e; font-family: var(--font-mono); font-size: calc(14px * var(--font-scale, 1)); font-style: normal; place-items: center; }
  .empty-result strong { color: #b8baaf; font-size: calc(16px * var(--font-scale, 1)); }
  .empty-result p { max-width: 340px; margin-top: 7px; font-size: calc(12px * var(--font-scale, 1)); line-height: 1.6; }

  .preview-status {
    color: #aeb490;
    font-size: calc(12px * var(--font-scale, 1));
  }

  .preview-status.warning { color: #ff8e74; }

  .preview-list {
    display: grid;
    max-height: 310px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin-top: 18px;
    padding-right: 4px;
    overflow: auto;
  }

  .preview-tier-divider {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 9px;
    margin: 9px 0 2px;
    color: #b8c56f;
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
    color: #bdc978;
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
    color: #c9cf9c;
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
    min-height: 170px;
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
    color: #c5cf89;
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
    color: #55584f;
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

  .rank-form-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .rank-form-heading strong {
    font-size: calc(13px * var(--font-scale, 1));
  }

  .rank-form-heading button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--lineup-dim-on-light);
    cursor: pointer;
    font-size: calc(11px * var(--font-scale, 1));
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

  .rank-form-note {
    color: var(--lineup-dim-on-light);
    font-size: calc(10px * var(--font-scale, 1));
    line-height: 1.45;
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

  .ranked-user-list {
    display: grid;
    max-height: 460px;
    gap: 13px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(36, 37, 31, 0.08);
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
    gap: 4px;
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

  .rank-insert-zone {
    height: 5px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    overflow: hidden;
    background: transparent;
    color: #727d2f;
    font-size: calc(9px * var(--font-scale, 1));
    pointer-events: none;
    transition: height 120ms ease, background 120ms ease;
  }

  .rank-insert-zone span { opacity: 0; }

  .rank-manager.dragging .rank-insert-zone {
    height: 24px;
    border: 1px dashed rgba(122, 132, 47, 0.34);
    pointer-events: auto;
  }

  .rank-manager.dragging .rank-insert-zone span { opacity: 1; }

  .rank-insert-zone.active {
    border-color: #7a842f;
    background: rgba(122, 132, 47, 0.12);
    color: #535b1f;
  }

  .unranked-drop-zone {
    padding: 7px;
    border: 1px dashed rgba(36, 37, 31, 0.16);
    border-radius: 7px;
    background: rgba(36, 37, 31, 0.025);
    color: var(--lineup-dim-on-light);
    font-size: calc(10px * var(--font-scale, 1));
  }

  .rank-manager.dragging .unranked-drop-zone {
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
    display: grid;
    min-width: 0;
    grid-template-columns: 31px minmax(0, 1fr) 17px;
    align-items: center;
    gap: 6px;
    padding: 7px;
    border: 1px solid rgba(36, 37, 31, 0.08);
    border-radius: 8px;
    background: #fffdf8;
    cursor: grab;
    transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }

  .ranked-user-list article:active { cursor: grabbing; }

  .ranked-user-list article.drop-target {
    border-color: #7a842f;
    box-shadow: 0 0 0 2px rgba(122, 132, 47, 0.12);
  }

  .ranked-user-list article.drag-source { opacity: 0.44; }

  .rank-number {
    color: #7a842f;
    font-family: var(--font-mono);
    font-size: calc(13px * var(--font-scale, 1));
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
    font-size: calc(12px * var(--font-scale, 1));
    font-weight: 800;
    text-align: left;
    text-overflow: ellipsis;
  }

  .alias-action,
  .delete-user {
    color: #72782e;
    font-size: calc(9px * var(--font-scale, 1));
  }

  .delete-user { color: #9b5a4b; }

  .alias-action:hover { color: #4f5819; }
  .delete-user:hover { color: #ad3822; }

  .ranked-user-content > small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: var(--lineup-dim-on-light);
    font-size: calc(10px * var(--font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drag-handle {
    color: var(--lineup-dim-on-light);
    font-size: calc(15px * var(--font-scale, 1));
    line-height: 1;
    text-align: center;
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

  .history-status {
    margin-top: 10px;
    color: #909b51;
    font-size: calc(11px * var(--font-scale, 1));
    text-align: right;
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
    .lineup-page { min-height: calc(100vh - 110px); border-radius: 19px 19px 0 0; }
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
    .lineup-hero { align-items: flex-start; flex-direction: column; }
    .rule-badge { align-self: stretch; }
    .lineup-config, .preview-panel, .lineup-result { padding: 17px; }
    .preview-list { grid-template-columns: minmax(0, 1fr); }
    .lineup-actions { flex-direction: column; }
  }
</style>
