import { describe, expect, test } from 'bun:test';
import {
  createBattleTmpSnapshot,
  createSeededBattlePlan,
  type BattleTmpSnapshot,
} from './battle';
import {
  createBattleHistoryTransfer,
  parseBattleHistoryTransfer,
  parseBattleHistoryTransferRecord,
} from './battle-history-transfer';

function createSnapshot(variant: 'standard' | 'caimi' = 'standard'): BattleTmpSnapshot {
  return createBattleTmpSnapshot(variant, createSeededBattlePlan(
    ['甲', '乙', '丙', '丁'],
    {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 0,
      random: () => 0.5,
    },
  ), 123);
}

describe('对战历史同步文件', () => {
  test('正式封装导出后可以完整读回签表', () => {
    const snapshot = createSnapshot();
    const transfer = createBattleHistoryTransfer(snapshot);

    expect(transfer).toEqual({ kind: 'battle-history', version: 1, updatedAt: snapshot.updatedAt, snapshot });
    expect(parseBattleHistoryTransfer(transfer, 'standard')).toEqual(snapshot);
  });

  test('兼容导入早期直接导出的裸临时表快照', () => {
    const snapshot = createSnapshot();
    expect(parseBattleHistoryTransfer(snapshot, 'standard')).toEqual(snapshot);
  });

  test('导入正式文件时保留历史名称', () => {
    const snapshot = createSnapshot();
    const transfer = createBattleHistoryTransfer(snapshot, '春季赛');
    expect(parseBattleHistoryTransferRecord(transfer, 'standard')).toEqual({
      snapshot,
      title: '春季赛',
    });
  });

  test('拒绝其他格式、未来版本和不同变体', () => {
    const snapshot = createSnapshot();

    expect(() => parseBattleHistoryTransfer({
      kind: 'lineup-history',
      version: 1,
      snapshot,
    }, 'standard')).toThrow('不是对战历史 JSON');
    expect(() => parseBattleHistoryTransfer({
      kind: 'battle-history',
      version: 2,
      snapshot,
    }, 'standard')).toThrow('不支持的对战历史版本');
    expect(() => parseBattleHistoryTransfer({
      kind: 'battle-history',
      version: 1,
      updatedAt: snapshot.updatedAt + 1,
      snapshot,
    }, 'standard')).toThrow('对战历史更新时间不一致');
    expect(() => parseBattleHistoryTransfer(
      createBattleHistoryTransfer(createSnapshot('caimi')),
      'standard',
    )).toThrow('对战临时状态格式不正确');
  });
});
