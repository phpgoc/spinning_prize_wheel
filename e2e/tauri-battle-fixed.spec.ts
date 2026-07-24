import { expect, test, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { launchTauri, stopProcess } from './helpers/tauri-app';

const requestedCount = process.env.TAURI_BATTLE_COUNT?.trim().toLocaleLowerCase('en-US');
const requestedFormat = process.env.TAURI_BATTLE_FORMAT?.trim().toLocaleLowerCase('en-US');
const participantCounts = requestedCount === 'all'
  ? Array.from({ length: 26 }, (_, index) => index + 8)
  : requestedCount && /^\d+$/u.test(requestedCount)
    ? [Number(requestedCount)]
    : [];
const battleFormats = requestedFormat === undefined
  ? (['单败', '双败'] as const)
  : requestedFormat === 'single' || requestedFormat === '单败'
    ? (['单败'] as const)
    : requestedFormat === 'double' || requestedFormat === '双败'
      ? (['双败'] as const)
      : ([] as const);
if (requestedFormat !== undefined && battleFormats.length === 0) {
  throw new Error(`赛制必须是 single/单败 或 double/双败，收到 ${requestedFormat}`);
}
const STEP_DELAY_MS = Number(process.env.TAURI_E2E_STEP_DELAY_MS ?? 2_000);
// 发布验收时把真实导出的 Excel 留在下载目录，便于人工逐个打开核对。
const persistentDownloadDirectory = process.env.TAURI_E2E_DOWNLOAD_DIR?.trim() || undefined;
const testRunId = `${Date.now()}-${process.pid}`;

for (const participantCount of participantCounts) {
  for (const format of battleFormats) {
    test(`真实 Tauri ${participantCount} 人 ${format} 慢速检查前 N 固定签位、完整赛程和 Excel`, async ({}, testInfo) => {
      // 每次录分和焦点切换都至少停两秒；33 人双败完整打完需要数分钟。
      test.setTimeout(900_000);
      if (participantCount < 8 || participantCount > 33) {
        throw new Error(`人数必须在 8 到 33 之间，收到 ${participantCount}`);
      }
      const applicationPath = process.env.TAURI_E2E_STANDARD_APP;
      if (!applicationPath) throw new Error('缺少普通版程序路径');

      const rankedUsers = Array.from({ length: 33 }, (_, index) => ({
        name: `种子${index + 1}`,
        rank: index + 1,
        aliases: [],
      }));
      const names = rankedUsers.slice(0, participantCount).map((user) => user.name);
      // Playwright 的 outputPath 在多次命令运行间可能复用，加入运行标识避免恢复上一轮临时对战。
      const dataDirectory = testInfo.outputPath(`data-${participantCount}-${format}-${testRunId}`);
      const testDownloadDirectory = persistentDownloadDirectory
        ? join(persistentDownloadDirectory, `${participantCount}-${format}-${testRunId}`)
        : undefined;
      const running = await launchTauri(applicationPath, dataDirectory, {
        downloadDirectory: testDownloadDirectory,
      });

      try {
        const page = running.page;
        await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible({ timeout: 30_000 });
        await slowClick(page, page.getByRole('button', { name: '对战', exact: true }));
        await expect(page).toHaveURL(/\/battle$/u);

        // 先导入足够多的连续排名，再把当前人数名单逐项放入对战页。
        const rankingInput = page.locator('.rank-manager input[type="file"]');
        await rankingInput.setInputFiles({
          name: 'ranking.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({
            version: 1,
            kind: 'wheel-ranking',
            exportedAt: new Date().toISOString(),
            users: rankedUsers,
          })),
        });
        await waitStep();
        const importDialog = page.getByRole('alertdialog');
        await expect(importDialog).toContainText('导入 33 项排名');
        await slowClick(page, importDialog.getByRole('button', { name: '确认' }));
        await expect(page.locator('[data-rank-user-id]')).toHaveCount(33);

        const textarea = page.locator('.battle-config textarea');
        await textarea.focus();
        await expect(textarea).toBeFocused();
        await textarea.fill(names.join('\n'));
        await waitStep();
        await textarea.press('Alt+Enter');
        await waitStep();
        await expect(page.locator('.preview-row')).toHaveCount(participantCount);
        await expect(page.locator('.preview-row.unknown')).toHaveCount(0);

        const fixedCounts = [2, 4, 8].filter((count) => count < participantCount);
        await slowCheck(page, page.getByRole('radio', { name: format, exact: true }));
        await slowCheck(page, page.getByRole('radio', { name: '按排名', exact: true }));
        for (const fixedCount of fixedCounts) {
          await slowCheck(page, page.getByRole('radio', { name: `前 ${fixedCount} 固定`, exact: true }));
          await assertFixedPreview(page, names, fixedCount, participantCount);
        }

        // headed 用例必须进入实际对战编辑区，而不是只停在固定签位的只读查看。
        await slowClick(page, page.getByRole('button', { name: /^抽签/u }));
        const bracketSelector = format === '单败' ? '.single-battle-bracket' : '.double-battle-bracket';
        await expect(page.locator(bracketSelector)).toBeVisible();
        await expect(page.locator(`${bracketSelector} .battle-match:not(.read-only)`)).not.toHaveCount(0);

        const keyboardUsage = await completeTauriBattleThroughKeyboard(page, format);
        if (format === '单败') {
          expect(keyboardUsage.single).toBeGreaterThan(0);
          expect(keyboardUsage.winner + keyboardUsage.loser).toBe(0);
        } else {
          expect(keyboardUsage.winner).toBeGreaterThan(0);
          expect(keyboardUsage.loser).toBeGreaterThan(0);
        }
        await expect(page.locator(
          '.battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"]) input[type="number"]:not(:disabled)',
        )).toHaveCount(0);

        await slowClick(page, page.locator('[data-export="battle-excel"]'));
        const worksheet = await exportedBattleWorksheet(running.downloadDirectory);
        expect(worksheet.name).toBe('对战签表');
        expect(worksheet.getCell('A1').value).toBe(`${format}对战签表`);
        const values = worksheetValues(worksheet).map((value) => String(value));
        for (const name of names) expect(values).toContain(name);
        expect(values).toEqual(expect.arrayContaining(['4', '1']));
        expect(values.filter((value) => value.startsWith('等待'))).toEqual([]);
      } finally {
        await running.browser.close().catch(() => undefined);
        await stopProcess(running.process);
      }
    });
  }
}

