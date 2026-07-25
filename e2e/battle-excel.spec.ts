import { expect, test, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { installTauriMock } from './helpers/tauri-mock';

const eightNames = Array.from({ length: 8 }, (_, index) => `选手${index + 1}`);

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test('单败在抽签、部分比分和完赛时导出完全相同的预留签位', async ({ page }) => {
  await drawSingleBattle(page, '单败', eightNames);

  const initialSheet = await exportBattleWorksheet(page);
  expect(initialSheet.getCell('A1').value).toBe('单败对战签表');
  expect(initialSheet.model.merges).toEqual(expect.arrayContaining([
    'A5:B5',
    'D5:E5',
    'G5:H5',
    'J5:K5',
    'M5:N5',
  ]));
  expect(initialSheet.getCell('A5').value).toBe('1/4');
  expect(initialSheet.getCell('D5').value).toBe('半决赛');
  expect(initialSheet.getCell('G5').value).toBe('决赛');
  expect(initialSheet.getCell('J5').value).toBe('半决赛');
  expect(initialSheet.getCell('M5').value).toBe('1/4');
  expect(initialSheet.getCell('A10').value).toBeNull();
  expect(initialSheet.getCell('M10').value).toBeNull();
  expect(initialSheet.getCell('G16').value).toBe('等待决赛');
  expect(initialSheet.getCell('H16').value).toBe('冠军');
  for (const spacerColumn of [3, 6, 9, 12]) {
    expect(nonEmptyValuesFrom(initialSheet, spacerColumn, 5)).toEqual([]);
  }

  const firstMatch = page.locator(
    '[data-battle-stage="single"][data-battle-level="1"][data-battle-position="1"]',
  );
  await enterBattleScore(firstMatch, 4, 1);
  const partialSheet = await exportBattleWorksheet(page);
  expect(excelLayoutSignature(partialSheet)).toEqual(excelLayoutSignature(initialSheet));
  expect(worksheetValues(partialSheet)).toEqual(expect.arrayContaining([4, 1]));

  await completeSingleBattle(page);
  const completedSheet = await exportBattleWorksheet(page);
  expect(excelLayoutSignature(completedSheet)).toEqual(excelLayoutSignature(initialSheet));

  const championName = await page.evaluate(() => {
    const snapshot = (window as any).__E2E_TAURI_STATE__.battleTmpState;
    const final = [...snapshot.matches]
      .filter((match: any) => match.stage === 'single')
      .sort((left: any, right: any) => right.level - left.level)[0];
    const championId = final.upResult > final.downResult ? final.up : final.down;
    return snapshot.participants.find((participant: any) => participant.id === championId)?.name;
  });
  expect(completedSheet.getCell('G16').value).toBe(championName);
  expect(completedSheet.getCell('H16').value).toBe('冠军');
});

test('同组不对战 1 对 2 使用相同左右签表并在完赛后原位写入冠军', async ({ page }) => {
  await drawSingleBattle(page, '同组不对战1对2', [
    'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2',
  ]);

  const initialSheet = await exportBattleWorksheet(page);
  expect(initialSheet.getCell('A1').value).toBe('同组不对战1对2对战签表');
  expect(initialSheet.getCell('A5').value).toBe('1 对 2');
  expect(initialSheet.getCell('D5').value).toBe('半决赛');
  expect(initialSheet.getCell('G5').value).toBe('决赛');
  expect(initialSheet.getCell('J5').value).toBe('半决赛');
  expect(initialSheet.getCell('M5').value).toBe('1 对 2');
  expect(initialSheet.getCell('G16').value).toBe('等待决赛');

  await completeSingleBattle(page);
  const completedSheet = await exportBattleWorksheet(page);
  expect(excelLayoutSignature(completedSheet)).toEqual(excelLayoutSignature(initialSheet));
  expect(completedSheet.getCell('G16').value).not.toBe('等待决赛');
  expect(completedSheet.getCell('H16').value).toBe('冠军');
});

test('双败从上下向总决赛收拢并把总冠军固定在最右侧', async ({ page }) => {
  test.setTimeout(60_000);
  await drawDoubleBattle(page, eightNames);

  const initialSheet = await exportBattleWorksheet(page);
  expect(initialSheet.columnCount).toBe(17);
  expect(initialSheet.getCell('A4').value).toBe('胜者组');
  expect(initialSheet.getCell('A27').value).toBe('败者组');
  expect(initialSheet.getCell('M24').value).toBe('总决赛');
  expect(initialSheet.getCell('P24').value).toBe('总冠军');
  expect(initialSheet.getCell('P25').value).toBe('等待总决赛');
  expect(worksheetValues(initialSheet)).toEqual(expect.arrayContaining(['W1 P1', 'W1 P2', 'L1 P1']));
  expect(worksheetValues(initialSheet)).not.toContain('等待上游');
  expect(initialSheet.getCell('A6').value).toBe('W1 P1');
  expect(initialSheet.getCell('D16').value).toBe('W2 P1');
  expect(initialSheet.getCell('D17').value).toBe('W1 P1');
  expect(initialSheet.getCell('A29').value).toBe('L1 P1');
  expect(initialSheet.getCell('A30').value).toBe('W1 P1');
  expect(initialSheet.getCell('G6').value).toBeNull();
  expect(initialSheet.getCell('G24').value).not.toBeNull();
  expect(initialSheet.getCell('J28').value).not.toBeNull();

  const firstMatch = page.locator(
    '[data-battle-stage="winner"][data-battle-level="1"][data-battle-position="1"]',
  );
  await enterBattleScore(firstMatch, 4, 1);
  const partialSheet = await exportBattleWorksheet(page);
  expect(excelLayoutSignature(partialSheet)).toEqual(excelLayoutSignature(initialSheet));
  expect(partialSheet.getCell('D16').value).toBe('W2 P1');
  expect(partialSheet.getCell('D17').value).toMatch(/^选手/u);
  expect(partialSheet.getCell('A29').value).toBe('L1 P1');
  expect(partialSheet.getCell('A30').value).toMatch(/^选手/u);

  await completeBattleBracket(page, '.double-battle-bracket');
  const completedSheet = await exportBattleWorksheet(page);
  expect(excelLayoutSignature(completedSheet)).toEqual(excelLayoutSignature(initialSheet));
  expect(completedSheet.getCell('P25').value).not.toBe('等待总决赛');
  expect(completedSheet.getCell('Q25').value).toBe('冠军');
});

async function drawSingleBattle(page: Page, format: string, names: string[]) {
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  const textarea = page.locator('.battle-config textarea');
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: format, exact: true }).check();
  const suspense = page.getByRole('checkbox', { name: '悬念揭晓' });
  if (await suspense.isChecked()) await suspense.uncheck();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator('.single-battle-bracket')).toBeVisible();
}

