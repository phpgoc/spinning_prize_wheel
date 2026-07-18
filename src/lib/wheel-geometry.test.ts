import { describe, expect, test } from 'bun:test';
import type { WheelOption } from './types';
import {
  createRouletteWheelSlots,
  createWeightedSegments,
  pickWheelSegmentIndex,
} from './wheel-geometry';

function option(id: string, weight: number, isRetry = false): WheelOption {
  return {
    id,
    label: id,
    weight,
    color: '#000000',
    isRetry,
  };
}

describe('转盘权重几何', () => {
  test('扇区面积与权重比例一致', () => {
    const segments = createWeightedSegments([{ weight: 5 }, { weight: 2 }, { weight: 1 }]);

    expect(segments[0]).toEqual({ startRatio: 0, sizeRatio: 5 / 8 });
    expect(segments[1]).toEqual({ startRatio: 5 / 8, sizeRatio: 2 / 8 });
    expect(segments[2]).toEqual({ startRatio: 7 / 8, sizeRatio: 1 / 8 });
  });

  test('无效权重仍保留最小可见扇区', () => {
    const segments = createWeightedSegments([
      { weight: 0 },
      { weight: Number.NaN },
      { weight: Number.POSITIVE_INFINITY },
    ]);

    for (const segment of segments) {
      expect(segment.sizeRatio).toBeCloseTo(1 / 3);
    }
  });

  test('单个候选项占满整个圆盘', () => {
    expect(createWeightedSegments([{ weight: 8 }])).toEqual([
      { startRatio: 0, sizeRatio: 1 },
    ]);
  });

  test('俄罗斯轮盘把多条命拆开并避免环形相邻', () => {
    const slots = createRouletteWheelSlots([
      option('a', 5),
      option('b', 1),
      option('c', 1),
      option('d', 1),
      option('e', 1),
      option('f', 1),
      option('retry', 0.65, true),
    ]);

    expect(slots.filter((slot) => slot.id === 'a')).toHaveLength(5);
    expect(new Set(slots.map((slot) => slot.slotId)).size).toBe(slots.length);
    for (let index = 0; index < slots.length; index += 1) {
      expect(slots[index].id).not.toBe(slots[(index + 1) % slots.length].id);
    }
  });

  test('拆分前后的扇区总权重保持一致', () => {
    const options = [option('a', 5.5), option('b', 2), option('retry', 0.65, true)];
    const slots = createRouletteWheelSlots(options);

    expect(slots.reduce((sum, slot) => sum + slot.weight, 0)).toBeCloseTo(8.15);
    expect(slots.filter((slot) => slot.id === 'a')).toHaveLength(6);
    expect(slots.filter((slot) => slot.id === 'retry')).toHaveLength(1);
  });

  test('极大权重限制扇区总量以避免页面卡死', () => {
    const slots = createRouletteWheelSlots([option('a', 10_000), option('b', 1)]);

    expect(slots).toHaveLength(180);
    expect(slots.reduce((sum, slot) => sum + slot.weight, 0)).toBeCloseTo(10_001);
  });

  test('从同一候选项的多个扇区中选择实际落点', () => {
    const slots = createRouletteWheelSlots([option('a', 3), option('b', 2)]);
    const aIndexes = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.id === 'a')
      .map(({ index }) => index);

    expect(pickWheelSegmentIndex(slots, 'a', () => 0)).toBe(aIndexes[0]);
    expect(pickWheelSegmentIndex(slots, 'a', () => 0.999)).toBe(
      aIndexes[aIndexes.length - 1],
    );
    expect(pickWheelSegmentIndex(slots, 'missing', () => 0.5)).toBe(-1);
  });
});
