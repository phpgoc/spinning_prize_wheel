import type {
  BatchSimulation,
  DrawMode,
  Prize,
  SimulationEvent,
  WheelOption,
} from './types';

export const RETRY_ID = '__retry__';

export function secureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 2 ** 32;
  }

  return Math.random();
}

export function buildWheelOptions(
  prizes: Prize[],
  retryEnabled: boolean,
  retryWeight: number,
  excludedIds: ReadonlySet<string> = new Set(),
): WheelOption[] {
  const options = prizes
    .filter((prize) => prize.enabled && !excludedIds.has(prize.id))
    .map((prize) => ({
      id: prize.id,
      label: prize.name.trim() || '未命名奖项',
      weight: Math.max(0.01, Number(prize.weight) || 0.01),
      color: prize.color,
      isRetry: false,
    }));

  if (retryEnabled) {
    options.push({
      id: RETRY_ID,
      label: '重来一次',
      weight: Math.max(0.01, Number(retryWeight) || 0.01),
      color: '#f2eee5',
      isRetry: true,
    });
  }

  return options;
}

export function pickWeighted<T extends { weight: number }>(
  options: readonly T[],
  random: () => number = secureRandom,
): T {
  if (options.length === 0) {
    throw new Error('至少需要一个可抽取的奖项');
  }

  const totalWeight = options.reduce(
    (total, option) => total + Math.max(0, Number(option.weight) || 0),
    0,
  );

  if (totalWeight <= 0) {
    return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  }

  let cursor = Math.min(0.999999999999, Math.max(0, random())) * totalWeight;
  for (const option of options) {
    cursor -= Math.max(0, Number(option.weight) || 0);
    if (cursor < 0) return option;
  }

  return options[options.length - 1];
}

function emptyCounts(prizes: Prize[]): Record<string, number> {
  return Object.fromEntries(prizes.map((prize) => [prize.id, 0]));
}

export function simulateSelectedBatch(
  prizes: Prize[],
  requested: number,
  retryEnabled: boolean,
  retryWeight: number,
  random: () => number = secureRandom,
): BatchSimulation {
  const target = Math.max(1, Math.floor(requested));
  const options = buildWheelOptions(prizes, retryEnabled, retryWeight);
  if (!options.some((option) => !option.isRetry)) {
    throw new Error('至少需要一个启用的奖项，重来不能是唯一选项');
  }
  const prizeCounts = emptyCounts(prizes);
  const events: SimulationEvent[] = [];
  let completed = 0;
  let attempts = 0;
  let retryCount = 0;

  while (completed < target) {
    attempts += 1;
    const picked = pickWeighted(options, random);

    if (picked.isRetry) {
      retryCount += 1;
      events.push({
        round: completed + 1,
        attempt: attempts,
        optionId: RETRY_ID,
        label: picked.label,
        outcome: 'retry',
        detail: `第 ${completed + 1} 次有效抽取触发重来`,
      });
      continue;
    }

    completed += 1;
    prizeCounts[picked.id] = (prizeCounts[picked.id] ?? 0) + 1;
    events.push({
      round: completed,
      attempt: attempts,
      optionId: picked.id,
      label: picked.label,
      outcome: 'selected',
      detail: `第 ${completed} 次抽取命中 ${picked.label}`,
    });
  }

  return {
    mode: 'selected',
    requested: target,
    completed,
    attempts,
    retryCount,
    prizeCounts,
    events,
  };
}

export function simulateRouletteBatch(
  prizes: Prize[],
  requested: number,
  retryEnabled: boolean,
  retryWeight: number,
  random: () => number = secureRandom,
): BatchSimulation {
  const enabledPrizes = prizes.filter((prize) => prize.enabled);
  if (enabledPrizes.length < 2) {
    throw new Error('俄罗斯轮盘至少需要两个启用的奖项');
  }

  const target = Math.max(1, Math.floor(requested));
  const prizeCounts = emptyCounts(prizes);
  const events: SimulationEvent[] = [];
  let attempts = 0;
  let retryCount = 0;

  for (let round = 1; round <= target; round += 1) {
    let active = [...enabledPrizes];

    while (active.length > 1) {
      const options = buildWheelOptions(active, retryEnabled, retryWeight);
      const picked = pickWeighted(options, random);
      attempts += 1;

      if (picked.isRetry) {
        retryCount += 1;
        events.push({
          round,
          attempt: attempts,
          optionId: RETRY_ID,
          label: picked.label,
          outcome: 'retry',
          detail: `第 ${round} 局触发重来，仍有 ${active.length} 项留在轮盘`,
        });
        continue;
      }

      const eliminated = active.find((prize) => prize.id === picked.id)!;
      active = active.filter((prize) => prize.id !== picked.id);

      if (active.length === 1) {
        const winner = active[0];
        prizeCounts[winner.id] = (prizeCounts[winner.id] ?? 0) + 1;
        events.push({
          round,
          attempt: attempts,
          optionId: winner.id,
          label: winner.name,
          outcome: 'winner',
          detail: `${eliminated.name} 淘汰，${winner.name} 成为第 ${round} 局赢家`,
        });
      } else {
        events.push({
          round,
          attempt: attempts,
          optionId: eliminated.id,
          label: eliminated.name,
          outcome: 'eliminated',
          detail: `${eliminated.name} 淘汰，剩余 ${active.length} 项`,
        });
      }
    }
  }

  return {
    mode: 'roulette',
    requested: target,
    completed: target,
    attempts,
    retryCount,
    prizeCounts,
    events,
  };
}

export function simulateBatch(
  mode: DrawMode,
  prizes: Prize[],
  requested: number,
  retryEnabled: boolean,
  retryWeight: number,
  random: () => number = secureRandom,
): BatchSimulation {
  return mode === 'selected'
    ? simulateSelectedBatch(prizes, requested, retryEnabled, retryWeight, random)
    : simulateRouletteBatch(prizes, requested, retryEnabled, retryWeight, random);
}
