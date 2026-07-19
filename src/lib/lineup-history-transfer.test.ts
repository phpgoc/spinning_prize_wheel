import { describe, expect, test } from 'bun:test';
import { createCsv } from './file-export';
import {
  createLineupHistoryTransfer,
  lineupHistoryCsvRows,
  parseLineupHistoryTransfer,
} from './lineup-history-transfer';
import type { SavedLineup } from './types';

const history: SavedLineup = {
  id: 'lineup-1',
  createdAt: 1_700_000_000_000,
  input: { sourceNames: ['甲', '乙'] },
  result: { groupNames: ['A', 'B'], tiers: [] },
};

describe('分组历史同步文件', () => {
  test('JSON 和 CSV 都可以完整读回分组记录', () => {
    const json = JSON.stringify(createLineupHistoryTransfer([history], 'standard'));
    expect(parseLineupHistoryTransfer(json, 'json')).toEqual([history]);
    expect(parseLineupHistoryTransfer(createCsv(lineupHistoryCsvRows([history])), 'csv')).toEqual([history]);
  });

  test('格式错误和重复编号会被拒绝', () => {
    expect(() => parseLineupHistoryTransfer('{}', 'json')).toThrow('不是转盘导出的');
    const transfer = createLineupHistoryTransfer([history, history], 'standard');
    expect(() => parseLineupHistoryTransfer(JSON.stringify(transfer), 'json')).toThrow('重复');
  });
});
