import type { SavedDraw } from './types';

export interface SingleDrawHistoryStat {
  name: string;
  weight: number;
  count: number;
  rewardTotal: number;
}

export interface DrawHistoryAggregateStat {
  name: string;
  participationCount: number;
  winCount: number;
  rewardTotal: number;
}

/** 开始日期包含当天，结束日期从所选当天零点起不再包含。 */
export function filterDrawHistories(
  histories: readonly SavedDraw[],
  startDate = '',
  endDate = '',
): SavedDraw[] {
  const startAt = localDateStart(startDate) ?? Number.NEGATIVE_INFINITY;
  const endAt = localDateStart(endDate) ?? Number.POSITIVE_INFINITY;
  return [...histories]
    .filter((draw) => draw.createdAt >= startAt && draw.createdAt < endAt)
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** 单次历史保留当时的候选权重，并统计有效中奖记录。 */
export function singleDrawHistoryStats(draw: SavedDraw): SingleDrawHistoryStat[] {
  const rows = new Map<string, SingleDrawHistoryStat>();
  const optionNames = new Map<string, string>();
  for (const prize of draw.prizes) {
    const name = prize.name.trim();
    if (!name) continue;
    optionNames.set(prize.id, name);
    if (prize.enabled) {
      rows.set(nameKey(name), {
        name,
        weight: Math.max(0, Number(prize.weight) || 0),
        count: 0,
        rewardTotal: 0,
      });
    }
  }

  for (const record of draw.records) {
    if (record.outcome !== 'selected' && record.outcome !== 'winner') continue;
    const name = (optionNames.get(record.optionId) ?? record.label).trim();
    if (!name) continue;
    const key = nameKey(name);
    const row = rows.get(key) ?? { name, weight: 0, count: 0, rewardTotal: 0 };
    row.count += 1;
    row.rewardTotal += Math.max(0, Number(record.rewardAmount) || 0);
    rows.set(key, row);
  }

  return [...rows.values()].sort(compareNames);
}

/** 多次历史按名字合并；参与次数按“出现在一次已启用名单中”计算。 */
export function aggregateDrawHistories(
  histories: readonly SavedDraw[],
): DrawHistoryAggregateStat[] {
  const rows = new Map<string, DrawHistoryAggregateStat>();

  for (const draw of histories) {
    const optionNames = new Map<string, string>();
    const participated = new Set<string>();
    for (const prize of draw.prizes) {
      const name = prize.name.trim();
      if (!name) continue;
      optionNames.set(prize.id, name);
      if (!prize.enabled) continue;
      const key = nameKey(name);
      const row = rows.get(key) ?? {
        name,
        participationCount: 0,
        winCount: 0,
        rewardTotal: 0,
      };
      if (!participated.has(key)) row.participationCount += 1;
      participated.add(key);
      rows.set(key, row);
    }

    for (const record of draw.records) {
      if (record.outcome !== 'selected' && record.outcome !== 'winner') continue;
      const name = (optionNames.get(record.optionId) ?? record.label).trim();
      if (!name) continue;
      const key = nameKey(name);
      const row = rows.get(key) ?? {
        name,
        participationCount: 0,
        winCount: 0,
        rewardTotal: 0,
      };
      row.winCount += 1;
      row.rewardTotal += Math.max(0, Number(record.rewardAmount) || 0);
      rows.set(key, row);
    }
  }

  return [...rows.values()].sort(compareNames);
}

function localDateStart(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase('zh-CN');
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, 'zh-CN');
}
