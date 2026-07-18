import type { ResolvedLineupName, SavedLineup } from './types';

export interface LineupEntry {
  name: string;
  sourceIndex: number;
  tierIndex: number;
  groupIndex: number;
  caimiSwap?: CaimiSwap;
}

export interface CaimiSwap {
  kind: 'favored' | 'displaced';
  partnerName: string;
  fromGroupIndex: number;
  toGroupIndex: number;
}

export interface RandomLineup {
  groupNames: string[];
  tiers: Array<Array<LineupEntry | null>>;
  peopleCount: number;
  groupCount: number;
}

export interface LineupOrderAvailability {
  input: boolean;
  rank: boolean;
}

export type RankedUserDropTarget =
  | { kind: 'insert'; index: number }
  | { kind: 'swap'; userId: number }
  | { kind: 'unranked' };

/** 把已排名卡片的上四分之一、中间、下四分之一映射为前插、替换、后插。 */
export function rankedUserDropTargetForCard(
  userId: number,
  rankIndex: number | null,
  verticalRatio: number,
): RankedUserDropTarget {
  if (rankIndex === null) return { kind: 'swap', userId };
  if (verticalRatio < 0.25) return { kind: 'insert', index: rankIndex };
  if (verticalRatio > 0.75) return { kind: 'insert', index: rankIndex + 1 };
  return { kind: 'swap', userId };
}

/** 红名只锁定数据库排名排阵；输入顺序仍可使用。 */
export function lineupOrderAvailability(
  nameCount: number,
  desktopRuntime: boolean,
  resolvingNames: boolean,
  unresolvedCount: number,
): LineupOrderAvailability {
  const input = Math.max(0, Math.floor(Number(nameCount) || 0)) >= 2
    && (!desktopRuntime || !resolvingNames);
  return {
    input,
    rank: input && (!desktopRuntime || Math.max(0, unresolvedCount) === 0),
  };
}

/** 预览项只有和当前输入逐项对应、且具备本名与排名时，才不显示红名。 */
export function isResolvedLineupName(
  inputName: string,
  person: ResolvedLineupName | null | undefined,
): person is ResolvedLineupName {
  return person?.inputName === inputName
    && person.known
    && person.canonicalName !== null
    && person.rank !== null;
}

export function unresolvedLineupNameCount(
  names: readonly string[],
  people: readonly ResolvedLineupName[],
): number {
  return names.reduce(
    (count, name, index) => count + (isResolvedLineupName(name, people[index]) ? 0 : 1),
    0,
  );
}

/** 返回每一档在预览名单中的起始下标，用于强制换行和绘制分隔线。 */
export function lineupPreviewTierStarts(peopleCount: number, groupCount: number): number[] {
  const total = Math.max(0, Math.floor(Number(peopleCount) || 0));
  const size = Math.max(2, Math.floor(Number(groupCount) || 2));
  return Array.from({ length: Math.ceil(total / size) }, (_, index) => index * size);
}

/** 在预览名单的指定位置插入一个姓名。 */
export function insertLineupPreviewName(
  names: readonly string[],
  index: number,
  value: string,
): string[] {
  const name = value.trim();
  if (!name) throw new Error('请输入要添加的姓名');

  const key = name.toLocaleLowerCase('zh-CN');
  if (names.some((current) => current.toLocaleLowerCase('zh-CN') === key)) {
    throw new Error('名单中已经有这个姓名');
  }

  const insertIndex = Math.min(names.length, Math.max(0, Math.floor(Number(index) || 0)));
  const updated = [...names];
  updated.splice(insertIndex, 0, name);
  return updated;
}

export function groupName(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let name = '';

  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return name;
}

export function orderResolvedLineupNames(people: readonly ResolvedLineupName[]): string[] {
  if (people.some((person) => !person.known || person.canonicalName === null || person.rank === null)) {
    throw new Error('排名名单中存在未识别选项');
  }

  return [...people]
    .sort((left, right) => (
      left.rank! - right.rank!
      || left.canonicalName!.localeCompare(right.canonicalName!, 'zh-CN')
    ))
    .map((person) => person.canonicalName!);
}

export function recentLineupHistories(
  histories: readonly SavedLineup[],
  startDate = '',
  endDate = '',
  limit = 5,
): SavedLineup[] {
  const startAt = dateBoundary(startDate, false);
  const endAt = dateBoundary(endDate, true);
  return [...histories]
    .filter((history) => history.createdAt >= startAt && history.createdAt <= endAt)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(0, Math.floor(limit)));
}

function dateBoundary(value: string, endOfDay: boolean): number {
  if (!value) return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, day).getTime();
}

function secureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 2 ** 32;
  }

  return Math.random();
}

function shuffledGroupIndexes(groupCount: number, random: () => number): number[] {
  const indexes = Array.from({ length: groupCount }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const sample = Math.min(0.999999999999, Math.max(0, random()));
    const target = Math.floor(sample * (index + 1));
    [indexes[index], indexes[target]] = [indexes[target], indexes[index]];
  }
  return indexes;
}

