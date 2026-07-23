import { expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
import { createExcelWorkbook } from './file-export';

test('Excel 导出生成标准 XLSX 并保留中文、数字和表头', async () => {
  const bytes = await createExcelWorkbook([
    ['档位', 'A组', '积分'],
    ['t1', '张三', 12],
  ], '分组/结果');

  expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  const workbook = new ExcelJS.Workbook();
  const loadBuffer = (bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as unknown) as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(loadBuffer);
  const worksheet = workbook.getWorksheet('分组_结果');
  expect(worksheet?.getCell('B2').value).toBe('张三');
  expect(worksheet?.getCell('C2').value).toBe(12);
  expect(worksheet?.getCell('A1').font.bold).toBe(true);
  expect(worksheet?.getCell('A1').alignment.horizontal).toBe('center');
  expect(worksheet?.getCell('B2').alignment.horizontal).toBe('center');
  expect(worksheet?.getCell('C2').alignment.horizontal).toBe('center');
});
