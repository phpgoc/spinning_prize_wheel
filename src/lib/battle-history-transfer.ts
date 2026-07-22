import type { AppVariant } from './app-variant';
import { parseBattleTmpSnapshot, type BattleTmpSnapshot } from './battle';

export interface BattleHistoryTransfer {
  kind: 'battle-history';
  version: 1;
  snapshot: BattleTmpSnapshot;
}

/** 创建带格式标识的对战历史文件，避免与临时表 JSON 混淆。 */
export function createBattleHistoryTransfer(snapshot: BattleTmpSnapshot): BattleHistoryTransfer {
  return {
    kind: 'battle-history',
    version: 1,
    snapshot,
  };
}

/** 校验正式历史文件；同时兼容早期直接导出的裸临时表快照。 */
export function parseBattleHistoryTransfer(
  value: unknown,
  variant: AppVariant,
): BattleTmpSnapshot {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'snapshot' in value) {
    const transfer = value as { kind?: unknown; version?: unknown; snapshot?: unknown };
    if (transfer.kind !== 'battle-history') throw new Error('不是对战历史 JSON');
    if (transfer.version !== 1) throw new Error('不支持的对战历史版本');
    return parseBattleTmpSnapshot(transfer.snapshot, variant);
  }
  return parseBattleTmpSnapshot(value, variant);
}
