import { expect, test } from '@playwright/test';
import { launchTauri, stopProcess } from './helpers/tauri-app';

const applications = [
  { name: '普通版', path: process.env.TAURI_E2E_STANDARD_APP, title: '转盘' },
  { name: '猜蜜版', path: process.env.TAURI_E2E_CAIMI_APP, title: '猜蜜版 · 转盘' },
];

for (const application of applications) {
  test(`真实 Tauri ${application.name}可启动并进入分组页`, async ({}, testInfo) => {
    if (!application.path) throw new Error(`缺少 ${application.name}程序路径`);

    const dataDirectory = testInfo.outputPath('data');
    const running = await launchTauri(application.path, dataDirectory);

    try {
      const page = running.page;

      await expect(page).toHaveTitle(application.title);
      await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible();
      await expect(page.getByRole('button', { name: '转盘', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '分组', exact: true }).click();
      await expect(page).toHaveURL(/\/(?:caimi\/)?grouping$/);
      await expect(page.locator('.desktop-accordion-toggle').filter({ hasText: '排名' })).toBeVisible();
    } finally {
      await running.browser.close().catch(() => undefined);
      await stopProcess(running.process);
    }
  });
}

test('真实 Tauri 重启后恢复临时对战并锁定配置', async ({}, testInfo) => {
  const application = applications[0];
  if (!application.path) throw new Error('缺少普通版程序路径');
  const dataDirectory = testInfo.outputPath('data');
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];

  const first = await launchTauri(application.path, dataDirectory);
  try {
    const page = first.page;
    await page.getByRole('button', { name: '对战', exact: true }).click();
    const textarea = page.locator('.battle-config textarea');
    await textarea.fill(names.join('\n'));
    await textarea.press('Alt+Enter');
    await page.getByRole('radio', { name: '单败' }).check();
    await page.getByRole('button', { name: /^抽签/u }).click();
    await expect(page.locator('.battle-match')).toHaveCount(7);
    await expect(page.locator('.battle-result .result-heading')).toContainText('8 项 · 单败 · 输入顺序');
  } finally {
    await first.browser?.close().catch(() => undefined);
    await stopProcess(first.process);
  }

  const second = await launchTauri(application.path, dataDirectory);
  try {
    const page = second.page;
    await page.getByRole('button', { name: '对战', exact: true }).click();
    await expect(page.locator('.battle-match')).toHaveCount(7);
    await expect(page.locator('.battle-result .result-heading')).toContainText('8 项 · 单败 · 输入顺序');
    await expect(page.locator('.battle-config textarea')).toHaveValue(names.join('\n'));
    await expect(page.locator('.battle-config textarea')).toBeDisabled();
    await expect(page.getByRole('radio', { name: '单败' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '单败' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^抽签/u })).toBeDisabled();
  } finally {
    await second.browser?.close().catch(() => undefined);
    await stopProcess(second.process);
  }
});
