import { expect, test, type Locator, type Page } from '@playwright/test';
import { installTauriMock, mockedRankedNames } from './helpers/tauri-mock';

async function openDesktopLineup(page: Page) {
  await installTauriMock(page);
  await page.goto('/grouping', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
}

async function openDesktopBattle(page: Page) {
  await installTauriMock(page);
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
}

async function openDesktopWheel(page: Page) {
  await installTauriMock(page);
  await page.goto('/wheel', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
}

async function confirmDesktopNames(page: Page, names: string[]) {
  const textarea = page.locator('.names-field textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(names.length);
}

async function importDrawCandidates(page: Page, names: string[]) {
  await page.keyboard.press('w');
  const textarea = page.locator('.import-box textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('[data-prize-id]')).toHaveCount(names.length);
}

async function dragToRatio(page: Page, source: Locator, target: Locator, ratio: number) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('排名卡片不可见');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height * ratio,
    { steps: 12 },
  );
  await page.mouse.up();
}

async function rankNumberAlignment(number: Locator) {
  return number.evaluate((element) => {
    const card = element.closest('article');
    const inner = element.firstElementChild;
    if (!card || !inner) throw new Error('排名数字结构不完整');
    const cardRect = card.getBoundingClientRect();
    const numberRect = element.getBoundingClientRect();
    const innerRect = inner.getBoundingClientRect();
    return {
      outerTop: numberRect.top - cardRect.top,
      outerBottom: cardRect.bottom - numberRect.bottom,
      innerTop: innerRect.top - numberRect.top,
      innerBottom: numberRect.bottom - innerRect.bottom,
    };
  });
}

test('桌面抽奖不再占用 S，自动保存仍可通过设置切换', async ({ page }) => {
  await openDesktopWheel(page);

  await expect(page.getByRole('button', { name: '关闭自动保存历史' })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__DESKTOP_S_DEFAULT_PREVENTED__ = null;
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 's') {
        (window as any).__DESKTOP_S_DEFAULT_PREVENTED__ = event.defaultPrevented;
      }
    }, { once: true });
  });
  await page.keyboard.press('s');
  expect(await page.evaluate(() => (window as any).__DESKTOP_S_DEFAULT_PREVENTED__)).toBe(false);
  await expect(page.getByRole('button', { name: '关闭自动保存历史' })).toBeVisible();

  await page.getByRole('button', { name: '关闭自动保存历史' }).click();
  await expect(page.getByRole('button', { name: '开启自动保存历史' })).toBeVisible();
});

test('桌面快捷键总表记录完整对战页操作', async ({ page }) => {
  await openDesktopWheel(page);
  await page.keyboard.press('z');

  const battleShortcuts = page.locator('.shortcut-battle');
  await expect(battleShortcuts.getByRole('heading', { name: '对战页' })).toBeVisible();
  await expect(battleShortcuts.locator('.sidebar-shortcut-list > div')).toHaveCount(4);
  await expect(battleShortcuts).toContainText('聚焦对战区');
  await expect(battleShortcuts).toContainText('聚焦名单');
  await expect(battleShortcuts).toContainText('打开 / 关闭排名');
  await expect(battleShortcuts).toContainText('打开 / 关闭对战历史');

  const battleAreaShortcuts = page.locator('.shortcut-battle-area');
  await expect(battleAreaShortcuts.getByRole('heading', { name: '对战区' })).toBeVisible();
  await expect(battleAreaShortcuts.locator('.sidebar-shortcut-list > div')).toHaveCount(5);
  await expect(battleAreaShortcuts).toContainText('进入 / 返回全屏');
  await expect(battleAreaShortcuts).toContainText('微调比分框上 / 下');
  await expect(battleAreaShortcuts).toContainText('微调比分框左 / 右');
  await expect(battleAreaShortcuts).toContainText('聚焦单败未完成比分');
  await expect(battleAreaShortcuts).toContainText('聚焦胜者 / 败者未完成比分');
});

test('排名字号放大时排名框同步扩容', async ({ page }) => {
  await openDesktopLineup(page);
  const normalNumber = page.locator('.ranked-user-list .rank-number').first();
  const normalBox = await normalNumber.boundingBox();
  const normalAlignment = await rankNumberAlignment(normalNumber);
  expect(normalBox).not.toBeNull();
  expect(Math.abs(normalAlignment.outerTop - normalAlignment.outerBottom)).toBeLessThan(1);
  expect(Math.abs(normalAlignment.innerTop - normalAlignment.innerBottom)).toBeLessThan(1);

  await page.evaluate(() => localStorage.setItem('wheel-settings-v1', JSON.stringify({ fontScale: 3 })));
  await page.reload();
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
  const largeNumber = page.locator('.ranked-user-list .rank-number').first();
  const largeBox = await largeNumber.boundingBox();
  const largeAlignment = await rankNumberAlignment(largeNumber);
  expect(largeBox!.width / normalBox!.width).toBeGreaterThan(1.65);
  expect(largeBox!.width / normalBox!.width).toBeLessThan(1.67);
  expect(largeBox!.height / normalBox!.height).toBeGreaterThan(1.65);
  expect(largeBox!.height / normalBox!.height).toBeLessThan(1.67);
  expect(Math.abs(largeAlignment.outerTop - largeAlignment.outerBottom)).toBeLessThan(1);
  expect(Math.abs(largeAlignment.innerTop - largeAlignment.innerBottom)).toBeLessThan(1);
});

test('全局界面风格覆盖桌面排名与公共历史组件', async ({ page }) => {
  await openDesktopLineup(page);
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('wheel-settings-v1') ?? '{}');
    localStorage.setItem('wheel-settings-v1', JSON.stringify({ ...settings, uiTheme: 'sand' }));
  });
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-theme', 'sand');
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);

  const rankingColors = await page.locator('.rank-manager').evaluate((element) => {
    const firstCard = element.querySelector<HTMLElement>('[data-rank-user-id]:not(.keyboard-selected)');
    if (!firstCard) throw new Error('缺少排名卡片');
    return {
      panel: getComputedStyle(element).backgroundImage,
      card: getComputedStyle(firstCard).backgroundImage,
    };
  });
  expect(rankingColors.panel).toContain('rgb(44, 36, 28)');
  expect(rankingColors.panel).toContain('rgb(37, 29, 23)');
  expect(rankingColors.card).toContain('rgb(255, 250, 244)');
  expect(rankingColors.card).toContain('rgb(241, 233, 223)');

  await page.locator('.desktop-accordion-toggle').filter({ hasText: '分组历史' }).click();
  await expect(page.locator('.ui-history-panel')).toBeVisible();
  await expect(page.locator('.ui-date-range input').first()).toHaveCSS('color', 'rgb(51, 40, 32)');
  await expect(page.locator('.ui-history-empty')).toHaveCSS('color', 'rgb(108, 91, 78)');
});

