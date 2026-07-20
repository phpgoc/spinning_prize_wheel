import type { Page } from '@playwright/test';

export interface MockRankedUserInput {
  id: number;
  name: string;
  rank: number;
  aliases?: string[];
}

export interface MockTauriInitialData {
  drawHistories?: unknown[];
  lineupHistories?: unknown[];
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

    const state = {
      rankedUsers,
      commonSelections: [] as unknown[],
      drawHistories: structuredClone(data.drawHistories ?? []) as unknown[],
      lineupHistories: structuredClone(data.lineupHistories ?? []) as unknown[],
      invocations: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    };

    const clone = <T>(value: T): T => structuredClone(value);
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

    const invoke = async (cmd: string, args: Record<string, any> = {}) => {
      state.invocations.push({ cmd, args: clone(args) });
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
      if (cmd === 'resolve_lineup_names') {
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
      if (cmd === 'list_lineup_histories') return clone(state.lineupHistories);
      if (cmd === 'save_lineup_history') {
        state.lineupHistories = [clone(args.lineup), ...state.lineupHistories.filter((item: any) => item.id !== args.lineup.id)];
        return null;
      }
      if (cmd === 'import_lineup_history') {
        state.lineupHistories = [
          clone(args.history),
          ...state.lineupHistories.filter((item: any) => item.id !== args.history.id),
        ];
        return clone(state.lineupHistories);
      }
      if (cmd === 'delete_lineup_history') {
        state.lineupHistories = state.lineupHistories.filter((item: any) => item.id !== args.id);
        return null;
      }
      if (cmd === 'clear_lineup_histories') {
        state.lineupHistories = [];
        return null;
      }
      if (cmd === 'open_database_folder') return null;
      if (cmd === 'export_text_file') return 'E2E/导出文件';
      throw new Error(`E2E Tauri mock 未实现命令：${cmd}`);
    };

    const browserWindow = window as any;
    browserWindow.__E2E_TAURI_STATE__ = state;
    browserWindow.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: () => 1,
      unregisterCallback: () => {},
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
