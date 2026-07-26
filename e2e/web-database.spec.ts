import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import initSqlJs from 'sql.js';
import { createBattleTmpSnapshot, createSeededBattlePlan } from '../src/lib/battle';

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

async function openRankingPanel(page: import('@playwright/test').Page) {
  const section = page.locator('.desktop-accordion').filter({ hasText: '排名' }).first();
  const toggle = section.locator('.desktop-accordion-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(section.locator('.rank-person-form')).toBeVisible();
}

async function createDesktopDatabaseBackup(): Promise<Buffer> {
  const SQL = await initSqlJs({ locateFile: (file) => `node_modules/sql.js/dist/${file}` });
  const database = new SQL.Database();
  const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(
    ['桌面甲', '桌面乙', '桌面丙', '桌面丁'],
    { format: 'single-elimination', orderMode: 'input', fixedSeedCount: 0, random: () => 0.5 },
  ), Date.now());
  database.run(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER);
    INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1);
    CREATE TABLE user (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rank INTEGER NOT NULL);
    CREATE TABLE alias (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE grouping_history (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, input_json TEXT NOT NULL,
      result_json TEXT NOT NULL, variant TEXT NOT NULL
    );
    INSERT INTO user (id, name, rank) VALUES (1, '桌面排名', 1);
    INSERT INTO alias (id, name, user_id) VALUES (1, '桌面排名', 1), (2, '桌面别名', 1);
    CREATE TABLE battle_tmp (
      id INTEGER PRIMARY KEY, variant TEXT NOT NULL, rules_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, format TEXT NOT NULL, order_mode TEXT NOT NULL,
      participant_count INTEGER NOT NULL, bracket_size INTEGER NOT NULL, fixed_seed_count INTEGER NOT NULL
    );
    CREATE TABLE battle_tmp_participant (
      state_id INTEGER NOT NULL, participant_id INTEGER NOT NULL, name TEXT NOT NULL,
      source_index INTEGER NOT NULL, seed INTEGER NOT NULL, group_index INTEGER, group_rank INTEGER
    );
    CREATE TABLE battle_tmp_match (
      state_id INTEGER NOT NULL, match_id TEXT NOT NULL, stage TEXT NOT NULL,
      level INTEGER NOT NULL, position INTEGER NOT NULL, up INTEGER, down INTEGER,
      up_result INTEGER, down_result INTEGER, status TEXT NOT NULL
    );
    CREATE TABLE battle_history (
      id TEXT NOT NULL, created_at INTEGER NOT NULL, display_name TEXT NOT NULL,
      variant TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (id, variant)
    );
  `);
  database.run(
    `INSERT INTO grouping_history (id, created_at, input_json, result_json, variant)
      VALUES ('desktop-grouping', 1700000000000, ?, ?, 'standard')`,
    [JSON.stringify({ sourceNames: ['桌面甲'] }), JSON.stringify({ groups: [] })],
  );
  database.run(
    `INSERT INTO battle_tmp
      (id, variant, rules_version, created_at, updated_at, format, order_mode, participant_count, bracket_size, fixed_seed_count)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [snapshot.variant, snapshot.rulesVersion, snapshot.createdAt, snapshot.updatedAt, snapshot.format, snapshot.orderMode,
      snapshot.participantCount, snapshot.bracketSize, snapshot.fixedSeedCount],
  );
  for (const participant of snapshot.participants) {
    database.run(
      `INSERT INTO battle_tmp_participant
        (state_id, participant_id, name, source_index, seed, group_index, group_rank)
        VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [participant.id, participant.name, participant.sourceIndex, participant.seed,
        participant.groupIndex, participant.groupRank],
    );
  }
  for (const match of snapshot.matches) {
    database.run(
      `INSERT INTO battle_tmp_match
        (state_id, match_id, stage, level, position, up, down, up_result, down_result, status)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [match.matchId, match.stage, match.level, match.position, match.up, match.down,
        match.upResult, match.downResult, match.status],
    );
  }
  database.run(
    `INSERT INTO battle_history (id, created_at, display_name, variant, payload_json)
     VALUES ('desktop-battle', ?, '桌面对战历史', 'standard', ?)`,
    [snapshot.updatedAt + 1, JSON.stringify({
      title: '桌面对战历史',
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      snapshot,
    })],
  );
  return Buffer.from(database.export());
}