test('桌面对战按排名预览紧跟竖排名单顺序且大字号控件整行展开', async ({ page }) => {
  const rankedUsers = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    name: `选手${index + 1}`,
    rank: index + 1,
  }));
  await installTauriMock(page, rankedUsers);
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(8);
  await expect(page.locator('.battle-shortcut-hint')).toHaveCount(0);
  await confirmDesktopNames(page, rankedUsers.map((user) => user.name));
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('radio', { name: '按排名' }).check();
  await expect(page.locator('.battle-preview-bracket .single-battle-bracket')).toBeVisible();
  await expect(page.locator('.battle-preview-bracket .single-bracket-connectors')).toHaveCount(1);
  await expect(page.locator('.preview-row').first().getByRole('button', { name: '在 选手1 前插入' })).toHaveText('＋');
  await expect(page.locator('.preview-row').first().getByRole('button', { name: '移除 选手1' })).toHaveText('删除');

  const orderControls = page.locator('.battle-order-group label, .battle-order-group button');
  await expect(orderControls).toHaveCount(3);
  const orderPositions = await orderControls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  }));
  expect(new Set(orderPositions.map((position) => Math.round(position.x))).size).toBe(1);
  expect(orderPositions[1].y).toBeGreaterThan(orderPositions[0].y);
  expect(orderPositions[2].y).toBeGreaterThan(orderPositions[1].y);

  const controls = page.locator('.battle-preview-settings label, .battle-preview-settings button');
  const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(Math.min(...sizes.map((size) => size.height))).toBeGreaterThanOrEqual(55);
  const normalGroups = await page.locator('.battle-option-groups > fieldset').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(new Set(normalGroups.map((group) => Math.round(group.x))).size).toBe(3);
  expect(Math.max(...normalGroups.map((group) => group.y)) - Math.min(...normalGroups.map((group) => group.y))).toBeLessThan(2);
  const statusBox = await page.locator('.battle-count-status').boundingBox();
  const actionBox = await page.locator('.battle-option-actions > label').boundingBox();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(actionBox!.y);

  await page.evaluate(() => localStorage.setItem('wheel-settings-v1', JSON.stringify({ fontScale: 3 })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(8);
  await confirmDesktopNames(page, rankedUsers.map((user) => user.name));
  await page.getByRole('radio', { name: '单败' }).check();
  const largeGroups = await page.locator('.battle-option-groups > fieldset').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(new Set(largeGroups.map((group) => Math.round(group.x))).size).toBe(1);
  expect(new Set(largeGroups.map((group) => Math.round(group.y))).size).toBe(3);
  expect(Math.max(...largeGroups.map((group) => group.width)) - Math.min(...largeGroups.map((group) => group.width))).toBeLessThan(1);
  const largeActions = await page.locator('.battle-option-actions > label, .battle-option-actions > button').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(new Set(largeActions.map((action) => Math.round(action.x))).size).toBe(1);
  expect(Math.max(...largeActions.map((action) => action.width)) - Math.min(...largeActions.map((action) => action.width))).toBeLessThan(1);
  const settingsOverflow = await page.locator('.battle-preview-settings').evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(settingsOverflow).toBeLessThanOrEqual(1);
});

test('桌面抽奖统计操作等宽并能打开下载文件夹', async ({ page }) => {
  await openDesktopWheel(page);
  await page.getByRole('button', { name: '统计 0' }).click();

  const actions = page.locator('.side-stats-actions button');
  await expect(actions).toHaveCount(3);
  await expect(actions).toHaveText(['Excel', 'JSON', '打开下载']);
  const widths = await actions.evaluateAll((buttons) => (
    buttons.map((button) => button.getBoundingClientRect().width)
  ));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);

  await page.getByRole('button', { name: '打开下载' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations.some(
      (invocation: any) => invocation.cmd === 'open_download_folder',
    )
  ))).toBe(true);
});

test('开启自动保存后关闭窗口会等当前旋转结束并归档', async ({ page }) => {
  await openDesktopWheel(page);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.closeRequestedHandler !== null
  ))).toBe(true);
  await importDrawCandidates(page, ['甲', '乙']);
  await page.getByRole('button', { name: '关闭重来机制' }).click();
  await page.locator('#duration').fill('1');
  await page.getByRole('button', { name: '开启奢华转盘' }).click();

  await page.evaluate(() => (window as any).__E2E_TAURI_CLOSE__());

  const closeState = await page.evaluate(() => {
    const state = (window as any).__E2E_TAURI_STATE__;
    return {
      destroyed: state.windowDestroyed,
      histories: state.drawHistories,
      commands: state.invocations.map((invocation: any) => invocation.cmd),
    };
  });
  expect(closeState.destroyed).toBe(true);
  expect(closeState.histories).toHaveLength(1);
  expect(closeState.histories[0].records.some((record: any) => record.outcome === 'selected')).toBe(true);
  expect(closeState.commands.lastIndexOf('save_draw_history'))
    .toBeLessThan(closeState.commands.lastIndexOf('plugin:window|destroy'));
});

