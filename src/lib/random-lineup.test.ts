import { describe, expect, test } from 'bun:test';
import { createRandomLineup, groupName } from './random-lineup';

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
});
