import { expect, test } from '@playwright/test';

test('网页版四个正式地址均可直接打开', async ({ page }) => {
  const routes = [
    { path: '/#/draw', title: '转盘抽签 · 转盘', caimi: false },
    { path: '/#/lineup', title: '分组 · 转盘', caimi: false },
    { path: '/#/caimi/draw', title: '猜蜜版 · 转盘抽签 · 转盘', caimi: true },
    { path: '/#/caimi/lineup', title: '猜蜜版 · 分组 · 转盘', caimi: true },
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
