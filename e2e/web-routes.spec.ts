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

test('对战会先显示固定签位，再生成单败和双败轮次', async ({ page }) => {
  await page.goto('/#/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 8 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('radio', { name: '前 4 固定' }).check();

  await expect(page.locator('.battle-fixed-preview .battle-match')).toHaveCount(4);
  await expect(page.locator('.battle-fixed-preview .fixed strong')).toHaveText([
    '选手1', '选手4', '选手2', '选手3',
  ]);
  await page.getByRole('button', { name: /^执行/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(3);
  await expect(page.locator('.battle-round').first().locator('.battle-match')).toHaveCount(4);

  await page.getByRole('radio', { name: '双败' }).check();
  await page.getByRole('button', { name: /^执行/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(9);
  await expect(page.getByRole('heading', { name: '总决赛（必要时重赛）' })).toBeVisible();
});

test('同组不对战按名单前后半区生成跨组的1对2', async ({ page }) => {
  await page.goto('/#/battle');
  await page.locator('.battle-config textarea').fill('A1\nB1\nC1\nD1\nA2\nB2\nC2\nD2');
  await page.getByRole('button', { name: /^执行/ }).click();

  const matches = page.locator('.battle-round .battle-match');
  await expect(matches).toHaveCount(4);
  await expect(matches.first()).toContainText('第 1 组 · 第 1');
  await expect(matches.first()).toContainText(/第 [234] 组 · 第 2/);
});
