import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

async function openRankingPanel(page: import('@playwright/test').Page) {
  const section = page.locator('.desktop-accordion').filter({ hasText: '排名' }).first();
  const toggle = section.locator('.desktop-accordion-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(section.locator('.rank-person-form')).toBeVisible();
}

test('Web SQLite 跨刷新保存并恢复对战临时状态', async ({ page }) => {
  await page.goto('/battle');
  const names = ['甲', '乙', '丙', '丁'];
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator('.battle-match')).toHaveCount(3);

  await page.reload();
  await expect(page.locator('.battle-match')).toHaveCount(3);
  await expect(page.locator('.battle-config textarea')).toHaveValue(names.join('\n'));
  await expect(page.locator('.battle-config textarea')).toBeDisabled();
});

test('Web SQLite 保存排名和分组历史并可在刷新后读取', async ({ page }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);
  await page.locator('.rank-person-form input').fill('甲');
  await page.locator('.rank-person-form').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.ranked-user-list').getByText('甲', { exact: true })).toBeVisible();

  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('button', { name: '按输入顺序分组' }).click();
  await page.getByRole('button', { name: '保存到历史' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeDisabled();

  await page.reload();
  await openRankingPanel(page);
  await expect(page.locator('.ranked-user-list').getByText('甲', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '分组历史' }).click();
  await expect(page.locator('.history-panel .ui-history-row')).toHaveCount(1);
});

test('Web SQLite 可以导出浏览器数据库备份', async ({ page }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SQLite' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^转盘数据库-\d{4}-\d{2}-\d{2}\.sqlite3$/u);
});

test('Web SQLite 会迁移旧版常用候选存储', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wheel-common-selections-v1', JSON.stringify([{
      version: 1,
      id: 'legacy-selection',
      name: '旧名单',
      createdAt: 1_700_000_000_000,
      prizes: [{ id: 'legacy-prize', name: '甲', color: '#fff', enabled: true }],
    }]));
  });
  await page.goto('/wheel');
  await page.locator('.common-panel .accordion-toggle').click();
  await expect(page.getByRole('group', { name: '常用候选：旧名单' })).toBeVisible();
});
