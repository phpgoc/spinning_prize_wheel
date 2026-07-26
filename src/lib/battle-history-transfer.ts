import { parseBattleTmpSnapshot, type BattleTmpSnapshot } from './battle';

export interface BattleHistoryTransfer {
  kind: 'battle-history';
  version: 1;
  /** 用户点击保存历史的时间；与 snapshot.createdAt 不同。 */
  createdAt?: number;
  updatedAt: number;
  title?: string | null;
  snapshot: BattleTmpSnapshot;
}

export interface ParsedBattleHistoryTransfer {
  snapshot: BattleTmpSnapshot;
  createdAt?: number | null;
  title: string | null;
}

/** 创建带格式标识的对战历史文件，避免与临时表 JSON 混淆。 */
export function createBattleHistoryTransfer(
  snapshot: BattleTmpSnapshot,
  title?: string | null,
  createdAt = Date.now(),
): BattleHistoryTransfer {
  return {
    kind: 'battle-history',
    version: 1,
    createdAt,
    updatedAt: snapshot.updatedAt,
    ...(title ? { title } : {}),
    snapshot,
  };
}

/** 校验正式历史文件；同时兼容早期直接导出的裸临时表快照。 */
export function parseBattleHistoryTransfer(
  value: unknown,
): BattleTmpSnapshot {
  return parseBattleHistoryTransferRecord(value).snapshot;
}

/** 读取对战历史文件，同时保留历史名称。 */
export function parseBattleHistoryTransferRecord(
  value: unknown,
): ParsedBattleHistoryTransfer {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'snapshot' in value) {
    const transfer = value as {
      kind?: unknown;
      version?: unknown;
      updatedAt?: unknown;
      createdAt?: unknown;
      title?: unknown;
      snapshot?: unknown;
    };
    if (transfer.kind !== 'battle-history') throw new Error('不是对战历史 JSON');
    if (transfer.version !== 1) throw new Error('不支持的对战历史版本');
    const snapshot = parseBattleTmpSnapshot(transfer.snapshot);
    if (transfer.createdAt !== undefined
      && (typeof transfer.createdAt !== 'number'
        || !Number.isSafeInteger(transfer.createdAt)
        || transfer.createdAt <= snapshot.updatedAt)) {
      throw new Error('对战历史创建时间不合法');
    }
    if (transfer.updatedAt !== undefined
      && (!Number.isSafeInteger(transfer.updatedAt) || transfer.updatedAt !== snapshot.updatedAt)) {
      throw new Error('对战历史更新时间不一致');
    }
    return {
      snapshot,
      createdAt: typeof transfer.createdAt === 'number' && Number.isSafeInteger(transfer.createdAt)
        ? transfer.createdAt
        : null,
      title: typeof transfer.title === 'string' && transfer.title.trim() ? transfer.title.trim() : null,
    };
  }
  return { snapshot: parseBattleTmpSnapshot(value), createdAt: null, title: null };
}
