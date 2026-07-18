import type { WheelOption } from './types';

export interface WeightedSegment {
  startRatio: number;
  sizeRatio: number;
}

const MAX_ROULETTE_SEGMENTS = 180;

interface RouletteEntry {
  option: WheelOption;
  count: number;
  remaining: number;
  emitted: number;
}

export function createWeightedSegments<T extends { weight: number }>(
  options: readonly T[],
): WeightedSegment[] {
  const weights = options.map((option) => {
    const weight = Number(option.weight);
    return Number.isFinite(weight) ? Math.max(0.01, weight) : 0.01;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumedWeight = 0;

  return weights.map((weight) => {
    const segment = {
      startRatio: consumedWeight / totalWeight,
      sizeRatio: weight / totalWeight,
    };
    consumedWeight += weight;
    return segment;
  });
}

function rouletteSlotCounts(options: readonly WheelOption[]): number[] {
  const requested = options.map((option) => (
    option.isRetry ? 1 : Math.max(1, Math.round(Number(option.weight) || 1))
  ));
  const requestedTotal = requested.reduce((sum, count) => sum + count, 0);
  if (requestedTotal <= MAX_ROULETTE_SEGMENTS) return requested;

  const retryCount = options.filter((option) => option.isRetry).length;
  const regularOptions = options.filter((option) => !option.isRetry);
  const regularBudget = Math.max(
    regularOptions.length,
    MAX_ROULETTE_SEGMENTS - retryCount,
  );
  const totalWeight = regularOptions.reduce(
    (sum, option) => sum + Math.max(0.01, Number(option.weight) || 0.01),
    0,
  );
  const rawCounts = regularOptions.map(
    (option) => (Math.max(0.01, Number(option.weight) || 0.01) / totalWeight) * regularBudget,
  );
  const regularCounts = rawCounts.map((count) => Math.max(1, Math.floor(count)));
  let assigned = regularCounts.reduce((sum, count) => sum + count, 0);

  while (assigned < regularBudget) {
    let bestIndex = 0;
    for (let index = 1; index < regularCounts.length; index += 1) {
      const bestDeficit = rawCounts[bestIndex] - regularCounts[bestIndex];
      const deficit = rawCounts[index] - regularCounts[index];
      if (deficit > bestDeficit) bestIndex = index;
    }
    regularCounts[bestIndex] += 1;
    assigned += 1;
  }

  while (assigned > regularBudget) {
    let bestIndex = -1;
    for (let index = 0; index < regularCounts.length; index += 1) {
      if (regularCounts[index] <= 1) continue;
      if (
        bestIndex < 0
        || rawCounts[index] - regularCounts[index]
          < rawCounts[bestIndex] - regularCounts[bestIndex]
      ) {
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    regularCounts[bestIndex] -= 1;
    assigned -= 1;
  }

  let regularIndex = 0;
  return options.map((option) => {
    if (option.isRetry) return 1;
    const count = regularCounts[regularIndex];
    regularIndex += 1;
    return count;
  });
}

/**
 * 把俄罗斯轮盘中的权重拆成独立生命扇区，并按环形顺序尽量避免同项相邻。
 * 每个拆分扇区保留对应比例，拆分前后的总面积与抽中概率一致。
 */
export function createRouletteWheelSlots(
  options: readonly WheelOption[],
): WheelOption[] {
  if (options.length === 0) return [];

  const counts = rouletteSlotCounts(options);
  let queue: RouletteEntry[] = options.map((option, index) => ({
    option,
    count: counts[index],
    remaining: counts[index],
    emitted: 0,
  }));
  const totalSlots = counts.reduce((sum, count) => sum + count, 0);
  const result: WheelOption[] = [];

  for (let position = 0; position < totalSlots; position += 1) {
    queue.sort((left, right) => right.remaining - left.remaining);
    const previousId = result.at(-1)?.id;
    const firstId = result[0]?.id;
    const isLast = position === totalSlots - 1;

    let selectedIndex = queue.findIndex((entry) => (
      entry.remaining > 0
      && entry.option.id !== previousId
      && (!isLast || entry.option.id !== firstId)
    ));
    if (selectedIndex < 0) {
      selectedIndex = queue.findIndex((entry) => (
        entry.remaining > 0 && entry.option.id !== previousId
      ));
    }
    if (selectedIndex < 0) {
      selectedIndex = queue.findIndex((entry) => entry.remaining > 0);
    }
    if (selectedIndex < 0) break;

    const entry = queue[selectedIndex];
    result.push({
      ...entry.option,
      slotId: `${entry.option.id}::roulette-slot-${entry.emitted}`,
      weight: Math.max(0.01, Number(entry.option.weight) || 0.01) / entry.count,
    });
    entry.remaining -= 1;
    entry.emitted += 1;
    queue = queue.filter((candidate) => candidate.remaining > 0);
  }

  return result;
}

/** 从同一候选项的多个生命扇区中随机选择一个实际落点。 */
export function pickWheelSegmentIndex(
  options: readonly Pick<WheelOption, 'id'>[],
  optionId: string,
  random: () => number = Math.random,
): number {
  const matchingIndexes = options.reduce<number[]>((indexes, option, index) => {
    if (option.id === optionId) indexes.push(index);
    return indexes;
  }, []);
  if (matchingIndexes.length === 0) return -1;

  const randomValue = Math.min(0.999999999999, Math.max(0, Number(random()) || 0));
  return matchingIndexes[Math.floor(randomValue * matchingIndexes.length)];
}
