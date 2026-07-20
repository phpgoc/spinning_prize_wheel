import { describe, expect, test } from 'bun:test';
import {
  createLineupHistoryTransfer,
  parseLineupHistoryTransfer,
} from './lineup-history-transfer';
import type { SavedLineup } from './types';

const history: SavedLineup = {
  id: 'lineup-1',
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
    const transfer = createLineupHistoryTransfer(history, 'standard');
    expect(transfer.history).toEqual(history);
    expect(parseLineupHistoryTransfer(JSON.stringify(transfer))).toEqual(history);
  });

  test('格式错误和旧版多条文件会被拒绝', () => {
    expect(() => parseLineupHistoryTransfer('{}')).toThrow('不是转盘导出的');
    expect(() => parseLineupHistoryTransfer(JSON.stringify({
      version: 1,
      kind: 'lineup-history',
      histories: [history, { ...history, id: 'lineup-2' }],
    }))).toThrow('只支持单条');
  });

  test('兼容导入旧版单条 JSON', () => {
    expect(parseLineupHistoryTransfer(JSON.stringify({
      version: 1,
      kind: 'lineup-history',
      histories: [history],
    }))).toEqual(history);
  });
});
