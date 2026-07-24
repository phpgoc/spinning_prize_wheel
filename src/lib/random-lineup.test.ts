import { describe, expect, test } from 'bun:test';
import {
  applyCaimiLineupSwap,
  createLineupRankingSnapshot,
  createRandomLineup,
  groupName,
  insertLineupPreviewName,
  isResolvedLineupName,
  lineupLastTierSize,
  lineupOrderAvailability,
  lineupPreviewTierStarts,
  nextRankedUserActionIndex,
  orderBattleNamesByFixedRank,
  orderCaimiBattleNamesByFixedRank,
  orderPartiallyResolvedLineupNames,
  orderResolvedLineupNames,
  rankedBattleLineupNameCount,
  rankedUserIdAtShortcut,
  rankedUserDropTargetForCard,
  rankedUserKeyboardDropPoints,
  filterLineupHistories,
  unrankedLineupNameCount,
  unresolvedLineupNameCount,
  uniqueLineupNames,
  uniqueResolvedLineupPeople,
  updateRankShortcutInput,
} from './random-lineup';
import type { ResolvedLineupName, SavedLineup } from './types';

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0;
}

describe('随机排阵', () => {
  test('24 人分为 6 组和 4 档，同档不会重复进组', () => {
    const names = Array.from({ length: 24 }, (_, index) => `选手${index + 1}`);
    const result = createRandomLineup(names, 6, sequence([0.2, 0.8, 0.4, 0.6, 0.1]));

    expect(result.groupNames).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(result.tiers).toHaveLength(4);
    expect(result.tiers.every((tier) => tier.filter(Boolean).length === 6)).toBe(true);
    expect(result.tiers.flat().map((entry) => entry?.name).sort()).toEqual([...names].sort());
    result.tiers.forEach((tier, tierIndex) => {
      expect(tier.every((entry) => entry?.tierIndex === tierIndex)).toBe(true);
      expect(new Set(tier.map((entry) => entry?.groupIndex)).size).toBe(6);
    });
  });

  test('最后一档人数不足时保留空位且不重复分配', () => {
    const names = Array.from({ length: 10 }, (_, index) => `选手${index + 1}`);
    const result = createRandomLineup(names, 4, () => 0);

    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[2].filter(Boolean)).toHaveLength(2);
    expect(result.tiers.flat().filter(Boolean)).toHaveLength(10);
  });

  test('猜蜜版把自己换进最弱组并标记交换双方', () => {
    const lineup = createRandomLineup(
      ['猜蜜本人', '同档甲', '同档乙', '第二档甲', '第二档乙', '第二档丙'],
      3,
      () => 0,
    );
    const favoredBefore = lineup.tiers.flat().find((entry) => entry?.name === '猜蜜本人')!;
    const scores = [1, 20, 8, 2, 20, 8];
    const result = applyCaimiLineupSwap(lineup, scores);
    const favoredAfter = result.tiers.flat().find((entry) => entry?.name === '猜蜜本人')!;
    const displaced = result.tiers[favoredAfter.tierIndex][favoredBefore.groupIndex]!;

    expect(favoredAfter.groupIndex).not.toBe(favoredBefore.groupIndex);
    expect(favoredAfter.caimiSwap?.kind).toBe('favored');
    expect(displaced.caimiSwap?.kind).toBe('displaced');
    expect(result.tiers.flat().filter(Boolean)).toHaveLength(6);
  });

  test('猜蜜版也识别 cai 特权字', () => {
    const lineup = createRandomLineup(
      ['cai本人', '同档甲', '同档乙', '第二档甲', '第二档乙', '第二档丙'],
      3,
      () => 0,
    );
    const before = lineup.tiers.flat().find((entry) => entry?.name === 'cai本人')!;
    const result = applyCaimiLineupSwap(lineup, [1, 20, 8, 2, 20, 8]);
    const after = result.tiers.flat().find((entry) => entry?.name === 'cai本人')!;
    expect(after.groupIndex).not.toBe(before.groupIndex);
    expect(after.caimiSwap?.kind).toBe('favored');
  });

  test('校验组数和人数', () => {
    expect(() => createRandomLineup(['甲', '乙'], 1)).toThrow('组数至少为 2');
    expect(() => createRandomLineup(['甲', '乙'], 3)).toThrow('人数不能少于组数');
    expect(() => createRandomLineup(Array.from({ length: 27 }, (_, index) => `${index}`), 27))
      .toThrow('当前最多支持 26 组');
  });

  test('组名可以从 Z 继续到 AA', () => {
    expect(groupName(0)).toBe('A');
    expect(groupName(25)).toBe('Z');
    expect(groupName(26)).toBe('AA');
  });

  test('桌面排名使用数据库顺序但保留输入别名', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '小B', known: true, userId: 2, canonicalName: 'B', rank: 2 },
      { inputName: '小A', known: true, userId: 1, canonicalName: 'A', rank: 1 },
      { inputName: '另一个小A', known: true, userId: 1, canonicalName: 'A', rank: 1 },
      { inputName: '另一个A', known: true, userId: 3, canonicalName: 'C', rank: 2 },
    ];

    expect(orderResolvedLineupNames(people)).toEqual(['小A', '小B', '另一个A']);
    expect(orderResolvedLineupNames([...people].reverse())).toEqual(['另一个小A', '小B', '另一个A']);
  });

  test('分组按排名排序时把未排名项按输入顺序放在末尾', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '未录入甲', known: false, userId: null, canonicalName: null, rank: null },
      { inputName: '第二名', known: true, userId: 2, canonicalName: '乙', rank: 2 },
      { inputName: '未排名乙', known: true, userId: 3, canonicalName: '丙', rank: 10_000 },
      { inputName: '第一名', known: true, userId: 1, canonicalName: '甲', rank: 1 },
      { inputName: '未关联丙', known: true, userId: 4, canonicalName: '丁', rank: null },
    ];

    expect(orderPartiallyResolvedLineupNames(people)).toEqual([
      '第一名',
      '第二名',
      '未录入甲',
      '未排名乙',
      '未关联丙',
    ]);
  });

  test('对战固定前四只要求四个参赛者有排名', () => {
    const names = ['丁', '甲别名', '陌生', '乙', '无排名', '丙'];
    const people: ResolvedLineupName[] = [
      { inputName: '丁', known: true, userId: 4, canonicalName: '丁', rank: 4 },
      { inputName: '甲别名', known: true, userId: 1, canonicalName: '甲', rank: 1 },
      { inputName: '陌生', known: false, userId: null, canonicalName: null, rank: null },
      { inputName: '乙', known: true, userId: 2, canonicalName: '乙', rank: 2 },
      { inputName: '无排名', known: true, userId: 5, canonicalName: '无排名', rank: 10_000 },
      { inputName: '丙', known: true, userId: 3, canonicalName: '丙', rank: 3 },
    ];

    expect(rankedBattleLineupNameCount(names, people)).toBe(4);
    expect(orderBattleNamesByFixedRank(names, people, 4))
      .toEqual(['甲别名', '乙', '丙', '丁', '陌生', '无排名']);
    expect(() => orderBattleNamesByFixedRank(names, people, 5))
      .toThrow('固定前 5 名，现 4 个排名');
  });

  test('猜蜜版按排名对战把特权第一名放到前 N 固定区的最末种子', () => {
    const people = Array.from({ length: 16 }, (_, index): ResolvedLineupName => ({
      inputName: index === 0 ? '头号猜选手' : `第${index + 1}名`,
      known: true,
      userId: index + 1,
      canonicalName: index === 0 ? '头号猜选手' : `第${index + 1}名`,
      rank: index + 1,
    }));
    const names = [...people].reverse().map((person) => person.inputName);

    expect(orderCaimiBattleNamesByFixedRank(names, people, 4).slice(0, 4)).toEqual([
      '第2名',
      '第3名',
      '第4名',
      '头号猜选手',
    ]);
    expect(orderCaimiBattleNamesByFixedRank(names, people, 8).slice(0, 8)).toEqual([
      '第2名',
      '第3名',
      '第4名',
      '第5名',
      '第6名',
      '第7名',
      '第8名',
      '头号猜选手',
    ]);
  });

  test('猜蜜版会提升已有排名的特权项，全随机则完全保持原名单', () => {
    const people = Array.from({ length: 10 }, (_, index): ResolvedLineupName => ({
      inputName: index === 9 ? 'cai第10名' : `普通第${index + 1}名`,
      known: true,
      userId: index + 1,
      canonicalName: index === 9 ? 'cai第10名' : `普通第${index + 1}名`,
      rank: index + 1,
    }));
    const names = [people[5], people[0], people[9], ...people.slice(1, 5), ...people.slice(6, 9)]
      .map((person) => person.inputName);

    expect(orderCaimiBattleNamesByFixedRank(names, people, 4).slice(0, 4)).toEqual([
      '普通第1名',
      '普通第2名',
      '普通第3名',
      'cai第10名',
    ]);
    expect(orderCaimiBattleNamesByFixedRank(names, people, 0)).toEqual(names);
  });

  test('同一排名项的不同别名在预览中只保留首次出现的一项', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '小甲', known: true, userId: 1, canonicalName: '甲', rank: 1 },
      { inputName: '甲同学', known: true, userId: 1, canonicalName: '甲', rank: 1 },
      { inputName: '陌生', known: false, userId: null, canonicalName: null, rank: null },
    ];

    expect(uniqueResolvedLineupPeople(people).map((person) => person.inputName))
      .toEqual(['小甲', '陌生']);
  });

  test('排名快照按分组使用顺序记录输入名、本名和当时排名', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '小乙', known: true, userId: 2, canonicalName: '乙', rank: 2 },
      { inputName: '小甲', known: true, userId: 1, canonicalName: '甲', rank: 1 },
    ];

    expect(createLineupRankingSnapshot(['小甲', '小乙'], people)).toEqual([
      { inputName: '小甲', name: '甲', rank: 1 },
      { inputName: '小乙', name: '乙', rank: 2 },
    ]);
  });

  test('排名快照可以跳过最后一档的未排名项', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '第一名', known: true, userId: 1, canonicalName: '甲', rank: 1 },
      { inputName: '未录入', known: false, userId: null, canonicalName: null, rank: null },
      { inputName: '未排名', known: true, userId: 2, canonicalName: '乙', rank: 10_000 },
    ];

    expect(createLineupRankingSnapshot(['第一名', '未录入', '未排名'], people, true)).toEqual([
      { inputName: '第一名', name: '甲', rank: 1 },
    ]);
  });

  test('关联数字只在排名完全存在时跳转并支持退格', () => {
    const users = [{ id: 1, rank: 1 }, { id: 12, rank: 12 }, { id: 99, rank: 10_000 }];
    let input = updateRankShortcutInput('', '1');
    expect(rankedUserIdAtShortcut(users, input)).toBe(1);
    input = updateRankShortcutInput(input, '2');
    expect(rankedUserIdAtShortcut(users, input)).toBe(12);
    input = updateRankShortcutInput(input, '3');
    expect(rankedUserIdAtShortcut(users, input)).toBeNull();
    input = updateRankShortcutInput(input, 'Backspace');
    expect(input).toBe('12');
    expect(rankedUserIdAtShortcut(users, input)).toBe(12);
    expect(rankedUserIdAtShortcut(users, '10000')).toBeNull();
  });

  test('桌面排名拒绝未识别选项', () => {
    expect(() => orderResolvedLineupNames([
      { inputName: '陌生人', known: false, userId: null, canonicalName: null, rank: null },
    ])).toThrow('排名名单中存在未识别选项');
  });

  test('红名统计同时识别缺失、错位和无排名选项', () => {
    const names = ['已知', '陌生', '错位', '缺排名'];
    const people: ResolvedLineupName[] = [
      { inputName: '已知', known: true, userId: 1, canonicalName: '已知', rank: 1 },
      { inputName: '陌生', known: false, userId: null, canonicalName: null, rank: null },
      { inputName: '另一个名字', known: true, userId: 2, canonicalName: '错位', rank: 2 },
      { inputName: '缺排名', known: true, userId: 3, canonicalName: '缺排名', rank: null },
    ];

    expect(isResolvedLineupName(names[0], people[0])).toBeTrue();
    expect(unresolvedLineupNameCount(names, people)).toBe(3);
    expect(unresolvedLineupNameCount(names, [people[0]])).toBe(3);
    const unranked: ResolvedLineupName = {
      inputName: '未排名',
      known: true,
      userId: 4,
      canonicalName: '未排名',
      rank: 10_000,
    };
    expect(isResolvedLineupName('未排名', unranked)).toBeTrue();
    expect(unrankedLineupNameCount(['已知', '未排名'], [people[0], unranked])).toBe(1);
  });

  test('红名只锁定排名排阵，输入顺序仍然可用', () => {
    expect(lineupOrderAvailability(4, true, false, 2)).toEqual({
      input: true,
      rank: false,
    });
    expect(lineupOrderAvailability(4, true, false, 0)).toEqual({
      input: true,
      rank: true,
    });
    expect(lineupOrderAvailability(4, true, true, 0)).toEqual({
      input: false,
      rank: false,
    });
  });

  test('按排名分组允许末档未排名', () => {
    expect(lineupLastTierSize(15, 4)).toBe(3);
    expect(lineupLastTierSize(16, 4)).toBe(4);
    expect(lineupLastTierSize(24, 6)).toBe(6);

    expect(lineupOrderAvailability(15, true, false, 3, lineupLastTierSize(15, 4)).rank).toBeTrue();
    expect(lineupOrderAvailability(15, true, false, 4, lineupLastTierSize(15, 4)).rank).toBeFalse();
    expect(lineupOrderAvailability(16, true, false, 4, lineupLastTierSize(16, 4)).rank).toBeTrue();
    expect(lineupOrderAvailability(24, true, false, 6, lineupLastTierSize(24, 6)).rank).toBeTrue();
    expect(lineupOrderAvailability(24, true, false, 1).rank).toBeFalse();
  });

  test('预览按组数标出每一档的换行位置', () => {
    expect(lineupPreviewTierStarts(24, 6)).toEqual([0, 6, 12, 18]);
    expect(lineupPreviewTierStarts(10, 4)).toEqual([0, 4, 8]);
    expect(lineupPreviewTierStarts(0, 6)).toEqual([]);
  });

  test('预览名单可在指定位置插入姓名', () => {
    expect(insertLineupPreviewName(['甲', '丙'], 1, ' 乙 ')).toEqual(['甲', '乙', '丙']);
  });

  test('分组文本导入按首次出现自动去重', () => {
    expect(uniqueLineupNames(['甲', '乙', '甲', ' 乙 ', '丙'])).toEqual(['甲', '乙', '丙']);
  });

  test('排名卡片上下插入且中间替换', () => {
    expect([
      rankedUserDropTargetForCard(7, 2, 0.1),
      rankedUserDropTargetForCard(7, 2, 0.5),
      rankedUserDropTargetForCard(7, 2, 0.9),
    ]).toEqual([
      { kind: 'insert', index: 2 },
      { kind: 'swap', userId: 7 },
      { kind: 'insert', index: 3 },
    ]);
  });

  test('无排名源项只按卡片上下半区插入', () => {
    expect([
      rankedUserDropTargetForCard(7, 2, 0.1, false),
      rankedUserDropTargetForCard(7, 2, 0.4, false),
      rankedUserDropTargetForCard(7, 2, 0.6, false),
      rankedUserDropTargetForCard(7, 2, 0.9, false),
    ]).toEqual([
      { kind: 'insert', index: 2 },
      { kind: 'insert', index: 2 },
      { kind: 'insert', index: 3 },
      { kind: 'insert', index: 3 },
    ]);
  });

  test('键盘排序依次包含无排名、插入和替换落点', () => {
    expect(rankedUserKeyboardDropPoints([11, 22], [33])).toEqual([
      { target: { kind: 'unranked' }, cardId: null, position: 'unranked' },
      { target: { kind: 'insert', index: 0 }, cardId: 11, position: 'before' },
      { target: { kind: 'swap', userId: 11 }, cardId: 11, position: 'swap' },
      { target: { kind: 'insert', index: 1 }, cardId: 22, position: 'before' },
      { target: { kind: 'swap', userId: 22 }, cardId: 22, position: 'swap' },
      { target: { kind: 'insert', index: 2 }, cardId: 22, position: 'after' },
    ]);
  });

  test('无排名源项的键盘排序跳过替换落点', () => {
    expect(rankedUserKeyboardDropPoints([11, 22], [33], false)).toEqual([
      { target: { kind: 'unranked' }, cardId: null, position: 'unranked' },
      { target: { kind: 'insert', index: 0 }, cardId: 11, position: 'before' },
      { target: { kind: 'insert', index: 1 }, cardId: 22, position: 'before' },
      { target: { kind: 'insert', index: 2 }, cardId: 22, position: 'after' },
    ]);
  });

  test('排名操作行可以用左右键经过第三个操作并返回整条', () => {
    expect(nextRankedUserActionIndex(-1, 'right', 3)).toBe(0);
    expect(nextRankedUserActionIndex(0, 'right', 3)).toBe(1);
    expect(nextRankedUserActionIndex(1, 'right', 3)).toBe(2);
    expect(nextRankedUserActionIndex(2, 'right', 3)).toBe(2);
    expect(nextRankedUserActionIndex(2, 'left', 3)).toBe(1);
    expect(nextRankedUserActionIndex(0, 'left', 3)).toBe(-1);
  });

  test('分组历史开始日期包含当天、结束日期不包含当天，并返回条件内全部记录', () => {
    const histories: SavedLineup[] = Array.from({ length: 8 }, (_, index) => ({
      id: `history-${index}`,
      createdAt: new Date(2026, 6, index + 1, 12).getTime(),
      input: {},
      result: {},
    }));

    expect(filterLineupHistories(histories).map((history) => history.id)).toEqual([
      'history-7', 'history-6', 'history-5', 'history-4', 'history-3', 'history-2', 'history-1', 'history-0',
    ]);
    expect(filterLineupHistories(histories, '2026-07-03', '2026-07-05').map((history) => history.id))
      .toEqual(['history-3', 'history-2']);
  });
});