test('点击排名或按 A 选择第一项，N 聚焦添加排名', async ({ page }) => {
  await openDesktopLineup(page);
  const firstCard = page.locator('[data-rank-user-id="1"]');
  const rankingToggle = page.locator('.desktop-accordion:first-child > .desktop-accordion-toggle');
  const addInput = page.locator('.rank-person-form input');

  await rankingToggle.click();
  await expect(firstCard).toBeFocused();
  await expect(addInput).not.toBeFocused();
  await expect(page.getByRole('button', { name: '导入 JSON' })).toBeDisabled();

  await rankingToggle.click();
  await page.keyboard.press('a');
  await expect(firstCard).toBeFocused();
  await expect(addInput).not.toBeFocused();

  await page.keyboard.press('a');
  await expect(page.locator('.desktop-accordion').filter({ hasText: '排名' })).not.toHaveClass(/open/);
  await page.keyboard.press('n');
  await expect(addInput).toBeFocused();

  await addInput.click();
  await expect(addInput).toBeFocused();
  await addInput.fill('戊');
  await addInput.press('Enter');
  await expect(page.getByRole('button', { name: '戊' })).toBeVisible();
  await expect(addInput).toBeFocused();
  await expect(addInput).toHaveValue('');

  await addInput.press('z');
  await expect(addInput).toHaveValue('z');
  await expect(page.getByRole('button', { name: /分组历史/u })).not.toHaveAttribute('class', /open/u);
});

test('Z 切换历史，X 聚焦结果，Esc 逐层退出局部区域', async ({ page }) => {
  await openDesktopLineup(page);
  await page.keyboard.press('z');
  await expect(page.locator('.desktop-accordion').filter({ hasText: '分组历史' })).toHaveClass(/open/);
  await page.keyboard.press('z');
  await expect(page.locator('.desktop-accordion').filter({ hasText: '分组历史' })).not.toHaveClass(/open/);

  await page.keyboard.press('a');
  await page.keyboard.press('Escape');
  await expect(page.locator('.rank-person-form input')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.desktop-accordion').filter({ hasText: '排名' })).not.toHaveClass(/open/);

  await page.keyboard.press('x');
  await expect(page.locator('.lineup-result')).toBeFocused();
});

test('按排名分组允许末档未排名', async ({ page }) => {
  await openDesktopLineup(page);
  await page.locator('#lineup-group-count').fill('2');
  await confirmDesktopNames(page, ['乙', '甲', '未录入']);
  const sortPreview = page.getByRole('button', { name: '按排名顺序预览' });
  const groupByRank = page.getByRole('button', { name: '按排名顺序分组' });
  await expect(sortPreview).toBeEnabled();
  await expect(groupByRank).toBeEnabled();

  await sortPreview.click();
  await expect.poll(() => page.locator('.preview-row input').evaluateAll((inputs) => (
    inputs.map((input) => (input as HTMLInputElement).value)
  ))).toEqual(['甲', '乙', '未录入']);
  await groupByRank.click();
  await expect(page.locator('.lineup-table-wrap tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '打开下载', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations.some(
      (invocation: any) => invocation.cmd === 'open_download_folder',
    )
  ))).toBe(true);

  await confirmDesktopNames(page, ['甲', '未录入甲', '未录入乙']);
  await expect(sortPreview).toBeDisabled();
  await expect(groupByRank).toBeDisabled();
});

test('对战只要求固定人数有排名', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['丁', '未录入', '乙', '甲']);
  await expect(page.getByRole('button', { name: '甲', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /对战历史/u })).toBeVisible();

  await page.getByRole('radio', { name: '单败' }).check();
  await expect(page.getByRole('radio', { name: '全随机' })).toBeChecked();
  await page.getByRole('radio', { name: '前 2 固定' }).check();
  await page.getByRole('radio', { name: '按排名' }).check();
  const rankPreview = page.getByRole('button', { name: '按排名预览' });
  await expect(rankPreview).toBeEnabled();
  await rankPreview.click();
  await expect.poll(() => page.locator('.preview-row input').evaluateAll((inputs) => (
    inputs.map((input) => (input as HTMLInputElement).value)
  ))).toEqual(['甲', '乙', '丁', '未录入']);

  const previewBracket = page.locator('.battle-preview-bracket');
  await expect(previewBracket.locator('.single-battle-bracket')).toBeVisible();
  const [previewLeft, previewFinal, previewRight] = await Promise.all([
    previewBracket.locator('.single-bracket-side.left').boundingBox(),
    previewBracket.locator('.single-bracket-final').boundingBox(),
    previewBracket.locator('.single-bracket-side.right').boundingBox(),
  ]);
  expect(previewLeft!.x + previewLeft!.width).toBeLessThan(previewFinal!.x);
  expect(previewFinal!.x + previewFinal!.width).toBeLessThan(previewRight!.x);
  await expect(previewBracket.locator('.battle-match .fixed strong')).toHaveText(['甲', '乙']);
  await expect(previewBracket.locator('.battle-match[data-battle-level="1"] .battle-side:not(.fixed) strong')).toHaveText(['待随机', '待随机']);
  await expect(previewBracket.locator('.battle-match input:not(:disabled)')).toHaveCount(0);
  const previewStructure = await previewBracket.locator('.battle-match').evaluateAll((matches) => matches.map((match) => ({
    stage: match.getAttribute('data-battle-stage'),
    level: match.getAttribute('data-battle-level'),
    position: match.getAttribute('data-battle-position'),
  })));
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect(page.locator('.battle-round')).toHaveCount(2);
  const resultStructure = await page.locator('.lineup-result > .single-battle-bracket .battle-match').evaluateAll((matches) => matches.map((match) => ({
    stage: match.getAttribute('data-battle-stage'),
    level: match.getAttribute('data-battle-level'),
    position: match.getAttribute('data-battle-position'),
  })));
  expect(resultStructure).toEqual(previewStructure);
  await expect(page.locator('.lineup-result .result-heading')).toContainText('排名');
  await expect(page.getByRole('button', { name: /^抽签/ })).toBeDisabled();
});

test('桌面对战全屏会同步切换 Tauri 窗口', async ({ page }) => {
  await openDesktopBattle(page);
  const battleResult = page.locator('.battle-result');

  await page.getByRole('button', { name: '全屏' }).click();
  await expect(battleResult).toHaveClass(/battle-fullscreen/u);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.windowFullscreen
  ))).toBe(true);

  await page.getByRole('button', { name: '返回' }).click();
  await expect(battleResult).not.toHaveClass(/battle-fullscreen/u);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.windowFullscreen
  ))).toBe(false);
});

