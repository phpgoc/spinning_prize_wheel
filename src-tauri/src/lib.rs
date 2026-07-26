use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{HashSet, VecDeque},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use time::OffsetDateTime;

const UNRANKED_RANK: i64 = 10_000;
const SHARED_DATA_DIRECTORY: &str = "com.phpgoc.wheel";
const DATABASE_FILE_NAME: &str = "draw-history.sqlite3";
const SQL_LOG_FILE_NAME: &str = "sql.log";
const DATABASE_SCHEMA_VERSION: i64 = 1;

static SQL_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static SQL_TRACE_DEDUPLICATOR: OnceLock<Mutex<SqlTraceDeduplicator>> = OnceLock::new();

/// 由 Tauri 托管的数据库连接；所有命令复用同一个连接。
#[derive(Default)]
struct DatabaseState {
    connection: Mutex<Option<Connection>>,
}

/// 过滤 SQLite trace 在级联删除时产生的重复顶层语句。
#[derive(Default)]
struct SqlTraceDeduplicator {
    previous_was_full_user_delete: bool,
}

impl SqlTraceDeduplicator {
    fn should_skip(&mut self, sql: &str) -> bool {
        let is_full_user_delete = is_full_user_delete_statement(sql);
        let duplicate = is_full_user_delete && self.previous_was_full_user_delete;
        self.previous_was_full_user_delete = is_full_user_delete;
        duplicate
    }
}

/// 按版本顺序执行的数据库迁移，已应用版本记录在 `schema_migrations`。
const MIGRATIONS: &[(i64, &str)] = &[
    (
        DATABASE_SCHEMA_VERSION,
        "CREATE TABLE IF NOT EXISTS draw_history (
           id TEXT PRIMARY KEY NOT NULL,
           created_at INTEGER NOT NULL,
           payload_json TEXT NOT NULL,
           variant TEXT NOT NULL
         );
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
           id TEXT PRIMARY KEY NOT NULL,
           created_at INTEGER NOT NULL,
           display_name TEXT NOT NULL DEFAULT '',
           input_json TEXT NOT NULL,
           result_json TEXT NOT NULL,
           variant TEXT NOT NULL
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
         CREATE TABLE IF NOT EXISTS app_kv (
           key TEXT PRIMARY KEY NOT NULL,
           value_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS battle_tmp (
           id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
           variant TEXT NOT NULL CHECK (variant IN ('standard', 'caimi')),
           rules_version INTEGER NOT NULL CHECK (rules_version = 1),
           created_at INTEGER NOT NULL CHECK (created_at > 0),
           updated_at INTEGER NOT NULL CHECK (updated_at > 0),
           history_saved INTEGER NOT NULL DEFAULT 0 CHECK (history_saved IN (0, 1)),
           format TEXT NOT NULL CHECK (format IN ('avoid-first-pair', 'single-elimination', 'double-elimination')),
           order_mode TEXT NOT NULL CHECK (order_mode IN ('rank', 'input')),
           participant_count INTEGER NOT NULL CHECK (participant_count >= 2),
           bracket_size INTEGER NOT NULL CHECK (bracket_size >= participant_count),
           fixed_seed_count INTEGER NOT NULL CHECK (fixed_seed_count >= 0 AND fixed_seed_count <= participant_count)
         );
         CREATE TABLE IF NOT EXISTS battle_tmp_participant (
           state_id INTEGER NOT NULL REFERENCES battle_tmp(id) ON DELETE CASCADE,
           participant_id INTEGER NOT NULL CHECK (participant_id > 0),
           name TEXT NOT NULL,
           source_index INTEGER NOT NULL CHECK (source_index >= 0),
           seed INTEGER NOT NULL CHECK (seed > 0),
           group_index INTEGER CHECK (group_index >= 0),
           group_rank INTEGER CHECK (group_rank IN (1, 2)),
           PRIMARY KEY (state_id, participant_id)
         );
         CREATE TABLE IF NOT EXISTS battle_tmp_match (
           state_id INTEGER NOT NULL REFERENCES battle_tmp(id) ON DELETE CASCADE,
           match_id TEXT NOT NULL,
           stage TEXT NOT NULL CHECK (stage IN ('pairing', 'single', 'winner', 'loser', 'final')),
           level INTEGER NOT NULL CHECK (level > 0),
           position INTEGER NOT NULL CHECK (position > 0),
           up INTEGER,
           down INTEGER,
           up_result INTEGER CHECK (up_result IS NULL OR up_result >= 0),
           down_result INTEGER CHECK (down_result IS NULL OR down_result >= 0),
           status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'completed', 'skipped')),
           PRIMARY KEY (state_id, match_id),
           UNIQUE (state_id, stage, level, position),
           FOREIGN KEY (state_id, up) REFERENCES battle_tmp_participant(state_id, participant_id),
           FOREIGN KEY (state_id, down) REFERENCES battle_tmp_participant(state_id, participant_id)
         );
         CREATE INDEX IF NOT EXISTS draw_history_created_at
         ON draw_history(variant, created_at DESC);
         CREATE INDEX IF NOT EXISTS grouping_history_created_at
         ON grouping_history(variant, created_at DESC);",
    ),
];

mod models;
use models::*;

fn common_selection_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("common-selections"))
        .map_err(|error| format!("无法定位常用选择目录：{error}"))
}

fn valid_selection_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// 打开共享数据库并统一配置日志、超时、外键和迁移。
fn open_app_database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app_database_dir(app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建历史数据库目录：{error}"))?;
    let _ = SQL_LOG_PATH.set(directory.join(SQL_LOG_FILE_NAME));

    let mut connection = Connection::open(directory.join(DATABASE_FILE_NAME))
        .map_err(|error| database_file_error(format!("无法打开本地数据库：{error}")))?;
    #[allow(deprecated)]
    connection.trace(Some(log_sql_statement));
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| database_file_error(format!("无法配置本地数据库：{error}")))?;
    migrate_database(&mut connection).map_err(database_file_error)?;
    Ok(connection)
}

/// 串行借用 Tauri 状态中的连接，首次调用时才实际打开数据库。
fn with_app_database<T>(
    app: &AppHandle,
    database: &DatabaseState,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    with_database_connection(database, || open_app_database(app), operation)
}

fn with_database_connection<T>(
    database: &DatabaseState,
    open: impl FnOnce() -> Result<Connection, String>,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut connection = database
        .connection
        .lock()
        .map_err(|_| database_file_error("数据库连接状态异常".to_string()))?;
    if connection.is_none() {
        *connection = Some(open()?);
    }
    operation(connection.as_mut().expect("数据库连接已经初始化"))
}

fn log_sql_statement(sql: &str) {
    // SQLite 的外键级联会为一次全量删除重复回报同一条父语句，日志只保留第一条。
    if SQL_TRACE_DEDUPLICATOR
        .get_or_init(|| Mutex::new(SqlTraceDeduplicator::default()))
        .lock()
        .is_ok_and(|mut deduplicator| deduplicator.should_skip(sql))
    {
        return;
    }
    if !should_log_sql_statement(sql) {
        return;
    }
    let Some(path) = SQL_LOG_PATH.get() else {
        return;
    };
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let line = format_sql_log_line(sql, now);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn should_log_sql_statement(sql: &str) -> bool {
    let operation = sql
        .trim_start()
        .split_ascii_whitespace()
        .next()
        .unwrap_or_default();
    // 迁移表会在每次打开数据库连接时检查，不属于需要审计的业务建表操作。
    if operation.eq_ignore_ascii_case("CREATE")
        && sql.split_ascii_whitespace().any(|token| {
            token
                .trim_matches(['(', ')', ';'])
                .eq_ignore_ascii_case("schema_migrations")
        })
    {
        return false;
    }
    // CREATE 兼容业务建表记录，INSERT 对应业务里的新增；读取和事务语句不写日志。
    operation.eq_ignore_ascii_case("CREATE")
        || operation.eq_ignore_ascii_case("INSERT")
        || operation.eq_ignore_ascii_case("UPDATE")
        || operation.eq_ignore_ascii_case("DELETE")
}

fn is_full_user_delete_statement(sql: &str) -> bool {
    let mut tokens = sql.trim().trim_end_matches(';').split_ascii_whitespace();
    tokens
        .next()
        .is_some_and(|token| token.eq_ignore_ascii_case("DELETE"))
        && tokens
            .next()
            .is_some_and(|token| token.eq_ignore_ascii_case("FROM"))
        && tokens
            .next()
            .is_some_and(|token| token.eq_ignore_ascii_case("user"))
        && tokens.next().is_none()
}

fn format_sql_log_line(sql: &str, now: OffsetDateTime) -> String {
    let sql = sql.replace(['\r', '\n'], " ");
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} {}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        sql.trim()
    )
}

fn database_file_error(detail: String) -> String {
    if detail.starts_with("数据库文件错误：") {
        return detail;
    }
    if detail.starts_with("数据库版本不兼容：") {
        return format!(
            "数据库文件错误：{detail}。0.3.0 不兼容 0.2.0、0.2.1 的数据库，请手动卸载旧版本并删除 {DATABASE_FILE_NAME} 后重新安装。"
        );
    }
    format!(
        "数据库文件错误：{detail}。请打开数据库文件夹，手动删除 {DATABASE_FILE_NAME}，然后重新打开应用以初始化数据库。"
    )
}

fn app_database_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // 仅 Debug 构建允许把自动化测试数据库隔离到工作区，Release 始终使用正式数据目录。
    #[cfg(debug_assertions)]
    if let Some(directory) =
        std::env::var_os("WHEEL_TEST_DATA_DIR").filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(directory));
    }

    let app_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位历史数据库目录：{error}"))?;
    let directory = app_directory
        .parent()
        .map(|parent| parent.join(SHARED_DATA_DIRECTORY))
        .unwrap_or(app_directory);
    Ok(directory)
}