async function waitStep() {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, STEP_DELAY_MS)));
}

async function slowClick(page: Page, locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.click();
  await waitStep();
}

async function slowCheck(page: Page, locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.check();
  await expect(locator).toBeChecked();
  await waitStep();
}

async function slowFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await waitStep();
}

async function slowPress(page: Page, key: string) {
  await page.keyboard.press(key);
  await waitStep();
}

type TauriBattleGroup = 'single' | 'winner' | 'loser' | 'final';

async function completeTauriBattleThroughKeyboard(page: Page, format: '单败' | '双败') {
  const usage = { single: 0, winner: 0, loser: 0, final: 0 };
  for (let round = 0; round < 160; round += 1) {
    const group = await nextReadyTauriBattleGroup(page, format);
    if (group === null) return usage;
    const score = await focusTauriBattleGroup(page, group);
    await enterFocusedBattleScore(page, score, 4, 1);
    usage[group] += 1;
  }
  throw new Error('真实 Tauri 在预期场次数内没有完成整张对战表');
}

async function nextReadyTauriBattleGroup(page: Page, format: '单败' | '双败'): Promise<TauriBattleGroup | null> {
  const groups = new Set(await page.locator('.battle-match').evaluateAll((matches) => [...new Set(matches.flatMap((match) => {
    if (
      match.dataset.battleStatus === 'completed'
      || match.dataset.battleStatus === 'skipped'
      || match.querySelectorAll('input[type="number"]:not(:disabled)').length !== 2
    ) return [];
    const stage = match.dataset.battleStage;
    return stage === 'single' || stage === 'winner' || stage === 'loser' || stage === 'final' ? [stage] : [];
  }))]));
  if (format === '单败') return groups.has('single') ? 'single' : null;
  if (groups.has('winner')) return 'winner';
  if (groups.has('loser')) return 'loser';
  return groups.has('final') ? 'final' : null;
}

