import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

const UI_THEME_CASES = [
  {
    id: 'classic',
    buttonName: /经典.*深灰.*苔绿/u,
    canvas: '#171813',
    workspace: '#20211b',
    surface: '#efede6',
    surfaceRaised: '#f8f6f0',
    text: '#24251f',
    accent: '#e7ff72',
    accentStrong: '#829638',
    accentInk: '#465318',
    accentSoft: '#f2f6df',
    onDark: '#f6f3ea',
    surfaceRgb: 'rgb(239, 237, 230)',
    canvasRgb: 'rgb(23, 24, 19)',
  },
  {
    id: 'mist',
    buttonName: /雾蓝.*冷灰.*雾蓝/u,
    canvas: '#111820',
    workspace: '#192630',
    surface: '#e8eef2',
    surfaceRaised: '#f6f9fb',
    text: '#1f2b34',
    accent: '#8bc7e5',
    accentStrong: '#4f88a8',
    accentInk: '#28556d',
    accentSoft: '#e4f2f9',
    onDark: '#f1f7fa',
    surfaceRgb: 'rgb(232, 238, 242)',
    canvasRgb: 'rgb(17, 24, 32)',
  },
  {
    id: 'sand',
    buttonName: /暖砂.*暖灰.*琥珀/u,
    canvas: '#211a14',
    workspace: '#2c241c',
    surface: '#f1e9df',
    surfaceRaised: '#fbf7f1',
    text: '#332820',
    accent: '#ebb668',
    accentStrong: '#a86f27',
    accentInk: '#66451e',
    accentSoft: '#fbefdc',
    onDark: '#fff8ef',
    surfaceRgb: 'rgb(241, 233, 223)',
    canvasRgb: 'rgb(33, 26, 20)',
  },
] as const;

function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => {
    const values = color.slice(1).match(/.{2}/gu)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
    const [red, green, blue] = values.map((value) => (
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

async function importCandidates(page: Page, names: string[]) {
  await page.keyboard.press('w');
  const textarea = page.locator('.import-box textarea');
  await expect(textarea).toBeFocused();
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('[data-prize-id]')).toHaveCount(names.length);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/wheel', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
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

test('转盘音乐与音效可关闭并持久化', async ({ page }) => {
  const soundToggle = page.getByRole('button', { name: '关闭音乐与音效' });
  await expect(soundToggle).toHaveAttribute('aria-pressed', 'true');
  await soundToggle.click();
  await expect(page.getByRole('button', { name: '开启音乐与音效' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').soundEnabled
  ))).toBe(false);

  await page.reload();
  await expect(page.getByRole('button', { name: '开启音乐与音效' })).toHaveAttribute('aria-pressed', 'false');
});

test('三套界面风格即时切换并跨页面持久化', async ({ page }) => {
  const shell = page.locator('.app-shell');
  const classic = page.getByRole('button', { name: UI_THEME_CASES[0].buttonName });
  const mist = page.getByRole('button', { name: UI_THEME_CASES[1].buttonName });
  const sand = page.getByRole('button', { name: UI_THEME_CASES[2].buttonName });
  await expect(classic).toHaveAttribute('aria-pressed', 'true');

  const stageBackgrounds = new Set<string>();
  const workspaceRadii = new Set<string>();
  for (const theme of UI_THEME_CASES) {
    await page.getByRole('button', { name: theme.buttonName }).click();
    await expect(shell).toHaveAttribute('data-ui-theme', theme.id);
    const palette = await shell.evaluate((element) => {
      const style = getComputedStyle(element);
      const value = (name: string) => style.getPropertyValue(name).trim();
      return {
        canvas: value('--color-app-canvas'),
        workspace: value('--color-app-workspace'),
        surface: value('--color-app-surface'),
        surfaceRaised: value('--color-app-surface-raised'),
        text: value('--color-app-text'),
        accent: value('--color-app-accent'),
        accentStrong: value('--accent-strong'),
        accentInk: value('--accent-ink'),
        accentSoft: value('--accent-soft'),
        onDark: value('--on-dark'),
      };
    });
    expect(palette).toEqual({
      canvas: theme.canvas,
      workspace: theme.workspace,
      surface: theme.surface,
      surfaceRaised: theme.surfaceRaised,
      text: theme.text,
      accent: theme.accent,
      accentStrong: theme.accentStrong,
      accentInk: theme.accentInk,
      accentSoft: theme.accentSoft,
      onDark: theme.onDark,
    });
    expect(contrastRatio(theme.text, theme.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.onDark, theme.workspace)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.accentInk, theme.accentSoft)).toBeGreaterThanOrEqual(5);
    await expect(page.locator('body')).toHaveCSS('background-color', theme.canvasRgb);
    await expect(page.locator('.candidate-board')).toHaveCSS('background-color', theme.surfaceRgb);
    stageBackgrounds.add(await page.locator('.stage-panel').evaluate((element) => (
      getComputedStyle(element).backgroundImage
    )));
    workspaceRadii.add(await page.locator('.workspace').evaluate((element) => (
      getComputedStyle(element).borderRadius
    )));
  }
  expect(stageBackgrounds.size).toBe(3);
  expect(workspaceRadii.size).toBe(3);

  await mist.click();
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').uiTheme
  ))).toBe('mist');

  await page.goto('/grouping');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-theme', 'mist');
  await expect.poll(() => page.locator('.lineup-page').evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--color-app-workspace').trim()
  ))).toBe('#192630');
  await expect(page.locator('.lineup-config')).toHaveCSS('background-color', 'rgb(232, 238, 242)');

  await page.goto('/caimi/grouping');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-theme', 'mist');
  await expect(page.locator('.lineup-config')).toHaveCSS('background-color', 'rgb(232, 238, 242)');

  await page.goto('/caimi/wheel');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-theme', 'mist');
  await expect(page.locator('.candidate-board')).toHaveCSS('background-color', 'rgb(232, 238, 242)');

  await page.goto('/wheel');
  await sand.click();
  await expect(shell).toHaveAttribute('data-ui-theme', 'sand');
  await expect(page.locator('.candidate-board')).toHaveCSS('background-color', 'rgb(241, 233, 223)');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-theme', 'sand');

  await page.goto('/grouping');
  await page.locator('.lineup-config textarea').fill('主题确认项');
  await page.locator('.lineup-config textarea').press('Alt+Enter');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('.ui-confirm-dialog')).toHaveCSS('background-color', 'rgb(251, 247, 241)');
  await expect(page.locator('.ui-confirm-dialog')).toHaveCSS('color', 'rgb(51, 40, 32)');
});

