import type { Database, SqlJsStatic } from 'sql.js';
import sqlJsUrl from 'sql.js/dist/sql-wasm.js?url';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  parseBattleTmpSnapshot,
  updateBattleTmpResult,
  type BattleHistory,
  type BattleHistoryListItem,
  type BattleTmpSnapshot,
} from './battle';
import type { AppVariant } from './app-variant';
import type {
  AliasRecord,
  CommonSelection,
  RankedUser,
  ResolvedGroupingName,
  SavedDraw,
  SavedGrouping,
  HistoryListItem,
} from './types';
import type { RankedUserDropTarget } from './random-grouping';

const DATABASE_NAME = 'spinning-prize-wheel';
const DATABASE_STORE = 'database';
const DATABASE_KEY = 'main';
const DATABASE_VERSION = 1;
const DATABASE_SCHEMA_VERSION = 1;

let databasePromise: Promise<Database> | null = null;
let mutationQueue = Promise.resolve();

interface RankedUserInput {
  id: number | null;
  name: string;
  rank: number;
  aliases?: string[];
}

interface RankingTransferInput {
  name: string;
  rank: number;
  aliases: string[];
}

/** 在浏览器中执行与 Rust invoke 同名的业务命令。 */
export async function invokeWebCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const db = await getDatabase();
  if (isMutation(command)) {
    let result!: T;
    const operation = mutationQueue.then(async () => {
      result = executeCommand<T>(db, command, args);
      await persistDatabase(db);
    });
    // 当前写入失败只影响当前命令，不能让后续所有 Web SQLite 操作永久跟着失败。
    mutationQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }
  await mutationQueue;
  return executeCommand<T>(db, command, args);
}

export async function exportWebDatabase(): Promise<Uint8Array> {
  const database = await getDatabase();
  await mutationQueue;
  return database.export();
}

/** 导入网页版或桌面版导出的 SQLite 文件，并替换浏览器中的本地数据库。 */
export async function importWebDatabase(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength === 0) throw new Error('SQLite 文件为空');
  const SQL = await loadSqlJs();
  const previousPromise = databasePromise;
  if (previousPromise) await previousPromise;
  try {
    await mutationQueue;
  } catch {
    // 之前的写入失败不应阻止用户用备份恢复数据库。
  }
  mutationQueue = Promise.resolve();

  const imported = new SQL.Database(bytes);
  try {
    if (!hasKnownDatabaseTable(imported)) {
      throw new Error('不是转盘 SQLite 数据库');
    }
    assertDatabaseVersion(imported);
    const desktopBattleSnapshot = normalizeImportedSchema(imported);
    migrateDatabase(imported, SQL);
    if (desktopBattleSnapshot) {
      saveBattleTmpState(imported, desktopBattleSnapshot);
    }
    validateDatabaseSchema(imported);
    await persistDatabase(imported);
    const previous = previousPromise ? await previousPromise : null;
    previous?.close();
    databasePromise = Promise.resolve(imported);
  } catch (reason) {
    imported.close();
    throw reason;
  }
}

function isMutation(command: string): boolean {
  return !command.startsWith('list_')
    && !command.startsWith('load_')
    && command !== 'resolve_grouping_names'
    && command !== 'open_download_folder'
    && command !== 'open_database_folder';
}

