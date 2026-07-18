import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FONT_SCALE,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  normalizeFontScale,
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
});
