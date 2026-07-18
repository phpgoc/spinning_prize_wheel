import { describe, expect, test } from 'bun:test';
import { parseLineupFile } from './lineup-file-import';

describe('排阵文件导入', () => {
  test('CSV 支持名称列和排阵结果表', () => {
    expect(parseLineupFile('\uFEFF姓名,备注\r\n"张,三",一组\r\n李四,二组', 'csv'))
      .toEqual(['张,三', '李四']);
    expect(parseLineupFile('档位,A组,B组\r\nt1,张三,李四\r\nt2,王五,赵六', 'csv'))
      .toEqual(['张三', '李四', '王五', '赵六']);
  });

  test('JSON 读取排阵导出中的原始名单', () => {
    expect(parseLineupFile(JSON.stringify({ input: { sourceNames: ['张三', '李四', '张三'] } }), 'json'))
      .toEqual(['张三', '李四']);
  });
});
