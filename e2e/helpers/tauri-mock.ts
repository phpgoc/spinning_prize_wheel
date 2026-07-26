import type { Page } from '@playwright/test';

export interface MockRankedUserInput {
  id: number;
  name: string;
  rank: number;
  aliases?: string[];
}

export interface MockTauriInitialData {
  drawHistories?: unknown[];
  groupingHistories?: unknown[];
  battleHistories?: unknown[];
  battleTmpState?: unknown;
  commandFailures?: Record<string, string[]>;
}

export const DEFAULT_RANKED_USERS: MockRankedUserInput[] = [
  { id: 1, name: '甲', rank: 1, aliases: ['甲', '甲别名'] },
  { id: 2, name: '乙', rank: 2, aliases: ['乙'] },
  { id: 3, name: '丙', rank: 3, aliases: ['丙'] },
  { id: 4, name: '丁', rank: 10_000, aliases: ['丁'] },
];

export async function installTauriMock(
  page: Page,
  initialUsers: MockRankedUserInput[] = DEFAULT_RANKED_USERS,
  initialData: MockTauriInitialData = {},
) {
  await page.addInitScript(({ users, data }) => {
    type AliasRecord = { id: number; name: string; userId: number };
    type RankedUser = { id: number; name: string; rank: number; aliases: AliasRecord[] };

    let nextAliasId = 1;
    let nextUserId = Math.max(0, ...users.map((user) => user.id)) + 1;
    let nextCallbackId = 1;
    const callbacks = new Map<number, (payload: unknown) => unknown>();
    const rankedUsers: RankedUser[] = users.map((user) => ({
      id: user.id,
      name: user.name,
      rank: user.rank,
      aliases: [...new Set([user.name, ...(user.aliases ?? [])])].map((name) => ({
        id: nextAliasId++,
        name,
        userId: user.id,
      })),
    }));

    const persistedBattleState = (() => {
      try {
        const raw = sessionStorage.getItem('__E2E_TAURI_BATTLE_TMP__');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })();
    const persistedBattleHistories = (() => {
      try {
        const raw = localStorage.getItem('battle-history-v1:standard');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })();
    const state = {
      rankedUsers,
      commonSelections: [] as unknown[],
      drawHistories: structuredClone(data.drawHistories ?? []) as unknown[],
      groupingHistories: structuredClone(data.groupingHistories ?? []) as unknown[],
      battleHistories: structuredClone(data.battleHistories ?? persistedBattleHistories ?? []) as unknown[],
      battleTmpState: persistedBattleState ?? (data.battleTmpState ? structuredClone(data.battleTmpState) as any : null as any),
      commandFailures: structuredClone(data.commandFailures ?? {}) as Record<string, string[]>,
      closeRequestedHandler: null as number | null,
      windowDestroyed: false,
      windowFullscreen: false,
      invocations: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    };

    const clone = <T>(value: T): T => structuredClone(value);
    const persistBattleState = () => {
      sessionStorage.setItem('__E2E_TAURI_BATTLE_TMP__', JSON.stringify(state.battleTmpState));
    };
    const sortedUsers = () => [...state.rankedUsers].sort((left, right) => (
      left.rank - right.rank || left.name.localeCompare(right.name, 'zh-CN')
    ));
    const normalizeRanks = (ordered: RankedUser[]) => {
      ordered.forEach((user, index) => { user.rank = index + 1; });
    };
    const findUser = (id: number) => {
      const user = state.rankedUsers.find((candidate) => candidate.id === id);
      if (!user) throw new Error('找不到排名项');
      return user;
    };
    const assertUniqueAlias = (name: string, ownerId: number | null = null) => {
      const key = name.trim().toLocaleLowerCase('zh-CN');
      if (!key) throw new Error('名称不能为空');
      const duplicate = state.rankedUsers.some((user) => (
        user.id !== ownerId
        && user.aliases.some((alias) => alias.name.toLocaleLowerCase('zh-CN') === key)
      ));
      if (duplicate) throw new Error('名称或别名已经存在');
    };
    const recomputeBattleTmp = (snapshot: any) => {
      const winnerId = (match: any) => {
        if (match.status !== 'completed') return null;
        if (match.up === null || match.down === null) return match.up ?? match.down;
        if (match.upResult === null || match.downResult === null || match.upResult === match.downResult) return null;
        return match.upResult > match.downResult ? match.up : match.down;
      };
      const loserId = (match: any) => {
        const winner = winnerId(match);
        if (winner === null) return null;
        return match.up === winner ? match.down : match.up;
      };
      const slotSource = (match: any, slot: 'up' | 'down') => {
        const offset = slot === 'up' ? 0 : 1;
        if (match.stage === 'pairing') return null;
        if (match.stage === 'single' || match.stage === 'winner') {
          if (match.level === 1) return null;
          const prefix = match.stage === 'single' ? 'S' : 'W';
          return {
            matchId: `${prefix}${match.level - 1}-M${(match.position - 1) * 2 + offset + 1}`,
            outcome: 'winner',
          };
        }
        if (match.stage === 'loser') {
          if (snapshot.bracketSize === 2 && match.level === 1) {
            return slot === 'up' ? { matchId: 'W1-M1', outcome: 'loser' } : null;
          }
          if (match.level === 1) {
            return {
              matchId: `W1-M${(match.position - 1) * 2 + offset + 1}`,
              outcome: 'loser',
            };
          }
          if (match.level % 2 === 0) {
            if (slot === 'up') {
              return { matchId: `L${match.level - 1}-M${match.position}`, outcome: 'winner' };
            }
            const winnerLevel = match.level / 2 + 1;
            const winnerMatchCount = snapshot.matches.filter((candidate: any) => (
              candidate.stage === 'winner' && candidate.level === winnerLevel
            )).length;
            const crossedPosition = winnerMatchCount === 1
              ? match.position
              : match.position % 2 === 1 ? match.position + 1 : match.position - 1;
            return { matchId: `W${winnerLevel}-M${crossedPosition}`, outcome: 'loser' };
          }
          return {
            matchId: `L${match.level - 1}-M${(match.position - 1) * 2 + offset + 1}`,
            outcome: 'winner',
          };
        }
        if (match.level === 1) {
          const winnerLevel = Math.max(...snapshot.matches
            .filter((candidate: any) => candidate.stage === 'winner')
            .map((candidate: any) => candidate.level));
          const loserLevel = Math.max(...snapshot.matches
            .filter((candidate: any) => candidate.stage === 'loser')
            .map((candidate: any) => candidate.level));
          return slot === 'up'
            ? { matchId: `W${winnerLevel}-M1`, outcome: 'winner' }
            : { matchId: `L${loserLevel}-M1`, outcome: 'winner' };
        }
        return { matchId: 'GF-M1', outcome: slot === 'up' ? 'winner' : 'loser' };
      };
      const sourceValue = (
        staticValue: number | null,
        source: { matchId: string; outcome: 'winner' | 'loser' } | null,
      ) => {
        if (!source) return { ready: true, value: staticValue };
        const sourceMatch = snapshot.matches.find((match: any) => match.matchId === source.matchId);
        if (!sourceMatch || (sourceMatch.status !== 'completed' && sourceMatch.status !== 'skipped')) {
          return { ready: false, value: null };
        }
        if (sourceMatch.status === 'skipped') return { ready: true, value: null };
        return { ready: true, value: source.outcome === 'winner' ? winnerId(sourceMatch) : loserId(sourceMatch) };
      };
      for (let iteration = 0; iteration < snapshot.matches.length * 3; iteration += 1) {
        let changed = false;
        for (const match of snapshot.matches) {
          const before = [match.up, match.down, match.upResult, match.downResult, match.status].join('|');
          let activation: 'active' | 'pending' | 'skipped' = 'active';
          if (match.stage === 'final' && match.level === 2) {
            const source = snapshot.matches.find((candidate: any) => candidate.matchId === 'GF-M1');
            if (!source || source.status !== 'completed') {
              activation = 'pending';
            } else {
              activation = source.down !== null && winnerId(source) === source.down ? 'active' : 'skipped';
            }
          }
          if (activation !== 'active') {
            if (slotSource(match, 'up')) match.up = null;
            if (slotSource(match, 'down')) match.down = null;
            match.upResult = null;
            match.downResult = null;
            match.status = activation;
          } else {
            const up = sourceValue(match.up, slotSource(match, 'up'));
            const down = sourceValue(match.down, slotSource(match, 'down'));
            const participantsChanged = match.up !== up.value || match.down !== down.value;
            match.up = up.value;
            match.down = down.value;
            if (participantsChanged) {
              match.upResult = null;
              match.downResult = null;
            }
            if (!up.ready || !down.ready) {
              match.upResult = null;
              match.downResult = null;
              match.status = 'pending';
            } else if (match.up === null && match.down === null) {
              match.upResult = null;
              match.downResult = null;
              match.status = 'skipped';
            } else if (match.up === null || match.down === null) {
              match.upResult = null;
              match.downResult = null;
              match.status = 'completed';
            } else if (
              match.upResult !== null
              && match.downResult !== null
              && match.upResult !== match.downResult
            ) {
              match.status = 'completed';
            } else {
              match.status = 'ready';
            }
          }
          if (before !== [match.up, match.down, match.upResult, match.downResult, match.status].join('|')) changed = true;
        }
        if (!changed) break;
      }
      return snapshot;
    };

    const invoke = async (cmd: string, args: Record<string, any> = {}) => {
      state.invocations.push({ cmd, args: clone(args) });
      const failure = state.commandFailures[cmd]?.shift();
      if (failure) throw new Error(failure);
      if (cmd === 'plugin:event|listen') {
        if (args.event === 'tauri://close-requested') state.closeRequestedHandler = args.handler;
        return 1;
      }
      if (cmd === 'plugin:event|unlisten') {
        state.closeRequestedHandler = null;
        return null;
      }
      if (cmd === 'plugin:window|destroy') {
        state.windowDestroyed = true;
        return null;
      }
      if (cmd === 'plugin:window|set_fullscreen') {
        state.windowFullscreen = Boolean(args.value);
        return null;
      }
      if (cmd === 'list_common_selections') return clone(state.commonSelections);
      if (cmd === 'save_common_selection') {
        state.commonSelections.unshift(clone(args.selection));
        return null;
      }
      if (cmd === 'delete_common_selection') {
        state.commonSelections = state.commonSelections.filter((item: any) => item.id !== args.id);
        return null;
      }
      if (cmd === 'list_draw_histories') return clone(state.drawHistories);
      if (cmd === 'save_draw_history') {
        state.drawHistories = [clone(args.draw), ...state.drawHistories.filter((item: any) => item.id !== args.draw.id)];
        return null;
      }
      if (cmd === 'delete_draw_history') {
        state.drawHistories = state.drawHistories.filter((item: any) => item.id !== args.id);
        return null;
      }
      if (cmd === 'clear_draw_histories') {
        state.drawHistories = [];
        return null;
      }
      if (cmd === 'list_ranked_users') return clone(sortedUsers());
      if (cmd === 'resolve_grouping_names') {
        return clone((args.names as string[]).map((inputName) => {
          const key = inputName.toLocaleLowerCase('zh-CN');
          const user = state.rankedUsers.find((candidate) => (
            candidate.aliases.some((alias) => alias.name.toLocaleLowerCase('zh-CN') === key)
          ));
          return user
            ? { inputName, known: true, userId: user.id, canonicalName: user.name, rank: user.rank }
            : { inputName, known: false, userId: null, canonicalName: null, rank: null };
        }));
      }
      if (cmd === 'save_ranked_user') {
        const input = args.user as { id: number | null; name: string; rank: number; aliases?: string[] };
        const name = input.name.trim();
        assertUniqueAlias(name, input.id);
        if (input.id === null) {
          const id = nextUserId++;
          const user: RankedUser = {
            id,
            name,
            rank: input.rank ?? 10_000,
            aliases: [{ id: nextAliasId++, name, userId: id }],
          };
          state.rankedUsers.push(user);
          return clone(user);
        }
        const user = findUser(input.id);
        const canonical = user.aliases.find((alias) => alias.name === user.name);
        const nameKey = name.toLocaleLowerCase('zh-CN');
        user.aliases = user.aliases.filter((alias) => (
          alias === canonical || alias.name.toLocaleLowerCase('zh-CN') !== nameKey
        ));
        user.name = name;
        if (canonical) canonical.name = name;
        else user.aliases.unshift({ id: nextAliasId++, name, userId: user.id });
        return clone(user);
      }
      if (cmd === 'add_ranked_user_alias') {
        const user = findUser(args.userId);
        const alias = String(args.alias).trim();
        assertUniqueAlias(alias);
        user.aliases.push({ id: nextAliasId++, name: alias, userId: user.id });
        return clone(user);
      }
      if (cmd === 'clear_ranked_user_aliases') {
        const user = findUser(args.userId);
        user.aliases = user.aliases.filter((alias) => alias.name === user.name);
        return clone(user);
      }
      if (cmd === 'delete_ranked_user') {
        const user = findUser(args.id);
        const ranked = sortedUsers().filter((candidate) => candidate.rank < 10_000 && candidate.id !== user.id);
        state.rankedUsers = state.rankedUsers.filter((candidate) => candidate.id !== user.id);
        normalizeRanks(ranked);
        return null;
      }
      if (cmd === 'replace_ranked_users') {
        state.rankedUsers = (args.users as Array<{ name: string; rank: number; aliases: string[] }>).map((input) => {
          const id = nextUserId++;
          return {
            id,
            name: input.name,
            rank: input.rank,
            aliases: [...new Set([input.name, ...input.aliases])].map((name) => ({
              id: nextAliasId++,
              name,
              userId: id,
            })),
          };
        });
        return clone(sortedUsers());
      }
      if (cmd === 'move_ranked_user') {
        const dragged = findUser(args.draggedId);
        const target = args.target as { kind: 'insert'; index: number } | { kind: 'swap'; userId: number } | { kind: 'unranked' };
        if (target.kind === 'swap') {
          if (dragged.rank >= 10_000) throw new Error('无排名选项只能插入排名');
          const other = findUser(target.userId);
          [dragged.rank, other.rank] = [other.rank, dragged.rank];
        } else if (target.kind === 'unranked') {
          const ranked = sortedUsers().filter((user) => user.rank < 10_000 && user.id !== dragged.id);
          dragged.rank = 10_000;
          normalizeRanks(ranked);
        } else {
          const original = sortedUsers().filter((user) => user.rank < 10_000);
          const sourceIndex = original.findIndex((user) => user.id === dragged.id);
          const ranked = original.filter((user) => user.id !== dragged.id);
          let insertIndex = Math.max(0, Math.min(original.length, target.index));
          if (sourceIndex >= 0 && sourceIndex < insertIndex) insertIndex -= 1;
          ranked.splice(Math.min(insertIndex, ranked.length), 0, dragged);
          normalizeRanks(ranked);
        }
        return clone(sortedUsers());
      }
      if (cmd === 'list_grouping_histories') return clone(state.groupingHistories);
      if (cmd === 'save_grouping_history') {
        state.groupingHistories = [clone(args.grouping), ...state.groupingHistories.filter((item: any) => item.id !== args.grouping.id)];
        return null;
      }
      if (cmd === 'import_grouping_history') {
        state.groupingHistories = [
          clone(args.history),
          ...state.groupingHistories.filter((item: any) => item.id !== args.history.id),
        ];
        return clone(state.groupingHistories);
      }
      if (cmd === 'delete_grouping_history') {
        state.groupingHistories = state.groupingHistories.filter((item: any) => item.id !== args.id);
        return null;
      }
      if (cmd === 'clear_grouping_histories') {
        state.groupingHistories = [];
        return null;
      }
      if (cmd === 'list_battle_histories') return clone(state.battleHistories);
      if (cmd === 'save_battle_history') {
        if (args.markCurrent) {
          if ((state as any).battleHistorySaved) throw new Error('同一对战状态已经保存过历史');
          if (!state.battleTmpState || state.battleTmpState.updatedAt !== (args.history as any).snapshot.updatedAt) {
            throw new Error('当前对战临时状态已改变，无法保存历史');
          }
          (state as any).battleHistorySaved = true;
        }
        state.battleHistories = [
          clone(args.history),
          ...state.battleHistories.filter((item: any) => item.id !== (args.history as any).id),
        ];
        return null;
      }
      if (cmd === 'delete_battle_history') {
        state.battleHistories = state.battleHistories.filter((item: any) => item.id !== args.id);
        return null;
      }
      if (cmd === 'clear_battle_histories') {
        state.battleHistories = [];
        return null;
      }
      if (cmd === 'load_battle_tmp_history_status') {
        if (!state.battleTmpState || state.battleTmpState.variant !== args.variant) return null;
        return { updatedAt: state.battleTmpState.updatedAt, historySaved: Boolean((state as any).battleHistorySaved) };
      }
      if (cmd === 'mark_battle_tmp_history_saved') {
        if (!state.battleTmpState || state.battleTmpState.variant !== args.variant) throw new Error('当前没有可标记的对战临时状态');
        (state as any).battleHistorySaved = state.battleTmpState.updatedAt === args.updatedAt;
        return null;
      }
      if (cmd === 'save_battle_tmp_state') {
        state.battleTmpState = clone(args.state);
        (state as any).battleHistorySaved = args.historySaved === true;
        persistBattleState();
        return null;
      }
      if (cmd === 'load_battle_tmp_state') {
        return state.battleTmpState?.variant === args.variant ? clone(state.battleTmpState) : null;
      }
      if (cmd === 'update_battle_tmp_result') {
        if (!state.battleTmpState || state.battleTmpState.variant !== args.variant) {
          throw new Error('当前没有可更新的对战临时状态');
        }
        const snapshot = clone(state.battleTmpState);
        const match = snapshot.matches.find((candidate: any) => candidate.matchId === args.matchId);
        if (!match) throw new Error('找不到对战场次');
        match.upResult = args.upResult;
        match.downResult = args.downResult;
        snapshot.updatedAt = args.updatedAt;
        state.battleTmpState = recomputeBattleTmp(snapshot);
        (state as any).battleHistorySaved = false;
        persistBattleState();
        return clone(state.battleTmpState);
      }
      if (cmd === 'clear_battle_tmp_state') {
        if (state.battleTmpState?.variant === args.variant) state.battleTmpState = null;
        persistBattleState();
        return null;
      }
      if (cmd === 'open_database_folder' || cmd === 'open_download_folder') return null;
      if (cmd === 'export_text_file' || cmd === 'export_binary_file') return 'E2E/导出文件';
      throw new Error(`E2E Tauri mock 未实现命令：${cmd}`);
    };

    const browserWindow = window as any;
    browserWindow.__E2E_TAURI_STATE__ = state;
    browserWindow.__E2E_TAURI_CLOSE__ = async () => {
      const handler = state.closeRequestedHandler === null
        ? null
        : callbacks.get(state.closeRequestedHandler);
      if (!handler) throw new Error('Tauri 关闭监听尚未就绪');
      await handler({ event: 'tauri://close-requested', id: 1, payload: null });
    };
    browserWindow.__TAURI_INTERNALS__ = {
      invoke,
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (callback: (payload: unknown) => unknown) => {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
    };
  }, { users: initialUsers, data: initialData });
}

export async function mockedRankedNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.rankedUsers
      .filter((user: any) => user.rank < 10_000)
      .sort((left: any, right: any) => left.rank - right.rank)
      .map((user: any) => user.name)
  ));
}
