import { expect, test, type Page } from '@playwright/test';
import { installTauriMock } from './helpers/tauri-mock';

async function clearDesktopBattle(page: Page) {
  await page.getByRole('button', { name: '清空对战' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.battle-config textarea')).toBeEnabled();
  await expect(page.locator('.single-battle-bracket, .double-battle-bracket')).toHaveCount(0);
}

test('网页版各个正式地址均可直接打开', async ({ page }) => {
  const routes = [
    { path: '/wheel', title: '转盘', caimi: false },
    { path: '/grouping', title: '分组 · 转盘', caimi: false },
    { path: '/battle', title: '对战 · 转盘', caimi: false },
    { path: '/caimi/wheel', title: '猜蜜版 · 转盘', caimi: true },
    { path: '/caimi/grouping', title: '猜蜜版 · 分组 · 转盘', caimi: true },
    { path: '/caimi/battle', title: '猜蜜版 · 对战 · 转盘', caimi: true },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveTitle(route.title);
    await expect(page.locator('.app-shell')).toHaveClass(
      route.caimi ? /caimi-variant/ : /^(?!.*caimi-variant).*$/,
    );
    await expect(page.locator('.app-shell')).not.toHaveClass(/desktop-runtime/);
    await expect(page.locator('.page-switch').getByRole('button', { name: '对战' })).toHaveCount(0);
  }
});

test('抽奖、分组和对战切换时头部保持在同一位置', async ({ page }) => {
  const positions: number[] = [];
  for (const route of ['/wheel', '/grouping', '/battle']) {
    await page.goto(route);
    const box = await page.locator('.topbar-controls').boundingBox();
    positions.push(box!.x + box!.width / 2);
  }
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
});

test('网页版对战页只提示使用桌面版', async ({ page }) => {
  await page.goto('/battle');
  await expect(page.getByRole('main').getByText('对战仅支持桌面版')).toBeVisible();
  await expect(page.locator('.battle-config, .battle-result, .battle-sidebar')).toHaveCount(0);
});

test.describe('桌面版对战显示与配置', () => {
test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test('全局界面风格不会覆盖对战签表自己的配色令牌', async ({ page }) => {
  const battleBackgrounds = new Set<string>();
  for (const theme of [
    { id: 'mist', accent: '139 199 229', surface: 'rgb(232, 238, 242)' },
    { id: 'sand', accent: '235 182 104', surface: 'rgb(241, 233, 223)' },
  ]) {
    await page.goto('/wheel');
    await page.evaluate((uiTheme) => {
      const settings = JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}');
      localStorage.setItem('wheel-settings-v1', JSON.stringify({ ...settings, uiTheme }));
    }, theme.id);
    await page.goto('/battle');
    const shellAccent = await page.locator('.app-shell').evaluate((element) => (
      getComputedStyle(element).getPropertyValue('--app-accent-rgb').trim()
    ));
    const battleStyle = await page.locator('.battle-result').evaluate((element) => {
      const style = getComputedStyle(element);
      const colorProbe = document.createElement('span');
      colorProbe.style.color = 'var(--battle-background-color)';
      element.append(colorProbe);
      const selectedBackground = getComputedStyle(colorProbe).color;
      colorProbe.remove();
      return {
        accent: style.getPropertyValue('--app-accent-rgb').trim(),
        workspace: style.getPropertyValue('--workspace-deep').trim(),
        background: style.backgroundColor,
        selectedBackground,
      };
    });
    expect(shellAccent).toBe(theme.accent);
    expect(battleStyle.accent).toBe('231 255 114');
    expect(battleStyle.workspace).toBe('#22231d');
    expect(battleStyle.background).toBe(battleStyle.selectedBackground);
    battleBackgrounds.add(battleStyle.background);
    await expect(page.locator('.lineup-config')).toHaveCSS('background-color', theme.surface);
  }
  expect(battleBackgrounds.size).toBe(1);
});

test('对战可以全屏返回并持久化四类颜色和预设', async ({ page }) => {
  await page.goto('/battle');
  const battleResult = page.locator('.battle-result');
  const presets = page.getByRole('group', { name: '配色预设' });
  await expect(page.getByLabel(/颜色$/u)).toHaveCount(4);
  await expect(presets.getByRole('button')).toHaveCount(3);
  await expect(presets.getByRole('button', { name: 'One Dark' })).toHaveAttribute('aria-pressed', 'true');

  const toolbarBox = await page.locator('.battle-result-toolbar').boundingBox();
  const colorBox = await page.locator('.battle-color-controls').boundingBox();
  const fullscreenButtonBox = await page.getByRole('button', { name: '全屏' }).boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(colorBox).not.toBeNull();
  expect(fullscreenButtonBox).not.toBeNull();
  expect(fullscreenButtonBox!.x + fullscreenButtonBox!.width).toBeLessThan(colorBox!.x);
  expect(Math.abs(fullscreenButtonBox!.x - toolbarBox!.x)).toBeLessThan(1);
  expect(Math.abs(fullscreenButtonBox!.y - toolbarBox!.y)).toBeLessThan(1);

  await presets.getByRole('button', { name: 'Tokyo' }).click();
  await expect(page.getByLabel('背景框颜色')).toHaveValue('#1a1b26');
  await expect(page.getByLabel('文字颜色', { exact: true })).toHaveValue('#c0caf5');
  await expect(page.getByLabel('选手文字颜色')).toHaveValue('#7dcfff');
  await expect(page.getByLabel('对战框颜色')).toHaveValue('#414868');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battle-colors-v1:standard') ?? '{}'))).toEqual({
    background: '#1a1b26',
    text: '#c0caf5',
    participant: '#7dcfff',
    match: '#414868',
    preset: 'ocean',
  });

  await page.getByLabel('背景框颜色').fill('#123456');
  await page.getByLabel('文字颜色', { exact: true }).fill('#fedcba');
  await page.getByLabel('选手文字颜色').fill('#abcdef');
  await page.getByLabel('对战框颜色').fill('#654321');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battle-colors-v1:standard') ?? '{}'))).toEqual({
    background: '#123456',
    text: '#fedcba',
    participant: '#abcdef',
    match: '#654321',
    preset: 'custom',
  });
  await expect(presets.locator('button[aria-pressed="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: '全屏' }).click();
  await expect(battleResult).toHaveClass(/battle-fullscreen/u);
  await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
  const fullscreenBox = await battleResult.boundingBox();
  expect(fullscreenBox).toMatchObject({ x: 0, y: 0 });
  expect(fullscreenBox!.width).toBe(page.viewportSize()!.width);
  expect(fullscreenBox!.height).toBe(page.viewportSize()!.height);

  await page.keyboard.press('Escape');
  await expect(battleResult).toHaveClass(/battle-fullscreen/u);
  await page.keyboard.press('f');
  await expect(battleResult).not.toHaveClass(/battle-fullscreen/u);
  await page.reload();
  await expect(page.getByLabel('背景框颜色')).toHaveValue('#123456');
  await expect(page.getByLabel('文字颜色', { exact: true })).toHaveValue('#fedcba');
  await expect(page.getByLabel('选手文字颜色')).toHaveValue('#abcdef');
  await expect(page.getByLabel('对战框颜色')).toHaveValue('#654321');
  await expect(page.getByRole('group', { name: '配色预设' }).locator('button[aria-pressed="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Gruvbox' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gruvbox' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('选手文字颜色')).toHaveValue('#fabd2f');
});

test('对战配色预设按版本分别持久化', async ({ page }) => {
  await page.goto('/battle');
  await page.getByRole('button', { name: 'Tokyo' }).click();
  await page.goto('/caimi/battle');
  await expect(page.getByRole('button', { name: 'One Dark' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Gruvbox' }).click();

  expect(await page.evaluate(() => ({
    standard: JSON.parse(localStorage.getItem('battle-colors-v1:standard') ?? '{}').preset,
    caimi: JSON.parse(localStorage.getItem('battle-colors-v1:caimi') ?? '{}').preset,
  }))).toEqual({ standard: 'ocean', caimi: 'sunset' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gruvbox' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/battle');
  await expect(page.getByRole('button', { name: 'Tokyo' })).toHaveAttribute('aria-pressed', 'true');
});

test('对战赛制切换会保留单败和双败的配置', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 33 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');

  const previewSettings = page.locator('.preview-panel .battle-preview-settings');
  await expect(previewSettings).toBeVisible();
  await expect(previewSettings.getByRole('radio')).toHaveCount(3);
  await expect(page.locator('.lineup-config input[type="radio"]')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '同组不对战1对2' })).toBeChecked();
  await expect(page.getByRole('group', { name: '名单顺序' })).toHaveCount(0);

  await page.getByRole('radio', { name: '单败' }).check();
  await expect(page.getByRole('radio', { name: '按排名' })).toBeEnabled();
  await expect(page.getByRole('radio', { name: '全随机' })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^前 \d+ 固定$/ })).toHaveCount(5);
  await expect(previewSettings.getByRole('radio')).toHaveCount(11);
  await page.getByRole('radio', { name: '前 16 固定' }).check();

  await page.getByRole('radio', { name: '同组不对战1对2' }).check();
  await expect(page.getByRole('group', { name: '固定位置' })).toHaveCount(0);
  await page.getByRole('radio', { name: '双败' }).check();
  await expect(page.getByRole('radio', { name: '前 16 固定' })).toBeChecked();
});

test('宽屏并排显示三组对战选项', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 33 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();

  const groups = page.locator('.battle-preview-settings fieldset');
  await expect(groups).toHaveCount(3);
  const boxes = await groups.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y))).toBeLessThan(2);
  expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(3);
  expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))).toBeLessThan(1);
  const settingsBox = await page.locator('.battle-preview-settings').boundingBox();
  expect(settingsBox!.height).toBeLessThan(page.viewportSize()!.height / 2);
});

