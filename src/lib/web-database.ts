import type { Database, SqlJsStatic } from 'sql.js';
import sqlJsUrl from 'sql.js/dist/sql-wasm.js?url';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { parseBattleTmpSnapshot, updateBattleTmpResult, type BattleTmpSnapshot } from './battle';
import type { AppVariant } from './app-variant';
import type {
  AliasRecord,
  CommonSelection,
  RankedUser,
  ResolvedLineupName,
  SavedDraw,
  SavedLineup,
} from './types';
import type { RankedUserDropTarget } from './random-lineup';

const DATABASE_NAME = 'spinning-prize-wheel';
const DATABASE_STORE = 'database';
const DATABASE_KEY = 'main';
const DATABASE_VERSION = 1;

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
    mutationQueue = mutationQueue.then(async () => {
      result = executeCommand<T>(db, command, args);
      await persistDatabase(db);
    });
    await mutationQueue;
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

function isMutation(command: string): boolean {
  return !command.startsWith('list_')
    && !command.startsWith('load_')
    && command !== 'resolve_lineup_names'
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
         WHERE variant = ? ORDER BY created_at DESC`,
        [String(args.variant)],
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
      db.run('DELETE FROM draw_history WHERE id = ? AND variant = ?', [
        String(args.id),
        String(args.variant),
      ]);
      return undefined as T;
    case 'clear_draw_histories':
      db.run('DELETE FROM draw_history WHERE variant = ?', [String(args.variant)]);
      return undefined as T;
    case 'list_ranked_users':
      return listRankedUsers(db) as T;
    case 'resolve_lineup_names':
      return resolveLineupNames(db, args.names as string[]) as T;
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
    case 'list_lineup_histories':
      return queryJsonRows<SavedLineup>(
        db,
        `SELECT payload_json FROM lineup_history
         WHERE variant = ? ORDER BY created_at DESC`,
        [String(args.variant)],
      ) as T;
    case 'save_lineup_history':
      saveLineupHistory(db, String(args.variant), args.lineup as SavedLineup);
      return undefined as T;
    case 'import_lineup_history':
      saveLineupHistory(db, String(args.variant), args.history as SavedLineup);
      return queryJsonRows<SavedLineup>(
        db,
        `SELECT payload_json FROM lineup_history
         WHERE variant = ? ORDER BY created_at DESC`,
        [String(args.variant)],
      ) as T;
    case 'delete_lineup_history':
      db.run('DELETE FROM lineup_history WHERE id = ? AND variant = ?', [
        String(args.id),
        String(args.variant),
      ]);
      return undefined as T;
    case 'clear_lineup_histories':
      db.run('DELETE FROM lineup_history WHERE variant = ?', [String(args.variant)]);
      return undefined as T;
    case 'save_battle_tmp_state': {
      const state = parseBattleTmpSnapshot(args.state, String(args.variant) as AppVariant);
      saveBattleTmpState(db, state);
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
  migrateDatabase(db, SQL);
  if (!saved) await persistDatabase(db);
  return db;
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const browserWindow = window as Window & {
    initSqlJs?: (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
  };
  if (!browserWindow.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = sqlJsUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('无法加载浏览器 SQLite 运行库'));
      document.head.append(script);
    });
  }
  if (!browserWindow.initSqlJs) throw new Error('浏览器 SQLite 运行库初始化失败');
  return browserWindow.initSqlJs({ locateFile: () => wasmUrl });
}

function migrateDatabase(db: Database, _SQL: SqlJsStatic) {
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
    CREATE TABLE IF NOT EXISTS lineup_history (
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      variant TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, variant)
    );
    CREATE INDEX IF NOT EXISTS lineup_history_variant_created_at
      ON lineup_history(variant, created_at DESC);
    CREATE TABLE IF NOT EXISTS battle_tmp (
      variant TEXT PRIMARY KEY NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  `);
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

function resolveLineupNames(db: Database, names: string[]): ResolvedLineupName[] {
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

function saveLineupHistory(db: Database, variant: string, history: SavedLineup) {
  db.run(
    `INSERT OR REPLACE INTO lineup_history (id, created_at, variant, payload_json)
     VALUES (?, ?, ?, ?)`,
    [history.id, history.createdAt, variant, JSON.stringify(history)],
  );
}

function saveBattleTmpState(db: Database, state: BattleTmpSnapshot) {
  db.run(
    `INSERT OR REPLACE INTO battle_tmp (variant, updated_at, payload_json)
     VALUES (?, ?, ?)`,
    [state.variant, state.updatedAt, JSON.stringify(state)],
  );
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
