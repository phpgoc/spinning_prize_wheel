import { Buffer } from 'node:buffer';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installTauriMock } from './helpers/tauri-mock';

async function openDesktopBattle(page: Page) {
  await installTauriMock(page);
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
}

async function createScoredBattle(page: Page) {
  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(4);
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await page.getByRole('button', { name: '显示全部' }).click();

  const firstMatch = page.locator('.battle-round').first().locator('.battle-match').first();
  await enterScore(firstMatch, 4, 1);
  await expect(firstMatch.locator('.battle-side.winner')).toHaveCount(1);
  return firstMatch;
}

async function enterScore(match: Locator, up: number, down: number) {
  const inputs = match.locator('input[type="number"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(String(up));
  await inputs.nth(0).press('Tab');
  await inputs.nth(1).fill(String(down));
  await inputs.nth(1).press('Tab');
}

async function importBattleHistory(page: Page, name: string, value: unknown) {
  await page.locator('.lineup-file-input').setInputFiles({
    name,
    mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain',
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

function battleHistoryCards(page: Page) {
  return page.locator('.history-panel article');
}

test('对战历史 JSON 导出导入可完整复现并能从查看切回当前', async ({ page }) => {
  await openDesktopBattle(page);
  const currentMatch = await createScoredBattle(page);
  const expectedNames = await currentMatch.locator('.battle-side strong').allTextContents();
  const expectedSnapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));

  await page.getByRole('button', { name: '保存历史' }).click();
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]').length
  ))).toBe(1);

  await page.getByRole('button', { name: /对战历史/u }).click();
  const historyCard = battleHistoryCards(page);
  await expect(historyCard).toHaveCount(1);
  await historyCard.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const invocation = [...(window as any).__E2E_TAURI_STATE__.invocations]
      .reverse()
      .find((entry: any) => entry.cmd === 'export_text_file');
    return invocation?.args.content ?? '';
  })).not.toBe('');
  const exportedJson = await page.evaluate(() => {
    const invocation = [...(window as any).__E2E_TAURI_STATE__.invocations]
      .reverse()
      .find((entry: any) => entry.cmd === 'export_text_file');
    return invocation.args.content as string;
  });

  const exported = JSON.parse(exportedJson);
  expect(exported).toEqual({ kind: 'battle-history', version: 1, snapshot: expectedSnapshot });

  await historyCard.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: '历史对战' })).toBeVisible();
  const viewedMatch = page.locator('.battle-history-bracket .battle-round').first().locator('.battle-match').first();
  await expect(viewedMatch.locator('.battle-side strong')).toHaveText(expectedNames);
  await expect(viewedMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(viewedMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
  await expect(page.locator('.battle-history-bracket input:not(:disabled)')).toHaveCount(0);

  await page.locator('.history-panel').getByRole('button', { name: '加载当前' }).click();
  await expect(page.getByRole('heading', { name: '对战', exact: true })).toBeVisible();
  await expect(page.locator('.single-battle-bracket:not(.read-only)')).toBeVisible();
  await expect(currentMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(currentMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');

  await historyCard.getByRole('button', { name: /删除 .* 的对战历史/u }).click();
  await page.keyboard.press('Enter');
  await expect(historyCard).toHaveCount(0);

  await page.locator('.lineup-file-input').setInputFiles({
    name: '对战历史.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedJson),
  });
  await expect(historyCard).toHaveCount(1);
  const importedSnapshot = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]')[0]?.snapshot
  ));
  expect(importedSnapshot).toEqual(expectedSnapshot);

  await historyCard.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: '历史对战' })).toBeVisible();
  await expect(viewedMatch.locator('.battle-side strong')).toHaveText(expectedNames);
  await expect(viewedMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(viewedMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
});

