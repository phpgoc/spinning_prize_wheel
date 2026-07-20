import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_STAY_SECONDS,
  DEFAULT_FONT_SCALE,
  MAX_STAY_SECONDS,
  MAX_FONT_SCALE,
  MIN_STAY_SECONDS,
  MIN_FONT_SCALE,
  normalizeFontScale,
  normalizeStaySeconds,
  positiveNumberOrFallback,
} from './ui-settings';

describe('界面字号设置', () => {
  test('无效存储值恢复默认字号', () => {
    expect(normalizeFontScale(undefined)).toBe(DEFAULT_FONT_SCALE);
    expect(normalizeFontScale('not-a-number')).toBe(DEFAULT_FONT_SCALE);
  });

  test('字号只能在一倍到三倍之间', () => {
    expect(normalizeFontScale(0.5)).toBe(MIN_FONT_SCALE);
    expect(normalizeFontScale(4)).toBe(MAX_FONT_SCALE);
  });

  test('字号按十分之一倍保存', () => {
    expect(normalizeFontScale(1.26)).toBe(1.3);
  });

  test('正数输入接受任意正小数', () => {
    expect(positiveNumberOrFallback('0.0001', 0.65)).toBe(0.0001);
    expect(positiveNumberOrFallback(128.75, 0.65)).toBe(128.75);
  });

  test('非法正数输入恢复到编辑前数值', () => {
    expect(positiveNumberOrFallback('', 0.65)).toBe(0.65);
    expect(positiveNumberOrFallback(0, 0.65)).toBe(0.65);
    expect(positiveNumberOrFallback(-2, 0.65)).toBe(0.65);
    expect(positiveNumberOrFallback('oops', 0.65)).toBe(0.65);
  });

  test('停留时间使用默认值并限制在半秒到十秒', () => {
    expect(normalizeStaySeconds(undefined)).toBe(DEFAULT_STAY_SECONDS);
    expect(normalizeStaySeconds(0)).toBe(MIN_STAY_SECONDS);
    expect(normalizeStaySeconds(60)).toBe(MAX_STAY_SECONDS);
    expect(normalizeStaySeconds(7.5)).toBe(7.5);
  });
});