test('桌面对战经过三次确认后直接清空临时表', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState
  ))).not.toBeNull();

  const clearBattle = page.getByRole('button', { name: '清空对战' });
  await clearBattle.click();
  await expect(page.getByRole('heading', { name: '1/3 删除当前签表和全部比分？' })).toBeVisible();
  await expect(page.getByText('胜者组、败者组、总决赛以及已经录入的所有比分都会一起删除。')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除签表和比分' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.battle-match')).not.toHaveCount(0);

  await clearBattle.click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '2/3 直接删除桌面对战临时表？' })).toBeVisible();
  await expect(page.getByText('删除后即使关闭并重新启动软件，也无法恢复这场对战。')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除临时表' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '3/3 删除当前对战？' })).toBeVisible();
  await expect(page.getByText('名单、赛制、固定位置和当前浏览内容都会保留。')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除当前对战' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState
  ))).not.toBeNull();
  await page.keyboard.press('Enter');

  await expect(page.locator('.names-field textarea')).toHaveValue('甲\n乙\n丙\n丁');
  await expect(page.locator('.battle-preview-bracket')).toHaveAttribute('aria-label', '只读对战查看');
  await expect(page.locator('.battle-preview-bracket input:not(:disabled)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清空对战' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState
  ))).toBeNull();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'clear_battle_tmp_state').length
  ))).toBe(1);
});

test('桌面对战历史编辑按临时表状态确认并保留原记录', async ({ page }) => {
  await openDesktopBattle(page);

  const loadCurrent = page.locator('.battle-load-current-button');
  await expect(loadCurrent).toHaveCSS('visibility', 'hidden');
  expect(await loadCurrent.boundingBox()).not.toBeNull();

  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState
  ))).not.toBeNull();

  const saveCount = () => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'save_battle_tmp_state').length
  ));
  const generatedSaveCount = await saveCount();
  const historyToggle = page.getByRole('button', { name: /对战历史/u });
  await expect(historyToggle).toContainText('展开');
  await historyToggle.click();
  await expect(historyToggle).toContainText('收起');
  await expect(page.locator('.history-panel .ui-history-footer').getByRole('button', { name: '加载当前' })).toBeEnabled();
  await historyToggle.click();
  await expect(loadCurrent).toHaveCSS('visibility', 'hidden');
  expect(await saveCount()).toBe(generatedSaveCount);

  await page.getByRole('button', { name: '清空对战' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.battle-preview-bracket')).toHaveAttribute('aria-label', '只读对战查看');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.battleTmpState
  ))).toBeNull();

  const originalHistory = await page.evaluate(() => {
    const histories = JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]');
    return structuredClone(histories[0]);
  });
  expect(originalHistory.snapshot.matches[0].upResult).toBeNull();
  expect(originalHistory.snapshot.matches[0].downResult).toBeNull();

  await historyToggle.click();
  const historyLoad = page.locator('.history-panel .ui-history-row').first().getByRole('button', { name: '编辑' });
  const beforeDirectHistoryLoad = await saveCount();
  await historyLoad.click();
  await expect(page.getByRole('heading', { name: /用.*历史签表替换编辑区/u })).toHaveCount(0);
  await expect(page.locator('.single-battle-bracket:not(.read-only)')).toBeVisible();
  await expect(page.locator('.battle-match')).toHaveCount(3);
  await expect(page.locator('.battle-config textarea')).toHaveValue('甲\n乙\n丙\n丁');
  await expect.poll(saveCount).toBe(beforeDirectHistoryLoad + 1);

  const firstMatch = page.locator('.battle-round').first().locator('.battle-match').first();
  await enterDesktopBattleScore(firstMatch, 4, 1);
  expect(await page.evaluate((historyId) => {
    const histories = JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]');
    const history = histories.find((entry: any) => entry.id === historyId);
    return [history.snapshot.matches[0].upResult, history.snapshot.matches[0].downResult];
  }, originalHistory.id)).toEqual([null, null]);

  const beforeConfirmedHistoryLoad = await saveCount();
  await historyLoad.click();
  await expect(page.getByRole('heading', { name: /1\/3 用.*历史签表替换编辑区？/u })).toBeVisible();
  await expect(page.getByText('当前编辑区的参赛者、赛制、全部场次和比分会离开页面。')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '2/3 将历史副本写入临时表？' })).toBeVisible();
  await expect(page.getByText('现有临时签表会先保存到对战历史；所选历史随后覆盖关系化临时表。')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '3/3 覆盖并加载这条历史？' })).toBeVisible();
  await expect(page.getByText('原历史记录保持不变；后续比分只写入新生成的临时表副本。')).toBeVisible();
  expect(await saveCount()).toBe(beforeConfirmedHistoryLoad);
  await page.keyboard.press('Enter');
  await expect.poll(saveCount).toBe(beforeConfirmedHistoryLoad + 1);
  await expect(firstMatch.locator('input[type="number"]').nth(0)).toHaveValue('');
  await expect(firstMatch.locator('input[type="number"]').nth(1)).toHaveValue('');

  const archivedResults = await page.evaluate((historyId) => {
    const histories = JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]');
    const original = histories.find((entry: any) => entry.id === historyId);
    return {
      count: histories.length,
      originalScore: [original.snapshot.matches[0].upResult, original.snapshot.matches[0].downResult],
      archivedEditedScore: histories.some((entry: any) => (
        entry.id !== historyId
        && entry.snapshot.matches[0].upResult === 4
        && entry.snapshot.matches[0].downResult === 1
      )),
    };
  }, originalHistory.id);
  expect(archivedResults).toEqual({
    count: 2,
    originalScore: [null, null],
    archivedEditedScore: true,
  });

  await enterDesktopBattleScore(firstMatch, 3, 2);
  expect(await page.evaluate((historyId) => {
    const histories = JSON.parse(localStorage.getItem('battle-history-v1:standard') ?? '[]');
    const history = histories.find((entry: any) => entry.id === historyId);
    return [history.snapshot.matches[0].upResult, history.snapshot.matches[0].downResult];
  }, originalHistory.id)).toEqual([null, null]);
});

