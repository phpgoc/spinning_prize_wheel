import { expect, test, type Page } from '@playwright/test';
import { installTauriMock } from './helpers/tauri-mock';

const counts = Array.from({ length: 26 }, (_, index) => index + 8);
const formats = [
  { label: '单败', value: 'single-elimination' as const, selector: '.single-battle-bracket', stage: 'single' },
  { label: '双败', value: 'double-elimination' as const, selector: '.double-battle-bracket', stage: 'winner' },
];

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

for (const format of formats) {
  for (const count of counts) {
    test(`${format.label} ${count} 人查看、编辑和导出布局`, async ({ page }) => {
      test.setTimeout(90_000);
      await drawBattle(page, format.label, count);

      const bracket = page.locator(format.selector);
      await expect(bracket).toBeVisible();
      const snapshot = await page.evaluate(() => structuredClone(
        (window as any).__E2E_TAURI_STATE__.battleTmpState,
      ));
      expect(snapshot.participantCount).toBe(count);
      expect(new Set(snapshot.matches.map((match: any) => match.matchId)).size)
        .toBe(snapshot.matches.length);
      expect(await bracket.locator('.battle-match').count()).toBe(snapshot.matches.length);
      expect(await bracket.locator('.battle-match:not(.read-only)').count()).toBe(snapshot.matches.length);

      const firstStageByes = snapshot.matches.filter((match: any) => (
        match.stage === format.stage
        && match.level === 1
        && (match.up === null || match.down === null)
        && (match.up !== null || match.down !== null)
      ));
      if (count < snapshot.bracketSize) {
        expect(firstStageByes.length).toBeGreaterThan(0);
        for (const bye of firstStageByes) {
          const participantId = bye.up ?? bye.down;
          expect(snapshot.matches.some((match: any) => (
            match.stage === format.stage
            && match.level === 2
            && (match.up === participantId || match.down === participantId)
          ))).toBe(true);
        }
      }

      const exportCount = await page.evaluate(() => (
        (window as any).__E2E_TAURI_STATE__.invocations
          .filter((entry: any) => entry.cmd === 'export_binary_file').length
      ));
      await page.getByRole('button', { name: 'Excel', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (
        (window as any).__E2E_TAURI_STATE__.invocations
          .filter((entry: any) => entry.cmd === 'export_binary_file').length
      ))).toBe(exportCount + 1);

      await page.getByRole('button', { name: '保存历史' }).click();
      await page.getByRole('button', { name: /对战历史/u }).click();
      const historyCard = page.locator('.history-panel article');
      await expect(historyCard).toHaveCount(1);
      await historyCard.getByRole('button', { name: /查看比赛/u }).click();
      const historyBracket = page.locator('.battle-history-bracket');
      await expect(historyBracket).toBeVisible();
      await expect(historyBracket.locator('.battle-match')).toHaveCount(snapshot.matches.length);
      await expect(historyBracket.locator('.battle-match.read-only')).toHaveCount(snapshot.matches.length);
      await expect(historyBracket.locator('input:not(:disabled)')).toHaveCount(0);
      await page.getByRole('button', { name: '返回当前对战' }).click();
      await expect(page.locator(`${format.selector}:not(.read-only)`)).toBeVisible();
    });
  }
}

test('对战比分数字输入隐藏原生微调并支持 Alt 上下调整', async ({ page }) => {
  await drawBattle(page, '单败', 4);
  await expect(page.locator('.single-battle-bracket')).toBeVisible();
  const revealAll = page.getByRole('button', { name: '显示全部' });
  if (await revealAll.count() > 0) await revealAll.click();
  const score = page.locator('.single-battle-bracket .battle-match').first().locator('input[type="number"]').first();
  await score.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(score).toHaveValue('1');
  await score.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(score).toHaveValue('0');
  await expect(score).toHaveCSS('appearance', 'textfield');
});

async function drawBattle(page: Page, label: string, count: number) {
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  const textarea = page.locator('.names-field textarea');
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await textarea.fill(Array.from({ length: count }, (_, index) => `选手${index + 1}`).join('\n'));
  await textarea.press('Alt+Enter');
  await expect(page.locator('.preview-row')).toHaveCount(count);
  await page.getByRole('radio', { name: label, exact: true }).check();
  const suspense = page.getByRole('checkbox', { name: '悬念揭晓' });
  if (await suspense.isChecked()) await suspense.uncheck();
  await page.getByRole('button', { name: /^抽签/u }).click();
}
