import { describe, expect, test } from 'bun:test';
import {
  createRandomLineup,
  groupName,
  isResolvedLineupName,
  lineupOrderAvailability,
  orderResolvedLineupNames,
  recentLineupHistories,
  unresolvedLineupNameCount,
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

  test('桌面排名不受粘贴顺序影响并把别名统一为本名', () => {
    const people: ResolvedLineupName[] = [
      { inputName: '小B', known: true, userId: 2, canonicalName: 'B', rank: 2 },
      { inputName: '小A', known: true, userId: 1, canonicalName: 'A', rank: 1 },
      { inputName: '另一个A', known: true, userId: 3, canonicalName: 'C', rank: 2 },
    ];

    expect(orderResolvedLineupNames(people)).toEqual(['A', 'B', 'C']);
    expect(orderResolvedLineupNames([...people].reverse())).toEqual(['A', 'B', 'C']);
  });

  test('桌面排名拒绝未识别人物', () => {
    expect(() => orderResolvedLineupNames([
      { inputName: '陌生人', known: false, userId: null, canonicalName: null, rank: null },
    ])).toThrow('排名名单中存在未识别人物');
  });

  test('红名统计同时识别缺失、错位和无排名人物', () => {
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

  test('排阵历史按日期筛选并只保留最新 5 条', () => {
    const histories: SavedLineup[] = Array.from({ length: 8 }, (_, index) => ({
      id: `history-${index}`,
      createdAt: new Date(2026, 6, index + 1, 12).getTime(),
      input: {},
      result: {},
    }));

    expect(recentLineupHistories(histories).map((history) => history.id)).toEqual([
      'history-7', 'history-6', 'history-5', 'history-4', 'history-3',
    ]);
    expect(recentLineupHistories(histories, '2026-07-03', '2026-07-05').map((history) => history.id))
      .toEqual(['history-4', 'history-3', 'history-2']);
  });
});