#[tauri::command]
fn open_database_folder(app: AppHandle) -> Result<(), String> {
    let directory = app_database_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建数据库目录：{error}"))?;
    Command::new("explorer.exe")
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开数据库文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn open_download_folder(app: AppHandle) -> Result<(), String> {
    let directory = export_directory(&app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建下载目录：{error}"))?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(&directory);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&directory);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&directory);
        command
    };

    command
        .spawn()
        .map_err(|error| format!("无法打开下载文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn export_text_file(
    app: AppHandle,
    prefix: String,
    extension: String,
    content: String,
) -> Result<String, String> {
    let extension = match extension.as_str() {
        "json" => extension,
        _ => return Err("文本导出只支持 JSON 文件".to_string()),
    };
    write_export_file(&app, &prefix, &extension, content.as_bytes())
}

#[tauri::command]
fn export_binary_file(
    app: AppHandle,
    prefix: String,
    extension: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let extension = match extension.as_str() {
        "xlsx" => extension,
        _ => return Err("二进制导出只支持 Excel 文件".to_string()),
    };
    write_export_file(&app, &prefix, &extension, &bytes)
}

fn write_export_file(
    app: &AppHandle,
    prefix: &str,
    extension: &str,
    content: &[u8],
) -> Result<String, String> {
    let prefix = sanitize_export_prefix(prefix);
    let directory = export_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建下载目录：{error}"))?;
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let base_name = format!(
        "{}-{:04}-{:02}-{:02}",
        prefix,
        now.year(),
        u8::from(now.month()),
        now.day()
    );
    let path = available_export_path(&directory, &base_name, extension);
    fs::write(&path, content).map_err(|error| format!("无法写入导出文件：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Debug 自动化测试可把下载文件放进每次测试独立的目录，正式版始终使用系统下载目录。
fn export_directory(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(directory) =
        std::env::var_os("WHEEL_TEST_DOWNLOAD_DIR").filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(directory));
    }

    app.path()
        .download_dir()
        .map_err(|error| format!("无法定位下载目录：{error}"))
}

fn sanitize_export_prefix(prefix: &str) -> String {
    let value = prefix
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) {
                '_'
            } else {
                character
            }
        })
        .take(60)
        .collect::<String>();
    if value.is_empty() {
        "转盘导出".to_string()
    } else {
        value
    }
}

fn available_export_path(directory: &Path, base_name: &str, extension: &str) -> PathBuf {
    let direct = directory.join(format!("{base_name}.{extension}"));
    if !direct.exists() {
        return direct;
    }
    for index in 2.. {
        let candidate = directory.join(format!("{base_name}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn validate_variant(variant: &str) -> Result<&str, String> {
    match variant {
        "standard" | "caimi" => Ok(variant),
        _ => Err("应用版本不合法".to_string()),
    }
}

fn validate_app_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 128 || key.chars().any(char::is_control) {
        return Err("配置键不合法".to_string());
    }
    Ok(key)
}

#[tauri::command]
fn load_app_setting(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let key = validate_app_key(&key)?.to_string();
    with_app_database(&app, &database, |connection| {
        let value = connection
            .query_row(
                "SELECT value_json FROM app_kv WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("无法读取应用配置：{error}"))?;
        value
            .map(|raw| {
                serde_json::from_str(&raw).map_err(|error| format!("应用配置格式错误：{error}"))
            })
            .transpose()
    })
}

#[tauri::command]
fn save_app_setting(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let key = validate_app_key(&key)?.to_string();
    let value_json =
        serde_json::to_string(&value).map_err(|error| format!("无法序列化应用配置：{error}"))?;
    with_app_database(&app, &database, |connection| {
        connection
            .execute(
                "INSERT INTO app_kv (key, value_json) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                params![key, value_json],
            )
            .map_err(|error| format!("无法保存应用配置：{error}"))?;
        Ok(())
    })
}

fn migrate_database(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY NOT NULL,
               applied_at INTEGER NOT NULL DEFAULT (unixepoch())
             );",
        )
        .map_err(|error| format!("无法初始化迁移记录：{error}"))?;

    let existing_versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .map_err(|error| format!("无法读取数据库版本：{error}"))?
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("无法读取数据库版本：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析数据库版本：{error}"))?;
    if existing_versions
        .iter()
        .any(|version| *version != DATABASE_SCHEMA_VERSION)
    {
        return Err(format!(
            "数据库版本不兼容：发现迁移版本 {:?}，当前版本只支持数据库版本 {}",
            existing_versions, DATABASE_SCHEMA_VERSION
        ));
    }

    for (version, sql) in MIGRATIONS {
        let applied = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                params![version],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("无法读取数据库版本：{error}"))?;
        if applied {
            continue;
        }

        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始数据库迁移 {version}：{error}"))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| format!("无法执行数据库迁移 {version}：{error}"))?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                params![version],
            )
            .map_err(|error| format!("无法记录数据库迁移 {version}：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交数据库迁移 {version}：{error}"))?;
    }

    ensure_history_display_name_columns(connection)?;
    validate_database_schema(connection)
}

fn ensure_history_display_name_columns(connection: &Connection) -> Result<(), String> {
    for table in ["grouping_history", "battle_history"] {
        let columns = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("无法读取数据库表 {table} 结构：{error}"))?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("无法读取数据库表 {table} 字段：{error}"))?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| format!("无法解析数据库表 {table} 结构：{error}"))?;
        if !columns.contains("display_name") {
            connection
                .execute(
                    &format!("ALTER TABLE {table} ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"),
                    [],
                )
                .map_err(|error| format!("无法升级数据库表 {table}：{error}"))?;
        }
    }
    backfill_history_display_names(connection)?;
    Ok(())
}

/// 为升级前没有 display_name 的历史记录补齐列表名称。迁移阶段只做一次 JSON 解析，列表查询本身保持轻量。
fn backfill_history_display_names(connection: &Connection) -> Result<(), String> {
    let grouping_rows = {
        let mut statement = connection
            .prepare("SELECT id, created_at, input_json, result_json FROM grouping_history WHERE display_name = ''")
            .map_err(|error| format!("无法读取旧分组历史：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| format!("无法查询旧分组历史：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析旧分组历史：{error}"))?;
        rows
    };
    for (id, created_at, input_json, result_json) in grouping_rows {
        let input = serde_json::from_str(&input_json)
            .map_err(|error| format!("无法解析旧分组输入：{error}"))?;
        let result = serde_json::from_str(&result_json)
            .map_err(|error| format!("无法解析旧分组结果：{error}"))?;
        let history = SavedGrouping {
            id: id.clone(),
            created_at: u64::try_from(created_at).map_err(|_| "分组记录时间不合法".to_string())?,
            title: None,
            input,
            result,
        };
        connection
            .execute(
                "UPDATE grouping_history SET display_name = ?1 WHERE id = ?2",
                params![grouping_display_name(&history), id],
            )
            .map_err(|error| format!("无法更新分组历史名称：{error}"))?;
    }

    let battle_rows = {
        let mut statement = connection
            .prepare("SELECT id, variant, payload_json FROM battle_history WHERE display_name = ''")
            .map_err(|error| format!("无法读取旧对战历史：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| format!("无法查询旧对战历史：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析旧对战历史：{error}"))?;
        rows
    };
    for (id, variant, payload_json) in battle_rows {
        let payload: serde_json::Value = serde_json::from_str(&payload_json)
            .map_err(|error| format!("无法解析旧对战签表：{error}"))?;
        let snapshot: BattleTmpSnapshot = serde_json::from_value(
            payload.get("snapshot").cloned().unwrap_or_else(|| payload.clone()),
        )
        .map_err(|error| format!("无法解析旧对战签表：{error}"))?;
        let title = payload
            .get("title")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        let history = BattleHistory {
            id: id.clone(),
            created_at: 1,
            updated_at: snapshot.updated_at,
            title,
            snapshot,
        };
        connection
            .execute(
                "UPDATE battle_history SET display_name = ?1 WHERE id = ?2 AND variant = ?3",
                params![battle_history_display_name(&history), id, variant],
            )
            .map_err(|error| format!("无法更新对战历史名称：{error}"))?;
    }
    Ok(())
}

fn validate_database_schema(connection: &Connection) -> Result<(), String> {
    let versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .map_err(|error| format!("无法读取数据库版本：{error}"))?
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("无法读取数据库版本：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析数据库版本：{error}"))?;
    if versions != vec![DATABASE_SCHEMA_VERSION] {
        return Err(format!(
            "数据库版本不兼容：迁移记录应为 [{}]，实际为 {:?}",
            DATABASE_SCHEMA_VERSION, versions
        ));
    }

    for (table, columns) in [
        (
            "draw_history",
            &["id", "created_at", "payload_json", "variant"][..],
        ),
        ("user", &["id", "name", "rank"][..]),
        ("alias", &["id", "name", "user_id"][..]),
        (
            "grouping_history",
            &[
                "id", "created_at", "display_name", "input_json", "result_json", "variant",
            ][..],
        ),
        (
            "battle_history",
            &[
                "id", "created_at", "display_name", "variant", "payload_json",
            ][..],
        ),
        ("app_kv", &["key", "value_json"][..]),
    ] {
        let actual = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("无法读取数据库表 {table} 结构：{error}"))?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("无法读取数据库表 {table} 字段：{error}"))?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| format!("无法解析数据库表 {table} 结构：{error}"))?;
        if columns.iter().any(|column| !actual.contains(*column)) {
            return Err(format!(
                "数据库版本不兼容：数据库表 {table} 不是 0.3.0 结构"
            ));
        }
    }
    Ok(())
}

fn normalize_person_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if name.chars().count() > 80 {
        return Err("名称不能超过 80 个字符".to_string());
    }
    Ok(name.to_string())
}

fn normalize_rank(rank: Option<i64>) -> i64 {
    rank.unwrap_or(UNRANKED_RANK).clamp(1, UNRANKED_RANK)
}

fn normalize_aliases(name: &str, aliases: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = vec![name.to_string()];
    let mut seen = std::collections::HashSet::from([name.to_lowercase()]);

    for alias in aliases {
        let alias = normalize_person_name(&alias)?;
        if seen.insert(alias.to_lowercase()) {
            normalized.push(alias);
        }
    }
    Ok(normalized)
}

fn ensure_name_available(connection: &Connection, name: &str) -> Result<(), String> {
    ensure_name_available_except(connection, name, None)
}

fn ensure_name_available_except(
    connection: &Connection,
    name: &str,
    excluded_user_id: Option<i64>,
) -> Result<(), String> {
    let excluded_user_id = excluded_user_id.unwrap_or(i64::MIN);
    let owner = connection
        .query_row(
            "SELECT owner_name FROM (
               SELECT id AS owner_id, name AS owner_name FROM user WHERE name = ?1 COLLATE NOCASE
               UNION ALL
               SELECT user.id AS owner_id, user.name AS owner_name
               FROM alias JOIN user ON user.id = alias.user_id
               WHERE alias.name = ?1 COLLATE NOCASE
             ) WHERE owner_id <> ?2 LIMIT 1",
            params![name, excluded_user_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("无法检查名称和别名：{error}"))?;
    if let Some(owner_name) = owner {
        return Err(format!("“{name}”已经被“{owner_name}”作为名称或别名使用"));
    }
    Ok(())
}

fn load_ranked_user(connection: &Connection, id: i64) -> Result<RankedUser, String> {
    let (name, rank) = connection
        .query_row(
            "SELECT name, rank FROM user WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| format!("无法读取排名选项：{error}"))?;
    let mut statement = connection
        .prepare("SELECT id, name, user_id FROM alias WHERE user_id = ?1 ORDER BY id")
        .map_err(|error| format!("无法读取选项别名：{error}"))?;
    let aliases = statement
        .query_map(params![id], |row| {
            Ok(AliasRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                user_id: row.get(2)?,
            })
        })
        .map_err(|error| format!("无法查询选项别名：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析选项别名：{error}"))?;

    Ok(RankedUser {
        id,
        name,
        rank,
        aliases,
    })
}