test('Web SQLite 跨刷新保存并恢复对战临时状态', async ({ page }) => {
  await page.goto('/battle');
  const names = ['甲', '乙', '丙', '丁'];
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill(names.join('\n'));
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator('.battle-match')).toHaveCount(3);

  await page.reload();
  await expect(page.locator('.battle-match')).toHaveCount(3);
  await expect(page.locator('.battle-config textarea')).toHaveValue(names.join('\n'));
  await expect(page.locator('.battle-config textarea')).toBeDisabled();
});

test('Web SQLite 清空对战后删除临时状态并保持结果区为空', async ({ page }) => {
  await page.goto('/battle');
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await expect(page.locator('.battle-match')).toHaveCount(3);

  await page.getByRole('button', { name: '清空对战' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '保留设置和名单' }).click();
  await expect(textarea).toHaveValue('甲\n乙\n丙\n丁');
  await expect(page.locator('.battle-match')).toHaveCount(0);
  await expect(page.locator('.battle-empty-result')).toBeVisible();

  await page.reload();
  await expect(page.locator('.battle-match')).toHaveCount(0);
  await expect(page.locator('.battle-load-current-button')).toBeDisabled();
  await expect(page.locator('.battle-load-current-button')).toHaveCSS('visibility', 'hidden');
});

test('Web SQLite 保存排名和分组历史并可在刷新后读取', async ({ page }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);
  await page.locator('.rank-person-form input').fill('甲');
  await page.locator('.rank-person-form').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.ranked-user-list').getByText('甲', { exact: true })).toBeVisible();

  const textarea = page.locator('.names-field textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('button', { name: '按输入顺序分组' }).click();
  await page.getByRole('button', { name: '保存到历史' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeDisabled();

  await page.reload();
  await openRankingPanel(page);
  await expect(page.locator('.ranked-user-list').getByText('甲', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '分组历史' }).click();
  await expect(page.locator('.history-panel .ui-history-row')).toHaveCount(1);
});

test('Web 对战历史在普通版和猜蜜版之间共享', async ({ page }) => {
  await page.goto('/battle');
  const textarea = page.locator('.battle-config textarea');
  await textarea.fill('甲\n乙\n丙\n丁');
  await textarea.press('Alt+Enter');
  await page.getByRole('radio', { name: '单败' }).check();
  await page.getByRole('button', { name: /^抽签/u }).click();
  await page.getByRole('button', { name: '保存历史' }).click();
  await expect(page.getByRole('button', { name: '历史已保存' })).toBeDisabled();
  await page.getByRole('button', { name: /对战历史/u }).click();
  await expect(page.locator('.history-panel .ui-history-row')).toHaveCount(1);

  await page.goto('/caimi/battle');
  await page.getByRole('button', { name: /对战历史/u }).click();
  await expect(page.locator('.history-panel .ui-history-row')).toHaveCount(1);
});

test('Web 排名区支持录入、关联、拖拽和键盘移动', async ({ page }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);

  const form = page.locator('.rank-person-form');
  const nameInput = form.locator('input');
  const saveButton = form.getByRole('button', { name: '保存' });
  for (const name of ['甲', '乙', '丙']) {
    await nameInput.fill(name);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    // 保存完成后表单才允许下一次写入，避免把 UI 测试变成并发写入测试。
    await expect(saveButton).toHaveText('保存');
  }

  const rankedZone = page.locator('[data-rank-zone="ranked"]');
  const unrankedZone = page.locator('[data-rank-zone="unranked"]');
  const dragFirstUnranked = async () => {
    const source = unrankedZone.locator('[data-rank-user-id]').first();
    const destination = rankedZone;
    const sourceBox = await source.boundingBox();
    const destinationBox = await destination.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(destinationBox).not.toBeNull();
    const from = sourceBox!;
    const to = destinationBox!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + Math.max(4, to.height - 4), { steps: 12 });
    await page.mouse.up();
  };

  await dragFirstUnranked();
  await expect(rankedZone.locator('[data-rank-user-id]')).toHaveCount(1);
  await dragFirstUnranked();
  await expect(rankedZone.locator('[data-rank-user-id]')).toHaveCount(2);
  await dragFirstUnranked();
  await expect(rankedZone.locator('[data-rank-user-id]')).toHaveCount(3);
  await expect(unrankedZone.locator('[data-rank-user-id]')).toHaveCount(0);

  const rankedCards = rankedZone.locator('[data-rank-user-id]');
  const orderBeforeKeyboardMove = await rankedZone.locator('.user-name').allTextContents();
  await rankedCards.first().focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => rankedZone.locator('.user-name').allTextContents()).toEqual([
    orderBeforeKeyboardMove[1],
    orderBeforeKeyboardMove[0],
    orderBeforeKeyboardMove[2],
  ]);

  const names = page.locator('.names-field textarea');
  await names.fill('甲\n神秘');
  await names.press('Alt+Enter');
  const unknownRow = page.locator('.preview-row.unknown').first();
  await expect(unknownRow).toBeVisible();
  await unknownRow.getByRole('button', { name: '关联' }).click();
  await page.keyboard.press('Space');
  await expect(page.locator('.alias-link-order')).toHaveCount(0);
  await expect(page.locator('.preview-row.unknown')).toHaveCount(0);
  await expect.poll(async () => (await rankedZone.locator('.ranked-user-aliases').allTextContents()).join(' ')).toContain('神秘');

  await names.fill('新增');
  await names.press('Alt+Enter');
  await page.locator('.preview-row.unknown').first().getByRole('button', { name: '录入' }).click();
  await expect(unrankedZone.locator('.user-name')).toContainText('新增');
});