async function drawDoubleBattle(page: Page, names: string[]) {
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  const textarea = page.locator('.battle-config textarea');
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '双败', exact: true }).check();
  const suspense = page.getByRole('checkbox', { name: '悬念揭晓' });
  if (await suspense.isChecked()) await suspense.uncheck();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator('.double-battle-bracket')).toBeVisible();
}

async function enterBattleScore(match: Locator, up: number, down: number) {
  const inputs = match.locator('input[type="number"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(String(up));
  await inputs.nth(0).press('Tab');
  await expect(inputs.nth(1)).toBeEnabled();
  await inputs.nth(1).fill(String(down));
  await inputs.nth(1).press('Tab');
  await expect(match.locator('.battle-side.winner')).toHaveCount(1);
}

async function completeSingleBattle(page: Page) {
  await completeBattleBracket(page, '.single-battle-bracket');
}

async function completeBattleBracket(page: Page, bracketSelector: string) {
  for (let completed = 0; completed < 32; completed += 1) {
    const readyMatchId = await page.locator(`${bracketSelector} .battle-match`).evaluateAll((matches) => {
      const ready = matches.find((match) => {
        const inputs = [...match.querySelectorAll<HTMLInputElement>('input[type="number"]')];
        return inputs.length === 2 && inputs.every((input) => !input.disabled && input.value === '');
      });
      return ready?.getAttribute('data-battle-match-id') ?? null;
    });
    if (readyMatchId === null) return;
    await enterBattleScore(
      page.locator(`${bracketSelector} .battle-match[data-battle-match-id="${readyMatchId}"]`),
      4,
      1,
    );
  }
  throw new Error('单败签表在预期场次数内没有结束');
}

async function exportBattleWorksheet(page: Page) {
  const exportCount = await binaryExportCount(page);
  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  await expect.poll(() => binaryExportCount(page)).toBe(exportCount + 1);
  const bytes = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').at(-1).args.bytes,
  ));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  return workbook.getWorksheet('对战签表')!;
}

async function binaryExportCount(page: Page) {
  return page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').length
  ));
}

function excelLayoutSignature(worksheet: ExcelJS.Worksheet) {
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

function nonEmptyValuesFrom(worksheet: ExcelJS.Worksheet, column: number, startRow: number) {
  const values: unknown[] = [];
  for (let row = startRow; row <= worksheet.rowCount; row += 1) {
    const value = worksheet.getCell(row, column).value;
    if (value !== null) values.push(value);
  }
  return values;
}

function worksheetValues(worksheet: ExcelJS.Worksheet) {
  const values: unknown[] = [];
  worksheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
}
