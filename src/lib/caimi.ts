import type { Prize } from './types';

/** 猜蜜版里，名称每出现一个“猜”或“本”，选中概率再翻一倍。 */
export function caimiNameWeightMultiplier(name: string): number {
  const markedCharacterCount = Array.from(name)
    .filter((character) => character === '猜' || character === '本')
    .length;
  return 2 ** markedCharacterCount;
}

/** 只生成抽取时使用的副本，不改动候选区和转盘上展示的权重。 */
export function applyCaimiSelectedWeights(prizes: readonly Prize[]): Prize[] {
  return prizes.map((prize) => ({
    ...prize,
    weight: prize.weight * caimiNameWeightMultiplier(prize.name),
  }));
}