/**
 * 按输入顺序每 groupCount 项划为一档，再把同档成员随机放入不同组。
 */
export function createRandomLineup(
  names: readonly string[],
  groupCount: number,
  random: () => number = secureRandom,
): RandomLineup {
  const normalizedNames = names.map((name) => name.trim()).filter(Boolean);
  const normalizedGroupCount = Math.floor(Number(groupCount));

  if (!Number.isFinite(normalizedGroupCount) || normalizedGroupCount < 2) {
    throw new Error('组数至少为 2');
  }
  if (normalizedGroupCount > 26) {
    throw new Error('当前最多支持 26 组');
  }
  if (normalizedNames.length < normalizedGroupCount) {
    throw new Error('人数不能少于组数');
  }

  const tiers: Array<Array<LineupEntry | null>> = [];
  for (let tierIndex = 0; tierIndex * normalizedGroupCount < normalizedNames.length; tierIndex += 1) {
    const start = tierIndex * normalizedGroupCount;
    const tierNames = normalizedNames.slice(start, start + normalizedGroupCount);
    const groupIndexes = shuffledGroupIndexes(normalizedGroupCount, random);
    const row: Array<LineupEntry | null> = Array.from({ length: normalizedGroupCount }, () => null);

    tierNames.forEach((name, offset) => {
      const groupIndex = groupIndexes[offset];
      row[groupIndex] = {
        name,
        sourceIndex: start + offset,
        tierIndex,
        groupIndex,
      };
    });
    tiers.push(row);
  }

  return {
    groupNames: Array.from({ length: normalizedGroupCount }, (_, index) => groupName(index)),
    tiers,
    peopleCount: normalizedNames.length,
    groupCount: normalizedGroupCount,
  };
}

function isCaimiFavoredName(name: string): boolean {
  return name.includes('猜') || name.includes('本');
}

function caimiGroupScores(
  lineup: RandomLineup,
  rankScores: readonly number[],
): number[] {
  const scores = Array.from({ length: lineup.groupCount }, () => 0);
  for (const tier of lineup.tiers) {
    for (const entry of tier) {
      if (!entry) continue;
      const score = Number(rankScores[entry.sourceIndex]);
      scores[entry.groupIndex] += Number.isFinite(score) ? score : entry.sourceIndex + 1;
    }
  }
  return scores;
}

/** 猜蜜版把含“猜”或“本”的项换进当前总 rank 最高的最弱组，并保留正义调度标记。 */
export function applyCaimiLineupSwap(
  lineup: RandomLineup,
  rankScores: readonly number[] = [],
): RandomLineup {
  const tiers = lineup.tiers.map((tier) => tier.map((entry) => (entry ? { ...entry } : null)));
  const result: RandomLineup = { ...lineup, tiers };
  const favoredSourceIndexes = new Set(
    tiers.flat().flatMap((entry) => (
      entry && isCaimiFavoredName(entry.name) ? [entry.sourceIndex] : []
    )),
  );
  const usedPartners = new Set<number>();

  for (const sourceIndex of favoredSourceIndexes) {
    let favored: LineupEntry | null = null;
    for (const tier of tiers) {
      favored = tier.find((entry) => entry?.sourceIndex === sourceIndex) ?? null;
      if (favored) break;
    }
    if (!favored || favored.caimiSwap) continue;

    const scores = caimiGroupScores(result, rankScores);
    const weakestScore = Math.max(...scores);
    if (scores[favored.groupIndex] >= weakestScore) continue;

    const tier = tiers[favored.tierIndex];
    const targetGroupIndex = scores
      .map((score, groupIndex) => ({ score, groupIndex, entry: tier[groupIndex] }))
      .filter(({ groupIndex, entry }) => (
        groupIndex !== favored!.groupIndex
        && entry !== null
        && !favoredSourceIndexes.has(entry.sourceIndex)
        && !usedPartners.has(entry.sourceIndex)
      ))
      .sort((left, right) => right.score - left.score || left.groupIndex - right.groupIndex)[0]
      ?.groupIndex;
    if (targetGroupIndex === undefined) continue;

    const fromGroupIndex = favored.groupIndex;
    const displaced = tier[targetGroupIndex];
    if (!displaced) continue;
    tier[fromGroupIndex] = {
      ...displaced,
      groupIndex: fromGroupIndex,
      caimiSwap: {
        kind: 'displaced',
        partnerName: favored.name,
        fromGroupIndex: targetGroupIndex,
        toGroupIndex: fromGroupIndex,
      },
    };
    tier[targetGroupIndex] = {
      ...favored,
      groupIndex: targetGroupIndex,
      caimiSwap: {
        kind: 'favored',
        partnerName: displaced.name,
        fromGroupIndex,
        toGroupIndex: targetGroupIndex,
      },
    };
    usedPartners.add(displaced.sourceIndex);
  }

  return result;
}
