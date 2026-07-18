import { describe, expect, test } from 'bun:test';
import {
  clampRequestedResults,
  isResultLimitReached,
  normalizeResultLimit,
  remainingResultSlots,
} from './draw-limit';

describe('有效结果上限', () => {
  test('0 表示不限次数', () => {
    expect(normalizeResultLimit(0, 12)).toBe(0);
    expect(remainingResultSlots(0, 12)).toBeNull();
    expect(isResultLimitReached(0, 12)).toBeFalse();
  });

  test('正数上限不能低于当前有效结果数', () => {
    expect(normalizeResultLimit(3, 5)).toBe(5);
    expect(normalizeResultLimit(8.9, 5)).toBe(8);
    expect(normalizeResultLimit(5000, 1200)).toBe(1200);
  });

  test('到达上限后不再提供有效结果名额', () => {
    expect(remainingResultSlots(8, 5)).toBe(3);
    expect(remainingResultSlots(5, 5)).toBe(0);
    expect(isResultLimitReached(5, 5)).toBeTrue();
  });

  test('批量抽奖会被剩余名额截断', () => {
    expect(clampRequestedResults(100, 8, 5)).toBe(3);
    expect(clampRequestedResults(100, 5, 5)).toBe(0);
    expect(clampRequestedResults(100, 0, 5)).toBe(100);
  });
});