function executeCommand<T>(
  db: Database,
  command: string,
  args: Record<string, unknown>,
): T {
  switch (command) {
    case 'list_common_selections':
      return queryJsonRows<CommonSelection>(
        db,
        'SELECT payload_json FROM common_selection ORDER BY created_at DESC',
      ) as T;
    case 'save_common_selection': {
      const selection = args.selection as CommonSelection;
      db.run(
        `INSERT OR REPLACE INTO common_selection (id, created_at, payload_json)
         VALUES (?, ?, ?)`,
        [selection.id, selection.createdAt, JSON.stringify(selection)],
      );
      return undefined as T;
    }
    case 'delete_common_selection':
      db.run('DELETE FROM common_selection WHERE id = ?', [String(args.id)]);
      return undefined as T;
    case 'list_draw_histories':
      return queryJsonRows<SavedDraw>(
        db,
        `SELECT payload_json FROM draw_history
         ORDER BY created_at DESC`,
        [],
      ) as T;
    case 'save_draw_history': {
      const draw = args.draw as SavedDraw;
      db.run(
        `INSERT OR REPLACE INTO draw_history (id, created_at, variant, payload_json)
         VALUES (?, ?, ?, ?)`,
        [draw.id, draw.createdAt, String(args.variant), JSON.stringify(draw)],
      );
      return undefined as T;
    }
    case 'delete_draw_history':
      db.run('DELETE FROM draw_history WHERE id = ?', [String(args.id)]);
      return undefined as T;
    case 'clear_draw_histories':
      db.run('DELETE FROM draw_history');
      return undefined as T;
    case 'load_app_setting': {
      const rows = db.exec('SELECT value_json FROM app_kv WHERE key = ?', [String(args.key)])[0]?.values ?? [];
      return (rows.length > 0 ? JSON.parse(String(rows[0][0])) : null) as T;
    }
    case 'save_app_setting':
      db.run(
        `INSERT OR REPLACE INTO app_kv (key, value_json) VALUES (?, ?)`,
        [String(args.key), JSON.stringify(args.value)],
      );
      return undefined as T;
    case 'list_ranked_users':
      return listRankedUsers(db) as T;
    case 'resolve_grouping_names':
      return resolveGroupingNames(db, args.names as string[]) as T;
    case 'save_ranked_user':
      return saveRankedUser(db, args.user as RankedUserInput) as T;
    case 'add_ranked_user_alias':
      return addRankedUserAlias(db, Number(args.userId), String(args.alias)) as T;
    case 'clear_ranked_user_aliases':
      return clearRankedUserAliases(db, Number(args.userId)) as T;
    case 'delete_ranked_user':
      deleteRankedUser(db, Number(args.id));
      return undefined as T;
    case 'replace_ranked_users':
      return replaceRankedUsers(db, args.users as RankingTransferInput[]) as T;
    case 'move_ranked_user':
      return moveRankedUser(
        db,
        Number(args.draggedId),
        args.target as RankedUserDropTarget,
      ) as T;
    case 'list_grouping_histories':
      return listGroupingHistoryItems(db, String(args.variant) as AppVariant) as T;
    case 'load_grouping_history':
      return loadGroupingHistory(db, String(args.variant) as AppVariant, String(args.id)) as T;
    case 'save_grouping_history':
      saveGroupingHistory(db, String(args.variant), args.grouping as SavedGrouping);
      return undefined as T;
    case 'import_grouping_history':
      saveGroupingHistory(db, String(args.variant), args.history as SavedGrouping);
      return listGroupingHistoryItems(db, String(args.variant) as AppVariant) as T;
    case 'delete_grouping_history':
      db.run('DELETE FROM grouping_history WHERE id = ?', [String(args.id)]);
      return undefined as T;
    case 'clear_grouping_histories':
      db.run('DELETE FROM grouping_history');
      return undefined as T;
    case 'list_battle_histories':
      return listBattleHistoryItems(db, String(args.variant) as AppVariant) as T;
    case 'load_battle_history':
      return loadBattleHistory(db, String(args.variant) as AppVariant, String(args.id)) as T;
    case 'save_battle_history':
      saveBattleHistory(
        db,
        String(args.variant) as AppVariant,
        args.history as BattleHistory,
        args.markCurrent === true,
      );
      return undefined as T;
    case 'delete_battle_history':
      db.run('DELETE FROM battle_history WHERE id = ?', [String(args.id)]);
      return undefined as T;
    case 'clear_battle_histories':
      db.run('DELETE FROM battle_history');
      return undefined as T;
    case 'load_battle_tmp_history_status':
      return loadBattleTmpHistoryStatus(db, String(args.variant) as AppVariant) as T;
    case 'mark_battle_tmp_history_saved':
      markBattleTmpHistorySaved(db, String(args.variant) as AppVariant, Number(args.updatedAt));
      return undefined as T;
    case 'save_battle_tmp_state': {
      const state = parseBattleTmpSnapshot(args.state, String(args.variant) as AppVariant);
      saveBattleTmpState(db, state, args.historySaved === true);
      return undefined as T;
    }
    case 'load_battle_tmp_state':
      return loadBattleTmpState(db, String(args.variant) as AppVariant) as T;
    case 'update_battle_tmp_result': {
      const variant = String(args.variant) as AppVariant;
      const current = loadBattleTmpState(db, variant);
      if (!current) throw new Error('当前没有可更新的对战临时状态');
      const updated = updateBattleTmpResult(
        current,
        String(args.matchId),
        nullableInteger(args.upResult),
        nullableInteger(args.downResult),
        Number(args.updatedAt),
      );
      saveBattleTmpState(db, updated);
      return updated as T;
    }
    case 'clear_battle_tmp_state':
      db.run('DELETE FROM battle_tmp WHERE variant = ?', [String(args.variant)]);
      return undefined as T;
    case 'open_database_folder':
      void downloadDatabaseFile(db);
      return undefined as T;
    case 'open_download_folder':
      return undefined as T;
    default:
      throw new Error(`网页版尚未实现命令：${command}`);
  }
}

async function getDatabase(): Promise<Database> {
  if (!databasePromise) databasePromise = createDatabase();
  return databasePromise;
}