test('界面风格选择器在最大字号下自适应换行且不溢出', async ({ page }) => {
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}');
    localStorage.setItem('wheel-settings-v1', JSON.stringify({ ...settings, fontScale: 3 }));
  });
  await page.reload();
  const picker = page.locator('.ui-theme-picker');
  await expect(picker).toBeVisible();
  const layout = await picker.evaluate((element) => {
    const cards = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    return {
      overflow: element.scrollWidth - element.clientWidth,
      columns: new Set(cards.map((card) => Math.round(card.x))).size,
      minWidth: Math.min(...cards.map((card) => card.width)),
      cardOverflow: Math.max(...[...element.querySelectorAll('button')].map((button) => (
        button.scrollWidth - button.clientWidth
      ))),
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.columns).toBeLessThanOrEqual(2);
  expect(layout.minWidth).toBeGreaterThanOrEqual(160);
  expect(layout.cardOverflow).toBeLessThanOrEqual(1);
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

test('俄罗斯轮盘支持大富翁动画并持久化选择', async ({ page }) => {
  await importCandidates(page, ['甲', '乙', '丙']);
  const monopolyButton = page.getByRole('button', { name: '大富翁' });

  await monopolyButton.click();
  await expect(page.getByRole('img', { name: '大富翁抽奖棋盘' })).toBeVisible();
  await page.getByRole('button', { name: '俄罗斯轮盘' }).click();
  await expect(monopolyButton).toHaveClass(/active/u);
  await expect(page.getByRole('img', { name: '大富翁抽奖棋盘' })).toBeVisible();

  await page.getByRole('button', { name: '关闭重来机制' }).click();
  await page.getByLabel('动画时长').fill('1');
  await page.getByRole('button', { name: '开始抽奖' }).click();
  await expect(page.locator('.wheel-status')).toContainText('旋转中');
  await expect(page.locator('.wheel-status')).toContainText('等待开始', { timeout: 4_000 });
  const eliminatedName = (await page.locator('.winner-reveal strong').textContent())?.trim();
  expect(eliminatedName).toBeTruthy();
  await expect.poll(() => page.locator('.cell-label').allTextContents()).not.toContain(eliminatedName);

  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}');
    return `${settings.mode}:${settings.animationStyle}`;
  })).toBe('roulette:threeD');
  await page.reload();
  await expect(page.getByRole('button', { name: '俄罗斯轮盘' })).toHaveClass(/active/u);
  await expect(page.getByRole('button', { name: '大富翁' })).toHaveClass(/active/u);
  await expect(page.getByRole('img', { name: '大富翁抽奖棋盘' })).toBeVisible();
});

