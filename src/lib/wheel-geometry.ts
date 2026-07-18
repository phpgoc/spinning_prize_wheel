export interface WeightedSegment {
  startRatio: number;
  sizeRatio: number;
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