test('对战预览控件放大后逐行铺满且文字不溢出', async ({ page }) => {
  const names = Array.from({ length: 16 }, (_, index) => `选手${index + 1}`).join('\n');
  const prepareSingleBattle = async () => {
    await page.locator('.battle-config textarea').fill(names);
    await page.locator('.battle-config textarea').press('Alt+Enter');
    await page.getByRole('radio', { name: '单败' }).check();
  };
  const boxes = (selector: string) => page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      overflow: element.scrollWidth - element.clientWidth,
    };
  }));

  await page.goto('/battle');
  await expect(page.locator('main#battle')).toHaveAttribute('aria-keyshortcuts', 'A Z X W S L');
  await expect(page.locator('.battle-result')).toHaveAttribute('aria-keyshortcuts', 'F U J H K L W S');
  await prepareSingleBattle();
  const normalGroups = await boxes('.battle-option-groups > fieldset');
  expect(normalGroups).toHaveLength(3);
  expect(new Set(normalGroups.map((item) => Math.round(item.x))).size).toBe(3);
  expect(Math.max(...normalGroups.map((item) => item.y)) - Math.min(...normalGroups.map((item) => item.y))).toBeLessThan(2);
  const normalGenerate = (await boxes('.battle-generate-button'))[0];
  const normalRadios = await boxes('.battle-option-groups label');
  expect(Math.min(...normalRadios.map((item) => item.height))).toBeGreaterThanOrEqual(55);
  expect(normalGenerate.height).toBeGreaterThanOrEqual(55);
  await expect(page.locator('.battle-option-actions .battle-generate-button')).toHaveCount(1);
  const normalSettingsWidth = await page.locator('.battle-preview-settings').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(normalSettingsWidth.scroll - normalSettingsWidth.client).toBeLessThanOrEqual(1);

  const orderPositions = await page.locator('.battle-order-group label').evaluateAll((elements) => (
    elements.map((element) => element.getBoundingClientRect().y)
  ));
  expect(orderPositions[1]).toBeGreaterThan(orderPositions[0]);

  await page.evaluate(() => localStorage.setItem('wheel-settings-v1', JSON.stringify({ fontScale: 3 })));
  await page.reload();
  await prepareSingleBattle();
  const largeGroups = await boxes('.battle-option-groups > fieldset');
  expect(new Set(largeGroups.map((item) => Math.round(item.x))).size).toBe(1);
  expect(new Set(largeGroups.map((item) => Math.round(item.y))).size).toBe(3);
  expect(Math.max(...largeGroups.map((item) => item.width)) - Math.min(...largeGroups.map((item) => item.width))).toBeLessThan(1);
  const largeActions = await boxes('.battle-option-actions > label, .battle-option-actions > button');
  expect(new Set(largeActions.map((item) => Math.round(item.x))).size).toBe(1);
  expect(new Set(largeActions.map((item) => Math.round(item.y))).size).toBe(3);
  expect(Math.max(...largeActions.map((item) => item.width)) - Math.min(...largeActions.map((item) => item.width))).toBeLessThan(1);
  const largeRadios = await boxes('.battle-option-groups label');
  expect(largeRadios.every((item) => item.overflow <= 1)).toBe(true);
  const largeGenerate = (await boxes('.battle-generate-button'))[0];
  expect(largeGenerate.height).toBeGreaterThan(normalGenerate.height * 1.45);
  const largeSettingsWidth = await page.locator('.battle-preview-settings').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(largeSettingsWidth.scroll - largeSettingsWidth.client).toBeLessThanOrEqual(1);
});

