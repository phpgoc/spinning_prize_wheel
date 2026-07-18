import { describe, expect, test } from 'bun:test';
import { createWeightedSegments } from './wheel-geometry';

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
});
