import type { AppVariant } from './app-variant';
import { parseBattleTmpSnapshot, type BattleTmpSnapshot } from './battle';

export interface BattleHistoryTransfer {
  kind: 'battle-history';
  version: 1;
  updatedAt: number;
  title?: string | null;
  snapshot: BattleTmpSnapshot;
}

export interface ParsedBattleHistoryTransfer {
  snapshot: BattleTmpSnapshot;
  title: string | null;
}

/** 创建带格式标识的对战历史文件，避免与临时表 JSON 混淆。 */
export function createBattleHistoryTransfer(snapshot: BattleTmpSnapshot, title?: string | null): BattleHistoryTransfer {
  return {
    kind: 'battle-history',
    version: 1,
    updatedAt: snapshot.updatedAt,
    ...(title ? { title } : {}),
    snapshot,
  };
}

/** 校验正式历史文件；同时兼容早期直接导出的裸临时表快照。 */
export function parseBattleHistoryTransfer(
  value: unknown,
  variant: AppVariant,
): BattleTmpSnapshot {
  return parseBattleHistoryTransferRecord(value, variant).snapshot;
}

/** 读取对战历史文件，同时保留历史名称。 */
export function parseBattleHistoryTransferRecord(
  value: unknown,
  variant: AppVariant,
): ParsedBattleHistoryTransfer {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'snapshot' in value) {
    const transfer = value as {
      kind?: unknown;
      version?: unknown;
      updatedAt?: unknown;
      title?: unknown;
      snapshot?: unknown;
    };
    if (transfer.kind !== 'battle-history') throw new Error('不是对战历史 JSON');
    if (transfer.version !== 1) throw new Error('不支持的对战历史版本');
    const snapshot = parseBattleTmpSnapshot(transfer.snapshot, variant);
    if (transfer.updatedAt !== undefined
      && (!Number.isSafeInteger(transfer.updatedAt) || transfer.updatedAt !== snapshot.updatedAt)) {
      throw new Error('对战历史更新时间不一致');
    }
    return {
      snapshot,
      title: typeof transfer.title === 'string' && transfer.title.trim() ? transfer.title.trim() : null,
    };
  }
  return { snapshot: parseBattleTmpSnapshot(value, variant), title: null };
}