test('对战支持悬念揭晓并可逐格显示', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const firstMatch = page.locator('.single-bracket-side .battle-match').first();
  const firstReveal = firstMatch.getByRole('button', { name: /^揭晓 /u }).first();
  const firstName = (await firstReveal.getAttribute('aria-label'))!.replace(/^揭晓 /u, '');
  const firstInputs = firstMatch.locator('input[type="number"]');
  await firstInputs.nth(0).fill('4');
  await firstInputs.nth(1).fill('1');
  await firstInputs.nth(1).press('Enter');

  const finalMatch = page.locator('.single-bracket-final .battle-match');
  await expect(finalMatch.locator('.battle-reveal-slot')).toHaveCount(1);
  await expect(finalMatch).toContainText(firstName);
  await expect(page.getByRole('button', { name: '显示全部' })).toBeVisible();
  await finalMatch.getByRole('button', { name: `揭晓 ${firstName}` }).click();
  await expect(finalMatch.locator('.battle-reveal-slot')).toHaveCount(0);
  await expect(finalMatch.locator('.battle-side strong').first()).toContainText(firstName);
});

test('对战选手名默认字号加倍', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect(page.locator('.battle-match strong').first()).toHaveCSS('font-size', '24px');
});

test('字号放大时首轮间距和对战框同步扩张', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁\n戊\n己\n庚\n辛');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  const firstColumn = page.locator('.single-bracket-side.left .battle-round:first-child > div');
  const normalCard = await firstColumn.locator('.battle-match').first().boundingBox();
  const normalGap = await firstColumn.evaluate((element) => {
    const rects = [...element.querySelectorAll<HTMLElement>('.battle-match')].map((match) => match.getBoundingClientRect());
    return rects[1].top - rects[0].bottom;
  });
  expect(normalCard).not.toBeNull();

  await page.evaluate(() => localStorage.setItem('wheel-settings-v1', JSON.stringify({ fontScale: 3 })));
  await page.reload();
  await expect(page.locator('.single-battle-bracket')).toBeVisible();
  const largeColumn = page.locator('.single-bracket-side.left .battle-round:first-child > div');
  const largeCard = await largeColumn.locator('.battle-match').first().boundingBox();
  const largeGap = await largeColumn.evaluate((element) => {
    const rects = [...element.querySelectorAll<HTMLElement>('.battle-match')].map((match) => match.getBoundingClientRect());
    return rects[1].top - rects[0].bottom;
  });
  expect(largeCard!.width).toBeGreaterThan(normalCard!.width * 1.4);
  expect(largeGap).toBeGreaterThan(normalGap * 1.4);
});
});