fn save_ranked_user_in(
    connection: &mut Connection,
    input: RankedUserInput,
) -> Result<RankedUser, String> {
    let name = normalize_person_name(&input.name)?;
    let rank = normalize_rank(input.rank);
    let aliases = normalize_aliases(&name, input.aliases)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始保存排名选项：{error}"))?;

    let id = if let Some(id) = input.id {
        let previous_name = transaction
            .query_row("SELECT name FROM user WHERE id = ?1", params![id], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|error| format!("无法读取排名选项：{error}"))?
            .ok_or_else(|| "找不到要更新的排名选项".to_string())?;
        if !previous_name.eq_ignore_ascii_case(&name) {
            ensure_name_available_except(&transaction, &name, Some(id))?;
            transaction
                .execute(
                    "DELETE FROM alias WHERE user_id = ?1 AND name = ?2 COLLATE NOCASE",
                    params![id, name],
                )
                .map_err(|error| format!("无法更新本名对应的别名：{error}"))?;
        }
        for alias in aliases.iter().skip(1) {
            ensure_name_available(&transaction, alias)?;
        }
        let changed = transaction
            .execute(
                "UPDATE user SET name = ?1, rank = ?2 WHERE id = ?3",
                params![name, rank, id],
            )
            .map_err(|_| format!("名称或别名“{name}”已经被使用"))?;
        if changed == 0 {
            return Err("找不到要更新的排名选项".to_string());
        }
        let canonical_alias_changed = transaction
            .execute(
                "UPDATE alias SET name = ?1
                 WHERE user_id = ?2 AND name = ?3 COLLATE NOCASE",
                params![name, id, previous_name],
            )
            .map_err(|_| format!("名称或别名“{name}”已经被使用"))?;
        if canonical_alias_changed == 0 {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![name, id],
                )
                .map_err(|_| format!("名称或别名“{name}”已经被使用"))?;
        }

        for alias in aliases.into_iter().skip(1) {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![alias, id],
                )
                .map_err(|_| format!("名称或别名“{alias}”已经被使用"))?;
        }
        id
    } else {
        for alias in &aliases {
            ensure_name_available(&transaction, alias)?;
        }
        transaction
            .execute(
                "INSERT INTO user (name, rank) VALUES (?1, ?2)",
                params![name, rank],
            )
            .map_err(|_| format!("名称或别名“{name}”已经被使用"))?;
        let id = transaction.last_insert_rowid();
        for alias in aliases {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![alias, id],
                )
                .map_err(|_| format!("名称或别名“{alias}”已经被使用"))?;
        }
        id
    };
    transaction
        .commit()
        .map_err(|error| format!("无法提交排名选项：{error}"))?;
    load_ranked_user(connection, id)
}

fn add_ranked_user_alias_in(
    connection: &Connection,
    user_id: i64,
    alias: String,
) -> Result<RankedUser, String> {
    let alias = normalize_person_name(&alias)?;
    let owner = connection
        .query_row(
            "SELECT user.id, user.name
             FROM user
             WHERE user.name = ?1 COLLATE NOCASE
             UNION ALL
             SELECT user.id, user.name
             FROM alias JOIN user ON user.id = alias.user_id
             WHERE alias.name = ?1 COLLATE NOCASE
             LIMIT 1",
            params![alias],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("无法检查名称和别名：{error}"))?;
    if let Some((_, owner_name)) = owner {
        return Err(format!("“{alias}”已经被“{owner_name}”使用"));
    }

    let user_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM user WHERE id = ?1)",
            params![user_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("无法读取排名选项：{error}"))?;
    if !user_exists {
        return Err("找不到要添加别名的排名选项".to_string());
    }

    connection
        .execute(
            "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
            params![alias, user_id],
        )
        .map_err(|_| format!("名称或别名“{alias}”已经被使用"))?;
    load_ranked_user(connection, user_id)
}

fn clear_ranked_user_aliases_in(
    connection: &Connection,
    user_id: i64,
) -> Result<RankedUser, String> {
    let name = connection
        .query_row(
            "SELECT name FROM user WHERE id = ?1",
            params![user_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("无法读取排名选项：{error}"))?
        .ok_or_else(|| "找不到要清空别名的排名选项".to_string())?;
    connection
        .execute(
            "DELETE FROM alias
             WHERE user_id = ?1 AND name <> ?2 COLLATE NOCASE",
            params![user_id, name],
        )
        .map_err(|error| format!("无法清空选项别名：{error}"))?;
    load_ranked_user(connection, user_id)
}

fn replace_ranked_users_in(
    connection: &mut Connection,
    users: Vec<RankedUserTransferInput>,
) -> Result<Vec<RankedUser>, String> {
    if users.len() > 5_000 {
        return Err("排名文件最多允许 5000 项".to_string());
    }

    let mut namespace = std::collections::HashSet::new();
    let mut ranked = Vec::new();
    let mut alias_count = 0usize;
    let mut normalized = Vec::with_capacity(users.len());
    for user in users {
        let name = normalize_person_name(&user.name)?;
        if !(1..=UNRANKED_RANK).contains(&user.rank) {
            return Err(format!("“{name}”的排名不合法"));
        }
        let rank = user.rank;
        let aliases = normalize_aliases(&name, user.aliases)?;
        for alias in &aliases {
            let key = alias.to_lowercase();
            if !namespace.insert(key) {
                return Err(format!("名称或别名“{alias}”重复"));
            }
        }
        alias_count += aliases.len().saturating_sub(1);
        if alias_count > 100_000 {
            return Err("排名文件最多允许 100000 个别名".to_string());
        }
        if rank < UNRANKED_RANK {
            ranked.push(rank);
        }
        normalized.push((name, rank, aliases));
    }
    ranked.sort_unstable();
    if ranked
        .iter()
        .enumerate()
        .any(|(index, rank)| *rank != index as i64 + 1)
    {
        return Err("已排名项必须从第 1 名开始连续排列".to_string());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始导入排名：{error}"))?;
    transaction
        .execute("DELETE FROM alias", [])
        .map_err(|error| format!("无法清空旧别名：{error}"))?;
    transaction
        .execute("DELETE FROM user", [])
        .map_err(|error| format!("无法清空旧排名：{error}"))?;

    for (name, rank, aliases) in normalized {
        transaction
            .execute(
                "INSERT INTO user (name, rank) VALUES (?1, ?2)",
                params![name, rank],
            )
            .map_err(|error| format!("无法导入排名“{name}”：{error}"))?;
        let user_id = transaction.last_insert_rowid();
        for alias in aliases {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![alias, user_id],
                )
                .map_err(|error| format!("无法导入别名“{alias}”：{error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交排名导入：{error}"))?;
    list_ranked_users_in(connection)
}

#[tauri::command]
fn save_common_selection(app: AppHandle, selection: CommonSelection) -> Result<(), String> {
    if !valid_selection_id(&selection.id) {
        return Err("常用选择编号不合法".to_string());
    }

    let directory = common_selection_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建常用选择目录：{error}"))?;
    let content = serde_json::to_string_pretty(&selection)
        .map_err(|error| format!("无法序列化常用选择：{error}"))?;
    fs::write(directory.join(format!("{}.json", selection.id)), content)
        .map_err(|error| format!("无法保存常用选择：{error}"))
}

#[tauri::command]
fn list_common_selections(app: AppHandle) -> Result<Vec<CommonSelection>, String> {
    let directory = common_selection_dir(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut selections = Vec::new();
    let entries =
        fs::read_dir(directory).map_err(|error| format!("无法读取常用选择目录：{error}"))?;
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Ok(selection) = serde_json::from_str::<CommonSelection>(&content) {
            selections.push(selection);
        }
    }
    selections.sort_by_key(|selection| std::cmp::Reverse(selection.created_at));
    Ok(selections)
}

#[tauri::command]
fn delete_common_selection(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_selection_id(&id) {
        return Err("常用选择编号不合法".to_string());
    }

    let path = common_selection_dir(&app)?.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法删除常用选择：{error}"))?;
    }
    Ok(())
}

fn save_draw_history_in(
    connection: &Connection,
    variant: &str,
    draw: &SavedDraw,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    if !valid_selection_id(&draw.id) {
        return Err("抽奖记录编号不合法".to_string());
    }
    if draw.mode != "selected" && draw.mode != "roulette" {
        return Err("抽奖模式不合法".to_string());
    }
    if !draw.prizes.is_array() || !draw.records.is_array() {
        return Err("抽奖记录内容不合法".to_string());
    }
    let has_effective_result = draw.records.as_array().is_some_and(|records| {
        records.iter().any(|record| {
            matches!(
                record.get("outcome").and_then(serde_json::Value::as_str),
                Some("selected" | "winner")
            )
        })
    });
    if !has_effective_result {
        return Err("没有有效结果，抽奖记录不会入库".to_string());
    }

    let created_at = i64::try_from(draw.created_at).map_err(|_| "抽奖时间不合法".to_string())?;
    let payload =
        serde_json::to_string(&draw).map_err(|error| format!("无法序列化抽奖记录：{error}"))?;
    connection
        .execute(
            "INSERT INTO draw_history (id, created_at, payload_json, variant)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               created_at = excluded.created_at,
               payload_json = excluded.payload_json,
               variant = excluded.variant",
            params![draw.id, created_at, payload, variant],
        )
        .map_err(|error| format!("无法保存抽奖记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn save_draw_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    draw: SavedDraw,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        save_draw_history_in(connection, &variant, &draw)
    })
}

fn list_draw_histories_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<SavedDraw>, String> {
    let _variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare("SELECT payload_json FROM draw_history ORDER BY created_at DESC")
        .map_err(|error| format!("无法读取历史数据库：{error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询抽奖历史：{error}"))?;

    let mut histories = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法解析抽奖历史行：{error}"))?;
        let draw = serde_json::from_str::<SavedDraw>(&payload)
            .map_err(|error| format!("抽奖历史内容损坏：{error}"))?;
        histories.push(draw);
    }
    Ok(histories)
}

#[tauri::command]
fn list_draw_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<Vec<SavedDraw>, String> {
    with_app_database(&app, &database, |connection| {
        list_draw_histories_in(connection, &variant).map_err(database_file_error)
    })
}

#[tauri::command]
fn delete_draw_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    id: String,
) -> Result<(), String> {
    let _variant = validate_variant(&variant)?;
    if !valid_selection_id(&id) {
        return Err("抽奖记录编号不合法".to_string());
    }
    with_app_database(&app, &database, |connection| {
        connection
            .execute("DELETE FROM draw_history WHERE id = ?1", params![id])
            .map_err(|error| format!("无法删除抽奖记录：{error}"))?;
        Ok(())
    })
}

#[tauri::command]
fn clear_draw_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<(), String> {
    let _variant = validate_variant(&variant)?;
    with_app_database(&app, &database, |connection| {
        connection
            .execute("DELETE FROM draw_history", [])
            .map_err(|error| format!("无法清空抽奖历史：{error}"))?;
        Ok(())
    })
}

fn list_ranked_users_in(connection: &Connection) -> Result<Vec<RankedUser>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM user ORDER BY rank ASC, name COLLATE NOCASE ASC")
        .map_err(|error| format!("无法读取排名表：{error}"))?;
    let ids = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("无法查询排名表：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析排名表：{error}"))?;
    drop(statement);
    ids.into_iter()
        .map(|id| load_ranked_user(connection, id))
        .collect()
}