test('桌面对战关系化同步赛果并能恢复当前临时状态', async ({ page, context }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/ }).click();
  await page.getByRole('button', { name: '显示全部' }).click();

  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.battleTmpState)).not.toBeNull();
  const firstMatch = page.locator('.battle-round').first().locator('.battle-match').first();
  await expect(firstMatch).toContainText('S1 P1');
  const selectedName = (await firstMatch.locator('.battle-side strong').first().textContent())!;
  await enterDesktopBattleScore(firstMatch, 4, 1);
  await expect(firstMatch.locator('.battle-side.winner')).toHaveCount(1);
  await expect(page.locator('.single-bracket-final .battle-match')).toContainText(selectedName);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'update_battle_tmp_result').length
  ))).toBe(2);

  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file' || entry.cmd === 'export_text_file')
      .map((entry: any) => entry.cmd)
  ))).toEqual(['export_binary_file', 'export_text_file']);

  const savedState = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));
  const restoredPage = await context.newPage();
  await installTauriMock(restoredPage, undefined, { battleTmpState: savedState });
  await restoredPage.goto('/battle');
  await expect(restoredPage.locator('.preview-row')).toHaveCount(4);
  await expect(restoredPage.locator('.battle-round')).toHaveCount(2);
  await expect(restoredPage.locator('.battle-config textarea')).toBeDisabled();
  await expect(restoredPage.locator('.preview-row input').first()).toBeDisabled();
  await expect(restoredPage.locator('.battle-reveal-slot')).toHaveCount(0);
  await expect(restoredPage.getByRole('button', { name: '显示全部' })).toHaveCount(0);
  await expect(restoredPage.getByRole('radio', { name: '单败' })).toBeDisabled();
  await expect(restoredPage.getByRole('button', { name: /^抽签/u })).toBeDisabled();
  await expect(restoredPage.locator('.battle-round').first().locator('.battle-match').first().locator('.battle-side.winner')).toHaveCount(1);
  await restoredPage.close();
});

test('对战历史使用只读签表并保留比分', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await page.getByRole('button', { name: '显示全部' }).click();

  const firstMatch = page.locator('.battle-round').first().locator('.battle-match').first();
  await enterDesktopBattleScore(firstMatch, 4, 1);
  const savedNames = await firstMatch.locator('.battle-side strong').allTextContents();

  await page.getByRole('button', { name: '清空对战' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.battle-preview-bracket')).toHaveAttribute('aria-label', '只读对战查看');

  await page.getByRole('button', { name: /对战历史/u }).click();
  await page.locator('.history-panel .ui-history-summary').first().click();
  await expect(page.getByRole('heading', { name: '历史对战' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空对战' })).toHaveCount(0);
  const historyMatch = page.locator('.battle-history-bracket .battle-round').first().locator('.battle-match').first();
  await expect(historyMatch.locator('.battle-side strong')).toHaveText(savedNames);
  await expect(historyMatch.locator('input[type="number"]').nth(0)).toHaveValue('4');
  await expect(historyMatch.locator('input[type="number"]').nth(1)).toHaveValue('1');
  await expect(page.locator('.battle-history-bracket input:not(:disabled)')).toHaveCount(0);
  await expect(historyMatch.locator('.battle-side.winner')).toHaveCount(1);

  await page.getByRole('button', { name: '返回当前对战' }).click();
  await expect(page.getByRole('heading', { name: '对战', exact: true })).toBeVisible();
  await expect(page.locator('.battle-preview-bracket')).toHaveAttribute('aria-label', '只读对战查看');
});

test('单败左右晋级，上下衔接且对战快捷键不被比分框占用', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, Array.from({ length: 8 }, (_, index) => `选手${index + 1}`));
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();

  const result = page.locator('.battle-result');
  await result.focus();
  const selectedCards = () => page.locator('[data-rank-user-id].keyboard-selected').evaluateAll((cards) => (
    cards.map((card) => card.getAttribute('data-rank-user-id'))
  ));
  const selectedBefore = await selectedCards();
  await page.keyboard.press('3');
  await expect(result).toBeFocused();
  expect(await selectedCards()).toEqual(selectedBefore);

  const singleP2 = page.locator('[data-battle-stage="single"][data-battle-level="1"][data-battle-position="2"]');
  const singleP3 = page.locator('[data-battle-stage="single"][data-battle-level="1"][data-battle-position="3"]');
  const singleP4 = page.locator('[data-battle-stage="single"][data-battle-level="1"][data-battle-position="4"]');
  const [p3Box, p4Box] = await Promise.all([singleP3.boundingBox(), singleP4.boundingBox()]);
  expect(p3Box!.y).toBeLessThan(p4Box!.y);
  await singleP2.locator('input').nth(1).focus();
  await singleP2.locator('input').nth(1).press('ArrowDown');
  await expect(singleP3.locator('input').first()).toBeFocused();

  await singleP4.locator('input').nth(1).focus();
  await singleP4.locator('input').nth(1).press('s');
  await expect(page.locator('.single-battle-bracket input:focus').locator('xpath=ancestor::article[1]')).toHaveAttribute('data-battle-position', '1');

  // 左侧首轮完成后，右侧首轮仍有空位时，S 不能提前跳到左侧第二轮。
  const leftFirstRound = page.locator('.single-bracket-side.left .battle-round').first();
  await enterDesktopBattleScore(leftFirstRound.locator('.battle-match').nth(0), 4, 1);
  await enterDesktopBattleScore(leftFirstRound.locator('.battle-match').nth(1), 4, 1);
  await leftFirstRound.locator('.battle-match').nth(1).locator('input').first().focus();
  await page.keyboard.press('s');
  const singleMagicTarget = page.locator('.single-battle-bracket input:focus').locator('xpath=ancestor::article[1]');
  await expect(singleMagicTarget).toHaveAttribute('data-battle-level', '1');
  await expect(singleMagicTarget).toHaveAttribute('data-battle-position', '3');

  await page.getByRole('button', { name: '清空对战' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: '双败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();

  await result.focus();
  await page.keyboard.press('w');
  await expect(page.locator('.double-winner-section input:focus')).toHaveCount(1);

  const firstWinnerRound = page.locator('[data-battle-stage="winner"][data-battle-level="1"]');
  await expect(firstWinnerRound).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await enterDesktopBattleScore(firstWinnerRound.nth(index), 4, 1);
  }
  await expect(page.locator('[data-battle-stage="loser"][data-battle-level="1"][data-battle-status="ready"]')).not.toHaveCount(0);
  await firstWinnerRound.first().locator('input').first().focus();
  await firstWinnerRound.first().locator('input').first().press('w');
  await expect(page.locator('.double-winner-section input:focus').locator('xpath=ancestor::article[1]')).toHaveAttribute('data-battle-level', '2');
  await firstWinnerRound.first().locator('input').first().focus();
  await firstWinnerRound.first().locator('input').first().press('l');
  await expect(page.locator('.double-loser-section input:focus')).toHaveCount(1);
  await expect(page.locator('.double-loser-section input:focus').locator('xpath=ancestor::article[1]')).toHaveAttribute('data-battle-status', 'ready');

  // 败者组第二层已经有空位时，仍要先处理败者组第一层剩下的空位。
  const firstLoserRound = page.locator('[data-battle-stage="loser"][data-battle-level="1"]');
  await enterDesktopBattleScore(firstLoserRound.first(), 4, 1);
  const secondWinnerRound = page.locator('[data-battle-stage="winner"][data-battle-level="2"]');
  await enterDesktopBattleScore(secondWinnerRound.nth(0), 4, 1);
  await enterDesktopBattleScore(secondWinnerRound.nth(1), 4, 1);
  await expect(page.locator('[data-battle-stage="loser"][data-battle-level="2"][data-battle-status="ready"]')).toHaveCount(1);
  await firstLoserRound.nth(1).locator('input').first().focus();
  await page.keyboard.press('l');
  const loserMagicTarget = page.locator('.double-loser-section input:focus').locator('xpath=ancestor::article[1]');
  await expect(loserMagicTarget).toHaveAttribute('data-battle-level', '1');
  await expect(loserMagicTarget).toHaveAttribute('data-battle-position', '2');

  await expect(page.locator('.double-loser-section .battle-round').nth(0).getByRole('heading')).toHaveText('第 1 轮');
  await expect(page.locator('.double-loser-section .battle-round').nth(1).getByRole('heading')).toHaveText('第 2 轮');

  const scroller = page.locator('.double-battle-scroll');
  await scroller.focus();
  const before = await scroller.evaluate((element) => element.scrollLeft);
  await scroller.press('k');
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  const after = await scroller.evaluate((element) => element.scrollLeft);
  expect(after - before).toBeLessThanOrEqual(60);
});

test('同组不对战1对2固定八人并按单败左右晋级', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, Array.from({ length: 8 }, (_, index) => `组员${index + 1}`));
  await page.getByRole('radio', { name: '同组不对战1对2' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();

  const firstRound = page.locator('[data-battle-stage="single"][data-battle-level="1"]');
  await expect(page.locator('.single-battle-bracket')).toBeVisible();
  await expect(page.locator('.single-battle-bracket .battle-round').first().getByRole('heading')).toHaveText('1对2');
  await expect(firstRound).toHaveCount(4);
  await expect(page.locator('[data-battle-stage="single"][data-battle-level="2"]')).toHaveCount(2);
  await expect(page.locator('[data-battle-stage="single"][data-battle-level="3"]')).toHaveCount(1);
  await expect(page.locator('.single-bracket-connectors path')).toHaveCount(6);

  await firstRound.first().locator('input').first().focus();
  await firstRound.first().locator('input').first().press('s');
  await expect(page.locator('.single-battle-bracket input:focus')).toHaveCount(1);
});

test('桌面对战悬念揭晓支持逐格显示晋级选手', async ({ page }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '单败' }).check();
  await expect(page.getByText('悬念揭晓', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^抽签/u }).click();

  const firstMatch = page.locator('.single-bracket-side .battle-match').first();
  const firstReveal = firstMatch.getByRole('button', { name: /^揭晓 /u });
  await expect(firstReveal).toHaveCount(2);
  const firstName = (await firstReveal.first().getAttribute('aria-label'))!.replace(/^揭晓 /u, '');
  await firstReveal.first().click();
  await firstReveal.first().click();
  await expect(firstMatch.locator('.battle-side strong')).toHaveCount(2);
  await enterDesktopBattleScore(firstMatch, 4, 1);

  const finalMatch = page.locator('.single-bracket-final .battle-match');
  await expect(finalMatch.getByRole('button', { name: `揭晓 ${firstName}` })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '显示全部' })).toBeVisible();
  await finalMatch.getByRole('button', { name: `揭晓 ${firstName}` }).click();
  await expect(finalMatch.getByRole('button', { name: `揭晓 ${firstName}` })).toHaveCount(0);
  await expect(finalMatch.locator('.battle-side strong').filter({ hasText: firstName })).toHaveCount(1);
});

