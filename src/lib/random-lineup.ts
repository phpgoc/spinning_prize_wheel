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

export interface LineupRankingSnapshotEntry {
  inputName: string;
  name: string;
  rank: number;
}

export type RankedUserDropTarget =
  | { kind: 'insert'; index: number }
  | { kind: 'swap'; userId: number }
  | { kind: 'unranked' };

export interface RankedUserKeyboardDropPoint {
  target: RankedUserDropTarget;
  cardId: number | null;
  position: 'before' | 'swap' | 'after' | 'unranked';
}

/** 排名右侧操作在同一行，左右键只在线性操作行与整条之间移动。 */
export function nextRankedUserActionIndex(
  currentIndex: number,
  direction: 'left' | 'right',
  actionCount: number,
): number {
  const lastIndex = Math.max(-1, Math.floor(actionCount) - 1);
  return direction === 'left'
    ? Math.max(-1, currentIndex - 1)
    : Math.min(lastIndex, currentIndex + 1);
}

/** 已排名源项保留中间替换区；无排名源项把卡片上下半区都作为插入区。 */
export function rankedUserDropTargetForCard(
  userId: number,
  rankIndex: number | null,
  verticalRatio: number,
  allowSwap = true,
): RankedUserDropTarget {
  if (rankIndex === null) return { kind: 'unranked' };
  if (!allowSwap) {
    return verticalRatio < 0.5
      ? { kind: 'insert', index: rankIndex }
      : { kind: 'insert', index: rankIndex + 1 };
  }
  if (verticalRatio < 0.25) return { kind: 'insert', index: rankIndex };
  if (verticalRatio > 0.75) return { kind: 'insert', index: rankIndex + 1 };
  return { kind: 'swap', userId };
}

/** 无排名源项只经过插入落点，已排名源项仍可经过替换落点。 */
export function rankedUserKeyboardDropPoints(
  rankedIds: readonly number[],
  _unrankedIds: readonly number[],
  allowSwap = true,
): RankedUserKeyboardDropPoint[] {
  // 无排名只保留一个落点，并放在首尾循环的交界处。
  const points: RankedUserKeyboardDropPoint[] = [
    { target: { kind: 'unranked' }, cardId: null, position: 'unranked' },
  ];
  rankedIds.forEach((userId, index) => {
    points.push({ target: { kind: 'insert', index }, cardId: userId, position: 'before' });
    if (allowSwap) {
      points.push({ target: { kind: 'swap', userId }, cardId: userId, position: 'swap' });
    }
  });
  points.push({
    target: { kind: 'insert', index: rankedIds.length },
    cardId: rankedIds.at(-1) ?? null,
    position: rankedIds.length > 0 ? 'after' : 'before',
  });
  return points;
}

/** 红名只锁定数据库排名排阵；输入顺序仍可使用。 */
export function lineupOrderAvailability(
  nameCount: number,
  desktopRuntime: boolean,
  resolvingNames: boolean,
  unresolvedCount: number,
  allowedUnresolvedCount = 0,
): LineupOrderAvailability {
  const input = Math.max(0, Math.floor(Number(nameCount) || 0)) >= 2
    && (!desktopRuntime || !resolvingNames);
  const unresolved = Math.max(0, Math.floor(Number(unresolvedCount) || 0));
  const allowedUnresolved = Math.max(0, Math.floor(Number(allowedUnresolvedCount) || 0));
  return {
    input,
    rank: input && (!desktopRuntime || unresolved <= allowedUnresolved),
  };
}

/** 最后一档按实际人数计算；整除时最后一档人数等于组数。 */
export function lineupLastTierSize(peopleCount: number, groupCount: number): number {
  const rawTotal = Number(peopleCount);
  const rawGroupCount = Number(groupCount);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.floor(rawTotal)) : 0;
  const groups = Number.isFinite(rawGroupCount) ? Math.max(2, Math.floor(rawGroupCount)) : 2;
  return total === 0 ? 0 : ((total - 1) % groups) + 1;
}

