use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command, time::Duration};
use tauri::{AppHandle, Manager};

const UNRANKED_RANK: i64 = 10_000;
const SHARED_DATA_DIRECTORY: &str = "com.phpgoc.fortuna";

const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        "CREATE TABLE IF NOT EXISTS draw_history (
           id TEXT PRIMARY KEY NOT NULL,
           created_at INTEGER NOT NULL,
           payload_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS draw_history_created_at
         ON draw_history(created_at DESC);",
    ),
    (
        2,
        "CREATE TABLE IF NOT EXISTS user (
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
           id TEXT PRIMARY KEY NOT NULL,
           created_at INTEGER NOT NULL,
           input_json TEXT NOT NULL,
           result_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS lineup_history_created_at
         ON lineup_history(created_at DESC);",
    ),
    (
        3,
        "WITH ordered AS (
           SELECT id,
                  ROW_NUMBER() OVER (ORDER BY rank ASC, name COLLATE NOCASE ASC) AS normalized_rank
           FROM user
           WHERE rank < 10000
         )
         UPDATE user
         SET rank = (SELECT normalized_rank FROM ordered WHERE ordered.id = user.id)
         WHERE id IN (SELECT id FROM ordered);",
    ),
    (
        4,
        "ALTER TABLE draw_history
         ADD COLUMN variant TEXT NOT NULL DEFAULT 'standard';
         CREATE INDEX IF NOT EXISTS draw_history_variant_created_at
         ON draw_history(variant, created_at DESC);
         ALTER TABLE lineup_history
         ADD COLUMN variant TEXT NOT NULL DEFAULT 'standard';
         CREATE INDEX IF NOT EXISTS lineup_history_variant_created_at
         ON lineup_history(variant, created_at DESC);",
    ),
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommonSelection {
    version: u8,
    id: String,
    name: String,
    created_at: u64,
    prizes: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedDraw {
    version: u8,
    id: String,
    created_at: u64,
    mode: String,
    reward_amount: f64,
    prizes: serde_json::Value,
    records: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AliasRecord {
    id: i64,
    name: String,
    user_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RankedUser {
    id: i64,
    name: String,
    rank: i64,
    aliases: Vec<AliasRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankedUserInput {
    id: Option<i64>,
    name: String,
    rank: Option<i64>,
    #[serde(default)]
    aliases: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum RankedUserDropTargetInput {
    Insert { index: usize },
    Swap { user_id: i64 },
    Unranked,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ResolvedLineupName {
    input_name: String,
    known: bool,
    user_id: Option<i64>,
    canonical_name: Option<String>,
    rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedLineup {
    id: String,
    created_at: u64,
    input: serde_json::Value,
    result: serde_json::Value,
}

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

fn app_database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app_database_dir(app)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建历史数据库目录：{error}"))?;

    let mut connection = Connection::open(directory.join("draw-history.sqlite3"))
        .map_err(|error| format!("无法打开本地数据库：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| format!("无法配置本地数据库：{error}"))?;
    migrate_database(&mut connection)?;
    Ok(connection)
}

fn app_database_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // 仅 Debug 构建允许把自动化测试数据库隔离到工作区，Release 始终使用正式数据目录。
    #[cfg(debug_assertions)]
    if let Some(directory) =
        std::env::var_os("FORTUNA_TEST_DATA_DIR").filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(directory));
    }

    let app_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位历史数据库目录：{error}"))?;
    Ok(app_directory
        .parent()
        .map(|parent| parent.join(SHARED_DATA_DIRECTORY))
        .unwrap_or(app_directory))
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

fn validate_variant(variant: &str) -> Result<&str, String> {
    match variant {
        "standard" | "caimi" => Ok(variant),
        _ => Err("应用版本不合法".to_string()),
    }
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
        let changed = transaction
            .execute(
                "UPDATE user SET name = ?1, rank = ?2 WHERE id = ?3",
                params![name, rank, id],
            )
            .map_err(|error| format!("无法更新排名选项：{error}"))?;
        if changed == 0 {
            return Err("找不到要更新的排名选项".to_string());
        }
        let canonical_alias_changed = transaction
            .execute(
                "UPDATE alias SET name = ?1
                 WHERE user_id = ?2 AND name = ?3 COLLATE NOCASE",
                params![name, id, previous_name],
            )
            .map_err(|error| format!("名称或别名“{name}”已经被使用：{error}"))?;
        if canonical_alias_changed == 0 {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![name, id],
                )
                .map_err(|error| format!("名称或别名“{name}”已经被使用：{error}"))?;
        }

        for alias in aliases.into_iter().skip(1) {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![alias, id],
                )
                .map_err(|error| format!("名称或别名“{alias}”已经被使用：{error}"))?;
        }
        id
    } else {
        transaction
            .execute(
                "INSERT INTO user (name, rank) VALUES (?1, ?2)",
                params![name, rank],
            )
            .map_err(|error| format!("无法添加排名选项：{error}"))?;
        let id = transaction.last_insert_rowid();
        for alias in aliases {
            transaction
                .execute(
                    "INSERT INTO alias (name, user_id) VALUES (?1, ?2)",
                    params![alias, id],
                )
                .map_err(|error| format!("名称或别名“{alias}”已经被使用：{error}"))?;
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
        .map_err(|error| format!("无法添加别名“{alias}”：{error}"))?;
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
fn save_draw_history(app: AppHandle, variant: String, draw: SavedDraw) -> Result<(), String> {
    let connection = app_database(&app)?;
    save_draw_history_in(&connection, &variant, &draw)
}

fn list_draw_histories_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<SavedDraw>, String> {
    let variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT payload_json FROM draw_history
             WHERE variant = ?1 ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取历史数据库：{error}"))?;
    let rows = statement
        .query_map(params![variant], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询抽奖历史：{error}"))?;

    let mut histories = Vec::new();
    for payload in rows.flatten() {
        if let Ok(draw) = serde_json::from_str::<SavedDraw>(&payload) {
            histories.push(draw);
        }
    }
    Ok(histories)
}

#[tauri::command]
fn list_draw_histories(app: AppHandle, variant: String) -> Result<Vec<SavedDraw>, String> {
    let connection = app_database(&app)?;
    list_draw_histories_in(&connection, &variant)
}

#[tauri::command]
fn delete_draw_history(app: AppHandle, variant: String, id: String) -> Result<(), String> {
    let variant = validate_variant(&variant)?;
    if !valid_selection_id(&id) {
        return Err("抽奖记录编号不合法".to_string());
    }
    let connection = app_database(&app)?;
    connection
        .execute(
            "DELETE FROM draw_history WHERE id = ?1 AND variant = ?2",
            params![id, variant],
        )
        .map_err(|error| format!("无法删除抽奖记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn clear_draw_histories(app: AppHandle, variant: String) -> Result<(), String> {
    let variant = validate_variant(&variant)?;
    let connection = app_database(&app)?;
    connection
        .execute(
            "DELETE FROM draw_history WHERE variant = ?1",
            params![variant],
        )
        .map_err(|error| format!("无法清空抽奖历史：{error}"))?;
    Ok(())
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
fn save_ranked_user(app: AppHandle, user: RankedUserInput) -> Result<RankedUser, String> {
    let mut connection = app_database(&app)?;
    save_ranked_user_in(&mut connection, user)
}

#[tauri::command]
fn add_ranked_user_alias(
    app: AppHandle,
    user_id: i64,
    alias: String,
) -> Result<RankedUser, String> {
    let connection = app_database(&app)?;
    add_ranked_user_alias_in(&connection, user_id, alias)
}

#[tauri::command]
fn clear_ranked_user_aliases(app: AppHandle, user_id: i64) -> Result<RankedUser, String> {
    let connection = app_database(&app)?;
    clear_ranked_user_aliases_in(&connection, user_id)
}

#[tauri::command]
fn list_ranked_users(app: AppHandle) -> Result<Vec<RankedUser>, String> {
    let connection = app_database(&app)?;
    list_ranked_users_in(&connection)
}

#[tauri::command]
fn move_ranked_user(
    app: AppHandle,
    dragged_id: i64,
    target: RankedUserDropTargetInput,
) -> Result<Vec<RankedUser>, String> {
    let mut connection = app_database(&app)?;
    move_ranked_user_in(&mut connection, dragged_id, target)
}

#[tauri::command]
fn delete_ranked_user(app: AppHandle, id: i64) -> Result<(), String> {
    let mut connection = app_database(&app)?;
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
}

fn resolve_lineup_names_in(
    connection: &Connection,
    names: Vec<String>,
) -> Result<Vec<ResolvedLineupName>, String> {
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
                Some((user_id, canonical_name, rank)) => ResolvedLineupName {
                    input_name,
                    known: true,
                    user_id: Some(user_id),
                    canonical_name: Some(canonical_name),
                    rank: Some(rank),
                },
                None => ResolvedLineupName {
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
fn resolve_lineup_names(
    app: AppHandle,
    names: Vec<String>,
) -> Result<Vec<ResolvedLineupName>, String> {
    let connection = app_database(&app)?;
    resolve_lineup_names_in(&connection, names)
}

fn save_lineup_history_in(
    connection: &Connection,
    variant: &str,
    lineup: &SavedLineup,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    if !valid_selection_id(&lineup.id) {
        return Err("分组记录编号不合法".to_string());
    }
    if lineup.input.is_null() || lineup.result.is_null() {
        return Err("分组记录内容不合法".to_string());
    }
    let created_at =
        i64::try_from(lineup.created_at).map_err(|_| "分组记录时间不合法".to_string())?;
    let input_json = serde_json::to_string(&lineup.input)
        .map_err(|error| format!("无法序列化分组输入：{error}"))?;
    let result_json = serde_json::to_string(&lineup.result)
        .map_err(|error| format!("无法序列化分组结果：{error}"))?;
    connection
        .execute(
            "INSERT INTO lineup_history (id, created_at, input_json, result_json, variant)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               created_at = excluded.created_at,
               input_json = excluded.input_json,
               result_json = excluded.result_json,
               variant = excluded.variant",
            params![lineup.id, created_at, input_json, result_json, variant],
        )
        .map_err(|error| format!("无法保存分组记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn save_lineup_history(app: AppHandle, variant: String, lineup: SavedLineup) -> Result<(), String> {
    let connection = app_database(&app)?;
    save_lineup_history_in(&connection, &variant, &lineup)
}

fn list_lineup_histories_in(
    connection: &Connection,
    variant: &str,
) -> Result<Vec<SavedLineup>, String> {
    let variant = validate_variant(variant)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, input_json, result_json
             FROM lineup_history WHERE variant = ?1 ORDER BY created_at DESC",
        )
        .map_err(|error| format!("无法读取分组历史：{error}"))?;
    let rows = statement
        .query_map(params![variant], |row| {
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
        histories.push(SavedLineup {
            id,
            created_at: u64::try_from(created_at).map_err(|_| "分组记录时间不合法".to_string())?,
            input: serde_json::from_str(&input_json)
                .map_err(|error| format!("无法解析分组输入：{error}"))?,
            result: serde_json::from_str(&result_json)
                .map_err(|error| format!("无法解析分组结果：{error}"))?,
        });
    }
    Ok(histories)
}

#[tauri::command]
fn list_lineup_histories(app: AppHandle, variant: String) -> Result<Vec<SavedLineup>, String> {
    let connection = app_database(&app)?;
    list_lineup_histories_in(&connection, &variant)
}

#[tauri::command]
fn delete_lineup_history(app: AppHandle, variant: String, id: String) -> Result<(), String> {
    let variant = validate_variant(&variant)?;
    if !valid_selection_id(&id) {
        return Err("分组记录编号不合法".to_string());
    }
    let connection = app_database(&app)?;
    connection
        .execute(
            "DELETE FROM lineup_history WHERE id = ?1 AND variant = ?2",
            params![id, variant],
        )
        .map_err(|error| format!("无法删除分组记录：{error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
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
            list_ranked_users,
            move_ranked_user,
            delete_ranked_user,
            resolve_lineup_names,
            save_lineup_history,
            list_lineup_histories,
            delete_lineup_history,
            open_database_folder
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
    fn migrations_upgrade_legacy_database_and_are_idempotent() {
        let mut connection = Connection::open_in_memory().expect("创建内存数据库");
        connection
            .execute_batch(
                "CREATE TABLE draw_history (
                   id TEXT PRIMARY KEY NOT NULL,
                   created_at INTEGER NOT NULL,
                   payload_json TEXT NOT NULL
                 );",
            )
            .expect("创建旧版历史表");

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
            &["draw_history", "user", "alias", "lineup_history"],
        );
        assert_eq!(versions, vec![1, 2, 3, 4]);
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
            resolve_lineup_names_in(&connection, vec!["小星".to_string(), "陌生人".to_string()])
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
        assert_eq!(
            list_ranked_users_in(&connection).expect("读取排名").len(),
            1
        );
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
        let first = save("甲", Some(1));
        let second = save("乙", Some(2));
        let third = save("丙", None);
        drop(save);

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
    fn lineup_history_round_trips_json() {
        let connection = test_database();
        let lineup = SavedLineup {
            id: "lineup-1".to_string(),
            created_at: 1_700_000_000_000,
            input: serde_json::json!({"names": ["甲", "乙"], "groupCount": 2}),
            result: serde_json::json!({"tiers": [["甲", "乙"]]}),
        };

        let caimi_lineup = SavedLineup {
            id: "lineup-caimi".to_string(),
            created_at: lineup.created_at + 1,
            input: lineup.input.clone(),
            result: lineup.result.clone(),
        };
        save_lineup_history_in(&connection, "standard", &lineup).expect("保存普通版排阵历史");
        save_lineup_history_in(&connection, "caimi", &caimi_lineup).expect("保存猜蜜版排阵历史");
        let histories =
            list_lineup_histories_in(&connection, "standard").expect("读取普通版排阵历史");
        let caimi_histories =
            list_lineup_histories_in(&connection, "caimi").expect("读取猜蜜版排阵历史");

        assert_eq!(histories.len(), 1);
        assert_eq!(histories[0].id, lineup.id);
        assert_eq!(histories[0].input, lineup.input);
        assert_eq!(histories[0].result, lineup.result);
        assert_eq!(caimi_histories.len(), 1);
        assert_eq!(caimi_histories[0].id, caimi_lineup.id);
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

        assert_eq!(histories.len(), 1);
        assert_eq!(histories[0].id, draw.id);
        assert_eq!(histories[0].created_at, draw.created_at);
        assert_eq!(histories[0].mode, draw.mode);
        assert_eq!(histories[0].reward_amount, draw.reward_amount);
        assert_eq!(histories[0].prizes, draw.prizes);
        assert_eq!(histories[0].records, draw.records);
        assert_eq!(caimi_histories.len(), 1);
        assert_eq!(caimi_histories[0].id, caimi_draw.id);
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