test('大字号下分组预览和结果载具不溢出', async ({ page }) => {
  await page.goto('/grouping');
  await page.evaluate(() => localStorage.setItem('wheel-settings-v1', JSON.stringify({ fontScale: 3 })));
  await page.reload();
  await page.locator('.names-field textarea').fill('甲\n乙\n丙\n丁\n戊\n己\n庚\n辛');
  await page.locator('.names-field textarea').press('Alt+Enter');
  const preview = page.locator('.preview-panel');
  const rows = page.locator('.preview-row');
  await expect(rows).toHaveCount(8);
  const previewOverflow = await preview.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(previewOverflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '开始分组' }).click();
  const result = page.locator('.lineup-result');
  const resultOverflow = await result.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(resultOverflow).toBeLessThanOrEqual(1);
});

test.describe('桌面版对战签表交互', () => {
test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test('对战方向键在边缘也能绕行到其他比分框', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁\n戊\n己\n庚\n辛');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  const inputs = page.locator('.battle-result .battle-side input:not(:disabled)');
  await expect(inputs).toHaveCount(8);
  await inputs.first().focus();
  const firstId = await inputs.first().getAttribute('data-battle-match-id');
  await inputs.first().press('ArrowLeft');
  await expect(page.locator('.battle-result input:focus')).toHaveAttribute('data-battle-match-id', /.+/u);
  expect(await page.locator('.battle-result input:focus').getAttribute('data-battle-match-id')).not.toBe(firstId);
});

test('对战会先显示固定签位，再生成单败和双败轮次', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 8 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('radio', { name: '前 4 固定' }).check();

  await expect(page.locator('.battle-preview-bracket .battle-match')).toHaveCount(4);
  await expect(page.locator('.battle-preview-bracket .fixed strong')).toHaveText([
    '选手1', '选手4', '选手2', '选手3',
  ]);
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect(page.locator('.single-battle-bracket')).toBeVisible();
  const leftBracket = page.locator('.single-bracket-side.left');
  const finalBracket = page.locator('.single-bracket-final');
  const rightBracket = page.locator('.single-bracket-side.right');
  await expect(leftBracket).toBeVisible();
  await expect(rightBracket).toBeVisible();
  await expect(finalBracket.locator('.battle-match')).toHaveCount(1);
  const [leftBox, finalBox, rightBox] = await Promise.all([
    leftBracket.boundingBox(),
    finalBracket.boundingBox(),
    rightBracket.boundingBox(),
  ]);
  expect(leftBox!.x + leftBox!.width).toBeLessThan(finalBox!.x);
  expect(finalBox!.x + finalBox!.width).toBeLessThan(rightBox!.x);

  await clearDesktopBattle(page);
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 8 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '双败' }).check();
  const doubleGrandFinal = page.getByRole('checkbox', { name: '双总决赛' });
  await expect(doubleGrandFinal).not.toBeChecked();
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(8);
  await expect(page.locator('.battle-side.waiting.winner')).toHaveCount(0);
  const doubleScroll = page.locator('.double-battle-scroll');
  const [winnerSectionBox, loserSectionBox, doubleFinalBox] = await battleElementBoxes(page, [
    '.double-winner-section', '.double-loser-section', '.double-final-section',
  ]);
  expect(doubleFinalBox!.x).toBeGreaterThan(winnerSectionBox!.x + winnerSectionBox!.width);
  expect(Math.abs(doubleFinalBox!.y + doubleFinalBox!.height / 2 - loserSectionBox!.y)).toBeLessThan(2);
  const [winnerFinalBox, loserFinalBox, grandFinalBox] = await battleElementBoxes(page, [
    '.double-winner-section .battle-round:last-child .battle-match',
    '.double-loser-section .battle-round:last-child .battle-match',
    '.double-final-section .battle-round:first-child .battle-match',
  ]);
  const bracketFinalMiddle = (
    winnerFinalBox!.y + winnerFinalBox!.height / 2
    + loserFinalBox!.y + loserFinalBox!.height / 2
  ) / 2;
  expect(Math.abs(grandFinalBox!.y + grandFinalBox!.height / 2 - bracketFinalMiddle)).toBeLessThan(4);
  await expect(page.locator('.double-battle-bracket')).not.toContainText(/顺位|W\d+-M\d+|L\d+-M\d+/u);
  await expect(page.locator('.double-winner-section .battle-round').nth(0).getByRole('heading')).toHaveText('1/4');
  await expect(page.locator('.double-winner-section .battle-round').nth(1).getByRole('heading')).toHaveText('半决赛');
  await expect(page.locator('.double-winner-section .battle-round').nth(2).getByRole('heading')).toHaveText('决赛');
  const winnerCenters = await battleRoundMatchCenters(page.locator('.double-winner-section .battle-round'));
  const loserCenters = await battleRoundMatchCenters(page.locator('.double-loser-section .battle-round'));
  const winnerEdges = await battleRoundMatchEdges(page.locator('.double-winner-section .battle-round'));
  const loserEdges = await battleRoundMatchEdges(page.locator('.double-loser-section .battle-round'));
  expect(winnerCenters[1]).toBeGreaterThan(winnerCenters[0]);
  expect(winnerCenters[2]).toBeGreaterThan(winnerCenters[1]);
  expect(Math.max(...winnerEdges.map((edge) => edge.lastBottom)) - Math.min(...winnerEdges.map((edge) => edge.lastBottom))).toBeLessThan(2);
  expect(Math.abs(loserCenters[1] - loserCenters[0])).toBeLessThan(2);
  expect(loserCenters[2]).toBeLessThan(loserCenters[1]);
  expect(Math.abs(loserCenters[3] - loserCenters[2])).toBeLessThan(2);
  expect(Math.max(...loserEdges.map((edge) => edge.firstTop)) - Math.min(...loserEdges.map((edge) => edge.firstTop))).toBeLessThan(2);
  await expect(page.locator('[data-battle-stage="winner"][data-battle-level="2"][data-battle-position="1"]'))
    .toContainText('W1 P1');
  await doubleScroll.focus();
  const scrollBefore = await doubleScroll.evaluate((element) => element.scrollLeft);
  await doubleScroll.press('k');
  await expect.poll(() => doubleScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(scrollBefore);
  const firstWinnerMatch = page.locator('[data-battle-stage="winner"][data-battle-level="1"][data-battle-position="1"]');
  await firstWinnerMatch.focus();
  await firstWinnerMatch.press('ArrowDown');
  await expect(firstWinnerMatch.locator('input[type="number"]').last()).toBeFocused();
  await firstWinnerMatch.locator('input[type="number"]').last().press('ArrowUp');
  await expect(firstWinnerMatch.locator('input[type="number"]').first()).toBeFocused();
  await firstWinnerMatch.locator('input[type="number"]').first().press('ArrowRight');
  await expect(page.locator('.double-battle-bracket input:focus')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '重赛', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '总决赛', exact: true })).toHaveCount(1);

  await clearDesktopBattle(page);
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 8 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '双败' }).check();
  await doubleGrandFinal.check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(9);
  await expect(page.getByRole('heading', { name: '重赛', exact: true })).toBeVisible();
});