test('俄罗斯大富翁用最少偶数格明确区分 2:1 和 1:1 剩余生命', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  const firstWeight = page.getByRole('spinbutton', { name: '甲的权重' });
  await firstWeight.fill('2');
  await firstWeight.press('Tab');

  await page.getByRole('button', { name: '俄罗斯轮盘' }).click();
  await page.getByRole('button', { name: '大富翁' }).click();
  await page.getByRole('button', { name: '关闭重来机制' }).click();

  const cells = page.locator('.cell-label');
  const firstCells = cells.filter({ hasText: /^甲$/u });
  const secondCells = cells.filter({ hasText: /^乙$/u });
  await expect(cells).toHaveCount(6);
  await expect(firstCells).toHaveCount(4);
  await expect(secondCells).toHaveCount(2);

  await firstWeight.fill('1');
  await firstWeight.press('Tab');
  await expect(cells).toHaveCount(4);
  await expect(firstCells).toHaveCount(2);
  await expect(secondCells).toHaveCount(2);
  const centerSize = await page.locator('.center-area').evaluate((element) => ({
    width: Number(element.getAttribute('width')),
    height: Number(element.getAttribute('height')),
  }));
  expect(centerSize.width).toBeGreaterThan(0);
  expect(centerSize.height).toBeGreaterThan(0);
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
  const wheelPageButton = page.locator('.page-switch').getByRole('button', { name: '转盘' });
  const initialButtonHeight = (await wheelPageButton.boundingBox())!.height;
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => shell.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--font-scale').trim()
  ))).toBe('1.1');
  expect((await wheelPageButton.boundingBox())!.height).toBeGreaterThan(initialButtonHeight);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}').fontScale)).toBe(1.1);

  await page.goto('/grouping');
  const lineupPanel = page.locator('.lineup-config');
  await expect(lineupPanel).toBeVisible();
  const initialPanelMetrics = await lineupPanel.evaluate((element) => ({
    padding: Number.parseFloat(getComputedStyle(element).paddingTop),
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => shell.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--font-scale').trim()
  ))).toBe('1.2');
  const enlargedPanelMetrics = await lineupPanel.evaluate((element) => ({
    padding: Number.parseFloat(getComputedStyle(element).paddingTop),
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(enlargedPanelMetrics.padding).toBeGreaterThan(initialPanelMetrics.padding);
  expect(enlargedPanelMetrics.radius).toBeGreaterThan(initialPanelMetrics.radius);
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

test('权重输入框内 Alt 加上下修改权重，普通上下移动候选', async ({ page }) => {
  await importCandidates(page, ['甲', '乙', '丙']);
  const rows = page.locator('[data-prize-id]');
  const firstWeight = page.getByRole('spinbutton', { name: '甲的权重' });

  await firstWeight.focus();
  await firstWeight.press('Alt+ArrowUp');
  await expect(firstWeight).toHaveValue('2');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveClass(/selected/u);

  const secondWeight = page.getByRole('spinbutton', { name: '乙的权重' });
  await secondWeight.focus();
  await secondWeight.press('ArrowDown');
  await expect(secondWeight).toHaveValue('1');
  await expect(rows.nth(2)).toHaveClass(/selected/u);
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
  const generalShortcuts = page.locator('.shortcut-general');
  await expect(generalShortcuts.getByText('增大 / 减小界面字号')).toBeVisible();
  await expect(page.locator('.shortcut-settings')).toHaveCount(0);
  await expect(page.getByText('切换自动保存历史')).toHaveCount(0);
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

test('统计栏快捷键增减上限并开始连续抽奖', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  await page.getByRole('button', { name: '统计 0' }).click();
  const limit = page.getByLabel('上限');

  await page.keyboard.press('Alt+ArrowUp');
  await expect(limit).toHaveValue('1');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(limit).toHaveValue('2');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(limit).toHaveValue('1');

  await page.keyboard.press('Alt+Enter');
  await expect(page.getByRole('button', { name: '停止连续抽奖' })).toBeVisible();
});

test('空格执行抽奖，E 导出统计 Excel，输入框内空格不触发抽奖', async ({ page }) => {
  await importCandidates(page, ['甲', '乙']);
  await page.getByRole('button', { name: '关闭重来机制' }).click();
  await page.getByRole('button', { name: '统计 0' }).click();
  await expect(page.getByRole('button', { name: 'Excel', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeDisabled();
  await page.getByLabel('动画时长').fill('1');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Space');
  await expect(page.locator('.wheel-status')).toContainText('旋转中');
  await expect(page.locator('.wheel-status')).toContainText('等待开始', { timeout: 4_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('e');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/转盘统计.*\.xlsx$/u);
  const exported = await readFile((await download.path())!);
  expect(exported.subarray(0, 2).toString()).toBe('PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported);
  const worksheet = workbook.worksheets[0];
  expect(worksheet.getColumn(1).values).not.toContain('重来一次');
  expect(worksheet.getColumn(3).values).toContain(1);

  await page.keyboard.press('m');
  const reward = page.getByLabel('奖励金额');
  await reward.fill('12');
  await reward.press('Space');
  await expect(page.locator('.wheel-status')).toContainText('等待开始');
});
