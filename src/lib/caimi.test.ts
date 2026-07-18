import { describe, expect, test } from 'bun:test';
import { applyCaimiSelectedWeights, caimiNameWeightMultiplier } from './caimi';
import { buildWheelOptions, pickWeighted } from './draw';

describe('猜蜜版隐藏权重', () => {
  test('每个猜或本都会让概率翻倍', () => {
    expect(caimiNameWeightMultiplier('普通名称')).toBe(1);
    expect(caimiNameWeightMultiplier('猜猜猜本')).toBe(16);

    const [prize] = applyCaimiSelectedWeights([
      { id: 'a', name: '猜猜猜本', weight: 5, color: '#000', enabled: true },
    ]);
    expect(prize.weight).toBe(80);
  });

  test('真实加权抽取使用隐藏倍率而不是展示权重', () => {
    const visible = [
      { id: 'normal', name: '普通项', weight: 5, color: '#000', enabled: true },
      { id: 'caimi', name: '猜猜猜本', weight: 5, color: '#fff', enabled: true },
    ];
    const visibleOptions = buildWheelOptions(visible, false, 1);
    const hiddenOptions = buildWheelOptions(applyCaimiSelectedWeights(visible), false, 1);

    expect(visibleOptions.map((option) => option.weight)).toEqual([5, 5]);
    expect(hiddenOptions.map((option) => option.weight)).toEqual([5, 80]);
    expect(pickWeighted(visibleOptions, () => 0.4).id).toBe('normal');
    expect(pickWeighted(hiddenOptions, () => 0.4).id).toBe('caimi');
  });
});
