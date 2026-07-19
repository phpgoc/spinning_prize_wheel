import type { AppVariant } from './app-variant';
import type { CsvCell } from './file-export';
import type { SavedLineup } from './types';

export type LineupHistoryFileFormat = 'csv' | 'json';

export interface LineupHistoryTransferFile {
  version: 1;
  kind: 'lineup-history';
  variant: AppVariant;
  exportedAt: string;
  histories: SavedLineup[];
}

const HISTORY_LIMIT = 10_000;

export function createLineupHistoryTransfer(
  histories: readonly SavedLineup[],
  variant: AppVariant,
): LineupHistoryTransferFile {
  return {
    version: 1,
    kind: 'lineup-history',
    variant,
    exportedAt: new Date().toISOString(),
    histories: histories.map((history) => ({ ...history })),
  };
}

export function lineupHistoryCsvRows(histories: readonly SavedLineup[]): CsvCell[][] {
  return [
    ['编号', '时间戳', '输入JSON', '结果JSON'],
    ...histories.map((history) => [
      history.id,
      history.createdAt,
      JSON.stringify(history.input),
      JSON.stringify(history.result),
    ]),
  ];
}

export function parseLineupHistoryTransfer(
  content: string,
  format: LineupHistoryFileFormat,
): SavedLineup[] {
  const histories = format === 'json' ? historiesFromJson(content) : historiesFromCsv(content);
  if (histories.length === 0) throw new Error('文件中没有分组历史');
  if (histories.length > HISTORY_LIMIT) throw new Error(`一次最多导入 ${HISTORY_LIMIT} 条分组历史`);

  const ids = new Set<string>();
  return histories.map((history, index) => {
    if (!isRecord(history)) throw new Error(`第 ${index + 1} 条历史格式不正确`);
    const id = typeof history.id === 'string' ? history.id.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new Error(`第 ${index + 1} 条历史编号不正确`);
    if (ids.has(id)) throw new Error(`历史编号“${id}”重复`);
    ids.add(id);
    const createdAt = Number(history.createdAt);
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error(`历史“${id}”的时间不正确`);
    if (!isRecord(history.input) || !isRecord(history.result)) throw new Error(`历史“${id}”内容不完整`);
    return { id, createdAt, input: history.input, result: history.result };
  });
}

function historiesFromJson(content: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error('分组历史 JSON 格式不正确');
  }
  if (!isRecord(value) || value.kind !== 'lineup-history' || value.version !== 1 || !Array.isArray(value.histories)) {
    throw new Error('不是转盘导出的分组历史文件');
  }
  return value.histories;
}

function historiesFromCsv(content: string): unknown[] {
  const rows = parseCsv(content.replace(/^\uFEFF/u, ''));
  const headers = rows[0]?.map((cell) => cell.trim()) ?? [];
  if (headers.join('|') !== '编号|时间戳|输入JSON|结果JSON') {
    throw new Error('不是转盘导出的分组历史 CSV');
  }
  return rows.slice(1).map((row, index) => {
    try {
      return {
        id: row[0],
        createdAt: Number(row[1]),
        input: JSON.parse(row[2]),
        result: JSON.parse(row[3]),
      };
    } catch {
      throw new Error(`CSV 第 ${index + 2} 行内容不正确`);
    }
  });
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const pushRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    cell = '';
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') pushRow();
    else if (character !== '\r') cell += character;
  }
  if (quoted) throw new Error('CSV 引号没有闭合');
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