test('桌面恢复双败时从重赛行还原双总决赛开关', async ({ page, context }) => {
  await openDesktopBattle(page);
  await confirmDesktopNames(page, ['甲', '乙', '丙', '丁']);
  await page.getByRole('radio', { name: '双败' }).check();
  const doubleGrandFinal = page.getByRole('checkbox', { name: '双总决赛' });
  await expect(doubleGrandFinal).not.toBeChecked();
  await page.getByRole('button', { name: /^抽签/ }).click();

  const singleFinalState = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));
  expect(singleFinalState.matches.some((match: any) => match.matchId === 'GF-RESET-M1')).toBe(false);
  const restoredSingleFinal = await context.newPage();
  await installTauriMock(restoredSingleFinal, undefined, { battleTmpState: singleFinalState });
  await restoredSingleFinal.goto('/battle');
  await expect(restoredSingleFinal.getByRole('checkbox', { name: '双总决赛' })).not.toBeChecked();
  await expect(restoredSingleFinal.getByRole('heading', { name: '重赛', exact: true })).toHaveCount(0);
  await restoredSingleFinal.close();

  const doubleFinalPage = await context.newPage();
  await installTauriMock(doubleFinalPage);
  await doubleFinalPage.goto('/battle');
  await expect(doubleFinalPage.locator('[data-rank-user-id]')).toHaveCount(4);
  await confirmDesktopNames(doubleFinalPage, ['甲', '乙', '丙', '丁']);
  await doubleFinalPage.getByRole('radio', { name: '双败' }).check();
  await doubleFinalPage.getByRole('checkbox', { name: '双总决赛' }).check();
  await doubleFinalPage.getByRole('button', { name: /^抽签/ }).click();
  const doubleFinalState = await doubleFinalPage.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.battleTmpState,
  ));
  await doubleFinalPage.close();
  expect(doubleFinalState.matches.some((match: any) => match.matchId === 'GF-RESET-M1')).toBe(true);
  const restoredDoubleFinal = await context.newPage();
  await installTauriMock(restoredDoubleFinal, undefined, { battleTmpState: doubleFinalState });
  await restoredDoubleFinal.goto('/battle');
  await expect(restoredDoubleFinal.getByRole('checkbox', { name: '双总决赛' })).toBeChecked();
  await expect(restoredDoubleFinal.getByRole('heading', { name: '重赛', exact: true })).toBeVisible();
  await restoredDoubleFinal.close();
});

