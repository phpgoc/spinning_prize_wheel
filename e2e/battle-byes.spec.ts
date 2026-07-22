import { expect, test, type Page } from '@playwright/test';
import { installTauriMock } from './helpers/tauri-mock';

const fiveNames = ['甲', '乙', '丙', '丁', '戊'];

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test('五人单败明确标出首轮轮空并显示已自动进入第二轮', async ({ page }) => {
  await drawBattle(page, '单败');

  const explanation = page.getByRole('note').filter({ hasText: '轮空说明' });
  await expect(explanation).toContainText('3 个首轮轮空');
  await expect(explanation).toContainText('已自动进入第二轮');
  await expect(explanation).toContainText('不需要填写比分');

  const firstRound = page.locator('[data-battle-stage="single"][data-battle-level="1"]');
  const byeMatches = page.locator(
    '[data-battle-stage="single"][data-battle-level="1"].auto-advance',
  );
  await expect(firstRound).toHaveCount(4);
  await expect(byeMatches).toHaveCount(3);
  await expect(byeMatches.locator('.battle-side strong').filter({ hasText: '轮空' })).toHaveCount(3);
  await expect(byeMatches.locator('small em')).toHaveText([
    /轮空，自动进入第二轮/u,
    /轮空，自动进入第二轮/u,
    /轮空，自动进入第二轮/u,
  ]);

  const byeNames = await page.evaluate(() => {
    const snapshot = (window as any).__E2E_TAURI_STATE__.battleTmpState;
    const participantNames = new Map(snapshot.participants.map((participant: any) => [
      participant.id,
      participant.name,
    ]));
    return snapshot.matches
      .filter((match: any) => match.stage === 'single' && match.level === 1 && match.status === 'completed')
      .map((match: any) => participantNames.get(match.up ?? match.down));
  });
  const secondRoundText = await page.locator(
    '[data-battle-stage="single"][data-battle-level="2"] .battle-side strong',
  ).allTextContents();
  for (const name of byeNames) expect(secondRoundText).toContain(name);
});

test('五人双败说明轮空不产生败者并明确标出自动跳过的空场', async ({ page }) => {
  await drawBattle(page, '双败');

  const explanation = page.getByRole('note').filter({ hasText: '轮空说明' });
  await expect(explanation).toContainText('3 个胜者组首轮轮空');
  await expect(explanation).toContainText('已自动进入胜者组第二轮');
  await expect(explanation).toContainText('轮空不记作失败');
  await expect(explanation).toContainText('不会产生选手进入败者组');

  const winnerByes = page.locator(
    '[data-battle-stage="winner"][data-battle-level="1"].auto-advance',
  );
  await expect(winnerByes).toHaveCount(3);
  await expect(winnerByes.locator('small em')).toHaveText([
    /轮空，自动进入胜者组第二轮/u,
    /轮空，自动进入胜者组第二轮/u,
    /轮空，自动进入胜者组第二轮/u,
  ]);

  const firstLoserRound = page.locator(
    '.double-loser-section [data-battle-stage="loser"][data-battle-level="1"]',
  );
  await expect(
    firstLoserRound.locator('.battle-side strong').filter({ hasText: '上游轮空，无败者' }),
  ).toHaveCount(3);
  const skippedMatch = firstLoserRound.filter({ has: page.locator('small em') });
  await expect(skippedMatch).toHaveCount(1);
  await expect(skippedMatch.locator('small em')).toHaveText('没有可参赛选手，本场自动跳过');
});

async function drawBattle(page: Page, format: '单败' | '双败') {
  await page.goto('/battle', { waitUntil: 'domcontentloaded' });
  const textarea = page.locator('.battle-config textarea');
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await textarea.fill(fiveNames.join('\n'));
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: format, exact: true }).check();
  const suspense = page.getByRole('checkbox', { name: '悬念揭晓' });
  if (await suspense.isChecked()) await suspense.uncheck();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator(format === '单败' ? '.single-battle-bracket' : '.double-battle-bracket'))
    .toBeVisible();
}
