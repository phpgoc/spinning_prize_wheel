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
    expect(String(worksheet.getCell('A2').value)).toContain('updated_at：');
    expect(worksheet.getCell('A5').value).toBe('1/4');
    expect(worksheet.getCell('D5').value).toBe('半决赛');
    expect(worksheet.getCell('G5').value).toBe('决赛');
    expect(worksheet.getCell('J5').value).toBe('半决赛');
    expect(worksheet.getCell('M5').value).toBe('1/4');
    expect(worksheet.getCell('A6').alignment.horizontal).toBe('center');
    expect(worksheet.getCell('B6').alignment.horizontal).toBe('center');
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

  test('八人双败逐轮空列并让胜者组向下、败者组向上收拢', async () => {
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
    expect(worksheet.columnCount).toBe(17);
    expect(worksheet.model.merges).toEqual(expect.arrayContaining([
      'A5:B5',
      'D5:E5',
      'G5:H5',
      'A27:B27',
      'D27:E27',
      'G27:H27',
      'J27:K27',
      'M24:N24',
      'P24:Q24',
    ]));
    expect(worksheet.getCell('A10').value).toBeNull();
    expect(worksheet.getCell('A15').value).toBeNull();
    expect(worksheet.getCell('A20').value).toBeNull();
    expect(worksheet.getCell('D20').value).toBeNull();
    expect(worksheet.getCell('G6').value).toBeNull();
    expect(worksheet.getCell('A32').value).toBeNull();
    expect(worksheet.getCell('D32').value).toBeNull();
    expect(worksheet.getCell('J33').value).toBeNull();
    expect(worksheet.getCell('A24').value).not.toBeNull();
    expect(worksheet.getCell('D24').value).not.toBeNull();
    expect(worksheet.getCell('G24').value).not.toBeNull();
    expect(worksheet.getCell('A28').value).not.toBeNull();
    expect(worksheet.getCell('D28').value).not.toBeNull();
    expect(worksheet.getCell('G28').value).not.toBeNull();
    expect(worksheet.getCell('J28').value).not.toBeNull();
    for (const spacerColumn of [3, 6, 9, 12, 15]) {
      expect(worksheet.getColumn(spacerColumn).width).toBe(3);
      expect(worksheet.getCell(5, spacerColumn).value).toBeNull();
      expect(worksheet.getCell(27, spacerColumn).value).toBeNull();
    }
    expect(worksheet.getCell('M24').value).toBe('总决赛');
    expect(worksheet.getCell('P24').value).toBe('总冠军');
    expect(worksheet.getCell('P25').value).toBe('等待总决赛');
    expect(worksheet.getCell('Q25').value).toBe('冠军');
    expect(worksheet.getColumn(13).width).toBe(24);
    expect(worksheet.getColumn(16).width).toBe(24);
  });

  test('双败未比赛、部分比分和完赛时坐标不变且冠军写在最右侧', async () => {
    const initial = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'double-elimination',
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

    const grandFinal = completed.matches.find((match) => match.stage === 'final' && match.level === 1)!;
    const championId = battleTmpWinnerId(grandFinal);
    const championName = completed.participants.find((participant) => participant.id === championId)?.name;
    expect(initialSheet.getCell('P25').value).toBe('等待总决赛');
    expect(completedSheet.getCell('P25').value).toBe(championName);
    expect(completedSheet.getCell('Q25').value).toBe('冠军');
    expect(completedSheet.getCell('P37').value).toBeNull();
  });

  test('双总决赛把重赛和总冠军继续排在最右边', async () => {
    const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      doubleGrandFinal: true,
      random: () => 0.25,
    }), 1_700_000_000_000);

    const worksheet = await loadBattleWorksheet(snapshot);
    expect(worksheet.columnCount).toBe(20);
    expect(worksheet.getCell('M24').value).toBe('总决赛');
    expect(worksheet.getCell('P24').value).toBe('必要时重赛');
    expect(worksheet.getCell('S24').value).toBe('总冠军');
    expect(worksheet.getCell('S25').value).toBe('等待总决赛');
    expect(worksheet.getCell('T25').value).toBe('冠军');
    expect(worksheet.getColumn(15).width).toBe(3);
    expect(worksheet.getColumn(18).width).toBe(3);
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