fn move_ranked_user_in(
    connection: &mut Connection,
    dragged_id: i64,
    target: RankedUserDropTargetInput,
) -> Result<Vec<RankedUser>, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始调整排名：{error}"))?;
    let source_rank = transaction
        .query_row(
            "SELECT rank FROM user WHERE id = ?1",
            params![dragged_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("无法读取拖动选项：{error}"))?
        .ok_or_else(|| "找不到拖动的选项".to_string())?;

    match target {
        RankedUserDropTargetInput::Insert { index } => {
            let ranked_count = transaction
                .query_row(
                    "SELECT COUNT(*) FROM user WHERE rank < ?1",
                    params![UNRANKED_RANK],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| format!("无法读取排名人数：{error}"))?;
            let mut insert_index = index.min(ranked_count as usize);

            if source_rank < UNRANKED_RANK {
                let source_index = (source_rank - 1).max(0) as usize;
                if source_index < insert_index {
                    insert_index -= 1;
                }
                transaction
                    .execute(
                        "UPDATE user SET rank = ?1 WHERE id = ?2",
                        params![UNRANKED_RANK, dragged_id],
                    )
                    .map_err(|error| format!("无法移出原排名：{error}"))?;
                transaction
                    .execute(
                        "UPDATE user SET rank = rank - 1 WHERE rank > ?1 AND rank < ?2",
                        params![source_rank, UNRANKED_RANK],
                    )
                    .map_err(|error| format!("无法收拢原排名：{error}"))?;
            }

            let insert_rank = insert_index as i64 + 1;
            transaction
                .execute(
                    "UPDATE user SET rank = rank + 1 WHERE rank >= ?1 AND rank < ?2",
                    params![insert_rank, UNRANKED_RANK],
                )
                .map_err(|error| format!("无法腾出目标排名：{error}"))?;
            transaction
                .execute(
                    "UPDATE user SET rank = ?1 WHERE id = ?2",
                    params![insert_rank, dragged_id],
                )
                .map_err(|error| format!("无法写入目标排名：{error}"))?;
        }
        RankedUserDropTargetInput::Swap { user_id } => {
            if source_rank >= UNRANKED_RANK {
                return Err("无排名选项只能插入排名".to_string());
            }
            if user_id != dragged_id {
                let target_rank = transaction
                    .query_row(
                        "SELECT rank FROM user WHERE id = ?1",
                        params![user_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(|error| format!("无法读取互换选项：{error}"))?
                    .ok_or_else(|| "找不到互换的选项".to_string())?;
                transaction
                    .execute(
                        "UPDATE user
                         SET rank = CASE id WHEN ?1 THEN ?2 WHEN ?3 THEN ?4 END
                         WHERE id IN (?1, ?3)",
                        params![dragged_id, target_rank, user_id, source_rank],
                    )
                    .map_err(|error| format!("无法互换选项排名：{error}"))?;
            }
        }
        RankedUserDropTargetInput::Unranked => {
            if source_rank < UNRANKED_RANK {
                transaction
                    .execute(
                        "UPDATE user SET rank = ?1 WHERE id = ?2",
                        params![UNRANKED_RANK, dragged_id],
                    )
                    .map_err(|error| format!("无法设为无排名：{error}"))?;
                transaction
                    .execute(
                        "UPDATE user SET rank = rank - 1 WHERE rank > ?1 AND rank < ?2",
                        params![source_rank, UNRANKED_RANK],
                    )
                    .map_err(|error| format!("无法收拢选项排名：{error}"))?;
            }
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交选项排名：{error}"))?;
    list_ranked_users_in(connection)
}

#[tauri::command]
fn save_ranked_user(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    user: RankedUserInput,
) -> Result<RankedUser, String> {
    with_app_database(&app, &database, |connection| {
        save_ranked_user_in(connection, user)
    })
}

#[tauri::command]
fn add_ranked_user_alias(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    user_id: i64,
    alias: String,
) -> Result<RankedUser, String> {
    with_app_database(&app, &database, |connection| {
        add_ranked_user_alias_in(connection, user_id, alias)
    })
}

#[tauri::command]
fn clear_ranked_user_aliases(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    user_id: i64,
) -> Result<RankedUser, String> {
    with_app_database(&app, &database, |connection| {
        clear_ranked_user_aliases_in(connection, user_id)
    })
}

#[tauri::command]
fn replace_ranked_users(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    users: Vec<RankedUserTransferInput>,
) -> Result<Vec<RankedUser>, String> {
    with_app_database(&app, &database, |connection| {
        replace_ranked_users_in(connection, users)
    })
}

#[tauri::command]
fn list_ranked_users(
    app: AppHandle,
    database: State<'_, DatabaseState>,
) -> Result<Vec<RankedUser>, String> {
    with_app_database(&app, &database, |connection| {
        list_ranked_users_in(connection).map_err(database_file_error)
    })
}

#[tauri::command]
fn move_ranked_user(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    dragged_id: i64,
    target: RankedUserDropTargetInput,
) -> Result<Vec<RankedUser>, String> {
    with_app_database(&app, &database, |connection| {
        move_ranked_user_in(connection, dragged_id, target)
    })
}

#[tauri::command]
fn delete_ranked_user(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    id: i64,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始删除排名选项：{error}"))?;
        let rank = transaction
            .query_row("SELECT rank FROM user WHERE id = ?1", params![id], |row| {
                row.get::<_, i64>(0)
            })
            .optional()
            .map_err(|error| format!("无法读取排名选项：{error}"))?
            .ok_or_else(|| "找不到要删除的排名选项".to_string())?;
        transaction
            .execute("DELETE FROM user WHERE id = ?1", params![id])
            .map_err(|error| format!("无法删除排名选项：{error}"))?;
        if rank < UNRANKED_RANK {
            transaction
                .execute(
                    "UPDATE user SET rank = rank - 1 WHERE rank > ?1 AND rank < ?2",
                    params![rank, UNRANKED_RANK],
                )
                .map_err(|error| format!("无法收拢选项排名：{error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交删除选项：{error}"))
    })
}

fn resolve_grouping_names_in(
    connection: &Connection,
    names: Vec<String>,
) -> Result<Vec<ResolvedGroupingName>, String> {
    let mut statement = connection
        .prepare(
            "SELECT user.id, user.name, user.rank
             FROM alias JOIN user ON user.id = alias.user_id
             WHERE alias.name = ?1 COLLATE NOCASE",
        )
        .map_err(|error| format!("无法准备别名查询：{error}"))?;
    names
        .into_iter()
        .map(|input_name| {
            let input_name = normalize_person_name(&input_name)?;
            let matched = statement
                .query_row(params![input_name], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .optional()
                .map_err(|error| format!("无法解析名称“{input_name}”：{error}"))?;
            Ok(match matched {
                Some((user_id, canonical_name, rank)) => ResolvedGroupingName {
                    input_name,
                    known: true,
                    user_id: Some(user_id),
                    canonical_name: Some(canonical_name),
                    rank: Some(rank),
                },
                None => ResolvedGroupingName {
                    input_name,
                    known: false,
                    user_id: None,
                    canonical_name: None,
                    rank: None,
                },
            })
        })
        .collect()
}

#[tauri::command]
fn resolve_grouping_names(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    names: Vec<String>,
) -> Result<Vec<ResolvedGroupingName>, String> {
    with_app_database(&app, &database, |connection| {
        resolve_grouping_names_in(connection, names)
    })
}

fn save_grouping_history_in(
    connection: &Connection,
    variant: &str,
    grouping: &SavedGrouping,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    if !valid_selection_id(&grouping.id) {
        return Err("分组记录编号不合法".to_string());
    }
    if grouping.input.is_null() || grouping.result.is_null() {
        return Err("分组记录内容不合法".to_string());
    }
    let created_at =
        i64::try_from(grouping.created_at).map_err(|_| "分组记录时间不合法".to_string())?;
    let input_json = serde_json::to_string(&grouping.input)
        .map_err(|error| format!("无法序列化分组输入：{error}"))?;
    let result_json = serde_json::to_string(&grouping.result)
        .map_err(|error| format!("无法序列化分组结果：{error}"))?;
    let display_name = grouping_display_name(grouping);
    connection
        .execute(
            "INSERT INTO grouping_history (id, created_at, display_name, input_json, result_json, variant)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               created_at = excluded.created_at,
               display_name = excluded.display_name,
               input_json = excluded.input_json,
               result_json = excluded.result_json,
               variant = excluded.variant",
            params![grouping.id, created_at, display_name, input_json, result_json, variant],
        )
        .map_err(|error| format!("无法保存分组记录：{error}"))?;
    Ok(())
}

fn grouping_display_name(grouping: &SavedGrouping) -> String {
    let input = grouping.input.as_object();
    let custom = grouping
        .title
        .as_deref()
        .or_else(|| input.and_then(|value| value.get("title").and_then(serde_json::Value::as_str)))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(custom) = custom {
        return custom.to_string();
    }
    let people = input
        .and_then(|value| value.get("sourceNames").and_then(serde_json::Value::as_array))
        .map_or(0, Vec::len);
    let groups = input
        .and_then(|value| value.get("groupCount").and_then(serde_json::Value::as_u64))
        .map_or_else(|| "—".to_string(), |value| value.to_string());
    let mode = match input.and_then(|value| value.get("orderMode").and_then(serde_json::Value::as_str)) {
        Some("input") => "输入顺序",
        Some("random") => "全随机",
        _ => "排名",
    };
    format!("{people} 项 · {groups} 组 · {mode}")
}

#[tauri::command]
fn save_grouping_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    grouping: SavedGrouping,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        save_grouping_history_in(connection, &variant, &grouping)
    })
}

#[cfg(test)]
fn list_grouping_histories_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<SavedGrouping>, String> {
    let _variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, input_json, result_json
             FROM grouping_history ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取分组历史：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| format!("无法查询分组历史：{error}"))?;

    let mut histories = Vec::new();
    for row in rows {
        let (id, created_at, input_json, result_json) =
            row.map_err(|error| format!("无法解析分组历史：{error}"))?;
        histories.push(SavedGrouping {
            id,
            created_at: u64::try_from(created_at).map_err(|_| "分组记录时间不合法".to_string())?,
            title: None,
            input: serde_json::from_str(&input_json)
                .map_err(|error| format!("无法解析分组输入：{error}"))?,
            result: serde_json::from_str(&result_json)
                .map_err(|error| format!("无法解析分组结果：{error}"))?,
        });
    }
    Ok(histories)
}

#[tauri::command]
fn list_grouping_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<Vec<HistoryListItem>, String> {
    with_app_database(&app, &database, |connection| {
        list_grouping_history_items_in(connection, &variant).map_err(database_file_error)
    })
}

#[tauri::command]
fn load_grouping_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    id: String,
) -> Result<SavedGrouping, String> {
    with_app_database(&app, &database, |connection| {
        load_grouping_history_in(connection, &variant, &id).map_err(database_file_error)
    })
}

