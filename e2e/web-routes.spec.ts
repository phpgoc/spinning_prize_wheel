import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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

test('抽奖、分组和对战切换时头部保持在同一位置', async ({ page }) => {
  const positions: number[] = [];
  for (const route of ['/#/draw', '/#/grouping', '/#/battle']) {
    await page.goto(route);
    const box = await page.locator('.topbar-controls').boundingBox();
    positions.push(box!.x + box!.width / 2);
  }
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
});

test('网页版对战页不显示桌面专用排名和历史栏', async ({ page }) => {
  await page.goto('/#/battle');
  await expect(page.locator('.battle-sidebar')).toHaveCount(0);
  await expect(page.locator('.battle-config')).toBeVisible();
});

test('对战可以全屏返回并持久化四类颜色', async ({ page }) => {
  await page.goto('/#/battle');
  const battleResult = page.locator('.battle-result');
  await expect(page.getByLabel(/颜色$/u)).toHaveCount(4);

  await page.getByLabel('背景框颜色').fill('#123456');
  await page.getByLabel('文字颜色', { exact: true }).fill('#fedcba');
  await page.getByLabel('选手文字颜色').fill('#abcdef');
  await page.getByLabel('对战框颜色').fill('#654321');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battle-colors-v1:standard') ?? '{}'))).toEqual({
    background: '#123456',
    text: '#fedcba',
    participant: '#abcdef',
    match: '#654321',
  });

  await page.getByRole('button', { name: '全屏' }).click();
  await expect(battleResult).toHaveClass(/battle-fullscreen/u);
  await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
  const fullscreenBox = await battleResult.boundingBox();
  expect(fullscreenBox).toMatchObject({ x: 0, y: 0 });
  expect(fullscreenBox!.width).toBe(page.viewportSize()!.width);
  expect(fullscreenBox!.height).toBe(page.viewportSize()!.height);

  await page.keyboard.press('Escape');
  await expect(battleResult).not.toHaveClass(/battle-fullscreen/u);
  await page.reload();
  await expect(page.getByLabel('背景框颜色')).toHaveValue('#123456');
  await expect(page.getByLabel('文字颜色', { exact: true })).toHaveValue('#fedcba');
  await expect(page.getByLabel('选手文字颜色')).toHaveValue('#abcdef');
  await expect(page.getByLabel('对战框颜色')).toHaveValue('#654321');
});

test('对战赛制切换会保留单败和双败的配置', async ({ page }) => {
  await page.goto('/#/battle');
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
  await expect(page.getByRole('radio', { name: '按排名' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /^前 \d+ 固定$/ })).toHaveCount(5);
  await expect(previewSettings.getByRole('radio')).toHaveCount(10);
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
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('radio', { name: '前 4 固定' }).check();

  await expect(page.locator('.battle-fixed-preview .battle-match')).toHaveCount(4);
  await expect(page.locator('.battle-fixed-preview .fixed strong')).toHaveText([
    '选手1', '选手4', '选手2', '选手3',
  ]);
  await page.getByRole('button', { name: /^执行/ }).click();
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

  await page.getByRole('radio', { name: '双败' }).check();
  await page.getByRole('button', { name: /^执行/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(9);
  await expect(page.locator('.battle-side.waiting.winner')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '总决赛（必要时重赛）' })).toBeVisible();
});

test('同组不对战按相邻两项成组并生成跨组的1对2', async ({ page }) => {
  await page.goto('/#/battle');
  await page.locator('.battle-config textarea').fill('A1\nA2\nB1\nB2\nC1\nC2\nD1\nD2');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('button', { name: /^执行/ }).click();

  const matches = page.locator('.battle-round .battle-match');
  await expect(matches).toHaveCount(4);
  const matchTexts = await matches.allTextContents();
  for (const matchText of matchTexts) {
    const entries = [...matchText.matchAll(/第 (\d+) 组 · 第 ([12])/gu)]
      .map((match) => ({ group: Number(match[1]), rank: Number(match[2]) }));
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(entries[0].group).not.toBe(entries[1].group);
  }
});

test('Web 对战可以修改赛果、传播下游并导出 JSON 和 Excel', async ({ page }) => {
  await page.goto('/#/battle');
  await page.locator('.battle-config textarea').fill('甲\n乙\n丙\n丁');
  await page.locator('.battle-config textarea').press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^执行/ }).click();

  const firstRoundMatches = page.locator('.single-bracket-side .battle-match');
  const finalMatch = page.locator('.single-bracket-final .battle-match');
  const firstWinner = (await firstRoundMatches.nth(0).locator('.battle-side strong').first().textContent())!;
  await enterBattleScore(firstRoundMatches.nth(0), 4, 1);
  await expect(finalMatch).toContainText(firstWinner);
  await expect(finalMatch).toContainText('等待上游');

  const secondMatchInputs = firstRoundMatches.nth(1).locator('input[type="number"]');
  await secondMatchInputs.nth(1).fill('1');
  await secondMatchInputs.nth(1).press('Tab');
  await expect(secondMatchInputs.nth(0)).toHaveValue('4');
  await expect(finalMatch).toContainText('待比分');
  await enterBattleScore(finalMatch, 4, 1);
  await expect(finalMatch).toContainText('已完成');

  await enterBattleScore(firstRoundMatches.nth(0), 1, 4);
  await expect(finalMatch).toContainText('待比分');
  await expect(finalMatch.locator('.battle-side.winner')).toHaveCount(0);

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/^对战状态-\d{4}-\d{2}-\d{2}\.json$/);
  const jsonPath = await jsonDownload.path();
  const exported = JSON.parse(await readFile(jsonPath!, 'utf8'));
  expect(exported.kind).toBe('battle-tmp');
  expect(exported.matches[0]).toMatchObject({ stage: 'single', level: 1, position: 1 });
  expect(exported.state_json).toBeUndefined();

  const excelDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  const excelDownload = await excelDownloadPromise;
  expect(excelDownload.suggestedFilename()).toMatch(/^对战签表-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const excelPath = await excelDownload.path();
  const bytes = await readFile(excelPath!);
  expect(Array.from(bytes.subarray(0, 2))).toEqual([0x50, 0x4b]);
});

async function enterBattleScore(match: import('@playwright/test').Locator, up: number, down: number) {
  const inputs = match.locator('input[type="number"]');
  await inputs.nth(0).fill(String(up));
  await inputs.nth(0).press('Tab');
  await expect(inputs.nth(1)).toBeEnabled();
  await inputs.nth(1).fill(String(down));
  await inputs.nth(1).press('Tab');
}
