import { expect, test } from '@playwright/test';

test('网页版各个正式地址均可直接打开', async ({ page }) => {
  const routes = [
    { path: '/#/draw', title: '转盘抽签 · 转盘', caimi: false },
    { path: '/#/grouping', title: '分组 · 转盘', caimi: false },
    { path: '/#/battle', title: '对战 · 转盘', caimi: false },
    { path: '/#/caimi/draw', title: '猜蜜版 · 转盘抽签 · 转盘', caimi: true },
    { path: '/#/caimi/grouping', title: '猜蜜版 · 分组 · 转盘', caimi: true },
    { path: '/#/caimi/battle', title: '猜蜜版 · 对战 · 转盘', caimi: true },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page).toHaveTitle(route.title);
    await expect(page.locator('.app-shell')).toHaveClass(
      route.caimi ? /caimi-variant/ : /^(?!.*caimi-variant).*$/,
    );
    await expect(page.locator('.app-shell')).not.toHaveClass(/desktop-runtime/);
  }
});

test('旧分组地址仍可兼容打开', async ({ page }) => {
  await page.goto('/#/lineup');
  await expect(page).toHaveTitle('分组 · 转盘');
  await expect(page.locator('.lineup-page')).toBeVisible();
});

test('网页版对战页不显示桌面专用排名和历史栏', async ({ page }) => {
  await page.goto('/#/battle');
  await expect(page.locator('.battle-sidebar')).toHaveCount(0);
  await expect(page.locator('.battle-config')).toBeVisible();
});

test('对战赛制切换会保留单败和双败的配置', async ({ page }) => {
  await page.goto('/#/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 33 }, (_, index) => `选手${index + 1}`).join('\n'),
  );

  await expect(page.getByRole('radio', { name: '同组不对战1对2' })).toBeChecked();
  await expect(page.getByRole('group', { name: '名单顺序' })).toHaveCount(0);

  await page.getByRole('radio', { name: '单败' }).check();
  await expect(page.getByRole('radio', { name: '按排名' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /^前 \d+ 固定$/ })).toHaveCount(5);
  await page.getByRole('radio', { name: '前 16 固定' }).check();

  await page.getByRole('radio', { name: '同组不对战1对2' }).check();
  await expect(page.getByRole('group', { name: '固定位置' })).toHaveCount(0);
  await page.getByRole('radio', { name: '双败' }).check();
  await expect(page.getByRole('radio', { name: '前 16 固定' })).toBeChecked();
});
