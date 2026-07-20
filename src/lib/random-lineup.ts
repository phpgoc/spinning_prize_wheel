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

/** 排名卡片上、下四分之一用于插入，中间二分之一用于替换。 */
export function rankedUserDropTargetForCard(
  userId: number,
  rankIndex: number | null,
  verticalRatio: number,
): RankedUserDropTarget {
  if (rankIndex === null) return { kind: 'unranked' };
  if (verticalRatio < 0.25) return { kind: 'insert', index: rankIndex };
  if (verticalRatio > 0.75) return { kind: 'insert', index: rankIndex + 1 };
  return { kind: 'swap', userId };
}

/** 键盘排序依次经过无排名、每一项前插、替换和排名末尾。 */
export function rankedUserKeyboardDropPoints(
  rankedIds: readonly number[],
  _unrankedIds: readonly number[],
): RankedUserKeyboardDropPoint[] {
  // 无排名只保留一个落点，并放在首尾循环的交界处。
  const points: RankedUserKeyboardDropPoint[] = [
    { target: { kind: 'unranked' }, cardId: null, position: 'unranked' },
  ];
  rankedIds.forEach((userId, index) => {
    points.push({ target: { kind: 'insert', index }, cardId: userId, position: 'before' });
    points.push({ target: { kind: 'swap', userId }, cardId: userId, position: 'swap' });
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

/** 把预览项移动到指定插入点，其余项目保持顺序并向后补位。 */
export function moveLineupPreviewName(
  names: readonly string[],
  sourceIndex: number,
  insertIndex: number,
): string[] {
  const source = Math.floor(Number(sourceIndex));
  const target = Math.min(names.length, Math.max(0, Math.floor(Number(insertIndex))));
  if (!Number.isInteger(source) || source < 0 || source >= names.length) {
    throw new Error('找不到要移动的名单项');
  }

  const updated = [...names];
  const [moved] = updated.splice(source, 1);
  const adjustedTarget = source < target ? target - 1 : target;
  updated.splice(adjustedTarget, 0, moved);
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
