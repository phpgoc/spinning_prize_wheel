import { describe, expect, test } from 'bun:test';
import {
  applyCaimiSelectedWeights,
  caimiNameWeightMultiplier,
  caimiRouletteWeight,
} from './caimi';
import { buildWheelOptions, pickWeighted, simulateBatch, simulateRouletteBatch } from './draw';

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

  test('选中模式把隐藏权重和重来放进同一个总权重池', () => {
    const prizes = [
      { id: 'caimi', name: '猜猜猜猜', weight: 1, color: '#fff', enabled: true },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `normal-${index}`,
        name: `普通项 ${index}`,
        weight: 1,
        color: '#000',
        enabled: true,
      })),
    ];
    const options = buildWheelOptions(applyCaimiSelectedWeights(prizes), true, 0.7);
    const totalWeight = options.reduce((total, option) => total + option.weight, 0);

    expect(totalWeight).toBeCloseTo(22.7);
    expect(options.find((option) => option.id === 'caimi')!.weight / totalWeight).toBeCloseTo(16 / 22.7);
    expect(options.find((option) => option.id === 'normal-0')!.weight / totalWeight).toBeCloseTo(1 / 22.7);
    expect(options.find((option) => option.isRetry)!.weight / totalWeight).toBeCloseTo(0.7 / 22.7);
  });

  test('批量实验室使用猜蜜隐藏权重', () => {
    const prizes = applyCaimiSelectedWeights([
      { id: 'normal', name: '普通项', weight: 1, color: '#000', enabled: true },
      { id: 'caimi', name: '猜猜猜本', weight: 1, color: '#fff', enabled: true },
    ]);
    const simulation = simulateBatch('selected', prizes, 3, false, 1, () => 0.5);

    expect(simulation.prizeCounts).toEqual({ normal: 0, caimi: 3 });
  });

  test('俄罗斯轮盘按名字隐藏降低被命中概率', () => {
    expect(caimiRouletteWeight('猜猜猜本', 16)).toBe(1);

    const prizes = [
      { id: 'normal', name: '普通项', weight: 1, color: '#000', enabled: true },
      { id: 'caimi', name: '猜本', weight: 1, color: '#fff', enabled: true },
    ];
    const normal = simulateRouletteBatch(prizes, 1, false, 1, () => 0.6);
    const hidden = simulateRouletteBatch(
      prizes,
      1,
      false,
      1,
      () => 0.6,
      (prize) => caimiRouletteWeight(prize.name, prize.weight),
    );

    expect(normal.prizeCounts).toEqual({ normal: 1, caimi: 0 });
    expect(hidden.prizeCounts).toEqual({ normal: 0, caimi: 1 });
  });
});