async function enterDesktopBattleScore(match: Locator, up: number, down: number) {
  const inputs = match.locator('input[type="number"]');
  const page = match.page();
  const invocationCount = () => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'update_battle_tmp_result').length
  ));
  const initialInvocationCount = await invocationCount();
  await expect(inputs.nth(0)).toBeEnabled();
  await inputs.nth(0).fill(String(up));
  await inputs.nth(0).press('Tab');
  await expect.poll(invocationCount).toBe(initialInvocationCount + 1);
  await expect(inputs.nth(1)).toBeEnabled();
  await inputs.nth(1).fill(String(down));
  await inputs.nth(1).press('Tab');
  await expect.poll(invocationCount).toBe(initialInvocationCount + 2);
  await expect(inputs.nth(0)).toBeEnabled();
}

test('抽奖和分组的删除全部历史都需要二次确认', async ({ page }) => {
  const createdAt = new Date(2026, 6, 20, 12).getTime();
  const drawHistory = {
    version: 1,
    id: 'draw-1',
    createdAt,
    mode: 'selected',
    rewardAmount: 0,
    prizes: [{ id: 'p-1', name: '甲', weight: 1, color: '#111111', enabled: true }],
    records: [],
  };
  const lineupHistories = [1, 2].map((index) => ({
    id: `lineup-${index}`,
    createdAt: createdAt + index,
    input: { sourceNames: ['甲', '乙'], groupCount: 2, orderMode: 'input' },
    result: { groupNames: ['A', 'B'], tiers: [[{ name: '甲' }, { name: '乙' }]] },
  }));
  await installTauriMock(page, undefined, {
    drawHistories: [drawHistory],
    lineupHistories,
  });

  await page.goto('/wheel');
  await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible();
  await page.locator('.accordion-toggle').filter({ hasText: '历史' }).click();
  const drawHistoryActions = page.locator('.sidebar-history-actions button');
  await expect(drawHistoryActions).toHaveCount(4);
  const drawHistoryActionWidths = await drawHistoryActions.evaluateAll((buttons) => (
    buttons.map((button) => button.getBoundingClientRect().width)
  ));
  expect(Math.max(...drawHistoryActionWidths) - Math.min(...drawHistoryActionWidths)).toBeLessThan(1);
  await page.getByRole('button', { name: '清空历史' }).click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '真的清空全部抽奖历史？' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.drawHistories.length)).toBe(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.drawHistories.length)).toBe(0);

  await page.goto('/grouping');
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
  await page.getByRole('button', { name: /分组历史/u }).click();
  const lineupHistoryPanel = page.locator('.history-panel');
  await expect(page.locator('.lineup-result').getByRole('button', { name: 'JSON', exact: true })).toHaveCount(0);
  await lineupHistoryPanel.locator('.ui-history-summary').first().click();
  await expect(page.locator('.lineup-result tbody tr')).toHaveCount(1);
  await expect(page.locator('.lineup-result').getByRole('button', { name: 'Excel', exact: true })).toHaveCount(1);
  await expect(page.locator('.lineup-result').getByRole('button', { name: 'JSON', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /删除 .* 的分组历史/u }).first().click();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.lineupHistories.length)).toBe(1);

  await page.getByRole('button', { name: '删除全部', exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '真的删除全部分组历史？' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.lineupHistories.length)).toBe(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__E2E_TAURI_STATE__.lineupHistories.length)).toBe(0);
});

test('数字跳转、方向选择、回车编辑、S 新别名和 F 删除别名', async ({ page }) => {
  await openDesktopLineup(page);
  const selectedBefore = await page.locator('[data-rank-user-id].keyboard-selected').evaluateAll((cards) => (
    cards.map((card) => card.getAttribute('data-rank-user-id'))
  ));
  await page.keyboard.press('3');
  expect(await page.locator('[data-rank-user-id].keyboard-selected').evaluateAll((cards) => (
    cards.map((card) => card.getAttribute('data-rank-user-id'))
  ))).toEqual(selectedBefore);
  await page.locator('[data-rank-user-id="1"]').focus();
  await page.keyboard.press('3');
  await expect(page.locator('[data-rank-user-id="3"]')).toHaveClass(/keyboard-selected/);

  await page.keyboard.press('Enter');
  const nameInput = page.getByLabel('修改名称');
  await expect(nameInput).toBeFocused();
  await nameInput.fill('丙改');
  await nameInput.press('Enter');
  await expect(page.getByRole('button', { name: '丙改' })).toBeVisible();

  await page.keyboard.press('s');
  const aliasInput = page.getByLabel('添加新别名');
  await expect(aliasInput).toBeFocused();
  await aliasInput.fill('三号');
  await aliasInput.press('Enter');
  await expect(page.locator('[data-rank-user-id="3"]')).toContainText('三号');

  await page.keyboard.press('Enter');
  await expect(nameInput).toBeFocused();
  await nameInput.fill('三号');
  await nameInput.press('Enter');
  await expect(page.getByRole('button', { name: '三号', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.rankedUsers
      .find((user: any) => user.id === 3)
      .aliases.map((alias: any) => alias.name)
  ))).toEqual(['三号']);

  await page.keyboard.press('s');
  await aliasInput.fill('备用');
  await aliasInput.press('Enter');

  await page.keyboard.press('f');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.locator('[data-rank-user-id="3"]')).not.toContainText('备用');

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rank-user-id="4"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-rank-user-id="3"]')).toHaveClass(/keyboard-selected/);
});

