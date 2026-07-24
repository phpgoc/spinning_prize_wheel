import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
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
    test(`${format.label} ${count} 人完整打完、快捷键焦点和最终 Excel`, async ({ page }) => {
      test.setTimeout(180_000);
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

      // 每种人数与赛制都要把整张表打完。单败只能用 S，双败胜者/败者组分别用 W/L，
      // 总决赛没有魔法键时从对战卡片用方向键进入，防止焦点悄悄跑回设置区。
      const keyboardUsage = await completeBattleThroughKeyboard(page, format.value);
      expect(keyboardUsage.single + keyboardUsage.winner + keyboardUsage.loser).toBeGreaterThan(0);
      if (format.value === 'single-elimination') {
        expect(keyboardUsage.single).toBeGreaterThan(0);
        expect(keyboardUsage.winner + keyboardUsage.loser).toBe(0);
      } else {
        expect(keyboardUsage.winner).toBeGreaterThan(0);
        expect(keyboardUsage.loser).toBeGreaterThan(0);
      }
      const completedSnapshot = await battleSnapshot(page);
      expect(completedSnapshot.matches.every((match: any) => (
        match.status === 'completed' || match.status === 'skipped'
      ))).toBe(true);
      const championName = completedChampionName(completedSnapshot, format.value);
      expect(championName).not.toBeNull();

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

      const excelButton = page.locator('[data-export="battle-excel"]');
      const worksheet = await exportBattleWorksheet(page, excelButton);
      expect(worksheet.name).toBe('对战签表');
      expect(worksheet.getCell('A1').value).toBe(`${format.label}对战签表`);
      const exportedValues = worksheetValues(worksheet).map((value) => String(value));
      for (const name of Array.from({ length: count }, (_, index) => `选手${index + 1}`)) {
        expect(exportedValues).toContain(name);
      }
      expect(exportedValues).toEqual(expect.arrayContaining(['4', '1']));
      expect(exportedValues).toContain(championName);
      expect(exportedValues.filter((value) => value.startsWith('等待'))).toEqual([]);

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
      await expect(historyBracket).toContainText(championName);
      await page.getByRole('button', { name: '返回当前对战' }).click();
      await expect(page.locator(`${format.selector}:not(.read-only)`)).toBeVisible();
    });
  }
}

type BattleFormat = (typeof formats)[number]['value'];
type BattleKeyboardGroup = 'single' | 'winner' | 'loser' | 'final';

async function completeBattleThroughKeyboard(page: Page, format: BattleFormat) {
  const usage = { single: 0, winner: 0, loser: 0, final: 0 };
  // 33 人双败有 60 余场；这个上限一旦触发说明某场没有被正确完成，不能静默成功。
  for (let round = 0; round < 160; round += 1) {
    const group = await nextReadyBattleGroup(page, format);
    if (group === null) return usage;
    const score = await focusBattleGroupWithKeyboard(page, group);
    await enterFocusedBattleScore(page, score);
    usage[group] += 1;
  }
  throw new Error('在预期场次数内没有完成整张对战表');
}

async function nextReadyBattleGroup(page: Page, format: BattleFormat): Promise<BattleKeyboardGroup | null> {
  const groups = new Set(await page.locator('.battle-match').evaluateAll((matches) => [...new Set(matches.flatMap((match) => {
    if (
      match.dataset.battleStatus === 'completed'
      || match.dataset.battleStatus === 'skipped'
      || match.querySelectorAll('input[type="number"]:not(:disabled)').length !== 2
    ) return [];
    const stage = match.dataset.battleStage;
    return stage === 'single' || stage === 'winner' || stage === 'loser' || stage === 'final' ? [stage] : [];
  }))]));
  if (format === 'single-elimination') return groups.has('single') ? 'single' : null;
  // 胜者、败者组分别通过 W/L 进入；总决赛留到两组都没有可打场次时再处理。
  if (groups.has('winner')) return 'winner';
  if (groups.has('loser')) return 'loser';
  return groups.has('final') ? 'final' : null;
}

async function focusBattleGroupWithKeyboard(page: Page, group: BattleKeyboardGroup) {
  const result = page.locator('.battle-result');
  if (group === 'final') {
    const finalMatch = page.locator(
      '.double-final-section .battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"])',
    ).filter({ has: page.locator('input[type="number"]:not(:disabled)') }).first();
    await finalMatch.focus();
    await expect(finalMatch).toBeFocused();
    await finalMatch.press('ArrowDown');
    const score = page.locator('.double-final-section input[type="number"]:focus');
    await expect(score).toHaveCount(1);
    await expect(score).toBeFocused();
    return score;
  }

  await result.focus();
  await expect(result).toBeFocused();
  await page.keyboard.press(group === 'single' ? 's' : group === 'winner' ? 'w' : 'l');
  const section = group === 'single'
    ? '.single-battle-bracket'
    : group === 'winner'
      ? '.double-winner-section'
      : '.double-loser-section';
  const score = page.locator(`${section} .battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"]) input[type="number"]:focus`);
  await expect(score).toHaveCount(1);
  await expect(score).toBeFocused();
  return score;
}

