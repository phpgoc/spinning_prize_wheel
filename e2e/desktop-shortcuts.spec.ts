import { expect, test, type Locator, type Page } from '@playwright/test';
import { installTauriMock, mockedRankedNames } from './helpers/tauri-mock';

async function openDesktopLineup(page: Page) {
  await installTauriMock(page);
  await page.goto('/#/lineup');
  await expect(page.locator('[data-rank-user-id]')).toHaveCount(4);
}

async function confirmDesktopNames(page: Page, names: string[]) {
  const textarea = page.locator('.names-field textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(names.length);
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

test('桌面抽奖的 S 只在非编辑状态切换自动保存', async ({ page }) => {
  await installTauriMock(page);
  await page.goto('/#/draw');

  await expect(page.getByRole('button', { name: '关闭自动保存历史' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: '开启自动保存历史' })).toBeVisible();

  await page.keyboard.press('w');
  const textarea = page.locator('.import-box textarea');
  await textarea.fill('甲');
  await textarea.press('s');
  await expect(textarea).toHaveValue('甲s');
  await expect(page.getByRole('button', { name: '开启自动保存历史' })).toBeVisible();
});

test('点击排名或按 A 选择第一项，添加输入框不抢焦点', async ({ page }) => {
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

test('数字跳转、方向选择、回车编辑、S 新别名和 F 删除别名', async ({ page }) => {
  await openDesktopLineup(page);
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

  await page.keyboard.press('f');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.locator('[data-rank-user-id="3"]')).not.toContainText('三号');

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rank-user-id="4"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-rank-user-id="3"]')).toHaveClass(/keyboard-selected/);
});

test('取消名称或别名编辑后仍选择原条目', async ({ page }) => {
  await openDesktopLineup(page);
  const thirdCard = page.locator('[data-rank-user-id="3"]');
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
  await page.keyboard.press('1');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['乙', '甲', '丙']);
});

test('键盘排序上方落点执行插入，无排名项可循环插入第一名', async ({ page }) => {
  await openDesktopLineup(page);
  await page.keyboard.press('3');
  await page.keyboard.press('Space');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丙', '甲', '乙']);

  await page.keyboard.press('3');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rank-user-id="4"]')).toHaveClass(/keyboard-selected/);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => mockedRankedNames(page)).toEqual(['丁', '丙', '甲', '乙']);
});

test('鼠标拖拽中间二分之一区域替换，上四分之一区域插入', async ({ page }) => {
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

  await page.getByRole('button', { name: '甲', exact: true }).click({ position: { x: 10, y: 10 } });
  await expect(page.getByLabel('修改名称')).toBeFocused();
});

test('未识别预览可按数字选排名并用空格关联，Enter 不会误确认', async ({ page }) => {
  await openDesktopLineup(page);
  await confirmDesktopNames(page, ['甲', '神秘']);
  const mysteryInput = page.getByLabel('第 2 个名称');
  const unknownRow = page.locator('.preview-row.unknown').filter({ has: mysteryInput });
  await expect(unknownRow).toBeVisible();
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