test('16 人双败逐列向分界线收拢', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill(
    Array.from({ length: 16 }, (_, index) => `选手${index + 1}`).join('\n'),
  );
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '双败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const winnerRounds = page.locator('.double-winner-section .battle-round');
  const loserRounds = page.locator('.double-loser-section .battle-round');
  await expect(winnerRounds).toHaveCount(4);
  await expect(loserRounds).toHaveCount(6);
  const winnerEdges = await battleRoundMatchEdges(winnerRounds);
  const loserEdges = await battleRoundMatchEdges(loserRounds);
  expect(Math.max(...winnerEdges.map((edge) => edge.lastBottom)) - Math.min(...winnerEdges.map((edge) => edge.lastBottom))).toBeLessThan(2);
  expect(Math.max(...loserEdges.map((edge) => edge.firstTop)) - Math.min(...loserEdges.map((edge) => edge.firstTop))).toBeLessThan(2);

  const [winnerFinalBox, loserFinalBox, grandFinalBox] = await battleElementBoxes(page, [
    '.double-winner-section .battle-round:last-child .battle-match',
    '.double-loser-section .battle-round:last-child .battle-match',
    '.double-final-section .battle-round:first-child .battle-match',
  ]);
  const bracketFinalMiddle = (
    winnerFinalBox!.y + winnerFinalBox!.height / 2
    + loserFinalBox!.y + loserFinalBox!.height / 2
  ) / 2;
  expect(Math.abs(grandFinalBox!.y + grandFinalBox!.height / 2 - bracketFinalMiddle)).toBeLessThan(4);
});