test('对战历史导出显示忙碌状态并在失败后恢复', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (reason) => pageErrors.push(reason.message));
  await openDesktopBattle(page);
  await createScoredBattle(page);
  await page.getByRole('button', { name: '保存历史' }).click();
  await page.getByRole('button', { name: /对战历史/u }).click();

  const historyCard = battleHistoryCards(page);
  await expect(historyCard).toHaveCount(1);
  const excelButton = historyCard.locator('[data-export="battle-history-excel"]');
  const jsonButton = historyCard.locator('[data-export="battle-history-json"]');
  await page.evaluate(() => {
    (window as any).__E2E_TAURI_STATE__.commandFailures.export_binary_file = ['历史 Excel 写入失败'];
  });
  await excelButton.click();
  await expect(excelButton).toHaveText('导出中…');
  await expect(excelButton).toBeDisabled();
  await expect(jsonButton).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('历史 Excel 写入失败', { timeout: 30_000 });
  await expect(excelButton).toHaveText('Excel');
  await expect(excelButton).toBeEnabled();
  await expect(jsonButton).toBeEnabled();

  await page.evaluate(() => {
    (window as any).__E2E_TAURI_STATE__.commandFailures.export_text_file = ['历史 JSON 写入失败'];
  });
  await jsonButton.click();
  await expect(page.getByRole('alert')).toContainText('历史 JSON 写入失败');
  await expect(excelButton).toBeEnabled();
  await expect(jsonButton).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('对战历史本地写入失败时不会伪造保存或删除', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (reason) => pageErrors.push(reason.message));
  await openDesktopBattle(page);
  await createScoredBattle(page);

  const failHistoryWrites = () => page.evaluate(() => {
    const prototype = Storage.prototype as any;
    prototype.__E2E_ORIGINAL_SET_ITEM__ ??= prototype.setItem;
    prototype.setItem = function setItem(this: Storage, key: string, value: string) {
      if (key.startsWith('battle-history-v1:')) throw new Error('模拟对战历史本地写入失败');
      return prototype.__E2E_ORIGINAL_SET_ITEM__.call(this, key, value);
    };
  });
  const restoreHistoryWrites = () => page.evaluate(() => {
    const prototype = Storage.prototype as any;
    if (prototype.__E2E_ORIGINAL_SET_ITEM__) {
      prototype.setItem = prototype.__E2E_ORIGINAL_SET_ITEM__;
    }
  });

  await failHistoryWrites();
  await page.getByRole('button', { name: '保存历史' }).click();
  await expect(page.getByRole('alert')).toContainText('模拟对战历史本地写入失败');
  await page.getByRole('button', { name: /对战历史/u }).click();
  const historyCards = battleHistoryCards(page);
  await expect(historyCards).toHaveCount(0);
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]')
  ))).toEqual([]);

  await restoreHistoryWrites();
  await page.getByRole('button', { name: '保存历史' }).click();
  await expect(historyCards).toHaveCount(1);
  await failHistoryWrites();
  await historyCards.getByRole('button', { name: /删除 .* 的对战历史/u }).click();
  await page.keyboard.press('Enter');
  await expect(historyCards).toHaveCount(1);
  await expect(page.locator('.history-panel').getByRole('alert')).toContainText('模拟对战历史本地写入失败');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]').length
  ))).toBe(1);
  await restoreHistoryWrites();
  expect(pageErrors).toEqual([]);
});

test('对战历史导入拒绝伪造封装并兼容旧版裸快照', async ({ page }) => {
  await openDesktopBattle(page);
  await createScoredBattle(page);
  const expectedSnapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));

  await page.getByRole('button', { name: '保存历史' }).click();
  await page.getByRole('button', { name: /对战历史/u }).click();
  const historyCard = battleHistoryCards(page);
  await expect(historyCard).toHaveCount(1);

  const validTransfer = {
    kind: 'battle-history',
    version: 1,
    snapshot: expectedSnapshot,
  };
  const assertImportRejected = async (name: string, value: unknown, detail: string) => {
    await importBattleHistory(page, name, value);
    const dialog = page.getByRole('alertdialog', { name: '对战历史导入失败' });
    await expect(dialog).toContainText(detail);
    await dialog.getByRole('button', { name: '知道了' }).click();
    await expect(historyCard).toHaveCount(1);
  };

  await assertImportRejected('错误格式.json', {
    ...validTransfer,
    kind: 'lineup-history',
  }, '不是对战历史 JSON');
  await assertImportRejected('未来版本.json', {
    ...validTransfer,
    version: 2,
  }, '不支持的对战历史版本');
  await assertImportRejected('其他变体.json', {
    ...validTransfer,
    snapshot: { ...expectedSnapshot, variant: 'caimi' },
  }, '对战临时状态格式不正确');
  await assertImportRejected('损坏参赛者.json', {
    ...validTransfer,
    snapshot: {
      ...expectedSnapshot,
      participants: expectedSnapshot.participants.map((participant: any, index: number) => (
        index === 0 ? { ...participant, id: '错误' } : participant
      )),
    },
  }, '对战临时状态格式不正确');
  await assertImportRejected('损坏场次引用.json', {
    ...validTransfer,
    snapshot: {
      ...expectedSnapshot,
      matches: expectedSnapshot.matches.map((match: any, index: number) => (
        index === 0 ? { ...match, up: 999 } : match
      )),
    },
  }, '对战临时状态格式不正确');
  await assertImportRejected('错误扩展名.txt', validTransfer, '只支持 JSON 文件');

  await historyCard.getByRole('button', { name: /删除 .* 的对战历史/u }).click();
  await page.keyboard.press('Enter');
  await expect(historyCard).toHaveCount(0);

  await importBattleHistory(page, '旧版对战状态.json', expectedSnapshot);
  await expect(historyCard).toHaveCount(1);
  const importedSnapshot = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]')[0]?.snapshot
  ));
  expect(importedSnapshot).toEqual(expectedSnapshot);
});

