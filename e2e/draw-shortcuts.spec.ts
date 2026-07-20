import { expect, test, type Page } from '@playwright/test';

async function importCandidates(page: Page, names: string[]) {
  await page.keyboard.press('w');
  const textarea = page.locator('.import-box textarea');
  await expect(textarea).toBeFocused();
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('[data-prize-id]')).toHaveCount(names.length);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/draw');
});

test('发布版默认不再带示例候选', async ({ page }) => {
  await expect(page.locator('[data-prize-id]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '候选' })).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ 添加候选' })).toBeVisible();
  await expect(page.locator('.candidate-board').getByRole('button', { name: '清空', exact: true })).toHaveCount(0);
  await expect(page.locator('button[title="恢复默认设置"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开启奢华转盘' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '＋ 保存为常用候选' })).toBeDisabled();
});

test('大窗口会继续放大转盘并保留候选栏空间', async ({ page }) => {
  const wheel = page.locator('.wheel-stage, .luxury-stage, .monopoly-stage');
  await expect(wheel).toHaveCount(1);

  await page.setViewportSize({ width: 1600, height: 1000 });
  const normalBox = await wheel.boundingBox();
  expect(normalBox).not.toBeNull();

  await page.setViewportSize({ width: 2560, height: 1440 });
  const largeBox = await wheel.boundingBox();
  const sidebarBox = await page.locator('.candidate-board').boundingBox();
  expect(largeBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(largeBox!.width).toBeGreaterThan(normalBox!.width * 1.45);
  expect(largeBox!.x + largeBox!.width).toBeLessThanOrEqual(sidebarBox!.x);
});

test('Web 不占用桌面 S 快捷键，全局方向键滚动当前折叠页', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  const settings = page.locator('.accordion-item.open .accordion-content');
  await expect(settings).toBeVisible();
  const dimensions = await settings.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => settings.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.evaluate(() => {
    (window as any).__WEB_S_DEFAULT_PREVENTED__ = null;
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 's') {
        (window as any).__WEB_S_DEFAULT_PREVENTED__ = event.defaultPrevented;
      }
    }, { once: true });
  });
  await page.keyboard.press('s');
  expect(await page.evaluate(() => (window as any).__WEB_S_DEFAULT_PREVENTED__)).toBe(false);
});

test('Ctrl 加方向键在两个页面调整字号并立即保存', async ({ page }) => {
  const shell = page.locator('.app-shell');
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => shell.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--font-scale').trim()
  ))).toBe('1.1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').fontScale)).toBe(1.1);

  await page.goto('/#/lineup');
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => shell.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--font-scale').trim()
  ))).toBe('1.2');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').fontScale)).toBe(1.2);

  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => shell.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--font-scale').trim()
  ))).toBe('1.1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').fontScale)).toBe(1.1);
});

test('文本区只用 Alt+回车确认，Esc 取消且单键不会越过输入作用域', async ({ page }) => {
  await page.keyboard.press('w');
  const textarea = page.locator('.import-box textarea');
  await textarea.fill('甲\n乙');
  await textarea.press('Enter');
  await expect(page.locator('[data-prize-id]')).toHaveCount(0);
  await expect(textarea).toHaveValue('甲\n乙\n');

  await textarea.press('t');
  await expect(textarea).toHaveValue('甲\n乙\nt');
  await expect(page.locator('[data-prize-id]')).toHaveCount(0);

  await textarea.press('Escape');
  await expect(textarea).toBeHidden();

  await page.keyboard.press('w');
  await page.locator('.import-box textarea').fill('甲\n乙');
  await page.locator('.import-box textarea').press('Alt+Enter');
  await expect(page.locator('[data-prize-id]')).toHaveCount(2);
});