test('同组不对战按相邻两项成组并生成跨组的1对2', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('A1\nA2\nB1\nB2\nC1\nC2\nD1\nD2');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('checkbox', { name: '悬念揭晓' }).uncheck();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const matches = page.locator('[data-battle-stage="single"][data-battle-level="1"]');
  await expect(matches).toHaveCount(4);
  for (let index = 0; index < await matches.count(); index += 1) {
    const entries = await matches.nth(index).locator('.battle-side strong').allTextContents();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatch(/1$/u);
    expect(entries[1]).toMatch(/2$/u);
    expect(entries[0][0]).not.toBe(entries[1][0]);
  }
});

test('同组不对战至少需要四组八项', async ({ page }) => {
  await page.goto('/battle');
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill('A1\nA2\nB1\nB2\nC1\nC2');
  await textarea.press('Alt+Enter');
  await expect(page.getByText('需 8 项', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^抽签/ })).toBeDisabled();

  await textarea.fill('A1\nA2\nB1\nB2\nC1\nC2\nD1\nD2');
  await textarea.press('Alt+Enter');
  await expect(page.getByRole('button', { name: /^抽签/ })).toBeEnabled();
});

test('单败和双败至少需要四项', async ({ page }) => {
  await page.goto('/battle');
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill('甲\n乙\n丙');
  await textarea.press('Alt+Enter');

  for (const format of ['单败', '双败']) {
    await page.getByRole('radio', { name: format, exact: true }).check();
    await expect(page.getByText('至少 4 项', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^抽签/u })).toBeDisabled();
  }

  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await expect(page.getByRole('button', { name: /^抽签/u })).toBeEnabled();
});