fn list_grouping_history_items_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<HistoryListItem>, String> {
    let _variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, display_name
             FROM grouping_history ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取分组历史：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(HistoryListItem {
                id: row.get(0)?,
                created_at: u64::try_from(row.get::<_, i64>(1)?).unwrap_or_default(),
                display_name: row.get(2)?,
            })
        })
        .map_err(|error| format!("无法查询分组历史：{error}"))?;
    rows.map(|row| row.map_err(|error| format!("无法解析分组历史：{error}")))
        .collect()
}

fn load_grouping_history_in(
    connection: &Connection,
    variant: &str,
    id: &str,
) -> Result<SavedGrouping, String> {
    let _variant = validate_variant(variant)?;
    let (id, created_at, input_json, result_json) = connection
        .query_row(
            "SELECT id, created_at, input_json, result_json
             FROM grouping_history WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| format!("无法读取分组历史：{error}"))?;
    Ok(SavedGrouping {
        id,
        created_at: u64::try_from(created_at).map_err(|_| "分组记录时间不合法".to_string())?,
        title: None,
        input: serde_json::from_str(&input_json).map_err(|error| format!("无法解析分组输入：{error}"))?,
        result: serde_json::from_str(&result_json).map_err(|error| format!("无法解析分组结果：{error}"))?,
    })
}

fn import_grouping_history_in(
    connection: &Connection,
    variant: &str,
    history: &SavedGrouping,
) -> Result<Vec<HistoryListItem>, String> {
    save_grouping_history_in(connection, variant, history)?;
    list_grouping_history_items_in(connection, variant)
}

#[tauri::command]
fn import_grouping_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    history: SavedGrouping,
) -> Result<Vec<HistoryListItem>, String> {
    with_app_database(&app, &database, |connection| {
        import_grouping_history_in(connection, &variant, &history)
    })
}

#[tauri::command]
fn delete_grouping_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    id: String,
) -> Result<(), String> {
    let _variant = validate_variant(&variant)?;
    if !valid_selection_id(&id) {
        return Err("分组记录编号不合法".to_string());
    }
    with_app_database(&app, &database, |connection| {
        connection
            .execute("DELETE FROM grouping_history WHERE id = ?1", params![id])
            .map_err(|error| format!("无法删除分组记录：{error}"))?;
        Ok(())
    })
}

fn clear_grouping_histories_in(connection: &Connection, variant: &str) -> Result<(), String> {
    let _variant = validate_variant(variant)?;
    connection
        .execute("DELETE FROM grouping_history", [])
        .map_err(|error| format!("无法清空分组历史：{error}"))?;
    Ok(())
}

#[tauri::command]
fn clear_grouping_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        clear_grouping_histories_in(connection, &variant)
    })
}

fn save_battle_history_in(
    connection: &mut Connection,
    variant: &str,
    history: &BattleHistory,
    mark_current: bool,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    if !valid_selection_id(&history.id) {
        return Err("对战记录编号不合法".to_string());
    }
    if history.updated_at != history.snapshot.updated_at {
        return Err("对战记录更新时间不一致".to_string());
    }
    if history.snapshot.created_at > history.snapshot.updated_at {
        return Err("对战签表时间顺序不正确".to_string());
    }
    if history.created_at <= history.snapshot.updated_at {
        return Err("历史保存时间必须晚于签表更新时间".to_string());
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("无法开始保存对战历史：{error}"))?;
    if mark_current {
        if let Some((updated_at, history_saved)) =
            battle_tmp_history_status_in(&transaction, variant)?
        {
            if updated_at != history.snapshot.updated_at {
                return Err("当前对战临时状态已改变，无法保存历史".to_string());
            }
            if history_saved {
                return Err("同一对战状态已经保存过历史".to_string());
            }
        }
    }
    let created_at =
        i64::try_from(history.created_at).map_err(|_| "对战记录时间不合法".to_string())?;
    let payload_json = serde_json::to_string(&serde_json::json!({
        "title": history.title,
        "createdAt": history.snapshot.created_at,
        "updatedAt": history.updated_at,
        "snapshot": history.snapshot,
    }))
    .map_err(|error| format!("无法序列化对战记录：{error}"))?;
    let display_name = battle_history_display_name(history);
    transaction
        .execute(
            "INSERT INTO battle_history (id, created_at, display_name, variant, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id, variant) DO UPDATE SET
               created_at = excluded.created_at,
               display_name = excluded.display_name,
               payload_json = excluded.payload_json",
            params![history.id, created_at, display_name, variant, payload_json],
        )
        .map_err(|error| format!("无法保存对战记录：{error}"))?;
    if mark_current {
        mark_battle_tmp_history_saved_in(&transaction, variant, history.snapshot.updated_at)?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交对战历史：{error}"))
}

fn battle_history_display_name(history: &BattleHistory) -> String {
    if let Some(title) = history.title.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        return title.to_string();
    }
    let format = match history.snapshot.format.as_str() {
        "avoid-first-pair" => "同组不对战1对2",
        "single-elimination" => "单败",
        _ => "双败",
    };
    format!("{} 人 · {format}", history.snapshot.participant_count)
}

#[tauri::command]
fn save_battle_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    history: BattleHistory,
    mark_current: Option<bool>,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        save_battle_history_in(
            connection,
            &variant,
            &history,
            mark_current.unwrap_or(false),
        )
    })
}

fn list_battle_histories_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<BattleHistory>, String> {
    let _variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, payload_json
             FROM battle_history ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取对战历史：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("无法查询对战历史：{error}"))?;

    let mut histories = Vec::new();
    for row in rows {
        let (id, created_at, payload_json) =
            row.map_err(|error| format!("无法解析对战历史：{error}"))?;
        let payload: serde_json::Value = serde_json::from_str(&payload_json)
            .map_err(|error| format!("无法解析对战签表：{error}"))?;
        let snapshot: BattleTmpSnapshot = serde_json::from_value(
            payload
                .get("snapshot")
                .cloned()
                .unwrap_or_else(|| payload.clone()),
        )
        .map_err(|error| format!("无法解析对战签表：{error}"))?;
        let updated_at = payload
            .get("updatedAt")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| "对战历史更新时间不合法".to_string())?;
        if updated_at != snapshot.updated_at {
            return Err("对战历史更新时间不一致".to_string());
        }
        if snapshot.created_at > snapshot.updated_at {
            return Err("对战签表时间顺序不正确".to_string());
        }
        if payload.get("createdAt").and_then(serde_json::Value::as_u64) != Some(snapshot.created_at)
        {
            return Err("对战历史创建时间不一致".to_string());
        }
        if u64::try_from(created_at).unwrap_or_default() <= snapshot.updated_at {
            return Err("历史保存时间必须晚于签表更新时间".to_string());
        }
        let title = payload
            .get("title")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        histories.push(BattleHistory {
            id,
            created_at: u64::try_from(created_at).map_err(|_| "对战记录时间不合法".to_string())?,
            updated_at,
            title,
            snapshot,
        });
    }
    Ok(histories)
}

#[tauri::command]
fn list_battle_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<Vec<BattleHistoryListItem>, String> {
    with_app_database(&app, &database, |connection| {
        list_battle_history_items_in(connection, &variant).map_err(database_file_error)
    })
}

#[tauri::command]
fn load_battle_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    id: String,
) -> Result<BattleHistory, String> {
    with_app_database(&app, &database, |connection| {
        load_battle_history_in(connection, &variant, &id).map_err(database_file_error)
    })
}

fn list_battle_history_items_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<BattleHistoryListItem>, String> {
    let _variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, display_name
             FROM battle_history ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取对战历史：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(BattleHistoryListItem {
                id: row.get(0)?,
                created_at: u64::try_from(row.get::<_, i64>(1)?).unwrap_or_default(),
                display_name: row.get(2)?,
            })
        })
        .map_err(|error| format!("无法查询对战历史：{error}"))?;
    rows.map(|row| row.map_err(|error| format!("无法解析对战历史：{error}")))
        .collect()
}

fn load_battle_history_in(
    connection: &Connection,
    variant: &str,
    id: &str,
) -> Result<BattleHistory, String> {
    let histories = list_battle_histories_in(connection, variant)?;
    histories
        .into_iter()
        .find(|history| history.id == id)
        .ok_or_else(|| "找不到对战历史".to_string())
}

#[tauri::command]
fn delete_battle_history(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    id: String,
) -> Result<(), String> {
    let _variant = validate_variant(&variant)?;
    if !valid_selection_id(&id) {
        return Err("对战记录编号不合法".to_string());
    }
    with_app_database(&app, &database, |connection| {
        connection
            .execute("DELETE FROM battle_history WHERE id = ?1", params![id])
            .map_err(|error| format!("无法删除对战记录：{error}"))?;
        Ok(())
    })
}

fn clear_battle_histories_in(connection: &Connection, variant: &str) -> Result<(), String> {
    let _variant = validate_variant(variant)?;
    connection
        .execute("DELETE FROM battle_history", [])
        .map_err(|error| format!("无法清空对战历史：{error}"))?;
    Ok(())
}

#[tauri::command]
fn clear_battle_histories(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        clear_battle_histories_in(connection, &variant)
    })
}

