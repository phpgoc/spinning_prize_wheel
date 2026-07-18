use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

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

fn draw_history_database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位历史数据库目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建历史数据库目录：{error}"))?;

    let connection = Connection::open(directory.join("draw-history.sqlite3"))
        .map_err(|error| format!("无法打开历史数据库：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| format!("无法配置历史数据库：{error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS draw_history (
               id TEXT PRIMARY KEY NOT NULL,
               created_at INTEGER NOT NULL,
               payload_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS draw_history_created_at
             ON draw_history(created_at DESC);",
        )
        .map_err(|error| format!("无法初始化历史数据库：{error}"))?;
    Ok(connection)
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
    selections.sort_by(|left, right| right.created_at.cmp(&left.created_at));
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

#[tauri::command]
fn save_draw_history(app: AppHandle, draw: SavedDraw) -> Result<(), String> {
    if !valid_selection_id(&draw.id) {
        return Err("抽奖记录编号不合法".to_string());
    }
    if draw.mode != "selected" && draw.mode != "roulette" {
        return Err("抽奖模式不合法".to_string());
    }
    if !draw.prizes.is_array() || !draw.records.is_array() {
        return Err("抽奖记录内容不合法".to_string());
    }

    let created_at = i64::try_from(draw.created_at).map_err(|_| "抽奖时间不合法".to_string())?;
    let payload =
        serde_json::to_string(&draw).map_err(|error| format!("无法序列化抽奖记录：{error}"))?;
    let connection = draw_history_database(&app)?;
    connection
        .execute(
            "INSERT INTO draw_history (id, created_at, payload_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               created_at = excluded.created_at,
               payload_json = excluded.payload_json",
            params![draw.id, created_at, payload],
        )
        .map_err(|error| format!("无法保存抽奖记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn list_draw_histories(app: AppHandle) -> Result<Vec<SavedDraw>, String> {
    let connection = draw_history_database(&app)?;
    let mut statement = connection
        .prepare("SELECT payload_json FROM draw_history ORDER BY created_at DESC")
        .map_err(|error| format!("无法读取历史数据库：{error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
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
fn delete_draw_history(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_selection_id(&id) {
        return Err("抽奖记录编号不合法".to_string());
    }
    let connection = draw_history_database(&app)?;
    connection
        .execute("DELETE FROM draw_history WHERE id = ?1", params![id])
        .map_err(|error| format!("无法删除抽奖记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn clear_draw_histories(app: AppHandle) -> Result<(), String> {
    let connection = draw_history_database(&app)?;
    connection
        .execute("DELETE FROM draw_history", [])
        .map_err(|error| format!("无法清空抽奖历史：{error}"))?;
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
            clear_draw_histories
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Fortuna");
}