async function enterFocusedBattleScore(page: Page, focusedScore: ReturnType<Page['locator']>) {
  const matchId = await focusedScore.evaluate((input) => (
    input.closest<HTMLElement>('.battle-match')?.dataset.battleMatchId ?? null
  ));
  expect(matchId).not.toBeNull();
  const match = page.locator(`.battle-match[data-battle-match-id="${matchId}"]`);
  const first = match.locator('input[type="number"]:not(:disabled)').nth(0);
  await first.focus();
  await expect(first).toBeFocused();
  await first.fill('4');
  await first.press('Enter');
  await expect.poll(async () => (await battleMatch(page, matchId!)).upResult).toBe(4);

  const second = match.locator('input[type="number"]:not(:disabled)').nth(1);
  await second.focus();
  await expect(second).toBeFocused();
  await second.fill('1');
  await second.press('Enter');
  await expect.poll(async () => (await battleMatch(page, matchId!)).status).toBe('completed');
  await expect(match.locator('.battle-side.winner')).toHaveCount(1);
}

async function battleSnapshot(page: Page): Promise<any> {
  return page.evaluate(() => structuredClone((window as any).__E2E_TAURI_STATE__.battleTmpState));
}

async function battleMatch(page: Page, matchId: string) {
  const snapshot = await battleSnapshot(page);
  const match = snapshot.matches.find((candidate: any) => candidate.matchId === matchId);
  if (!match) throw new Error(`找不到对战场次 ${matchId}`);
  return match;
}

function completedChampionName(snapshot: any, format: BattleFormat) {
  const completedFinal = snapshot.matches
    .filter((match: any) => (
      match.status === 'completed'
      && (format === 'single-elimination' ? match.stage === 'single' : match.stage === 'final')
    ))
    .sort((left: any, right: any) => left.level - right.level || left.position - right.position)
    .at(-1);
  if (!completedFinal || completedFinal.upResult === completedFinal.downResult) return null;
  const championId = completedFinal.upResult > completedFinal.downResult
    ? completedFinal.up
    : completedFinal.down;
  return snapshot.participants.find((participant: any) => participant.id === championId)?.name ?? null;
}

async function exportBattleWorksheet(page: Page, button: ReturnType<Page['locator']>) {
  const exportCount = await page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').length
  ));
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('导出中…');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').length
  )), { timeout: 30_000 }).toBe(exportCount + 1);
  await expect(button).toBeEnabled();
  const bytes = await page.evaluate(() => structuredClone(
    (window as any).__E2E_TAURI_STATE__.invocations
      .filter((entry: any) => entry.cmd === 'export_binary_file').at(-1).args.bytes,
  ));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  return workbook.getWorksheet('对战签表')!;
}

function worksheetValues(worksheet: ExcelJS.Worksheet) {
  const values: unknown[] = [];
  worksheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
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

test('同一轮比赛之间的行间距大于同场两名选手之间的间距', async ({ page }) => {
  for (const format of ['单败', '双败'] as const) {
    await drawBattle(page, format, 8);
    const round = page.locator(format === '单败'
      ? '.single-bracket-side.left .battle-round'
      : '.double-winner-section .battle-round').first();
    const geometry = await round.evaluate((element) => {
      const matches = [...element.querySelectorAll<HTMLElement>('.battle-match')]
        .map((match) => match.getBoundingClientRect())
        .sort((left, right) => left.top - right.top);
      const sides = [...element.querySelectorAll<HTMLElement>('.battle-match:first-child .battle-side')]
        .map((side) => side.getBoundingClientRect());
      return {
        matchGap: matches[1].top - matches[0].bottom,
        sideGap: sides[1].top - sides[0].bottom,
      };
    });
    expect(geometry.matchGap).toBeGreaterThan(geometry.sideGap);
    if (format === '单败') {
      await page.evaluate(() => {
        (window as any).__E2E_TAURI_STATE__.battleTmpState = null;
        sessionStorage.removeItem('__E2E_TAURI_BATTLE_TMP__');
      });
    }
  }
});

test('对战导出显示忙碌状态并在失败后恢复按钮', async ({ page }) => {
  await drawBattle(page, '单败', 4);
  await page.evaluate(() => {
    (window as any).__E2E_TAURI_STATE__.commandFailures.export_binary_file = ['模拟磁盘写入失败'];
  });

  const excelButton = page.locator('[data-export="battle-excel"]');
  const jsonButton = page.locator('[data-export="battle-json"]');
  await excelButton.click();
  await expect(excelButton).toBeDisabled();
  await expect(excelButton).toHaveText('导出中…');
  await expect(jsonButton).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('模拟磁盘写入失败', { timeout: 30_000 });
  await expect(excelButton).toHaveText('Excel');
  await expect(excelButton).toBeEnabled();
  await expect(jsonButton).toBeEnabled();
});

test('单败最终轮卡片宽度随轮次放大而不会被外层轨道压缩', async ({ page }) => {
  await drawBattle(page, '单败', 8);

  const widths = await page.locator('.single-battle-bracket [data-battle-stage="single"]')
    .evaluateAll((matches) => matches.map((match) => ({
      level: Number(match.getAttribute('data-battle-level')),
      width: match.getBoundingClientRect().width,
    })));
  const widthByLevel = new Map<number, number>();
  for (const entry of widths) widthByLevel.set(entry.level, entry.width);

  expect(widthByLevel.get(2)).toBeGreaterThan((widthByLevel.get(1) ?? 0) * 1.05);
  expect(widthByLevel.get(3)).toBeGreaterThan((widthByLevel.get(2) ?? 0) * 1.05);
});

test('中等宽度对战页的四个颜色控件和存档按钮不会被横向裁掉', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/battle');
  await expect(page.locator('.battle-result')).toBeVisible();

  const controls = page.locator('.battle-color-controls');
  await expect(controls.locator('.ui-color-palette')).toHaveCount(4);
  const overflow = await controls.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  for (const buttonName of ['保存配色', '加载配色']) {
    await expect(controls.getByRole('button', { name: buttonName })).toBeVisible();
  }
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
