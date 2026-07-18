import { describe, expect, test } from 'bun:test';
import { applyCaimiSelectedWeights, caimiNameWeightMultiplier } from './caimi';

describe('猜蜜版隐藏权重', () => {
  test('每个猜或本都会让概率翻倍', () => {
    expect(caimiNameWeightMultiplier('普通名称')).toBe(1);
    expect(caimiNameWeightMultiplier('猜猜猜本')).toBe(16);

    const [prize] = applyCaimiSelectedWeights([
      { id: 'a', name: '猜猜猜本', weight: 5, color: '#000', enabled: true },
    ]);
    expect(prize.weight).toBe(80);
  });
});