test('Web SQLite 可以导出浏览器数据库备份', async ({ page }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SQLite' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^转盘数据库-\d{4}-\d{2}-\d{2}\.sqlite3$/u);
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();
  const SQL = await initSqlJs({ locateFile: (file) => `node_modules/sql.js/dist/${file}` });
  const database = new SQL.Database(await readFile(backupPath!));
  const battleHistoryColumns = database.exec('PRAGMA table_info(battle_history)')[0]?.values
    .map((row) => String(row[1])) ?? [];
  expect(battleHistoryColumns).toEqual(['id', 'created_at', 'display_name', 'payload_json']);
  database.close();
});

test('Web SQLite 不再读取旧版常用候选存储', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wheel-common-selections-v1', JSON.stringify([{
      version: 1,
      id: 'legacy-selection',
      name: '旧名单',
      createdAt: 1_700_000_000_000,
      prizes: [{ id: 'legacy-prize', name: '甲', color: '#fff', enabled: true }],
    }]));
  });
  await page.goto('/wheel');
  await page.locator('.common-panel .accordion-toggle').click();
  await expect(page.getByRole('group', { name: '常用候选：旧名单' })).toHaveCount(0);
});

test('Web SQLite 备份可以导入并恢复排名', async ({ page, browser }) => {
  await page.goto('/grouping');
  await openRankingPanel(page);
  await page.locator('.rank-person-form input').fill('可恢复项');
  await page.locator('.rank-person-form').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.ranked-user-list').getByText('可恢复项', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SQLite' }).click();
  const backup = await downloadPromise;
  const backupPath = await backup.path();
  expect(backupPath).not.toBeNull();
  const backupBytes = await readFile(backupPath!);

  const restoredPage = await browser.newPage();
  await restoredPage.goto('/grouping');
  await openRankingPanel(restoredPage);
  await expect(restoredPage.locator('.ranked-user-list').getByText('可恢复项', { exact: true })).toHaveCount(0);
  await restoredPage.locator('input[type="file"][accept*=".sqlite"]').setInputFiles({
    name: '转盘备份.sqlite3',
    mimeType: 'application/vnd.sqlite3',
    buffer: backupBytes,
  });
  await expect(restoredPage.getByRole('alertdialog', { name: '导入 SQLite 数据库？' })).toBeVisible();
  await restoredPage.getByRole('button', { name: '替换并刷新' }).click();
  await expect(restoredPage.locator('.ranked-user-list').getByText('可恢复项', { exact: true })).toBeVisible();
  await restoredPage.close();
});

test('Web SQLite 可以导入桌面版关系化数据库', async ({ page }) => {
  const desktopBackup = await createDesktopDatabaseBackup();
  await page.goto('/battle');
  await openRankingPanel(page);
  await page.locator('input[type="file"][accept*=".sqlite"]').setInputFiles({
    name: '桌面数据库.sqlite3',
    mimeType: 'application/vnd.sqlite3',
    buffer: desktopBackup,
  });
  await expect(page.getByRole('alertdialog', { name: '导入 SQLite 数据库？' })).toBeVisible();
  await page.getByRole('button', { name: '替换并刷新' }).click();
  await expect(page.locator('.battle-match')).toHaveCount(3);
  await expect(page.locator('.battle-config textarea')).toHaveValue('桌面甲\n桌面乙\n桌面丙\n桌面丁');
  await openRankingPanel(page);
  await expect(page.locator('.ranked-user-list').getByText('桌面排名', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /对战历史/u }).click();
  await expect(page.locator('.history-panel .ui-history-row')).toHaveCount(1);
});