test('对战历史限制最近二十条并按日期筛选和二次确认删除全部', async ({ page }) => {
  await openDesktopBattle(page);
  await createScoredBattle(page);
  const snapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));

  await page.evaluate((currentSnapshot) => {
    const records = Array.from({ length: 21 }, (_, index) => {
      const createdAt = new Date(2026, 0, 21 - index, 12).getTime();
      return {
        id: `history-${index}`,
        createdAt,
        snapshot: { ...structuredClone(currentSnapshot), updatedAt: createdAt },
      };
    });
    localStorage.setItem('battle-history-v1:standard', JSON.stringify(records));
  }, snapshot);
  await page.reload();
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /对战历史/u }).click();

  const historyCards = battleHistoryCards(page);
  await expect(historyCards).toHaveCount(20);
  const dateInputs = page.locator('.history-panel input[type="date"]');
  await dateInputs.nth(0).fill('2026-01-10');
  await dateInputs.nth(1).fill('2026-01-12');
  await expect(historyCards).toHaveCount(2);

  await dateInputs.nth(0).fill('');
  await dateInputs.nth(1).fill('');
  await expect(historyCards).toHaveCount(20);
  await page.getByRole('button', { name: '删除全部', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '删除全部对战历史？' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog', { name: '真的删除全部对战历史？' })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(historyCards).toHaveCount(0);
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]')
  ))).toEqual([]);
});

test('历史覆盖临时表时可在三层确认分别取消且不改变当前比分', async ({ page }) => {
  await openDesktopBattle(page);
  await createScoredBattle(page);
  const expectedSnapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));
  await page.getByRole('button', { name: '保存历史' }).click();
  await page.getByRole('button', { name: /对战历史/u }).click();

  const editHistory = battleHistoryCards(page).getByRole('button', { name: '编辑' });
  const expectCurrentUnchanged = async () => {
    expect(await page.evaluate(() => structuredClone(
      (window as any).__E2E_TAURI_STATE__.battleTmpState,
    ))).toEqual(expectedSnapshot);
    await expect(page.locator('.battle-load-confirm-dialog')).toHaveCount(0);
  };

  await editHistory.click();
  await expect(page.getByRole('alertdialog', { name: /1\/3 用.*历史签表替换编辑区/u })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectCurrentUnchanged();

  await editHistory.click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog', { name: '2/3 将历史副本写入临时表？' })).toBeVisible();
  await page.keyboard.press('n');
  await expectCurrentUnchanged();

  await editHistory.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const finalDialog = page.getByRole('alertdialog', { name: '3/3 覆盖并加载这条历史？' });
  await expect(finalDialog).toBeVisible();
  await finalDialog.getByRole('button', { name: '取消' }).click();
  await expectCurrentUnchanged();
});

test('比分同步失败会恢复数据库状态并在重试成功后清除错误', async ({ page }) => {
  await openDesktopBattle(page);
  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await page.getByRole('button', { name: '显示全部' }).click();

  await page.evaluate(() => {
    (window as any).__E2E_TAURI_STATE__.commandFailures.update_battle_tmp_result = ['模拟比分同步失败'];
  });
  const firstInput = page.locator('.battle-round').first()
    .locator('.battle-match').first()
    .locator('input[type="number"]').first();
  await firstInput.fill('4');
  await firstInput.press('Tab');

  await expect(firstInput).toHaveValue('');
  await expect(page.getByRole('alert')).toContainText('模拟比分同步失败');
  expect(await page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState.matches[0].upResult
  ))).toBeNull();

  await firstInput.fill('4');
  await firstInput.press('Tab');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState.matches[0].upResult
  ))).toBe(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('历史覆盖写入失败会保留当前临时表且不会自动归档当前比分', async ({ page }) => {
  await openDesktopBattle(page);
  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await page.getByRole('button', { name: '显示全部' }).click();
  await page.getByRole('button', { name: '保存历史' }).click();

  const firstMatch = page.locator('.battle-round').first().locator('.battle-match').first();
  await enterScore(firstMatch, 4, 1);
  const currentSnapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));
  await page.getByRole('button', { name: /对战历史/u }).click();
  await page.evaluate(() => {
    (window as any).__E2E_TAURI_STATE__.commandFailures.save_battle_tmp_state = ['模拟历史覆盖失败'];
  });

  await battleHistoryCards(page).first()
    .getByRole('button', { name: '编辑' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('模拟历史覆盖失败');
  expect(await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ))).toEqual(currentSnapshot);
  await expect(firstMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(firstMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
  await expect(battleHistoryCards(page)).toHaveCount(1);
});