function hasLineupRank(
  person: ResolvedLineupName | null | undefined,
): person is ResolvedLineupName & { canonicalName: string; rank: number } {
  return Boolean(
    person?.known
    && person.canonicalName !== null
    && person.rank !== null
    && person.rank < 10_000,
  );
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

/** 分组按排名时，未录入、未关联和数据库中的未排名项都计入最后一档。 */
export function unrankedLineupNameCount(
  names: readonly string[],
  people: readonly ResolvedLineupName[],
): number {
  return names.reduce((count, name, index) => {
    const person = people[index];
    return count + (person?.inputName === name && hasLineupRank(person) ? 0 : 1);
  }, 0);
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

/** 文本导入按首次出现保留名称，大小写不同也视为重复。 */
export function uniqueLineupNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.trim().toLocaleLowerCase('zh-CN');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 同一排名项即使使用多个别名也只保留首次出现的预览名称。 */
export function uniqueResolvedLineupPeople(
  people: readonly ResolvedLineupName[],
): ResolvedLineupName[] {
  const seenUsers = new Set<number>();
  const seenUnknownNames = new Set<string>();
  return people.filter((person) => {
    if (person.known && person.userId !== null) {
      if (seenUsers.has(person.userId)) return false;
      seenUsers.add(person.userId);
      return true;
    }
    const key = person.inputName.trim().toLocaleLowerCase('zh-CN');
    if (!key || seenUnknownNames.has(key)) return false;
    seenUnknownNames.add(key);
    return true;
  });
}

/** 关联排名时只接受连续数字，退格逐位撤销。 */
export function updateRankShortcutInput(current: string, key: string): string {
  if (key === 'Backspace') return current.slice(0, -1);
  if (!/^\d$/u.test(key) || current.length >= 5) return current;
  return `${current}${key}`;
}

/** 仅精确匹配有排名项；10000 代表无排名，不能作为数字跳转目标。 */
export function rankedUserIdAtShortcut(
  users: readonly { id: number; rank: number }[],
  input: string,
): number | null {
  if (!/^[1-9]\d{0,3}$/u.test(input)) return null;
  const rank = Number(input);
  return users.find((user) => user.rank === rank && user.rank < 10_000)?.id ?? null;
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

  return uniqueResolvedLineupPeople(people)
    .sort((left, right) => (
      left.rank! - right.rank!
      || left.canonicalName!.localeCompare(right.canonicalName!, 'zh-CN')
    ))
    .map((person) => person.inputName);
}

/** 分组时已排名项在前面按排名排序，未排名项按原输入顺序进入最后一档。 */
export function orderPartiallyResolvedLineupNames(
  people: readonly ResolvedLineupName[],
): string[] {
  const uniquePeople = uniqueResolvedLineupPeople(people);
  const ranked = uniquePeople
    .filter(hasLineupRank)
    .sort((left, right) => (
      left.rank - right.rank
      || left.canonicalName.localeCompare(right.canonicalName, 'zh-CN')
    ));
  const unranked = uniquePeople.filter((person) => !hasLineupRank(person));
  return [...ranked, ...unranked].map((person) => person.inputName);
}

/** 对战固定前 N 时只要求 N 个参赛者已有有效排名，其余参赛者继续保留名单顺序。 */
export function rankedBattleLineupNameCount(
  names: readonly string[],
  people: readonly ResolvedLineupName[],
): number {
  return rankedBattleLineupEntries(names, people).length;
}

export function orderBattleNamesByFixedRank(
  names: readonly string[],
  people: readonly ResolvedLineupName[],
  fixedCount: number,
): string[] {
  const required = Math.max(0, Math.floor(Number(fixedCount) || 0));
  const rankedEntries = rankedBattleLineupEntries(names, people);
  if (rankedEntries.length < required) {
    throw new Error(`固定前 ${required} 名，现 ${rankedEntries.length} 个排名`);
  }
  const fixedEntries = rankedEntries
    .sort((left, right) => (
      left.person.rank! - right.person.rank!
      || left.person.canonicalName!.localeCompare(right.person.canonicalName!, 'zh-CN')
      || left.index - right.index
    ))
    .slice(0, required);
  const fixedIndexes = new Set(fixedEntries.map((entry) => entry.index));
  return [
    ...fixedEntries.map((entry) => entry.name),
    ...names.filter((_, index) => !fixedIndexes.has(index)),
  ];
}

function rankedBattleLineupEntries(
  names: readonly string[],
  people: readonly ResolvedLineupName[],
): Array<{ index: number; name: string; person: ResolvedLineupName }> {
  const peopleByInputName = new Map(
    people.map((person) => [person.inputName.toLocaleLowerCase('zh-CN'), person] as const),
  );
  const seenUserIds = new Set<number>();
  return names.flatMap((name, index) => {
    const person = peopleByInputName.get(name.toLocaleLowerCase('zh-CN'));
    if (
      !person?.known
      || person.userId === null
      || person.canonicalName === null
      || person.rank === null
      || person.rank >= 10_000
      || seenUserIds.has(person.userId)
    ) return [];
    seenUserIds.add(person.userId);
    return [{ index, name, person }];
  });
}

/** 保存排名分组当时使用的本名和排名，只作为历史 JSON 元数据。 */
export function createLineupRankingSnapshot(
  orderedNames: readonly string[],
  people: readonly ResolvedLineupName[],
  skipUnranked = false,
): LineupRankingSnapshotEntry[] {
  const byInputName = new Map(
    people.map((person) => [person.inputName.toLocaleLowerCase('zh-CN'), person] as const),
  );
  const snapshot: LineupRankingSnapshotEntry[] = [];
  orderedNames.forEach((inputName) => {
    const person = byInputName.get(inputName.toLocaleLowerCase('zh-CN'));
    if (!person?.known || person.canonicalName === null || person.rank === null) {
      if (skipUnranked) return;
      throw new Error(`无法记录“${inputName}”的排名快照`);
    }
    if (skipUnranked && !hasLineupRank(person)) return;
    snapshot.push({ inputName, name: person.canonicalName, rank: person.rank });
  });
  return snapshot;
}

export function recentLineupHistories(
  histories: readonly SavedLineup[],
  startDate = '',
  endDate = '',
  limit = 5,
): SavedLineup[] {
  const startAt = dateBoundary(startDate) ?? Number.NEGATIVE_INFINITY;
  const endAt = dateBoundary(endDate) ?? Number.POSITIVE_INFINITY;
  return [...histories]
    .filter((history) => history.createdAt >= startAt && history.createdAt < endAt)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(0, Math.floor(limit)));
}

function dateBoundary(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
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
  return name.includes('猜') || name.includes('本') || /cai/iu.test(name);
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

/** 猜蜜版把含“猜”“本”或 cai 的项换进当前总 rank 最高的最弱组，并保留正义调度标记。 */
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
