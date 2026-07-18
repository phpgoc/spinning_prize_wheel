import { expect, test } from 'bun:test';
import { createExcelCsv } from './file-export';

test('Excel CSV 带中文 BOM 并正确转义', () => {
  expect(createExcelCsv([
    ['档位', 'A组'],
    ['t1', '含,逗号和"引号"'],
  ])).toBe('\uFEFF档位,A组\r\nt1,"含,逗号和""引号"""');
});