test('对战比分方向键移动、Alt 调整、Enter 录入零分且 Esc 取消', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const matches = page.locator('.single-bracket-side .battle-match');
  const firstInputs = matches.nth(0).locator('input[type="number"]');
  await page.locator('.battle-result').focus();
  await page.locator('.battle-result').press('ArrowRight');
  await expect(firstInputs.nth(0)).toBeFocused();
  await firstInputs.nth(0).press('ArrowDown');
  await expect(firstInputs.nth(1)).toBeFocused();
  await firstInputs.nth(0).focus();
  await firstInputs.nth(0).fill('4');
  await expect(firstInputs.nth(0)).toHaveValue('4');
  await firstInputs.nth(1).focus();
  await firstInputs.nth(1).fill('1');
  await firstInputs.nth(1).press('Enter');
  await expect(matches.nth(0).locator('.battle-side.winner')).toHaveCount(1);
  await firstInputs.nth(1).evaluate((input) => (input as HTMLInputElement).blur());
  await page.keyboard.press('ArrowUp');
  await expect(firstInputs.nth(0)).toBeFocused();

  const secondInputs = matches.nth(1).locator('input[type="number"]');
  await secondInputs.nth(1).focus();
  await secondInputs.nth(1).press('Enter');
  await expect(secondInputs.nth(0)).toHaveValue('4');
  await expect(secondInputs.nth(1)).toHaveValue('0');
  await secondInputs.nth(1).focus();
  await secondInputs.nth(1).press('Alt+ArrowUp');
  await expect(secondInputs.nth(1)).toHaveValue('1');
  await secondInputs.nth(1).press('Alt+ArrowDown');
  await expect(secondInputs.nth(1)).toHaveValue('0');

  await page.getByRole('button', { name: '全屏' }).click();
  await secondInputs.nth(1).focus();
  await secondInputs.nth(1).fill('2');
  await secondInputs.nth(1).press('Escape');
  await expect(secondInputs.nth(1)).toHaveValue('0');
  await expect(page.locator('.battle-result')).toHaveClass(/battle-fullscreen/u);
});

