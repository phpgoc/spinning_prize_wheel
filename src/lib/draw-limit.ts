export const MAX_RESULT_LIMIT = 1000;

function normalizedCompleted(completed: number): number {
  return Math.max(0, Math.floor(Number(completed) || 0));
}

/**
 * 0 表示不限次数；正数不能低于当前已有的有效结果数。
 */
export function normalizeResultLimit(value: unknown, completed: number): number {
  const completedCount = normalizedCompleted(completed);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return completedCount;

  const limit = Math.floor(numericValue);
  if (limit <= 0) return 0;
  return Math.max(completedCount, Math.min(MAX_RESULT_LIMIT, limit));
}

/**
 * 返回还能生成的有效结果数；null 表示没有上限。
 */
export function remainingResultSlots(limit: number, completed: number): number | null {
  const normalizedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (normalizedLimit === 0) return null;
  return Math.max(0, normalizedLimit - normalizedCompleted(completed));
}

export function isResultLimitReached(limit: number, completed: number): boolean {
  return remainingResultSlots(limit, completed) === 0;
}

/**
 * 有明确上限的抽奖一旦产生记录，就锁定候选项，避免中途改变概率。
 */
export function areCandidateChangesLocked(
  limit: number,
  recordCount: number,
  isSpinning: boolean,
): boolean {
  return isSpinning || (
    Math.floor(Number(limit) || 0) > 0
    && Math.max(0, Math.floor(Number(recordCount) || 0)) > 0
  );
}

/**
 * 桌面端需要把奖励金额作为本轮统计的一部分，首条记录产生后不再允许修改。
 */
export function isRewardAmountLocked(
  desktopRuntime: boolean,
  recordCount: number,
  isSpinning: boolean,
): boolean {
  return isSpinning || (
    desktopRuntime
    && Math.max(0, Math.floor(Number(recordCount) || 0)) > 0
  );
}

/**
 * 批量抽奖也不能越过有效结果上限。
 */
export function clampRequestedResults(
  requested: number,
  limit: number,
  completed: number,
): number {
  const safeRequested = Math.min(
    MAX_RESULT_LIMIT,
    Math.max(1, Math.floor(Number(requested) || 1)),
  );
  const remaining = remainingResultSlots(limit, completed);
  return remaining === null ? safeRequested : Math.min(safeRequested, remaining);
}
