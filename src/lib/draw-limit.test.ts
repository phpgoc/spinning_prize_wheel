import { describe, expect, test } from 'bun:test';
import {
  areCandidateChangesLocked,
  isResultLimitReached,
  isRewardAmountLocked,
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

  test('有上限且已开始后锁定候选项，零上限仍可修改', () => {
    expect(areCandidateChangesLocked(3, 0, false)).toBeFalse();
    expect(areCandidateChangesLocked(3, 1, false)).toBeTrue();
    expect(areCandidateChangesLocked(0, 10, false)).toBeFalse();
    expect(areCandidateChangesLocked(0, 0, true)).toBeTrue();
  });

  test('奖励金额只在桌面端产生记录后锁定', () => {
    expect(isRewardAmountLocked(true, 0, false)).toBeFalse();
    expect(isRewardAmountLocked(true, 1, false)).toBeTrue();
    expect(isRewardAmountLocked(false, 10, false)).toBeFalse();
    expect(isRewardAmountLocked(false, 0, true)).toBeTrue();
  });
});