test('桌面对战可以修改赛果、传播下游并导出 JSON 和 Excel', async ({ page }) => {
  await page.goto('/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('checkbox', { name: '悬念揭晓' }).uncheck();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const firstRoundMatches = page.locator('.single-bracket-side .battle-match');
  const finalMatch = page.locator('.single-bracket-final .battle-match');
  const firstWinner = (await firstRoundMatches.nth(0).locator('.battle-side strong').first().textContent())!;
  await enterBattleScore(firstRoundMatches.nth(0), 4, 1);
  await expect(finalMatch).toContainText(firstWinner);
  await expect(finalMatch).toContainText('S1 P2');

  const secondMatchInputs = firstRoundMatches.nth(1).locator('input[type="number"]');
  await secondMatchInputs.nth(1).fill('1');
  await secondMatchInputs.nth(1).press('Tab');
  await expect(secondMatchInputs.nth(0)).toHaveValue('4');
  await expect(finalMatch.locator('input[type="number"]').first()).toBeEnabled();
  await enterBattleScore(finalMatch, 4, 1);
  await expect(finalMatch.locator('.battle-side.winner')).toHaveCount(1);

  const lockedSourceInputs = firstRoundMatches.nth(0).locator('input[type="number"]');
  await expect(lockedSourceInputs.nth(0)).toBeDisabled();
  await expect(lockedSourceInputs.nth(0)).toHaveAttribute('title', '下游已有比分');
  await expect(lockedSourceInputs.nth(1)).toBeEnabled();

  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_text_file').length
  ))).toBe(1);
  const jsonExport = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_text_file').at(-1).args,
  ));
  expect(jsonExport).toMatchObject({ prefix: '对战状态', extension: 'json' });
  const exported = JSON.parse(jsonExport.content);
  expect(exported.kind).toBe('battle-tmp');
  expect(exported.matches[0]).toMatchObject({ stage: 'single', level: 1, position: 1 });
  expect(exported.state_json).toBeUndefined();

  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').length
  ))).toBe(1);
  const excelExport = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').at(-1).args,
  ));
  expect(excelExport).toMatchObject({ prefix: '对战签表', extension: 'xlsx' });
  expect(excelExport.bytes.slice(0, 2)).toEqual([0x50, 0x4b]);
});
});

async function enterBattleScore(match: import('@playwright/test').Locator, up: number, down: number) {
  const inputs = match.locator('input[type="number"]');
  await inputs.nth(0).fill(String(up));
  await inputs.nth(0).press('Tab');
  await expect(inputs.nth(1)).toBeEnabled();
  await inputs.nth(1).fill(String(down));
  await inputs.nth(1).press('Tab');
}

async function battleRoundMatchCenters(rounds: import('@playwright/test').Locator): Promise<number[]> {
  return rounds.evaluateAll((elements) => elements.map((round) => {
    const matches = [...round.querySelectorAll('.battle-match')];
    return matches.reduce((sum, match) => {
      const box = match.getBoundingClientRect();
      return sum + box.top + box.height / 2;
    }, 0) / matches.length;
  }));
}

async function battleRoundMatchEdges(rounds: import('@playwright/test').Locator): Promise<{
  firstTop: number;
  lastBottom: number;
}[]> {
  return rounds.evaluateAll((elements) => elements.map((round) => {
    const matches = [...round.querySelectorAll('.battle-match')];
    const first = matches[0].getBoundingClientRect();
    const last = matches.at(-1)!.getBoundingClientRect();
    return { firstTop: first.top, lastBottom: last.bottom };
  }));
}

async function battleElementBoxes(page: Page, selectors: string[]): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}[]> {
  return page.locator('.double-battle-bracket').evaluate((bracket, targetSelectors) => (
    targetSelectors.map((selector) => {
      const target = bracket.querySelector(selector);
      if (!target) throw new Error(`找不到双败布局元素：${selector}`);
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
  ), selectors);
}