async function createDatabase(): Promise<Database> {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持 IndexedDB');
  const [SQL, saved] = await Promise.all([
    loadSqlJs(),
    readPersistedDatabase(),
  ]);
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  assertDatabaseVersion(db);
  migrateDatabase(db, SQL);
  validateDatabaseSchema(db);
  if (!saved) await persistDatabase(db);
  return db;
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const browserWindow = window as Window & {
    initSqlJs?: (config?: {
      locateFile?: (file: string) => string;
      wasmBinary?: Uint8Array;
    }) => Promise<SqlJsStatic>;
  };
  const wasmBinaryPromise = fetch(wasmUrl).then(async (response) => {
    if (!response.ok) throw new Error(`无法加载浏览器 SQLite WASM：${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const scriptPromise = browserWindow.initSqlJs
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = sqlJsUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('无法加载浏览器 SQLite 运行库'));
      document.head.append(script);
    });
  const [, wasmBinary] = await Promise.all([scriptPromise, wasmBinaryPromise]);
  if (!browserWindow.initSqlJs) throw new Error('浏览器 SQLite 运行库初始化失败');
  return browserWindow.initSqlJs({ locateFile: () => wasmUrl, wasmBinary });
}

function migrateDatabase(db: Database, _SQL: SqlJsStatic) {
  assertDatabaseVersion(db);
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS common_selection (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS draw_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX IF NOT EXISTS draw_history_variant_created_at
      ON draw_history(variant, created_at DESC);
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      rank INTEGER NOT NULL DEFAULT 10000
    );
    CREATE TABLE IF NOT EXISTS alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS alias_user_id ON alias(user_id);
    CREATE TABLE IF NOT EXISTS grouping_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX IF NOT EXISTS grouping_history_variant_created_at
      ON grouping_history(variant, created_at DESC);
    CREATE TABLE IF NOT EXISTS battle_tmp (
      variant TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      history_saved INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battle_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX IF NOT EXISTS battle_history_variant_created_at
      ON battle_history(variant, created_at DESC);
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (${DATABASE_SCHEMA_VERSION}, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  `);
  ensureHistoryDisplayNameColumns(db);
}

function ensureHistoryDisplayNameColumns(db: Database) {
  for (const table of ['grouping_history', 'battle_history']) {
    if (!tableColumns(db, table).has('display_name')) {
      db.run(`ALTER TABLE ${table} ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`);
    }
  }
  backfillHistoryDisplayNames(db);
}

/** 为旧数据库一次性补齐历史列表名称；正常列表查询不再解析 payload_json。 */
function backfillHistoryDisplayNames(db: Database) {
  const groupingRows = db.exec(
    "SELECT id, created_at, variant, payload_json FROM grouping_history WHERE display_name = ''",
  )[0]?.values ?? [];
  for (const [id, createdAt, variant, payloadJson] of groupingRows) {
    const history = JSON.parse(String(payloadJson)) as SavedGrouping;
    db.run(
      'UPDATE grouping_history SET display_name = ? WHERE id = ? AND variant = ?',
      [groupingDisplayName(history), String(id), String(variant)],
    );
  }
  const battleRows = db.exec(
    "SELECT id, variant, payload_json FROM battle_history WHERE display_name = ''",
  )[0]?.values ?? [];
  for (const [id, variant, payloadJson] of battleRows) {
    const payload = JSON.parse(String(payloadJson)) as Record<string, unknown>;
    const snapshot = parseBattleTmpSnapshot(
      payload.snapshot ?? payload,
      String(variant) as AppVariant,
    );
    const history = {
      id: String(id),
      createdAt: 0,
      updatedAt: snapshot.updatedAt,
      title: typeof payload.title === 'string' ? payload.title : null,
      snapshot,
    } satisfies BattleHistory;
    db.run(
      'UPDATE battle_history SET display_name = ? WHERE id = ? AND variant = ?',
      [battleHistoryDisplayName(history, snapshot), String(id), String(variant)],
    );
  }
}

function assertDatabaseVersion(db: Database) {
  if (!tableColumns(db, 'schema_migrations').size) return;
  const versions = db.exec('SELECT version FROM schema_migrations ORDER BY version')[0]?.values
    .map(([version]) => Number(version)) ?? [];
  if (versions.some((version) => version !== DATABASE_SCHEMA_VERSION)) {
    throw new Error(`数据库版本不兼容：0.3.0 只支持数据库版本 ${DATABASE_SCHEMA_VERSION}，请手动卸载旧版本并清除旧数据库`);
  }
}

function hasKnownDatabaseTable(db: Database): boolean {
  const result = db.exec(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN ('schema_migrations', 'app_kv', 'draw_history', 'user', 'grouping_history', 'battle_tmp', 'battle_history')`,
  )[0];
  return Boolean(result?.values.length);
}

/** 将当前版本 Rust 版关系化表转换成浏览器版快照表，保持桌面备份可恢复。 */
function normalizeImportedSchema(db: Database): BattleTmpSnapshot | null {
  normalizeImportedDrawHistory(db);
  normalizeImportedGroupingHistory(db);
  return normalizeImportedBattleState(db);
}

function normalizeImportedDrawHistory(db: Database) {
  const columns = tableColumns(db, 'draw_history');
  if (!columns.has('payload_json') || !columns.has('variant')) return;
  const rows = db.exec(
    'SELECT id, created_at, variant, payload_json FROM draw_history ORDER BY created_at DESC',
  )[0]?.values ?? [];
  replaceTable(db, 'draw_history', `
    CREATE TABLE draw_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX draw_history_variant_created_at
      ON draw_history(variant, created_at DESC);
  `, () => {
    for (const [id, createdAt, variant, payload] of rows) {
      db.run(
        'INSERT OR REPLACE INTO draw_history (id, created_at, variant, payload_json) VALUES (?, ?, ?, ?)',
        [id, createdAt, variant, payload],
      );
    }
  });
}

function normalizeImportedGroupingHistory(db: Database) {
  const columns = tableColumns(db, 'grouping_history');
  if (!columns.has('input_json') || !columns.has('result_json')) return;
  const rows = db.exec(
    'SELECT id, created_at, variant, input_json, result_json FROM grouping_history ORDER BY created_at DESC',
  )[0]?.values ?? [];
  replaceTable(db, 'grouping_history', `
    CREATE TABLE grouping_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX grouping_history_variant_created_at
      ON grouping_history(variant, created_at DESC);
  `, () => {
    for (const [id, createdAt, variant, inputJson, resultJson] of rows) {
      let input: unknown;
      let result: unknown;
      try {
        input = JSON.parse(String(inputJson));
        result = JSON.parse(String(resultJson));
      } catch {
        throw new Error('分组历史内容损坏，无法导入');
      }
      const history = { id: String(id), createdAt: Number(createdAt), input, result } as SavedGrouping;
      db.run(
        'INSERT OR REPLACE INTO grouping_history (id, created_at, display_name, variant, payload_json) VALUES (?, ?, ?, ?, ?)',
        [id, createdAt, groupingDisplayName(history), variant, JSON.stringify(history)],
      );
    }
  });
}

function normalizeImportedBattleState(db: Database): BattleTmpSnapshot | null {
  const columns = tableColumns(db, 'battle_tmp');
  if (!columns.has('rules_version') || columns.has('payload_json')) return null;
  const metadata = db.exec(
    `SELECT variant, rules_version, created_at, updated_at, format, order_mode,
            participant_count, bracket_size, fixed_seed_count
     FROM battle_tmp WHERE id = 1`,
  )[0]?.values[0];
  let snapshot: BattleTmpSnapshot | null = null;
  if (metadata) {
    const participants = db.exec(
      `SELECT participant_id, name, source_index, seed, group_index, group_rank
       FROM battle_tmp_participant WHERE state_id = 1 ORDER BY participant_id`,
    )[0]?.values.map(([id, name, sourceIndex, seed, groupIndex, groupRank]) => ({
      id: Number(id),
      name: String(name),
      sourceIndex: Number(sourceIndex),
      seed: Number(seed),
      groupIndex: groupIndex === null ? null : Number(groupIndex),
      groupRank: groupRank === null ? null : Number(groupRank),
    })) ?? [];
    const matches = db.exec(
      `SELECT match_id, stage, level, position, up, down, up_result, down_result, status
       FROM battle_tmp_match WHERE state_id = 1
       ORDER BY CASE stage
         WHEN 'pairing' THEN 0 WHEN 'single' THEN 1 WHEN 'winner' THEN 2
         WHEN 'loser' THEN 3 ELSE 4 END, level, position`,
    )[0]?.values.map(([matchId, stage, level, position, up, down, upResult, downResult, status]) => ({
      matchId: String(matchId),
      stage: String(stage),
      level: Number(level),
      position: Number(position),
      up: up === null ? null : Number(up),
      down: down === null ? null : Number(down),
      upResult: upResult === null ? null : Number(upResult),
      downResult: downResult === null ? null : Number(downResult),
      status: String(status),
    })) ?? [];
    snapshot = parseBattleTmpSnapshot({
      version: 1,
      rulesVersion: Number(metadata[1]),
      kind: 'battle-tmp',
      variant: String(metadata[0]),
      createdAt: Number(metadata[2]),
      updatedAt: Number(metadata[3]),
      format: String(metadata[4]),
      orderMode: String(metadata[5]),
      participantCount: Number(metadata[6]),
      bracketSize: Number(metadata[7]),
      fixedSeedCount: Number(metadata[8]),
      participants,
      matches,
    }, String(metadata[0]) as AppVariant);
  }
  db.run('PRAGMA foreign_keys = OFF');
  db.run('DROP TABLE IF EXISTS battle_tmp_match; DROP TABLE IF EXISTS battle_tmp_participant; DROP TABLE battle_tmp;');
  db.run('PRAGMA foreign_keys = ON');
  return snapshot;
}

function tableColumns(db: Database, table: string): Set<string> {
  const result = db.exec(`PRAGMA table_info(${table})`)[0];
  return new Set(result?.values.map((row) => String(row[1])) ?? []);
}

function replaceTable(db: Database, table: string, schema: string, fill: () => void) {
  db.run('PRAGMA foreign_keys = OFF');
  db.run(`DROP TABLE IF EXISTS ${table};`);
  db.run(schema);
  fill();
  db.run('PRAGMA foreign_keys = ON');
}

/** 打开或替换浏览器数据库前检查表结构和 JSON 内容。 */
function validateDatabaseSchema(db: Database) {
  const requiredColumns: Record<string, readonly string[]> = {
    schema_migrations: ['version', 'applied_at'],
    common_selection: ['id', 'created_at', 'payload_json'],
    draw_history: ['id', 'created_at', 'variant', 'payload_json'],
    user: ['id', 'name', 'rank'],
    alias: ['id', 'name', 'user_id'],
    grouping_history: ['id', 'created_at', 'display_name', 'variant', 'payload_json'],
    battle_tmp: ['variant', 'created_at', 'updated_at', 'history_saved', 'payload_json'],
    battle_history: ['id', 'created_at', 'display_name', 'variant', 'payload_json'],
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = tableColumns(db, table);
    if (columns.some((column) => !actual.has(column))) {
      throw new Error(`SQLite 数据库表 ${table} 结构不兼容`);
    }
  }
  if (String(singleValue(db, 'PRAGMA integrity_check')) !== 'ok') {
    throw new Error('SQLite 数据库完整性检查失败');
  }
  queryJsonRows<CommonSelection>(db, 'SELECT payload_json FROM common_selection');
  queryJsonRows<SavedDraw>(db, 'SELECT payload_json FROM draw_history');
  queryJsonRows<SavedGrouping>(db, 'SELECT payload_json FROM grouping_history');
  listBattleHistories(db, 'standard');
  listBattleHistories(db, 'caimi');
  listRankedUsers(db);
  loadBattleTmpState(db, 'standard');
  loadBattleTmpState(db, 'caimi');
}

function listRankedUsers(db: Database): RankedUser[] {
  const users = db.exec(
    'SELECT id, name, rank FROM user ORDER BY rank ASC, name COLLATE NOCASE ASC',
  )[0];
  if (!users) return [];
  return users.values.map(([id, name, rank]) => {
    const userId = Number(id);
    return {
      id: userId,
      name: String(name),
      rank: Number(rank),
      aliases: queryAliases(db, userId),
    };
  });
}

function queryAliases(db: Database, userId: number): AliasRecord[] {
  const result = db.exec(
    'SELECT id, name, user_id FROM alias WHERE user_id = ? ORDER BY id ASC',
    [userId],
  )[0];
  return result?.values.map(([id, name, owner]) => ({
    id: Number(id),
    name: String(name),
    userId: Number(owner),
  })) ?? [];
}

function resolveGroupingNames(db: Database, names: string[]): ResolvedGroupingName[] {
  const users = listRankedUsers(db);
  const byAlias = new Map<string, RankedUser>();
  for (const user of users) {
    for (const alias of user.aliases) {
      byAlias.set(alias.name.toLocaleLowerCase('zh-CN'), user);
    }
  }
  return names.map((inputName) => {
    const user = byAlias.get(inputName.toLocaleLowerCase('zh-CN'));
    return user
      ? {
          inputName,
          known: true,
          userId: user.id,
          canonicalName: user.name,
          rank: user.rank,
        }
      : {
          inputName,
          known: false,
          userId: null,
          canonicalName: null,
          rank: null,
        };
  });
}

function saveRankedUser(db: Database, input: RankedUserInput): RankedUser {
  const name = input.name.trim();
  if (!name) throw new Error('名称不能为空');
  if (name.length > 80) throw new Error('名称不能超过 80 个字符');
  const rank = normalizeRank(input.rank);
  assertUniqueAlias(db, name, input.id);
  return transaction(db, () => {
    let userId = input.id;
    if (userId === null) {
      db.run('INSERT INTO user (name, rank) VALUES (?, ?)', [name, rank]);
      userId = Number(singleValue(db, 'SELECT last_insert_rowid()'));
      db.run('INSERT INTO alias (name, user_id) VALUES (?, ?)', [name, userId]);
    } else {
      const existing = findRankedUser(db, userId);
      const renamed = existing.name.toLocaleLowerCase('zh-CN') !== name.toLocaleLowerCase('zh-CN');
      // 允许把本名改成自己的别名，先移除旧别名再更新本名，避免唯一键冲突。
      if (renamed) db.run('DELETE FROM alias WHERE user_id = ? AND name = ? COLLATE NOCASE', [userId, name]);
      db.run('UPDATE user SET name = ?, rank = ? WHERE id = ?', [name, rank, userId]);
      const canonical = existing.aliases.find(
        (alias) => alias.name.toLocaleLowerCase('zh-CN') === existing.name.toLocaleLowerCase('zh-CN'),
      );
      if (canonical) db.run('UPDATE alias SET name = ? WHERE id = ?', [name, canonical.id]);
      else db.run('INSERT INTO alias (name, user_id) VALUES (?, ?)', [name, userId]);
    }
    return findRankedUser(db, userId);
  });
}

function normalizeRank(value: number | null | undefined): number {
  if (value === null || value === undefined) return 10_000;
  if (!Number.isSafeInteger(value)) throw new Error('排名不合法');
  return Math.max(1, Math.min(10_000, value));
}

function addRankedUserAlias(db: Database, userId: number, value: string): RankedUser {
  const alias = value.trim();
  if (alias.length > 80) throw new Error('名称不能超过 80 个字符');
  findRankedUser(db, userId);
  assertUniqueAlias(db, alias);
  db.run('INSERT INTO alias (name, user_id) VALUES (?, ?)', [alias, userId]);
  return findRankedUser(db, userId);
}

function clearRankedUserAliases(db: Database, userId: number): RankedUser {
  const user = findRankedUser(db, userId);
  db.run('DELETE FROM alias WHERE user_id = ? AND name <> ? COLLATE NOCASE', [userId, user.name]);
  return findRankedUser(db, userId);
}

function deleteRankedUser(db: Database, userId: number) {
  findRankedUser(db, userId);
  transaction(db, () => {
    db.run('DELETE FROM user WHERE id = ?', [userId]);
    normalizeRanks(db);
  });
}

function replaceRankedUsers(db: Database, inputs: RankingTransferInput[]): RankedUser[] {
  return transaction(db, () => {
    db.run('DELETE FROM alias');
    db.run('DELETE FROM user');
    for (const input of inputs) {
      const name = input.name.trim();
      db.run('INSERT INTO user (name, rank) VALUES (?, ?)', [name, input.rank]);
      const userId = Number(singleValue(db, 'SELECT last_insert_rowid()'));
      for (const alias of new Set([name, ...input.aliases.map((item) => item.trim())])) {
        if (alias) db.run('INSERT INTO alias (name, user_id) VALUES (?, ?)', [alias, userId]);
      }
    }
    return listRankedUsers(db);
  });
}

function moveRankedUser(
  db: Database,
  userId: number,
  target: RankedUserDropTarget,
): RankedUser[] {
  return transaction(db, () => {
    const dragged = findRankedUser(db, userId);
    const ranked = listRankedUsers(db).filter((user) => user.rank < 10_000);
    if (target.kind === 'swap') {
      if (dragged.rank >= 10_000) throw new Error('无排名选项只能插入排名');
      const other = findRankedUser(db, target.userId);
      db.run('UPDATE user SET rank = ? WHERE id = ?', [other.rank, dragged.id]);
      db.run('UPDATE user SET rank = ? WHERE id = ?', [dragged.rank, other.id]);
    } else if (target.kind === 'unranked') {
      db.run('UPDATE user SET rank = 10000 WHERE id = ?', [dragged.id]);
      writeNormalizedRanks(db, ranked.filter((user) => user.id !== dragged.id));
    } else {
      const sourceIndex = ranked.findIndex((user) => user.id === dragged.id);
      const reordered = ranked.filter((user) => user.id !== dragged.id);
      let index = Math.max(0, Math.min(ranked.length, target.index));
      if (sourceIndex >= 0 && sourceIndex < index) index -= 1;
      reordered.splice(Math.min(index, reordered.length), 0, dragged);
      writeNormalizedRanks(db, reordered);
    }
    return listRankedUsers(db);
  });
}

function normalizeRanks(db: Database) {
  writeNormalizedRanks(db, listRankedUsers(db).filter((user) => user.rank < 10_000));
}

function writeNormalizedRanks(db: Database, users: RankedUser[]) {
  users.forEach((user, index) => db.run('UPDATE user SET rank = ? WHERE id = ?', [index + 1, user.id]));
}

function findRankedUser(db: Database, userId: number): RankedUser {
  const user = listRankedUsers(db).find((candidate) => candidate.id === userId);
  if (!user) throw new Error('找不到排名项');
  return user;
}

function assertUniqueAlias(db: Database, value: string, ownerId: number | null = null) {
  const name = value.trim();
  if (!name) throw new Error('名称不能为空');
  const duplicate = Number(singleValue(
    db,
    `SELECT EXISTS(
       SELECT 1 FROM alias WHERE name = ? COLLATE NOCASE
       AND (? IS NULL OR user_id <> ?)
     )`,
    [name, ownerId, ownerId],
  ));
  if (duplicate) throw new Error('名称或别名已经存在');
}

function saveGroupingHistory(db: Database, variant: string, history: SavedGrouping) {
  db.run(
    `INSERT OR REPLACE INTO grouping_history (id, created_at, display_name, variant, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [history.id, history.createdAt, groupingDisplayName(history), variant, JSON.stringify(history)],
  );
}

function groupingDisplayName(history: SavedGrouping): string {
  const input = history.input && typeof history.input === 'object' && !Array.isArray(history.input)
    ? history.input as Record<string, unknown>
    : {};
  const custom = typeof history.title === 'string' && history.title.trim()
    ? history.title.trim()
    : typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '';
  if (custom) return custom;
  const people = Array.isArray(input.sourceNames) ? input.sourceNames.length : 0;
  const groups = Number.isFinite(Number(input.groupCount)) ? Number(input.groupCount) : '—';
  const mode = input.orderMode === 'input' ? '输入顺序' : input.orderMode === 'random' ? '全随机' : '排名';
  return `${people} 项 · ${groups} 组 · ${mode}`;
}

function saveBattleHistory(
  db: Database,
  variant: AppVariant,
  history: BattleHistory,
  markCurrent: boolean,
) {
  transaction(db, () => {
    const snapshot = parseBattleTmpSnapshot(history.snapshot, variant);
    if (history.updatedAt !== snapshot.updatedAt) throw new Error('对战记录更新时间不一致');
    if (snapshot.createdAt > snapshot.updatedAt) throw new Error('对战签表时间顺序不正确');
    if (history.createdAt <= snapshot.updatedAt) throw new Error('历史保存时间必须晚于签表更新时间');
    if (markCurrent) {
      const status = loadBattleTmpHistoryStatus(db, variant);
      if (status && status.updatedAt !== snapshot.updatedAt) {
        throw new Error('当前对战临时状态已改变，无法保存历史');
      }
      if (status?.historySaved) throw new Error('同一对战状态已经保存过历史');
    }
    db.run(
      `INSERT OR REPLACE INTO battle_history (id, created_at, display_name, variant, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [history.id, history.createdAt, battleHistoryDisplayName(history, snapshot), variant, JSON.stringify({
        title: history.title ?? null,
        createdAt: snapshot.createdAt,
        updatedAt: history.updatedAt,
        snapshot,
      })],
    );
    if (markCurrent) markBattleTmpHistorySaved(db, variant, snapshot.updatedAt);
  });
}

function battleHistoryDisplayName(history: BattleHistory, snapshot: BattleTmpSnapshot): string {
  const title = history.title?.trim();
  if (title) return title;
  const format = snapshot.format === 'avoid-first-pair' ? '同组不对战1对2' : snapshot.format === 'single-elimination' ? '单败' : '双败';
  return `${snapshot.participantCount} 人 · ${format}`;
}

function listBattleHistories(db: Database, variant: AppVariant): BattleHistory[] {
  const rows = db.exec(
    `SELECT id, created_at, payload_json FROM battle_history
     WHERE variant = ? ORDER BY created_at DESC`,
    [variant],
  )[0]?.values ?? [];
  return rows.map(([id, createdAt, payload]) => {
    const payloadValue = JSON.parse(String(payload)) as unknown;
    const rawSnapshot = unwrapBattleHistorySnapshot(payloadValue);
    const snapshotVariant = rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot)
      && (rawSnapshot as { variant?: unknown }).variant === 'caimi'
      ? 'caimi'
      : 'standard';
    const snapshot = parseBattleTmpSnapshot(rawSnapshot, snapshotVariant);
    const updatedAt = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
      ? Number((payloadValue as { updatedAt?: unknown }).updatedAt)
      : Number.NaN;
    const payloadCreatedAt = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
      ? Number((payloadValue as { createdAt?: unknown }).createdAt)
      : Number.NaN;
    if (updatedAt !== snapshot.updatedAt) throw new Error('对战历史更新时间不一致');
    if (snapshot.createdAt > snapshot.updatedAt) throw new Error('对战签表时间顺序不正确');
    if (payloadCreatedAt !== snapshot.createdAt) throw new Error('对战历史创建时间不一致');
    if (Number(createdAt) <= snapshot.updatedAt) throw new Error('历史保存时间必须晚于签表更新时间');
    return {
      id: String(id),
      createdAt: Number(createdAt),
      updatedAt: Number(updatedAt),
      title: payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
        && typeof (payloadValue as { title?: unknown }).title === 'string'
        ? (payloadValue as { title: string }).title
        : null,
      snapshot,
    };
  });
}

function listGroupingHistoryItems(db: Database, _variant: AppVariant): HistoryListItem[] {
  const rows = db.exec(
    'SELECT id, created_at, display_name FROM grouping_history ORDER BY created_at DESC',
  )[0]?.values ?? [];
  return rows.map(([id, createdAt, displayName]) => ({
    id: String(id), createdAt: Number(createdAt), displayName: String(displayName),
  }));
}

function loadGroupingHistory(db: Database, _variant: AppVariant, id: string): SavedGrouping {
  const rows = db.exec(
    'SELECT payload_json FROM grouping_history WHERE id = ? ORDER BY created_at DESC LIMIT 1',
    [id],
  )[0]?.values ?? [];
  if (!rows.length) throw new Error('找不到分组历史');
  return JSON.parse(String(rows[0][0])) as SavedGrouping;
}

function listBattleHistoryItems(db: Database, variant: AppVariant): BattleHistoryListItem[] {
  const rows = db.exec(
    'SELECT id, created_at, display_name FROM battle_history WHERE variant = ? ORDER BY created_at DESC',
    [variant],
  )[0]?.values ?? [];
  return rows.map(([id, createdAt, displayName]) => ({
    id: String(id), createdAt: Number(createdAt), displayName: String(displayName),
  }));
}

function loadBattleHistory(db: Database, variant: AppVariant, id: string): BattleHistory {
  const history = listBattleHistories(db, variant).find((item) => item.id === id);
  if (!history) throw new Error('找不到对战历史');
  return history;
}

function unwrapBattleHistorySnapshot(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'snapshot' in value) {
    return (value as { snapshot: unknown }).snapshot;
  }
  return value;
}

function saveBattleTmpState(db: Database, state: BattleTmpSnapshot, historySaved = false) {
  db.run(
    `INSERT OR REPLACE INTO battle_tmp (variant, created_at, updated_at, history_saved, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [state.variant, state.createdAt, state.updatedAt, historySaved ? 1 : 0, JSON.stringify(state)],
  );
}

function loadBattleTmpHistoryStatus(db: Database, variant: AppVariant): { updatedAt: number; historySaved: boolean } | null {
  const result = db.exec(
    'SELECT updated_at, history_saved FROM battle_tmp WHERE variant = ?',
    [variant],
  )[0]?.values[0];
  if (!result) return null;
  return { updatedAt: Number(result[0]), historySaved: Number(result[1]) !== 0 };
}

function markBattleTmpHistorySaved(db: Database, variant: AppVariant, updatedAt: number) {
  db.run(
    `UPDATE battle_tmp SET history_saved = 1
     WHERE variant = ? AND updated_at = ?`,
    [variant, updatedAt],
  );
  // sql.js 的 run 不返回影响行数；再次读取确认时间和标记，避免静默标记错误状态。
  const status = loadBattleTmpHistoryStatus(db, variant);
  if (!status || status.updatedAt !== updatedAt || !status.historySaved) {
    throw new Error('当前对战临时状态已改变，无法标记历史');
  }
}

function loadBattleTmpState(db: Database, variant: AppVariant): BattleTmpSnapshot | null {
  const json = singleValue(
    db,
    'SELECT payload_json FROM battle_tmp WHERE variant = ?',
    [variant],
  );
  return json === null ? null : parseBattleTmpSnapshot(JSON.parse(String(json)), variant);
}

function queryJsonRows<T>(
  db: Database,
  sql: string,
  parameters: (string | number | null)[] = [],
): T[] {
  const result = db.exec(sql, parameters)[0];
  return result?.values.map(([json]) => JSON.parse(String(json)) as T) ?? [];
}

function singleValue(
  db: Database,
  sql: string,
  parameters: (string | number | null)[] = [],
): string | number | Uint8Array | null {
  return db.exec(sql, parameters)[0]?.values[0]?.[0] ?? null;
}

function transaction<T>(db: Database, action: () => T): T {
  db.run('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.run('COMMIT');
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('对战比分必须是非负整数');
  return number;
}

async function readPersistedDatabase(): Promise<Uint8Array | null> {
  const database = await openIndexedDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DATABASE_STORE, 'readonly')
      .objectStore(DATABASE_STORE)
      .get(DATABASE_KEY);
    request.onsuccess = () => {
      const value = request.result;
      resolve(value instanceof ArrayBuffer ? new Uint8Array(value) : null);
    };
    request.onerror = () => reject(request.error ?? new Error('无法读取浏览器数据库'));
  });
}

async function persistDatabase(db: Database): Promise<void> {
  const bytes = db.export();
  const database = await openIndexedDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      DATABASE_KEY,
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存浏览器数据库'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器数据库保存已取消'));
  });
}

let indexedDatabasePromise: Promise<IDBDatabase> | null = null;

function openIndexedDatabase(): Promise<IDBDatabase> {
  if (indexedDatabasePromise) return indexedDatabasePromise;
  indexedDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DATABASE_STORE)) {
        database.createObjectStore(DATABASE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器数据库'));
  });
  return indexedDatabasePromise;
}

async function downloadDatabaseFile(db: Database) {
  const bytes = db.export();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.sqlite3' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `转盘数据库-${new Date().toISOString().slice(0, 10)}.sqlite3`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
