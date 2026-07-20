import type { AppVariant } from './app-variant';
import type { SavedLineup } from './types';

export interface LineupHistoryTransferFile {
  version: 2;
  kind: 'lineup-history';
  variant: AppVariant;
  history: SavedLineup;
}

export function createLineupHistoryTransfer(
  history: SavedLineup,
  variant: AppVariant,
): LineupHistoryTransferFile {
  return {
    version: 2,
    kind: 'lineup-history',
    variant,
    history: { ...history },
  };
}

export function parseLineupHistoryTransfer(content: string): SavedLineup {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error('分组历史 JSON 格式不正确');
  }
  if (!isRecord(value) || value.kind !== 'lineup-history') {
    throw new Error('不是转盘导出的分组历史文件');
  }
  let history: unknown;
  if (value.version === 2 && 'history' in value) {
    history = value.history;
  } else if (value.version === 1 && Array.isArray(value.histories)) {
    if (value.histories.length !== 1) throw new Error('分组历史导入只支持单条记录');
    [history] = value.histories;
  } else {
    throw new Error('不是转盘导出的分组历史文件');
  }

  if (!isRecord(history)) throw new Error('分组历史格式不正确');
  const id = typeof history.id === 'string' ? history.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new Error('分组历史编号不正确');
  const createdAt = Number(history.createdAt);
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error(`历史“${id}”的时间不正确`);
  if (!isRecord(history.input) || !isRecord(history.result)) throw new Error(`历史“${id}”内容不完整`);
  return { id, createdAt, input: history.input, result: history.result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
