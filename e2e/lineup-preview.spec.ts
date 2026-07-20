import { expect, test, type Page } from '@playwright/test';

async function confirmNames(page: Page, names: string[]) {
  const textarea = page.locator('.names-field textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(names.length);
}

async function previewNames(page: Page) {
  return page.locator('.preview-row input').evaluateAll((inputs) => (
    inputs.map((input) => (input as HTMLInputElement).value)
  ));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/lineup');
});

test('名单文本区延迟到 Alt+回车集中确认，Esc 恢复上次确认内容', async ({ page }) => {
  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙');
  await expect(page.locator('.preview-row')).toHaveCount(0);

  await textarea.press('Enter');
  await expect(textarea).toHaveValue('甲\n乙\n');
  await expect(page.locator('.preview-row')).toHaveCount(0);

  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(2);

  await textarea.fill('甲\n乙\n未确认');
  await expect(page.locator('.preview-row')).toHaveCount(2);
  await textarea.press('Escape');
  await expect(textarea).toHaveValue('甲\n乙');
  await expect(page.locator('.preview-row')).toHaveCount(2);
});

test('清空名单会明确提示并同时清空名单预览', async ({ page }) => {
  await confirmNames(page, ['甲', '乙']);
  const clearButton = page.getByRole('button', { name: '清空', exact: true });

  await clearButton.click();
  await expect(page.getByRole('heading', { name: '同时清空名单预览？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.preview-row')).toHaveCount(2);

  await clearButton.click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.names-field textarea')).toHaveValue('');
  await expect(page.locator('.preview-row')).toHaveCount(0);
});

test('预览支持前插、末尾添加并用回车保存', async ({ page }) => {
  await confirmNames(page, ['甲', '乙']);

  await page.getByRole('button', { name: '在 乙 前插入' }).click();
  const beforeSecond = page.getByLabel('插入到 乙 前');
  await expect(beforeSecond).toBeFocused();
  await beforeSecond.fill('丙');
  await beforeSecond.press('Enter');
  expect(await previewNames(page)).toEqual(['甲', '丙', '乙']);

  await page.getByRole('button', { name: '＋ 添加到名单末尾' }).click();
  const append = page.getByLabel('添加到名单末尾');
  await append.fill('丁');
  await append.press('Enter');
  expect(await previewNames(page)).toEqual(['甲', '丙', '乙', '丁']);
});

test('预览位置只用空格选中和插入，方向键移动落点，Enter 不误触', async ({ page }) => {
  await confirmNames(page, ['甲', '乙', '丙', '丁']);

  const firstPosition = page.locator('[data-preview-position="0"]');
  await firstPosition.focus();
  await firstPosition.press('Enter');
  await expect(page.locator('.preview-move-source')).toHaveCount(0);
  expect(await previewNames(page)).toEqual(['甲', '乙', '丙', '丁']);

  const secondPosition = page.locator('[data-preview-position="1"]');
  await secondPosition.focus();
  await secondPosition.press('Space');
  await expect(page.locator('.preview-row').nth(1)).toHaveClass(/preview-move-source/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  expect(await previewNames(page)).toEqual(['甲', '丙', '丁', '乙']);

  await firstPosition.focus();
  await firstPosition.press('Space');
  await expect(page.locator('.preview-move-source')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.preview-move-source')).toHaveCount(0);
});

test('X 只聚焦分组结果，不会在文本编辑时抢走按键', async ({ page }) => {
  const textarea = page.locator('.names-field textarea');
  await textarea.focus();
  await textarea.fill('甲');
  await textarea.press('x');
  await expect(textarea).toHaveValue('甲x');
  await expect(textarea).toBeFocused();

  await textarea.press('Escape');
  await page.keyboard.press('x');
  await expect(page.locator('.lineup-result')).toBeFocused();
});

test('Web 分组支持悬念揭晓并默认显示第一档', async ({ page }) => {
  await confirmNames(page, ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);

  await expect(page.getByText('悬念揭晓', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始分组' }).click();

  const resultRows = page.locator('.lineup-result tbody tr');
  await expect(resultRows).toHaveCount(2);
  await expect(resultRows.first().locator('.slow-reveal-cell')).toHaveCount(0);
  await expect(resultRows.nth(1).locator('.slow-reveal-cell')).toHaveCount(4);

  await resultRows.nth(1).locator('.slow-reveal-cell').first().click();
  await expect(resultRows.nth(1).locator('.slow-reveal-cell')).toHaveCount(3);
  await page.getByRole('button', { name: '显示全部' }).click();
  await expect(page.locator('.slow-reveal-cell')).toHaveCount(0);
});
