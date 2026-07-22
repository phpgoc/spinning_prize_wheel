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
  const historyCard = page.locator('.battle-history-list article');
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

  await historyCard.locator('.history-view').click();
  await expect(page.getByRole('heading', { name: '历史对战' })).toBeVisible();
  const viewedMatch = page.locator('.battle-history-bracket .battle-round').first().locator('.battle-match').first();
  await expect(viewedMatch.locator('.battle-side strong')).toHaveText(expectedNames);
  await expect(viewedMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(viewedMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
  await expect(page.locator('.battle-history-bracket input:not(:disabled)')).toHaveCount(0);

  await page.locator('.battle-state-actions').getByRole('button', { name: '加载当前' }).click();
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

  await historyCard.locator('.history-view').click();
  await expect(page.getByRole('heading', { name: '历史对战' })).toBeVisible();
  await expect(viewedMatch.locator('.battle-side strong')).toHaveText(expectedNames);
  await expect(viewedMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(viewedMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
});

test('对战历史导入拒绝伪造封装并兼容旧版裸快照', async ({ page }) => {
  await openDesktopBattle(page);
  await createScoredBattle(page);
  const expectedSnapshot = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));

  await page.getByRole('button', { name: '保存历史' }).click();
  await page.getByRole('button', { name: /对战历史/u }).click();
  const historyCard = page.locator('.battle-history-list article');
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