test('R 清空候选，T 保留候选并开始新抽奖', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  await page.getByRole('button', { name: '统计 0' }).click();
  await page.getByLabel('上限').fill('8');
  await page.getByLabel('奖励金额').fill('88');
  await page.keyboard.press('Escape');

  await page.keyboard.press('t');
  await expect(page.locator('[data-prize-id]')).toHaveCount(2);
  await expect(page.locator('.wheel-status')).toContainText('等待开始');
  await page.getByRole('button', { name: '统计 0' }).click();
  await expect(page.getByLabel('上限')).toHaveValue('0');
  await expect(page.getByLabel('奖励金额')).toHaveValue('0');

  await page.getByLabel('上限').fill('6');
  await page.getByLabel('奖励金额').fill('66');
  await page.keyboard.press('Escape');

  await page.keyboard.press('r');
  await expect(page.locator('[data-prize-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '统计 0' }).click();
  await expect(page.getByLabel('上限')).toHaveValue('0');
  await expect(page.getByLabel('奖励金额')).toHaveValue('0');
});

test('X 进入候选后覆盖方向、权重、编辑、新增、停用、删除和 Esc 退出', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  const rows = page.locator('[data-prize-id]');

  await page.keyboard.press('x');
  await expect(rows.filter({ has: page.getByRole('textbox', { name: '第 1 个奖项名称' }) })).toHaveClass(/selected/);

  await page.keyboard.press('ArrowDown');
  const secondRow = rows.filter({ has: page.getByRole('textbox', { name: '第 2 个奖项名称' }) });
  await expect(secondRow).toHaveClass(/selected/);

  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('spinbutton', { name: '乙的权重' })).toHaveValue('2');

  await page.keyboard.press('Enter');
  const secondName = page.getByRole('textbox', { name: '第 2 个奖项名称' });
  await expect(secondName).toBeFocused();
  await secondName.fill('乙改');
  await secondName.press('Enter');
  await expect(secondName).toHaveValue('乙改');
  await page.keyboard.press('Enter');
  await secondName.fill('不保存');
  await secondName.press('Escape');
  await expect(secondName).toHaveValue('乙改');

  await page.keyboard.press('n');
  await expect(rows).toHaveCount(3);
  let thirdName = page.getByRole('textbox', { name: '第 3 个奖项名称' });
  await expect(thirdName).toBeFocused();
  await thirdName.fill('不保留');
  await thirdName.press('Escape');
  await expect(rows).toHaveCount(2);

  await page.keyboard.press('n');
  await expect(rows).toHaveCount(3);
  thirdName = page.getByRole('textbox', { name: '第 3 个奖项名称' });
  await expect(thirdName).toBeFocused();
  await thirdName.fill('丙');
  await thirdName.press('Enter');

  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '启用丙' })).toBeVisible();
  await page.keyboard.press('d');
  await expect(rows).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(page.locator('.prize-row.selected')).toHaveCount(0);
});

test('A/F 管理常用候选，Z 切换快捷键，数字设置可确认或取消', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  await page.getByRole('button', { name: '＋ 保存为常用候选' }).click();
  const commonName = page.getByLabel('给这组候选起个名字');
  await commonName.fill('双人名单');
  await commonName.press('Enter');

  await page.keyboard.press('r');
  await expect(page.locator('[data-prize-id]')).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(page.getByRole('heading', { name: '常用候选' })).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('[data-prize-id]')).toHaveCount(2);

  await page.keyboard.press('z');
  await expect(page.getByRole('heading', { name: '通用操作逻辑' })).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.getByRole('heading', { name: '通用操作逻辑' })).toBeHidden();

  await page.keyboard.press('m');
  const reward = page.getByLabel('奖励金额');
  await expect(reward).toBeFocused();
  await reward.press('z');
  await expect(reward).toBeFocused();
  await reward.fill('125.5');
  await reward.press('Enter');
  await expect(reward).not.toBeFocused();
  await expect(reward).toHaveValue('125.5');
  await page.keyboard.press('m');
  await reward.fill('300');
  await reward.press('Escape');
  await expect(reward).not.toBeFocused();
  await expect(reward).toHaveValue('125.5');

  const limit = page.getByLabel('上限');
  await limit.fill('12');
  await limit.press('Enter');
  await expect(limit).not.toBeFocused();
  await expect(limit).toHaveValue('12');
  await limit.fill('20');
  await limit.press('Escape');
  await expect(limit).toHaveValue('12');

  const interval = page.getByLabel('结果停留');
  await interval.fill('1.5');
  await interval.press('Enter');
  await expect(interval).not.toBeFocused();
  await expect(interval).toHaveValue('1.5');
});

test('空格执行抽奖，E 导出统计 JSON，输入框内空格不触发抽奖', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  await page.getByLabel('动画时长').fill('1');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Space');
  await expect(page.locator('.wheel-status')).toContainText('旋转中');
  await expect(page.locator('.wheel-status')).toContainText('等待开始', { timeout: 4_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('e');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/转盘统计.*\.json$/u);

  await page.keyboard.press('m');
  const reward = page.getByLabel('奖励金额');
  await reward.fill('12');
  await reward.press('Space');
  await expect(page.locator('.wheel-status')).toContainText('等待开始');
});
