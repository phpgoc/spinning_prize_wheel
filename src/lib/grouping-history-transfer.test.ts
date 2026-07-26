import { describe, expect, test } from 'bun:test';
import {
  createGroupingHistoryTransfer,
  parseGroupingHistoryTransfer,
} from './grouping-history-transfer';
import type { SavedGrouping } from './types';

const history: SavedGrouping = {
  id: 'grouping-1',
  createdAt: 1_700_000_000_000,
  input: {
    sourceNames: ['甲', '乙'],
    orderMode: 'rank',
    rankingSnapshot: [
      { inputName: '甲', name: '甲', rank: 1 },
      { inputName: '乙', name: '乙', rank: 2 },
    ],
  },
  result: { groupNames: ['A', 'B'], tiers: [] },
};

describe('分组历史同步文件', () => {
  test('单条 JSON 可以完整导出并读回', () => {
    const transfer = createGroupingHistoryTransfer(history);
    expect(transfer.history).toEqual(history);
    expect(transfer).not.toHaveProperty('variant');
    expect(parseGroupingHistoryTransfer(JSON.stringify(transfer))).toEqual(history);
  });

  test('格式错误和旧版多条文件会被拒绝', () => {
    expect(() => parseGroupingHistoryTransfer('{}')).toThrow('不是转盘导出的');
    expect(() => parseGroupingHistoryTransfer(JSON.stringify({
      version: 1,
      kind: 'grouping-history',
      histories: [history, { ...history, id: 'grouping-2' }],
    }))).toThrow('只支持单条');
  });

  test('兼容导入旧版单条 JSON', () => {
    expect(parseGroupingHistoryTransfer(JSON.stringify({
      version: 1,
      kind: 'grouping-history',
      histories: [history],
    }))).toEqual(history);
  });
});
