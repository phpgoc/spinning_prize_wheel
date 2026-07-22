import { describe, expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
import { createBattleBracketWorkbook } from './battle-excel';
import {
  battleTmpWinnerId,
  createAvoidSameGroupPlan,
  createBattleTmpSnapshot,
  createSeededBattlePlan,
  type BattleTmpSnapshot,
  updateBattleTmpResult,
} from './battle';

const names = (count: number) => Array.from({ length: count }, (_, index) => `选手${index + 1}`);

describe('对战签表 Excel', () => {
  test('八人单败从左右两侧逐轮向中央推进并固定留出空行空列', async () => {
    const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);

    const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
    const worksheet = workbook.getWorksheet('对战签表')!;
    expect(worksheet.getCell('A1').value).toBe('单败对战签表');
    expect(worksheet.getCell('A5').value).toBe('第 1 轮');
    expect(worksheet.getCell('D5').value).toBe('第 2 轮');
    expect(worksheet.getCell('G5').value).toBe('决赛');
    expect(worksheet.getCell('J5').value).toBe('第 2 轮');
    expect(worksheet.getCell('M5').value).toBe('第 1 轮');
    expect(worksheet.model.merges).toEqual(expect.arrayContaining([
      'A5:B5',
      'D5:E5',
      'G5:H5',
      'J5:K5',
      'M5:N5',
    ]));
    for (const spacerColumn of [3, 6, 9, 12]) {
      expect(columnValuesFrom(worksheet, spacerColumn, 5)).toEqual([]);
    }
    expect(worksheet.getCell('A10').value).toBeNull();
    expect(worksheet.getCell('B10').value).toBeNull();
    expect(worksheet.getCell('M10').value).toBeNull();
    expect(worksheet.getCell('N10').value).toBeNull();
    expect(worksheet.getColumn(7).width).toBe(24);
    expect(worksheet.getColumn(8).width).toBe(10);
  });

  test('单败抽签后就保留未来轮次和固定冠军位置', async () => {
    const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);

    const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
    const worksheet = workbook.getWorksheet('对战签表')!;
    expect(worksheet.getCell('D9').value).toBe('等待上游');
    expect(worksheet.getCell('G8').value).toBe('等待上游');
    expect(worksheet.getCell('G16').value).toBe('等待决赛');
    expect(worksheet.getCell('H16').value).toBe('冠军');
    expect(worksheet.getCell('G16').border).toBeTruthy();
    expect(worksheet.getCell('H16').border).toBeTruthy();
  });

  test('未比赛、部分比分和全部完赛的单败签表坐标完全一致', async () => {
    const initial = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const first = initial.matches.find((match) => match.status === 'ready')!;
    const partial = updateBattleTmpResult(initial, first.matchId, 4, 1, 1_700_000_000_001);
    const completed = completeBattle(initial);

    const initialSheet = await loadBattleWorksheet(initial);
    const partialSheet = await loadBattleWorksheet(partial);
    const completedSheet = await loadBattleWorksheet(completed);
    expect(layoutSignature(partialSheet)).toEqual(layoutSignature(initialSheet));
    expect(layoutSignature(completedSheet)).toEqual(layoutSignature(initialSheet));

    const final = completed.matches
      .filter((match) => match.stage === 'single')
      .sort((left, right) => right.level - left.level)[0];
    const championId = battleTmpWinnerId(final);
    const championName = completed.participants.find((participant) => participant.id === championId)?.name;
    expect(initialSheet.getCell('G16').value).toBe('等待决赛');
    expect(completedSheet.getCell('G16').value).toBe(championName);
    expect(completedSheet.getCell('H16').value).toBe('冠军');
  });

  test('同组不对战 1 对 2 与单败共用固定左右布局', async () => {
    const single = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 0,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const avoid = createBattleTmpSnapshot(
      'standard',
      createAvoidSameGroupPlan(names(8), () => 0.25),
      1_700_000_000_000,
    );

    const singleSheet = await loadBattleWorksheet(single);
    const avoidSheet = await loadBattleWorksheet(avoid);
    expect(layoutSignature(avoidSheet)).toEqual(layoutSignature(singleSheet));
    expect(avoidSheet.getCell('A5').value).toBe('1 对 2');
    expect(avoidSheet.getCell('M5').value).toBe('1 对 2');
    expect(avoidSheet.getCell('G5').value).toBe('决赛');

    const completed = completeBattle(avoid);
    const completedSheet = await loadBattleWorksheet(completed);
    expect(completedSheet.getCell('G16').value).not.toBe('等待决赛');
    expect(completedSheet.getCell('H16').value).toBe('冠军');
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

async function loadBattleWorksheet(snapshot: BattleTmpSnapshot) {
  const workbook = await loadWorkbook(await createBattleBracketWorkbook(snapshot));
  return workbook.getWorksheet('对战签表')!;
}

function completeBattle(initial: BattleTmpSnapshot): BattleTmpSnapshot {
  let snapshot = initial;
  let updatedAt = initial.updatedAt;
  while (true) {
    const ready = snapshot.matches.find((match) => (
      match.status === 'ready' && match.upResult === null && match.downResult === null
    ));
    if (!ready) return snapshot;
    snapshot = updateBattleTmpResult(snapshot, ready.matchId, 4, 1, ++updatedAt);
  }
}

function layoutSignature(worksheet: ExcelJS.Worksheet) {
  const borderedCells: string[] = [];
  const filledCells: string[] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cell.border && Object.keys(cell.border).length > 0) borderedCells.push(cell.address);
      if (cell.fill && cell.fill.type !== undefined) filledCells.push(cell.address);
    });
  });
  return {
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    merges: [...worksheet.model.merges].sort(),
    widths: Array.from({ length: worksheet.columnCount }, (_, index) => worksheet.getColumn(index + 1).width),
    heights: Array.from({ length: worksheet.rowCount }, (_, index) => worksheet.getRow(index + 1).height),
    borderedCells,
    filledCells,
  };
}

function columnValuesFrom(worksheet: ExcelJS.Worksheet, column: number, startRow: number): unknown[] {
  const values: unknown[] = [];
  for (let row = startRow; row <= worksheet.rowCount; row += 1) {
    const value = worksheet.getCell(row, column).value;
    if (value !== null) values.push(value);
  }
  return values;
}

function worksheetValues(worksheet: ExcelJS.Worksheet): unknown[] {
  const values: unknown[] = [];
  worksheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
}
