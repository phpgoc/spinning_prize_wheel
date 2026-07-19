import { describe, expect, test } from 'bun:test';
import { aggregateDrawHistories, filterDrawHistories, singleDrawHistoryStats } from './draw-history';
import type { DrawRecord, Prize, SavedDraw } from './types';

const prizes: Prize[] = [
  { id: 'a', name: '甲', weight: 2, color: '#111', enabled: true },
  { id: 'b', name: '乙', weight: 1, color: '#222', enabled: true },
];

function record(optionId: string, label: string, rewardAmount: number): DrawRecord {
  return {
    id: `${optionId}-${rewardAmount}`,
    sequence: 1,
    round: 1,
    attempt: 1,
    optionId,
    label,
    outcome: 'selected',
    detail: '',
    rewardAmount,
    mode: 'selected',
    createdAt: 1,
    source: 'single',
  };
}

function draw(id: string, createdAt: number, records: DrawRecord[]): SavedDraw {
  return { version: 1, id, createdAt, mode: 'selected', rewardAmount: 10, prizes, records };
}

describe('抽奖历史导出', () => {
  test('日期开始包含当天而结束不包含当天，并允许只填一端', () => {
    const histories = [
      draw('1', new Date(2026, 6, 1, 12).getTime(), []),
      draw('2', new Date(2026, 6, 2, 12).getTime(), []),
      draw('3', new Date(2026, 6, 3, 12).getTime(), []),
    ];

    expect(filterDrawHistories(histories, '2026-07-02', '2026-07-03').map((item) => item.id))
      .toEqual(['2']);
    expect(filterDrawHistories(histories, '', '2026-07-02').map((item) => item.id))
      .toEqual(['1']);
    expect(filterDrawHistories(histories, '2026-07-03').map((item) => item.id))
      .toEqual(['3']);
  });

  test('单条保留权重，日期范围则合并参与和中奖统计', () => {
    const first = draw('1', 1, [record('a', '甲', 10)]);
    const second = draw('2', 2, [record('a', '甲', 20), record('b', '乙', 20)]);

    expect(singleDrawHistoryStats(first)).toEqual([
      { name: '甲', weight: 2, count: 1, rewardTotal: 10 },
      { name: '乙', weight: 1, count: 0, rewardTotal: 0 },
    ]);
    expect(aggregateDrawHistories([first, second])).toEqual([
      { name: '甲', participationCount: 2, winCount: 2, rewardTotal: 30 },
      { name: '乙', participationCount: 2, winCount: 1, rewardTotal: 20 },
    ]);
  });
});
