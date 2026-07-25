//! Tauri 命令与 Svelte 前端之间共享的序列化数据模型。
//!
//! 模型只描述传输格式，不包含数据库访问或业务流程。

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 保存到本地文件系统的常用抽奖配置。
pub(super) struct CommonSelection {
    pub(super) version: u8,
    pub(super) id: String,
    pub(super) name: String,
    pub(super) created_at: u64,
    pub(super) prizes: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 写入 SQLite 的单次抽奖历史快照。
pub(super) struct SavedDraw {
    pub(super) version: u8,
    pub(super) id: String,
    pub(super) created_at: u64,
    pub(super) mode: String,
    pub(super) reward_amount: f64,
    pub(super) prizes: serde_json::Value,
    pub(super) records: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 排名用户的一个可匹配别名。
pub(super) struct AliasRecord {
    pub(super) id: i64,
    pub(super) name: String,
    pub(super) user_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 带规范名称、排名和全部别名的用户。
pub(super) struct RankedUser {
    pub(super) id: i64,
    pub(super) name: String,
    pub(super) rank: i64,
    pub(super) aliases: Vec<AliasRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 新增或编辑排名用户时接收的参数。
pub(super) struct RankedUserInput {
    pub(super) id: Option<i64>,
    pub(super) name: String,
    pub(super) rank: Option<i64>,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 排名 JSON 全量导入时接收的用户结构。
pub(super) struct RankedUserTransferInput {
    pub(super) name: String,
    pub(super) rank: i64,
    pub(super) aliases: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
/// 拖动排名用户时的目标位置。
pub(super) enum RankedUserDropTargetInput {
    Insert { index: usize },
    Swap { user_id: i64 },
    Unranked,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 分组名单名称与排名库的解析结果。
pub(super) struct ResolvedLineupName {
    pub(super) input_name: String,
    pub(super) known: bool,
    pub(super) user_id: Option<i64>,
    pub(super) canonical_name: Option<String>,
    pub(super) rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 可导入、导出的分组历史快照。
pub(super) struct SavedLineup {
    pub(super) id: String,
    pub(super) created_at: u64,
    #[serde(default)]
    pub(super) title: Option<String>,
    pub(super) input: serde_json::Value,
    pub(super) result: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 保存到 SQLite 的对战历史快照。
pub(super) struct BattleHistory {
    pub(super) id: String,
    pub(super) created_at: u64,
    pub(super) updated_at: u64,
    #[serde(default)]
    pub(super) title: Option<String>,
    pub(super) snapshot: BattleTmpSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 前端与关系化临时表之间传输的完整对战快照。
pub(super) struct BattleTmpSnapshot {
    pub(super) version: u8,
    pub(super) rules_version: u8,
    pub(super) kind: String,
    pub(super) variant: String,
    pub(super) updated_at: u64,
    pub(super) format: String,
    pub(super) order_mode: String,
    pub(super) participant_count: usize,
    pub(super) bracket_size: usize,
    pub(super) fixed_seed_count: usize,
    pub(super) participants: Vec<BattleTmpParticipant>,
    pub(super) matches: Vec<BattleTmpMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 对战临时快照中的参赛者。
pub(super) struct BattleTmpParticipant {
    pub(super) id: usize,
    pub(super) name: String,
    pub(super) source_index: usize,
    pub(super) seed: usize,
    pub(super) group_index: Option<usize>,
    pub(super) group_rank: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// 对战临时快照中的一场比赛。
pub(super) struct BattleTmpMatch {
    pub(super) match_id: String,
    pub(super) stage: String,
    pub(super) level: usize,
    pub(super) position: usize,
    pub(super) up: Option<usize>,
    pub(super) down: Option<usize>,
    pub(super) up_result: Option<usize>,
    pub(super) down_result: Option<usize>,
    pub(super) status: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn common_selection_uses_frontend_camel_case_fields() {
        let selection = CommonSelection {
            version: 1,
            id: "daily".to_string(),
            name: "每日名单".to_string(),
            created_at: 123,
            prizes: json!([]),
        };

        let value = serde_json::to_value(selection).expect("序列化常用选择");

        assert_eq!(value["createdAt"], 123);
        assert!(value.get("created_at").is_none());
    }

    #[test]
    fn ranking_drop_target_accepts_tagged_frontend_payload() {
        let target: RankedUserDropTargetInput =
            serde_json::from_value(json!({ "kind": "swap", "userId": 42 }))
                .expect("解析排名拖放目标");

        assert!(matches!(
            target,
            RankedUserDropTargetInput::Swap { user_id: 42 }
        ));
    }
}
