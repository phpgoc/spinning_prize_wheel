export const DEFAULT_FONT_SCALE = 1;
export const MIN_FONT_SCALE = 1;
export const MAX_FONT_SCALE = 3;

/** 把持久化或输入的字号倍率限制在界面支持范围内。 */
export function normalizeFontScale(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SCALE;
  const clamped = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, parsed));
  return Math.round(clamped * 10) / 10;
}