test('取消名称或别名编辑后仍选择原条目', async ({ page }) => {
  await openDesktopLineup(page);
  const thirdCard = page.locator('[data-rank-user-id="3"]');
  await page.locator('[data-rank-user-id="1"]').focus();
  await page.keyboard.press('3');

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('修改名称')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(thirdCard).toBeFocused();
  await expect(thirdCard).toHaveClass(/keyboard-selected/);

  await page.keyboard.press('s');
  await expect(page.getByLabel('添加新别名')).toBeFocused();
  await thirdCard.getByRole('button', { name: '取消', exact: true }).click();
  await expect(thirdCard).toBeFocused();
  await expect(thirdCard).toHaveClass(/keyboard-selected/);
});

test('左右键遍历当前项操作，D 的确认框支持 N 取消和回车确认', async ({ page }) => {
  await openDesktopLineup(page);
  const firstCard = page.locator('[data-rank-user-id="1"]');
  await firstCard.focus();
  await page.keyboard.press('1');
  await page.keyboard.press('ArrowRight');
  await expect(firstCard.getByRole('button', { name: '添加别名', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('添加新别名')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(firstCard.getByRole('button', { name: '删除', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(firstCard.getByRole('button', { name: '删除全部别名', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rank-user-id="2"]')).toBeFocused();

  await page.keyboard.press('1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(firstCard.getByRole('button', { name: '添加别名', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-rank-user-id="1"]')).toBeFocused();

  await page.keyboard.press('d');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('n');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('button', { name: '甲' })).toBeVisible();

  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '甲' })).toBeHidden();
});

test('键盘排序中间落点执行替换', async ({ page }) => {
  await openDesktopLineup(page);
  await page.locator('[data-rank-user-id="1"]').focus();
  await page.keyboard.press('1');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['乙', '甲', '丙']);
});

test('键盘排序上方落点执行插入，无排名项可循环插入第一名', async ({ page }) => {
  await openDesktopLineup(page);
  await page.locator('[data-rank-user-id="1"]').focus();
  await page.keyboard.press('3');
  await page.keyboard.press('Space');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丙', '甲', '乙']);

  await page.locator('[data-rank-user-id="3"]').focus();
  await page.keyboard.press('3');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rank-user-id="4"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丁', '丙', '甲', '乙']);
});

test('鼠标拖拽中间区域替换，无排名项的中间区域只插入', async ({ page }) => {
  await openDesktopLineup(page);
  await dragToRatio(
    page,
    page.locator('[data-rank-user-id="1"]'),
    page.locator('[data-rank-user-id="2"]'),
    0.5,
  );
  await expect.poll(() => mockedRankedNames(page)).toEqual(['乙', '甲', '丙']);

  await dragToRatio(
    page,
    page.locator('[data-rank-user-id="3"]'),
    page.locator('[data-rank-user-id="2"]'),
    0.1,
  );
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丙', '乙', '甲']);

  await dragToRatio(
    page,
    page.locator('[data-rank-user-id="4"]'),
    page.locator('[data-rank-user-id="2"]'),
    0.5,
  );
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丙', '乙', '丁', '甲']);

  await page.getByRole('button', { name: '甲', exact: true }).click({ position: { x: 10, y: 10 } });
  await expect(page.getByLabel('修改名称')).toBeFocused();
});

test('未识别预览可按数字选排名并用空格关联，Enter 不会误确认', async ({ page }) => {
  await openDesktopLineup(page);
  await confirmDesktopNames(page, ['甲', '神秘']);
  const mysteryInput = page.getByLabel('第 2 个名称');
  const unknownRow = page.locator('.preview-row.unknown').filter({ has: mysteryInput });
  await expect(unknownRow).toBeVisible();
  const nameAlignment = await unknownRow.evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const nameRect = row.querySelector('.preview-name')!.getBoundingClientRect();
    return Math.abs((rowRect.left + rowRect.width / 2) - (nameRect.left + nameRect.width / 2));
  });
  expect(nameAlignment).toBeLessThan(1);
  await unknownRow.getByRole('button', { name: '关联' }).click();

  await page.keyboard.press('1');
  await expect(page.locator('[data-rank-user-id="1"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('2');
  await expect(page.locator('[data-rank-user-id="2"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.alias-link-order')).toBeVisible();
  await page.keyboard.press('Space');

  await expect(page.locator('.alias-link-order')).toBeHidden();
  await expect(page.locator('.preview-row.unknown')).toHaveCount(0);
  await expect(mysteryInput).toHaveValue('神秘');
  await expect(page.locator('.preview-row').filter({ has: mysteryInput })).toContainText('本名 乙');
  const aliases = await page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.rankedUsers
      .find((user: any) => user.id === 2)
      .aliases.map((alias: any) => alias.name)
  ));
  expect(aliases).toContain('神秘');
});

test('未录入预览可直接加入无排名', async ({ page }) => {
  await openDesktopLineup(page);
  await confirmDesktopNames(page, ['甲', '新项']);
  const newItemInput = page.getByLabel('第 2 个名称');
  const unknownRow = page.locator('.preview-row.unknown').filter({ has: newItemInput });
  await expect(unknownRow.getByText('未录入排名', { exact: true })).toBeVisible();

  await unknownRow.getByRole('button', { name: '录入' }).click();

  await expect(page.locator('.unranked-zone [data-rank-user-id]').filter({ hasText: '新项' })).toHaveCount(1);
  await expect(page.locator('.preview-row').filter({ has: newItemInput })).not.toHaveClass(/unknown/);
});

test('桌面预览添加后集中核对并可用 Esc 取消关联', async ({ page }) => {
  await openDesktopLineup(page);
  await confirmDesktopNames(page, ['甲', '乙']);
  await page.getByRole('button', { name: '＋ 添加到名单末尾' }).click();
  const append = page.getByLabel('添加到名单末尾');
  await append.fill('新项');
  await append.press('Enter');
  const newItemInput = page.getByLabel('第 3 个名称');
  const unknownRow = page.locator('.preview-row.unknown').filter({ has: newItemInput });
  await expect(unknownRow).toBeVisible();

  await unknownRow.getByRole('button', { name: '关联' }).click();
  await expect(page.locator('.alias-link-order')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.alias-link-order')).toBeHidden();
  await expect(unknownRow).toBeVisible();
});
