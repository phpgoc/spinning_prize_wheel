import type { Prize } from './types';

/** 猜蜜版统一识别“猜”“本”或 cai（不区分大小写）特权标记。 */
export function isCaimiFavoredName(name: string): boolean {
  return name.includes('猜') || name.includes('本') || /cai/iu.test(name);
}

/** 猜蜜版里，名称每出现一个“猜”“本”或 cai（不区分大小写），选中概率再翻一倍。 */
export function caimiNameWeightMultiplier(name: string): number {
  const markedCharacterCount = Array.from(name)
    .filter((character) => character === '猜' || character === '本')
    .length;
  const caiCount = (name.match(/cai/giu) ?? []).length;
  return 2 ** (markedCharacterCount + caiCount);
}

/** 猜蜜版俄罗斯轮盘中，每个特权字都会让被命中的概率减半。 */
export function caimiRouletteWeight(name: string, visibleWeight: number): number {
  return visibleWeight / caimiNameWeightMultiplier(name);
}

/** 只生成抽取时使用的副本，不改动候选区和转盘上展示的权重。 */
export function applyCaimiSelectedWeights(prizes: readonly Prize[]): Prize[] {
  return prizes.map((prize) => ({
    ...prize,
    weight: prize.weight * caimiNameWeightMultiplier(prize.name),
  }));
}
