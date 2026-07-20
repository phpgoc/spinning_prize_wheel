export const DEFAULT_FONT_SCALE = 1;
export const MIN_FONT_SCALE = 1;
export const MAX_FONT_SCALE = 3;
export const DEFAULT_STAY_SECONDS = 3;
export const MIN_STAY_SECONDS = 0.5;
export const MAX_STAY_SECONDS = 30;

/** 把持久化或输入的字号倍率限制在界面支持范围内。 */
export function normalizeFontScale(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SCALE;
  const clamped = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, parsed));
  return Math.round(clamped * 10) / 10;
}

/** 只接受有限正数；编辑中的空值或非法值恢复到上一次有效值。 */
export function positiveNumberOrFallback(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback > 0 ? safeFallback : 1;
}

/** 把设置或统计输入的停留秒数限制在界面支持范围内。 */
export function normalizeStaySeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STAY_SECONDS;
  return Math.min(MAX_STAY_SECONDS, Math.max(MIN_STAY_SECONDS, parsed));
}
