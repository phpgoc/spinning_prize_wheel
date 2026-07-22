import { describe, expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
import { createBattleBracketWorkbook } from './battle-excel';
import {
  createBattleTmpSnapshot,
  createSeededBattlePlan,
  updateBattleTmpResult,
} from './battle';

const names = (count: number) => Array.from({ length: count }, (_, index) => `选手${index + 1}`);

describe('对战签表 Excel', () => {
  test('单败使用合并单元格呈现各轮和比分', async () => {
    let snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const first = snapshot.matches.find((match) => match.matchId === 'S1-M1')!;
    snapshot = updateBattleTmpResult(snapshot, first.matchId, 4, 1, 1_700_000_000_001);

    const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
    const worksheet = workbook.getWorksheet('对战签表')!;
    expect(worksheet.getCell('A1').value).toBe('单败对战签表');
    expect(worksheet.model.merges.length).toBeGreaterThan(8);
    expect(worksheetValues(worksheet)).toContain('第 3 轮');
    expect(worksheetValues(worksheet)).toContain(4);
    expect(worksheetValues(worksheet)).toContain(1);
  });

  test('双败把胜者组、败者组和总决赛分区展示', async () => {
    const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
    const worksheet = workbook.getWorksheet('对战签表')!;
    const values = worksheetValues(worksheet);
    expect(worksheet.getCell('A1').value).toBe('双败对战签表');
    expect(values).toContain('胜者组');
    expect(values).toContain('败者组');
    expect(values).toContain('总决赛');
    expect(worksheet.model.merges.length).toBeGreaterThan(15);
  });

  test('未启用第二场总决赛时第一场结果直接产生冠军', async () => {
    let snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(4), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 0,
      random: () => 0.25,
    }), 1_700_000_000_000);
    snapshot = updateBattleTmpResult(snapshot, 'W1-M1', 4, 1, 1_700_000_000_001);
    snapshot = updateBattleTmpResult(snapshot, 'W1-M2', 4, 1, 1_700_000_000_002);
    snapshot = updateBattleTmpResult(snapshot, 'L1-M1', 4, 1, 1_700_000_000_003);
    snapshot = updateBattleTmpResult(snapshot, 'W2-M1', 4, 1, 1_700_000_000_004);
    snapshot = updateBattleTmpResult(snapshot, 'L2-M1', 4, 1, 1_700_000_000_005);
    snapshot = updateBattleTmpResult(snapshot, 'GF-M1', 4, 1, 1_700_000_000_006);

    const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
    expect(worksheetValues(workbook.getWorksheet('对战签表')!)).toContain('冠军');
  });
});

async function loadWorkbook(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  return workbook;
}

function worksheetValues(worksheet: ExcelJS.Worksheet): unknown[] {
  const values: unknown[] = [];
  worksheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
}