async function focusTauriBattleGroup(page: Page, group: TauriBattleGroup) {
  if (group === 'final') {
    const match = page.locator(
      '.double-final-section .battle-match:not([data-battle-status="completed"]):not([data-battle-status="skipped"])',
    ).filter({ has: page.locator('input[type="number"]:not(:disabled)') }).first();
    await slowFocus(match);
    await slowPress(page, 'ArrowDown');
    const score = page.locator('.double-final-section input[type="number"]:focus');
    await expect(score).toHaveCount(1);
    await expect(score).toBeFocused();
    return score;
  }

  await slowFocus(page.locator('.battle-result'));
  await slowPress(page, group === 'single' ? 's' : group === 'winner' ? 'w' : 'l');
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

async function enterFocusedBattleScore(
  page: Page,
  focused: Locator,
  upScore: number,
  downScore: number,
) {
  const matchId = await focused.evaluate((input) => input.closest<HTMLElement>('.battle-match')?.dataset.battleMatchId ?? null);
  expect(matchId).not.toBeNull();
  const match = page.locator(`.battle-match[data-battle-match-id="${matchId}"]`);
  const first = match.locator('input[type="number"]:not(:disabled)').nth(0);
  await slowFocus(first);
  await first.fill(String(upScore));
  await waitStep();
  await first.press('Enter');
  await waitStep();

  const second = match.locator('input[type="number"]:not(:disabled)').nth(1);
  await expect(second).toBeVisible();
  await slowFocus(second);
  await second.fill(String(downScore));
  await waitStep();
  await second.press('Enter');
  await waitStep();
  await expect(match).toHaveAttribute('data-battle-status', 'completed');
  await expect(match.locator('.battle-side.winner')).toHaveCount(1);
}

async function exportedBattleWorksheet(downloadDirectory: string) {
  await expect.poll(async () => {
    try {
      return (await readdir(downloadDirectory)).filter((file) => file.endsWith('.xlsx'));
    } catch {
      return [];
    }
  }, { timeout: 30_000 }).not.toHaveLength(0);
  const files = (await readdir(downloadDirectory)).filter((file) => file.endsWith('.xlsx'));
  const filesWithTime = await Promise.all(files.map(async (file) => ({
    file,
    modifiedAt: (await stat(join(downloadDirectory, file))).mtimeMs,
  })));
  const file = filesWithTime.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.file;
  if (!file) throw new Error('未找到真实 Tauri 导出的 Excel 文件');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(join(downloadDirectory, file)) as never);
  const worksheet = workbook.getWorksheet('对战签表');
  if (!worksheet) throw new Error('真实 Tauri 导出的 Excel 缺少“对战签表”工作表');
  return worksheet;
}

function worksheetValues(worksheet: ExcelJS.Worksheet) {
  const values: unknown[] = [];
  worksheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
}

async function assertFixedPreview(
  page: Page,
  names: readonly string[],
  fixedCount: number,
  participantCount: number,
) {
  const bracket = page.locator('.battle-preview-bracket');
  await expect(bracket).toBeVisible();
  const fixedSlots = await bracket.locator('.battle-match[data-battle-level="1"] .seed-fixed').evaluateAll((elements) => elements.map((element) => {
    const card = element.closest<HTMLElement>('.battle-match');
    const participant = element.querySelector('strong')?.textContent?.trim() ?? '';
    const cardRect = card?.getBoundingClientRect();
    const slotRect = element.getBoundingClientRect();
    if (!card || !cardRect) throw new Error('固定签位缺少对战卡片');
    const cardStyle = getComputedStyle(card);
    return {
      participant,
      stage: card.dataset.battleStage,
      level: card.dataset.battleLevel,
      position: Number(card.dataset.battlePosition),
      side: Array.from(card.querySelectorAll<HTMLElement>('.battle-side')).indexOf(element) === 0 ? 'up' : 'down',
      cssPosition: getComputedStyle(element).position,
      width: slotRect.width,
      cardContentWidth: card.clientWidth
        - Number.parseFloat(cardStyle.paddingLeft)
        - Number.parseFloat(cardStyle.paddingRight),
      insideCard: slotRect.left >= cardRect.left
        && slotRect.right <= cardRect.right
        && slotRect.top >= cardRect.top
        && slotRect.bottom <= cardRect.bottom,
    };
  }));

  expect(fixedSlots).toHaveLength(fixedCount);
  expect(fixedSlots.map((slot) => slot.participant).sort()).toEqual(
    names.slice(0, fixedCount).sort(),
  );
  expect(fixedSlots.every((slot) => slot.stage === 'single' || slot.stage === 'winner')).toBe(true);
  expect(fixedSlots.every((slot) => slot.level === '1')).toBe(true);
  expect(fixedSlots.every((slot) => slot.cssPosition === 'static')).toBe(true);
  expect(fixedSlots.every((slot) => Math.abs(slot.width - slot.cardContentWidth) < 1)).toBe(true);
  expect(fixedSlots.every((slot) => slot.insideCard)).toBe(true);
  await expect(bracket.locator('.battle-match[data-battle-level="1"] .seed-fixed strong'))
    .toHaveText(fixedSlots.map((slot) => slot.participant));

  // 位置应落在标准首轮签位，而不是只把名字悬浮在结果区。
  const bracketSize = 2 ** Math.ceil(Math.log2(participantCount));
  const seedOrder = standardSeedOrder(bracketSize);
  const expected = new Map(names.slice(0, fixedCount).map((name, index) => {
    const position = seedOrder.indexOf(index + 1);
    return [name, { position: Math.floor(position / 2) + 1, side: position % 2 === 0 ? 'up' : 'down' }];
  }));
  for (const slot of fixedSlots) {
    expect(slot.position).toBe(expected.get(slot.participant)?.position);
    expect(slot.side).toBe(expected.get(slot.participant)?.side);
  }
}

function standardSeedOrder(size: number): number[] {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) {
    order = order.flatMap((seed) => [seed, current + 1 - seed]);
  }
  return order;
}
