import { describe, expect, test } from 'bun:test';
import { parseOptionText } from './parse-options';

describe('option text parser', () => {
  test('parses spaces and Chinese or English commas', () => {
    expect(parseOptionText('一等奖 二等奖,三等奖，四等奖')).toEqual([
      '一等奖',
      '二等奖',
      '三等奖',
      '四等奖',
    ]);
  });

  test('parses rows and columns pasted from Excel', () => {
    expect(parseOptionText('苹果\t香蕉\r\n橙子\t葡萄')).toEqual(['苹果', '香蕉', '橙子', '葡萄']);
  });

  test('removes empty and duplicate values while preserving order', () => {
    expect(parseOptionText('A,,a；B | B、C')).toEqual(['A', 'B', 'C']);
  });

  test('limits imported options and long names', () => {
    const result = parseOptionText(
      ['这是一个非常非常长而且需要截断的奖项名称', ...Array.from({ length: 120 }, (_, i) => `奖项${i}`)].join(' '),
    );

    expect(result).toHaveLength(100);
    expect(result[0]).toHaveLength(18);
  });
});