// 对战临时状态的关系化存储与赛果传播集中在独立文件中。
include!("battle_tmp.rs");
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DatabaseState::default())
        .invoke_handler(tauri::generate_handler![
            load_app_setting,
            save_app_setting,
            save_common_selection,
            list_common_selections,
            delete_common_selection,
            save_draw_history,
            list_draw_histories,
            delete_draw_history,
            clear_draw_histories,
            save_ranked_user,
            add_ranked_user_alias,
            clear_ranked_user_aliases,
            replace_ranked_users,
            list_ranked_users,
            move_ranked_user,
            delete_ranked_user,
            resolve_grouping_names,
            save_grouping_history,
            list_grouping_histories,
            load_grouping_history,
            import_grouping_history,
            delete_grouping_history,
            clear_grouping_histories,
            save_battle_history,
            list_battle_histories,
            load_battle_history,
            delete_battle_history,
            clear_battle_histories,
            save_battle_tmp_state,
            load_battle_tmp_state,
            load_battle_tmp_history_status,
            mark_battle_tmp_history_saved,
            update_battle_tmp_result,
            clear_battle_tmp_state,
            open_database_folder,
            open_download_folder,
            export_text_file,
            export_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("无法启动转盘");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> Connection {
        let mut connection = Connection::open_in_memory().expect("创建内存数据库");
        migrate_database(&mut connection).expect("执行数据库迁移");
        connection
    }

    #[test]
    fn migration_creates_fresh_schema_at_version_one_and_is_idempotent() {
        let mut connection = Connection::open_in_memory().expect("创建内存数据库");
        migrate_database(&mut connection).expect("第一次迁移");
        migrate_database(&mut connection).expect("重复迁移");

        let versions = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .expect("读取迁移表")
            .query_map([], |row| row.get::<_, i64>(0))
            .expect("查询迁移版本")
            .collect::<Result<Vec<_>, _>>()
            .expect("解析迁移版本");
        expect_tables(
            &connection,
            &[
                "draw_history",
                "user",
                "alias",
                "grouping_history",
                "battle_history",
                "app_kv",
                "battle_tmp",
                "battle_tmp_participant",
                "battle_tmp_match",
            ],
        );
        assert_eq!(versions, vec![DATABASE_SCHEMA_VERSION]);
    }

    #[test]
    fn migration_rejects_old_database_versions() {
        let mut connection = Connection::open_in_memory().expect("创建内存数据库");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL);
                 INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 1);",
            )
            .expect("创建旧版迁移记录");

        let error = migrate_database(&mut connection).expect_err("旧版数据库不能继续迁移");
        assert!(error.contains("数据库版本不兼容"));
    }

    #[test]
    fn sql_log_uses_one_line_local_timestamp_format() {
        let time = OffsetDateTime::from_unix_timestamp(0).expect("创建测试时间");
        assert_eq!(
            format_sql_log_line("SELECT 1;\nUPDATE user SET rank = 2;", time),
            "1970-01-01 00:00:00 SELECT 1; UPDATE user SET rank = 2;"
        );
    }

    #[test]
    fn sql_log_only_keeps_create_update_and_delete_operations() {
        for sql in [
            "CREATE TABLE user (id INTEGER)",
            "INSERT INTO user (id) VALUES (1)",
            "UPDATE user SET id = 2",
            "DELETE FROM user WHERE id = 2",
        ] {
            assert!(should_log_sql_statement(sql), "应记录：{sql}");
        }
        for sql in [
            "SELECT * FROM user",
            "PRAGMA user_version",
            "BEGIN",
            "COMMIT",
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
        ] {
            assert!(!should_log_sql_statement(sql), "不应记录：{sql}");
        }
    }

    #[test]
    fn sql_log_deduplicates_cascade_trace_for_full_user_delete() {
        let mut deduplicator = SqlTraceDeduplicator::default();
        assert!(!deduplicator.should_skip("DELETE FROM user"));
        assert!(deduplicator.should_skip("DELETE FROM user"));
        assert!(deduplicator.should_skip("DELETE FROM user;"));

        assert!(!deduplicator.should_skip("SELECT id FROM user"));
        assert!(!deduplicator.should_skip("DELETE FROM user"));
        assert!(!deduplicator.should_skip("DELETE FROM user WHERE id = 1"));
    }

    #[test]
    fn database_state_reuses_one_connection() {
        let database = DatabaseState::default();
        let open_count = std::cell::Cell::new(0);

        with_database_connection(
            &database,
            || {
                open_count.set(open_count.get() + 1);
                Connection::open_in_memory().map_err(|error| error.to_string())
            },
            |connection| {
                connection
                    .execute("CREATE TABLE shared_state (value INTEGER NOT NULL)", [])
                    .map_err(|error| error.to_string())?;
                connection
                    .execute("INSERT INTO shared_state (value) VALUES (7)", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            },
        )
        .expect("首次使用数据库");

        let value = with_database_connection(
            &database,
            || {
                open_count.set(open_count.get() + 1);
                Connection::open_in_memory().map_err(|error| error.to_string())
            },
            |connection| {
                connection
                    .query_row("SELECT value FROM shared_state", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| error.to_string())
            },
        )
        .expect("再次使用数据库");

        assert_eq!(value, 7);
        assert_eq!(open_count.get(), 1);
    }

    #[test]
    fn saving_user_always_creates_canonical_alias_and_default_rank() {
        let mut connection = test_database();
        let user = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "星河".to_string(),
                rank: None,
                aliases: vec!["小星".to_string()],
            },
        )
        .expect("保存选项");

        assert_eq!(user.rank, UNRANKED_RANK);
        assert_eq!(
            user.aliases
                .iter()
                .map(|alias| alias.name.as_str())
                .collect::<Vec<_>>(),
            vec!["星河", "小星"]
        );

        let resolved =
            resolve_grouping_names_in(&connection, vec!["小星".to_string(), "陌生人".to_string()])
                .expect("解析别名");
        assert!(resolved[0].known);
        assert_eq!(resolved[0].canonical_name.as_deref(), Some("星河"));
        assert!(!resolved[1].known);
    }

    #[test]
    fn duplicate_alias_rolls_back_new_user() {
        let mut connection = test_database();
        save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "甲".to_string(),
                rank: Some(1),
                aliases: vec!["共享别名".to_string()],
            },
        )
        .expect("保存第一个选项");

        let error = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "乙".to_string(),
                rank: Some(2),
                aliases: vec!["共享别名".to_string()],
            },
        )
        .expect_err("重复别名应失败");

        assert!(error.contains("共享别名"));
        assert!(!error.to_ascii_lowercase().contains("constraint"));
        assert!(!error.to_ascii_lowercase().contains("unique"));
        assert_eq!(
            list_ranked_users_in(&connection).expect("读取排名").len(),
            1
        );
    }

    #[test]
    fn duplicate_canonical_name_matching_an_alias_returns_chinese_error() {
        let mut connection = test_database();
        save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "甲".to_string(),
                rank: Some(1),
                aliases: vec!["共享名称".to_string()],
            },
        )
        .expect("保存第一个选项");

        let error = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "共享名称".to_string(),
                rank: Some(2),
                aliases: vec![],
            },
        )
        .expect_err("名称不能和已有别名重复");

        assert!(error.contains("已经被"));
        assert!(!error.to_ascii_lowercase().contains("constraint"));
        assert!(!error.to_ascii_lowercase().contains("unique"));
    }

    #[test]
    fn canonical_name_can_take_an_alias_owned_by_the_same_user() {
        let mut connection = test_database();
        let user = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "甲".to_string(),
                rank: Some(1),
                aliases: vec!["小甲".to_string(), "甲同学".to_string()],
            },
        )
        .expect("保存带别名的排名项");

        let renamed = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: Some(user.id),
                name: "小甲".to_string(),
                rank: Some(1),
                aliases: vec![],
            },
        )
        .expect("允许把自己的别名改成本名");

        assert_eq!(renamed.name, "小甲");
        assert_eq!(
            renamed
                .aliases
                .iter()
                .map(|alias| alias.name.as_str())
                .collect::<Vec<_>>(),
            vec!["小甲", "甲同学"]
        );
    }

    #[test]
    fn replacing_ranked_users_rolls_back_when_an_insert_fails() {
        let mut connection = test_database();
        save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "旧排名".to_string(),
                rank: Some(1),
                aliases: vec!["旧别名".to_string()],
            },
        )
        .expect("保存旧排名");
        connection
            .execute_batch(
                "CREATE TRIGGER reject_bad_ranked_user
                 BEFORE INSERT ON user WHEN NEW.name = '坏数据'
                 BEGIN SELECT RAISE(ABORT, '拒绝坏数据'); END;",
            )
            .expect("创建失败触发器");

        replace_ranked_users_in(
            &mut connection,
            vec![
                RankedUserTransferInput {
                    name: "新排名".to_string(),
                    rank: 1,
                    aliases: vec![],
                },
                RankedUserTransferInput {
                    name: "坏数据".to_string(),
                    rank: 2,
                    aliases: vec![],
                },
            ],
        )
        .expect_err("中途失败应回滚整个排名导入");

        let users = list_ranked_users_in(&connection).expect("读取回滚后的排名");
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].name, "旧排名");
        assert!(users[0].aliases.iter().any(|alias| alias.name == "旧别名"));
    }

    #[test]
    fn aliases_append_without_limit_and_clear_keeps_canonical_name() {
        let mut connection = test_database();
        let user = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "甲".to_string(),
                rank: Some(1),
                aliases: vec![],
            },
        )
        .expect("添加排名选项");

        for index in 1..=35 {
            add_ranked_user_alias_in(&connection, user.id, format!("别名{index}"))
                .expect("追加别名");
        }
        let duplicate = add_ranked_user_alias_in(&connection, user.id, "别名1".to_string())
            .expect_err("同一选项也不能重复使用别名");
        assert!(duplicate.contains("已经被"));

        let other = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: None,
                name: "乙".to_string(),
                rank: Some(2),
                aliases: vec![],
            },
        )
        .expect("添加另一个排名选项");
        assert!(
            add_ranked_user_alias_in(&connection, user.id, "乙".to_string())
                .expect_err("别名不能和其他名称重复")
                .contains("已经被")
        );
        assert!(
            add_ranked_user_alias_in(&connection, other.id, "别名1".to_string())
                .expect_err("不同选项不能共用别名")
                .contains("已经被")
        );

        let renamed = save_ranked_user_in(
            &mut connection,
            RankedUserInput {
                id: Some(user.id),
                name: "新甲".to_string(),
                rank: Some(1),
                aliases: vec![],
            },
        )
        .expect("修改名称");
        assert_eq!(renamed.aliases.len(), 36);
        assert_eq!(renamed.aliases[0].name, "新甲");
        assert!(renamed.aliases.iter().any(|alias| alias.name == "别名35"));

        let cleared = clear_ranked_user_aliases_in(&connection, user.id).expect("清空别名");
        assert_eq!(
            cleared
                .aliases
                .iter()
                .map(|alias| alias.name.as_str())
                .collect::<Vec<_>>(),
            vec!["新甲"]
        );
    }

    #[test]
    fn moving_users_inserts_with_range_updates_and_swaps_ranks() {
        let mut connection = test_database();
        let (first, second, third) = {
            let mut save = |name: &str, rank: Option<i64>| {
                save_ranked_user_in(
                    &mut connection,
                    RankedUserInput {
                        id: None,
                        name: name.to_string(),
                        rank,
                        aliases: vec![],
                    },
                )
                .expect("保存选项")
            };
            (save("甲", Some(1)), save("乙", Some(2)), save("丙", None))
        };

        let error = move_ranked_user_in(
            &mut connection,
            third.id,
            RankedUserDropTargetInput::Swap { user_id: second.id },
        )
        .expect_err("无排名选项不能交换");
        assert_eq!(error, "无排名选项只能插入排名");

        move_ranked_user_in(
            &mut connection,
            third.id,
            RankedUserDropTargetInput::Insert { index: 1 },
        )
        .expect("插入排名");
        let users = move_ranked_user_in(
            &mut connection,
            first.id,
            RankedUserDropTargetInput::Swap { user_id: second.id },
        )
        .expect("互换排名");
        assert_eq!(
            users
                .iter()
                .map(|user| (user.name.as_str(), user.rank))
                .collect::<Vec<_>>(),
            vec![("乙", 1), ("丙", 2), ("甲", 3)]
        );
    }

    #[test]
    fn grouping_history_round_trips_json() {
        let connection = test_database();
        let grouping = SavedGrouping {
            id: "grouping-1".to_string(),
            created_at: 1_700_000_000_000,
            title: None,
            input: serde_json::json!({"names": ["甲", "乙"], "groupCount": 2}),
            result: serde_json::json!({"tiers": [["甲", "乙"]]}),
        };

        let caimi_grouping = SavedGrouping {
            id: "grouping-caimi".to_string(),
            created_at: grouping.created_at + 1,
            title: None,
            input: grouping.input.clone(),
            result: grouping.result.clone(),
        };
        save_grouping_history_in(&connection, "standard", &grouping).expect("保存普通版排阵历史");
        save_grouping_history_in(&connection, "caimi", &caimi_grouping)
            .expect("保存猜蜜版排阵历史");
        let histories =
            list_grouping_histories_in(&connection, "standard").expect("读取普通版排阵历史");
        let caimi_histories =
            list_grouping_histories_in(&connection, "caimi").expect("读取猜蜜版排阵历史");

        assert_eq!(histories.len(), 2);
        let standard_history = histories
            .iter()
            .find(|history| history.id == grouping.id)
            .expect("找到普通版历史");
        assert_eq!(standard_history.input, grouping.input);
        assert_eq!(standard_history.result, grouping.result);
        assert_eq!(caimi_histories.len(), 2);
        assert!(caimi_histories
            .iter()
            .any(|history| history.id == caimi_grouping.id));

        clear_grouping_histories_in(&connection, "standard").expect("清空普通版分组历史");
        assert!(list_grouping_histories_in(&connection, "standard")
            .expect("读取已清空的共享分组历史")
            .is_empty());
        assert!(list_grouping_histories_in(&connection, "caimi")
            .expect("确认猜蜜版也使用共享分组历史")
            .is_empty());
    }

    #[test]
    fn importing_one_grouping_history_preserves_existing_records() {
        let connection = test_database();
        let old = SavedGrouping {
            id: "grouping-old".to_string(),
            created_at: 1_700_000_000_000,
            title: None,
            input: serde_json::json!({"names": ["旧"]}),
            result: serde_json::json!({"tiers": [["旧"]]}),
        };
        save_grouping_history_in(&connection, "standard", &old).expect("保存旧分组历史");

        let valid = SavedGrouping {
            id: "grouping-new".to_string(),
            created_at: old.created_at + 1,
            title: None,
            input: serde_json::json!({"names": ["新"]}),
            result: serde_json::json!({"tiers": [["新"]]}),
        };
        import_grouping_history_in(&connection, "standard", &valid).expect("导入单条分组历史");
        let histories = list_grouping_histories_in(&connection, "standard").expect("读取分组历史");
        assert_eq!(histories.len(), 2);

        let invalid = SavedGrouping {
            id: "非法 编号".to_string(),
            created_at: old.created_at + 2,
            title: None,
            input: valid.input.clone(),
            result: valid.result.clone(),
        };
        import_grouping_history_in(&connection, "standard", &invalid)
            .expect_err("非法单条历史不能导入");

        let histories = list_grouping_histories_in(&connection, "standard").expect("读取分组历史");
        assert_eq!(histories.len(), 2);
        assert!(histories.iter().any(|history| history.id == old.id));
        assert!(histories.iter().any(|history| history.id == valid.id));
    }

    fn battle_tmp_test_participants(count: usize) -> Vec<BattleTmpParticipant> {
        (1..=count)
            .map(|id| BattleTmpParticipant {
                id,
                name: format!("选手{id}"),
                source_index: id - 1,
                seed: id,
                group_index: None,
                group_rank: None,
            })
            .collect()
    }

    fn battle_tmp_test_match(
        match_id: &str,
        level: usize,
        position: usize,
        up: Option<usize>,
        down: Option<usize>,
    ) -> BattleTmpMatch {
        BattleTmpMatch {
            match_id: match_id.to_string(),
            stage: "single".to_string(),
            level,
            position,
            up,
            down,
            up_result: None,
            down_result: None,
            status: if up.is_some() && down.is_some() {
                "ready".to_string()
            } else {
                "pending".to_string()
            },
        }
    }

    fn single_battle_tmp_test_snapshot(variant: &str) -> BattleTmpSnapshot {
        let final_match = battle_tmp_test_match("S2-M1", 2, 1, None, None);
        BattleTmpSnapshot {
            version: 1,
            rules_version: 1,
            kind: "battle-tmp".to_string(),
            variant: variant.to_string(),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            format: "single-elimination".to_string(),
            order_mode: "input".to_string(),
            participant_count: 4,
            bracket_size: 4,
            fixed_seed_count: 2,
            participants: battle_tmp_test_participants(4),
            matches: vec![
                battle_tmp_test_match("S1-M1", 1, 1, Some(1), Some(2)),
                battle_tmp_test_match("S1-M2", 1, 2, Some(3), Some(4)),
                final_match,
            ],
        }
    }

    fn double_battle_tmp_test_snapshot() -> BattleTmpSnapshot {
        let mut winner = battle_tmp_test_match("W1-M1", 1, 1, Some(1), Some(2));
        winner.stage = "winner".to_string();

        let mut loser = battle_tmp_test_match("L1-M1", 1, 1, None, None);
        loser.stage = "loser".to_string();

        let mut grand_final = battle_tmp_test_match("GF-M1", 1, 1, None, None);
        grand_final.stage = "final".to_string();

        let mut reset = battle_tmp_test_match("GF-RESET-M1", 2, 1, None, None);
        reset.stage = "final".to_string();

        BattleTmpSnapshot {
            version: 1,
            rules_version: 1,
            kind: "battle-tmp".to_string(),
            variant: "standard".to_string(),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            format: "double-elimination".to_string(),
            order_mode: "input".to_string(),
            participant_count: 2,
            bracket_size: 2,
            fixed_seed_count: 0,
            participants: battle_tmp_test_participants(2),
            matches: vec![winner, loser, grand_final, reset],
        }
    }

    #[test]
    fn battle_tmp_rejects_duplicate_participants_before_creating_tables() {
        let connection = test_database();
        let mut snapshot = single_battle_tmp_test_snapshot("standard");
        snapshot.participants[1].id = snapshot.participants[0].id;

        let error = save_battle_tmp_state_in(&connection, "standard", &snapshot)
            .expect_err("重复参赛者编号必须被拒绝");

        assert_eq!(error, "对战临时状态参赛者不合法");
        assert!(battle_tmp_table_exists(&connection).unwrap());
    }

    #[test]
    fn battle_tmp_rejects_scores_for_an_unresolved_slot() {
        let connection = test_database();
        let mut snapshot = single_battle_tmp_test_snapshot("standard");
        let final_match = snapshot
            .matches
            .iter_mut()
            .find(|battle_match| battle_match.match_id == "S2-M1")
            .expect("找到决赛");
        final_match.up_result = Some(4);

        let error = save_battle_tmp_state_in(&connection, "standard", &snapshot)
            .expect_err("等待上游的签位不能带比分");

        assert_eq!(error, "等待上游的签位不能填写比分");
        assert!(battle_tmp_table_exists(&connection).unwrap());
    }

    #[test]
    fn battle_tmp_tables_are_created_by_migration_and_replaced_as_one_global_state() {
        let connection = test_database();
        assert!(battle_tmp_table_exists(&connection).expect("检查迁移创建的对战临时表"));
        assert_eq!(
            load_battle_tmp_state_in(&connection, "standard").expect("读取空对战状态"),
            None
        );

        let standard = single_battle_tmp_test_snapshot("standard");
        save_battle_tmp_state_in(&connection, "standard", &standard).expect("保存普通版对战状态");
        assert!(battle_tmp_table_exists(&connection).expect("检查已创建的对战临时表"));
        assert_eq!(
            load_battle_tmp_state_in(&connection, "standard").expect("读取普通版对战状态"),
            Some(standard.clone())
        );
        let columns = connection
            .prepare("PRAGMA table_info(battle_tmp)")
            .expect("读取对战临时表结构")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("查询对战临时表字段")
            .collect::<Result<Vec<_>, _>>()
            .expect("解析对战临时表字段");
        assert!(!columns.iter().any(|column| column == "state_json"));
        let match_columns = connection
            .prepare("PRAGMA table_info(battle_tmp_match)")
            .expect("读取对战场次表结构")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("查询对战场次表字段")
            .collect::<Result<Vec<_>, _>>()
            .expect("解析对战场次表字段");
        assert_eq!(
            match_columns,
            vec![
                "state_id",
                "match_id",
                "stage",
                "level",
                "position",
                "up",
                "down",
                "up_result",
                "down_result",
                "status"
            ]
        );

        let mut caimi = single_battle_tmp_test_snapshot("caimi");
        caimi.updated_at += 1;
        save_battle_tmp_state_in(&connection, "caimi", &caimi).expect("保存猜蜜版对战状态");
        assert_eq!(
            load_battle_tmp_state_in(&connection, "standard").expect("确认旧状态已被替换"),
            None
        );
        assert_eq!(
            load_battle_tmp_state_in(&connection, "caimi").expect("确认当前状态存在"),
            Some(caimi.clone())
        );
        clear_battle_tmp_state_in(&connection, "standard").expect("其他版本不能误删当前状态");
        assert_eq!(
            load_battle_tmp_state_in(&connection, "caimi").unwrap(),
            Some(caimi)
        );
        clear_battle_tmp_state_in(&connection, "caimi").expect("清空当前对战状态");
        assert_eq!(
            load_battle_tmp_state_in(&connection, "caimi").unwrap(),
            None
        );
    }

    #[test]
    fn battle_history_marks_exact_tmp_state_and_score_change_reopens_saving() {
        let mut connection = test_database();
        let snapshot = single_battle_tmp_test_snapshot("standard");
        save_battle_tmp_state_in(&connection, "standard", &snapshot).expect("保存对战临时状态");
        let history = BattleHistory {
            id: "battle-state-1".to_string(),
            created_at: snapshot.updated_at + 1,
            updated_at: snapshot.updated_at,
            title: None,
            snapshot: snapshot.clone(),
        };

        save_battle_history_in(&mut connection, "standard", &history, true)
            .expect("第一次保存对战历史");
        assert_eq!(
            battle_tmp_history_status_in(&connection, "standard").expect("读取保存标识"),
            Some((snapshot.updated_at, true))
        );

        let mut duplicate = history.clone();
        duplicate.id = "battle-state-2".to_string();
        assert_eq!(
            save_battle_history_in(&mut connection, "standard", &duplicate, true)
                .expect_err("同一状态不能重复保存"),
            "同一对战状态已经保存过历史"
        );
        assert_eq!(
            list_battle_histories_in(&connection, "standard")
                .expect("读取对战历史")
                .len(),
            1
        );

        let caimi_snapshot = single_battle_tmp_test_snapshot("caimi");
        let caimi_history = BattleHistory {
            id: "battle-caimi-1".to_string(),
            created_at: caimi_snapshot.updated_at + 2,
            updated_at: caimi_snapshot.updated_at,
            title: Some("猜蜜版历史".to_string()),
            snapshot: caimi_snapshot,
        };
        save_battle_history_in(&mut connection, "caimi", &caimi_history, false)
            .expect("保存猜蜜版对战历史");
        assert_eq!(
            list_battle_histories_in(&connection, "standard")
                .expect("普通版读取共享对战历史")
                .len(),
            2
        );
        assert_eq!(
            list_battle_history_items_in(&connection, "caimi")
                .expect("猜蜜版读取共享对战历史列表")
                .len(),
            2
        );

        let updated_at = snapshot.updated_at + 1;
        update_battle_tmp_result_in(
            &connection,
            "standard",
            "S1-M1",
            Some(4),
            Some(1),
            updated_at,
        )
        .expect("更新比分");
        assert_eq!(
            battle_tmp_history_status_in(&connection, "standard").expect("读取更新后标识"),
            Some((updated_at, false))
        );

        save_battle_tmp_state_with_history_in(&connection, "standard", &snapshot, true)
            .expect("从历史加载临时状态");
        assert_eq!(
            battle_tmp_history_status_in(&connection, "standard").expect("读取历史加载标识"),
            Some((snapshot.updated_at, true))
        );
    }

    #[test]
    fn battle_tmp_result_updates_only_propagate_to_dependent_matches() {
        let connection = test_database();
        let snapshot = single_battle_tmp_test_snapshot("standard");
        save_battle_tmp_state_in(&connection, "standard", &snapshot).expect("保存单败对战状态");

        update_battle_tmp_result_in(
            &connection,
            "standard",
            "S1-M1",
            Some(4),
            Some(1),
            1_700_000_000_001,
        )
        .expect("填写第一场赛果");
        let pending_final = load_battle_tmp_match_in(&connection, "S2-M1")
            .unwrap()
            .unwrap();
        assert_eq!(pending_final.up, Some(1));
        assert_eq!(pending_final.down, None);
        assert_eq!(pending_final.status, "pending");

        update_battle_tmp_result_in(
            &connection,
            "standard",
            "S1-M2",
            Some(4),
            Some(1),
            1_700_000_000_002,
        )
        .expect("填写第二场赛果");
        let ready_final = load_battle_tmp_match_in(&connection, "S2-M1")
            .unwrap()
            .unwrap();
        assert_eq!((ready_final.up, ready_final.down), (Some(1), Some(3)));
        assert_eq!(ready_final.status, "ready");

        update_battle_tmp_result_in(
            &connection,
            "standard",
            "S2-M1",
            Some(4),
            Some(1),
            1_700_000_000_003,
        )
        .expect("填写决赛赛果");
        let rejected = update_battle_tmp_result_in(
            &connection,
            "standard",
            "S1-M1",
            Some(1),
            Some(4),
            1_700_000_000_004,
        );
        assert!(rejected.is_err());
        let unchanged = load_battle_tmp_match_in(&connection, "S2-M1")
            .unwrap()
            .unwrap();
        assert_eq!((unchanged.up, unchanged.down), (Some(1), Some(3)));
        assert_eq!(
            (unchanged.up_result, unchanged.down_result),
            (Some(4), Some(1))
        );
        assert_eq!(unchanged.status, "completed");
        assert_eq!(
            load_battle_tmp_match_in(&connection, "S1-M2")
                .unwrap()
                .unwrap()
                .up_result,
            Some(4)
        );
    }

    #[test]
    fn double_battle_tmp_propagates_losers_and_conditionally_activates_reset() {
        let connection = test_database();
        let snapshot = double_battle_tmp_test_snapshot();
        save_battle_tmp_state_in(&connection, "standard", &snapshot).expect("保存双败对战状态");

        let after_winner = update_battle_tmp_result_in(
            &connection,
            "standard",
            "W1-M1",
            Some(4),
            Some(1),
            1_700_000_000_001,
        )
        .expect("填写胜者组赛果");
        let loser_match = after_winner
            .matches
            .iter()
            .find(|battle_match| battle_match.match_id == "L1-M1")
            .unwrap();
        assert_eq!(loser_match.up, Some(2));
        assert_eq!(
            (loser_match.up_result, loser_match.down_result),
            (None, None)
        );
        assert_eq!(loser_match.status, "completed");
        let grand_final = after_winner
            .matches
            .iter()
            .find(|battle_match| battle_match.match_id == "GF-M1")
            .unwrap();
        assert_eq!((grand_final.up, grand_final.down), (Some(1), Some(2)));
        assert_eq!(grand_final.status, "ready");

        let no_reset = update_battle_tmp_result_in(
            &connection,
            "standard",
            "GF-M1",
            Some(4),
            Some(1),
            1_700_000_000_002,
        )
        .expect("胜者组选手赢得总决赛");
        assert_eq!(
            no_reset
                .matches
                .iter()
                .find(|battle_match| battle_match.match_id == "GF-RESET-M1")
                .unwrap()
                .status,
            "skipped"
        );

        let reset = update_battle_tmp_result_in(
            &connection,
            "standard",
            "GF-M1",
            Some(1),
            Some(4),
            1_700_000_000_003,
        )
        .expect("败者组选手赢得总决赛");
        let reset_match = reset
            .matches
            .iter()
            .find(|battle_match| battle_match.match_id == "GF-RESET-M1")
            .unwrap();
        assert_eq!((reset_match.up, reset_match.down), (Some(2), Some(1)));
        assert_eq!(reset_match.status, "ready");
    }

    #[test]
    fn double_battle_tmp_without_reset_finishes_at_grand_final() {
        let connection = test_database();
        let mut snapshot = double_battle_tmp_test_snapshot();
        snapshot
            .matches
            .retain(|battle_match| battle_match.match_id != "GF-RESET-M1");
        save_battle_tmp_state_in(&connection, "standard", &snapshot)
            .expect("保存未启用第二场总决赛的双败状态");

        update_battle_tmp_result_in(
            &connection,
            "standard",
            "W1-M1",
            Some(4),
            Some(1),
            1_700_000_000_001,
        )
        .expect("填写胜者组赛果");
        let completed = update_battle_tmp_result_in(
            &connection,
            "standard",
            "GF-M1",
            Some(1),
            Some(4),
            1_700_000_000_002,
        )
        .expect("第一场总决赛直接产生冠军");
        assert!(completed
            .matches
            .iter()
            .all(|battle_match| battle_match.match_id != "GF-RESET-M1"));
        assert_eq!(
            completed
                .matches
                .iter()
                .find(|battle_match| battle_match.match_id == "GF-M1")
                .unwrap()
                .status,
            "completed"
        );
    }

    #[test]
    fn draw_history_round_trips_json() {
        let connection = test_database();
        let draw = SavedDraw {
            version: 1,
            id: "draw-1".to_string(),
            created_at: 1_700_000_000_000,
            mode: "selected".to_string(),
            reward_amount: 88.5,
            prizes: serde_json::json!([
                {"id": "prize-1", "name": "一等奖", "weight": 2}
            ]),
            records: serde_json::json!([
                {"id": "record-1", "prizeId": "prize-1", "name": "一等奖", "outcome": "selected"}
            ]),
        };

        let caimi_draw = SavedDraw {
            version: draw.version,
            id: "draw-caimi".to_string(),
            created_at: draw.created_at + 1,
            mode: draw.mode.clone(),
            reward_amount: draw.reward_amount,
            prizes: draw.prizes.clone(),
            records: draw.records.clone(),
        };
        save_draw_history_in(&connection, "standard", &draw).expect("保存普通版抽奖历史");
        save_draw_history_in(&connection, "caimi", &caimi_draw).expect("保存猜蜜版抽奖历史");
        let histories =
            list_draw_histories_in(&connection, "standard").expect("读取普通版抽奖历史");
        let caimi_histories =
            list_draw_histories_in(&connection, "caimi").expect("读取猜蜜版抽奖历史");

        assert_eq!(histories.len(), 2);
        let standard_history = histories
            .iter()
            .find(|history| history.id == draw.id)
            .expect("找到普通版历史");
        assert_eq!(standard_history.created_at, draw.created_at);
        assert_eq!(standard_history.mode, draw.mode);
        assert_eq!(standard_history.reward_amount, draw.reward_amount);
        assert_eq!(standard_history.prizes, draw.prizes);
        assert_eq!(standard_history.records, draw.records);
        assert_eq!(caimi_histories.len(), 2);
        assert!(caimi_histories
            .iter()
            .any(|history| history.id == caimi_draw.id));
    }

    #[test]
    fn draw_history_rejects_retry_only_records() {
        let connection = test_database();
        let draw = SavedDraw {
            version: 1,
            id: "draw-retry-only".to_string(),
            created_at: 1_700_000_000_000,
            mode: "selected".to_string(),
            reward_amount: 0.0,
            prizes: serde_json::json!([
                {"id": "prize-1", "name": "一等奖", "weight": 1}
            ]),
            records: serde_json::json!([
                {"id": "record-1", "optionId": "__retry__", "outcome": "retry"}
            ]),
        };

        assert_eq!(
            save_draw_history_in(&connection, "standard", &draw),
            Err("没有有效结果，抽奖记录不会入库".to_string())
        );
        assert!(list_draw_histories_in(&connection, "standard")
            .expect("读取抽奖历史")
            .is_empty());
    }

    #[test]
    fn corrupted_draw_history_reports_database_recovery_steps() {
        let connection = test_database();
        connection
            .execute(
                "INSERT INTO draw_history (id, created_at, payload_json, variant)
                 VALUES ('broken', 1, '{broken json', 'standard')",
                [],
            )
            .expect("写入损坏测试数据");

        let error =
            list_draw_histories_in(&connection, "standard").expect_err("损坏的历史不能被静默忽略");
        let message = database_file_error(error);
        assert!(message.contains("数据库文件错误"));
        assert!(message.contains(DATABASE_FILE_NAME));
        assert!(message.contains("重新打开应用"));
    }

    #[test]
    fn corrupted_ranking_reports_database_recovery_steps() {
        let connection = test_database();
        connection
            .execute("DROP TABLE user", [])
            .expect("模拟排名表被手工破坏");

        let error = list_ranked_users_in(&connection).expect_err("损坏的排名表不能被静默忽略");
        let message = database_file_error(error);
        assert!(message.contains("数据库文件错误"));
        assert!(message.contains(DATABASE_FILE_NAME));
        assert!(message.contains("重新打开应用"));
    }

    #[test]
    fn corrupted_grouping_history_reports_database_recovery_steps() {
        let connection = test_database();
        connection
            .execute(
                "INSERT INTO grouping_history (id, created_at, input_json, result_json, variant)
                 VALUES ('broken', 1, '{broken json', '{}', 'standard')",
                [],
            )
            .expect("写入损坏测试数据");

        let error = list_grouping_histories_in(&connection, "standard")
            .expect_err("损坏的分组历史不能被静默忽略");
        let message = database_file_error(error);
        assert!(message.contains("数据库文件错误"));
        assert!(message.contains(DATABASE_FILE_NAME));
        assert!(message.contains("重新打开应用"));
    }

    fn expect_tables(connection: &Connection, expected: &[&str]) {
        for table in expected {
            let exists = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    params![table],
                    |row| row.get::<_, bool>(0),
                )
                .expect("检查数据表");
            assert!(exists, "缺少数据表 {table}");
        }
    }
}
