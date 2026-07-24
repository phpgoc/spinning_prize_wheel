// 对战临时状态的关系化存储、校验和赛果传播。
//
// 该文件通过 `include!` 引入 crate 根模块，以便 Tauri 命令保持原有路径，
// 同时将高耦合的签表拓扑逻辑与排名、抽奖历史等数据库代码隔离。

/// 检查临时表是否存在；首次进入非对战功能时不主动创建表。
fn battle_tmp_table_exists(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_master
               WHERE type = 'table' AND name = 'battle_tmp'
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("无法检查对战临时表：{error}"))
}

/// 按需创建对战主表、参赛者表和场次表。
fn ensure_battle_tmp_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS battle_tmp (
               id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
               variant TEXT NOT NULL CHECK (variant IN ('standard', 'caimi')),
               rules_version INTEGER NOT NULL CHECK (rules_version = 1),
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
             );",
        )
        .map_err(|error| format!("无法创建关系化对战临时表：{error}"))
        .and_then(|_| {
            let has_history_saved = connection
                .prepare("PRAGMA table_info(battle_tmp)")
                .map_err(|error| format!("无法读取对战临时表结构：{error}"))?
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| format!("无法读取对战临时表字段：{error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法解析对战临时表字段：{error}"))?
                .iter()
                .any(|column| column == "history_saved");
            if !has_history_saved {
                connection
                    .execute(
                        "ALTER TABLE battle_tmp ADD COLUMN history_saved INTEGER NOT NULL DEFAULT 0 CHECK (history_saved IN (0, 1))",
                        [],
                    )
                    .map_err(|error| format!("无法升级对战临时表：{error}"))?;
            }
            Ok(())
        })
}

/// 在写入数据库前完整校验前端快照，避免非法引用进入关系化表。
fn validate_battle_tmp_snapshot(variant: &str, state: &BattleTmpSnapshot) -> Result<(), String> {
    if state.kind != "battle-tmp"
        || state.version != 1
        || state.rules_version != 1
        || state.variant != variant
        || state.updated_at == 0
        || !matches!(
            state.format.as_str(),
            "avoid-first-pair" | "single-elimination" | "double-elimination"
        )
        || !matches!(state.order_mode.as_str(), "rank" | "input")
        || state.participant_count < 2
        || state.participants.len() != state.participant_count
        || state.bracket_size < state.participant_count
        || state.fixed_seed_count > state.participant_count
        || state.matches.is_empty()
    {
        return Err("对战临时状态格式不合法".to_string());
    }

    let mut participant_ids = HashSet::new();
    let mut source_indexes = HashSet::new();
    for participant in &state.participants {
        if participant.id == 0
            || participant.name.trim().is_empty()
            || participant.seed == 0
            || !participant_ids.insert(participant.id)
            || !source_indexes.insert(participant.source_index)
            || !matches!(participant.group_rank, None | Some(1) | Some(2))
        {
            return Err("对战临时状态参赛者不合法".to_string());
        }
    }

    let match_ids = state
        .matches
        .iter()
        .map(|battle_match| battle_match.match_id.as_str())
        .collect::<HashSet<_>>();
    let coordinates = state
        .matches
        .iter()
        .map(|battle_match| {
            (
                battle_match.stage.as_str(),
                battle_match.level,
                battle_match.position,
            )
        })
        .collect::<HashSet<_>>();
    if match_ids.len() != state.matches.len() || coordinates.len() != state.matches.len() {
        return Err("对战临时状态场次编号或位置重复".to_string());
    }

    for battle_match in &state.matches {
        if battle_match.match_id.is_empty()
            || battle_match.match_id
                != expected_battle_tmp_match_id(
                    &battle_match.stage,
                    battle_match.level,
                    battle_match.position,
                )
            || battle_match.level == 0
            || battle_match.position == 0
            || !matches!(
                battle_match.stage.as_str(),
                "pairing" | "single" | "winner" | "loser" | "final"
            )
            || !matches!(
                battle_match.status.as_str(),
                "pending" | "ready" | "completed" | "skipped"
            )
        {
            return Err("对战临时状态场次不合法".to_string());
        }
        for participant_id in [battle_match.up, battle_match.down].into_iter().flatten() {
            if !participant_ids.contains(&participant_id) {
                return Err("对战临时状态引用了不存在的参赛者".to_string());
            }
        }
        if (battle_match.up.is_none() && battle_match.up_result.is_some())
            || (battle_match.down.is_none() && battle_match.down_result.is_some())
        {
            return Err("等待上游的签位不能填写比分".to_string());
        }
    }
    Ok(())
}

fn expected_battle_tmp_match_id(stage: &str, level: usize, position: usize) -> String {
    match stage {
        "pairing" => format!("P-R{level}-M{position}"),
        "single" => format!("S{level}-M{position}"),
        "winner" => format!("W{level}-M{position}"),
        "loser" => format!("L{level}-M{position}"),
        "final" if level == 1 => format!("GF-M{position}"),
        "final" => format!("GF-RESET-M{position}"),
        _ => String::new(),
    }
}

/// 使用单个事务替换当前临时签表，任一参赛者或场次写入失败都会整体回滚。
#[cfg(test)]
fn save_battle_tmp_state_in(
    connection: &Connection,
    variant: &str,
    state: &BattleTmpSnapshot,
) -> Result<(), String> {
    save_battle_tmp_state_with_history_in(connection, variant, state, false)
}

fn save_battle_tmp_state_with_history_in(
    connection: &Connection,
    variant: &str,
    state: &BattleTmpSnapshot,
    history_saved: bool,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    validate_battle_tmp_snapshot(variant, state)?;
    ensure_battle_tmp_tables(connection)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("无法开始保存对战临时状态：{error}"))?;
    transaction
        .execute("DELETE FROM battle_tmp WHERE id = 1", [])
        .map_err(|error| format!("无法替换旧对战临时状态：{error}"))?;
    transaction
        .execute(
            "INSERT INTO battle_tmp (
               id, variant, rules_version, updated_at, format, order_mode,
               history_saved, participant_count, bracket_size, fixed_seed_count
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                variant,
                state.rules_version,
                db_u64(state.updated_at, "对战临时状态时间")?,
                state.format,
                state.order_mode,
                i64::from(history_saved),
                db_usize(state.participant_count, "参赛人数")?,
                db_usize(state.bracket_size, "签位数量")?,
                db_usize(state.fixed_seed_count, "固定人数")?,
            ],
        )
        .map_err(|error| format!("无法保存对战临时状态元数据：{error}"))?;
    for participant in &state.participants {
        transaction
            .execute(
                "INSERT INTO battle_tmp_participant (
                   state_id, participant_id, name, source_index, seed, group_index, group_rank
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    db_usize(participant.id, "参赛者编号")?,
                    participant.name,
                    db_usize(participant.source_index, "参赛者来源位置")?,
                    db_usize(participant.seed, "参赛者顺位")?,
                    db_optional_usize(participant.group_index, "参赛者组号")?,
                    participant.group_rank.map(i64::from),
                ],
            )
            .map_err(|error| format!("无法保存对战参赛者：{error}"))?;
    }
    for battle_match in &state.matches {
        transaction
            .execute(
                "INSERT INTO battle_tmp_match (
                   state_id, match_id, stage, level, position, up, down,
                   up_result, down_result, status
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    battle_match.match_id,
                    battle_match.stage,
                    db_usize(battle_match.level, "对战层级")?,
                    db_usize(battle_match.position, "对战位置")?,
                    db_optional_usize(battle_match.up, "上方参赛者")?,
                    db_optional_usize(battle_match.down, "下方参赛者")?,
                    db_optional_usize(battle_match.up_result, "上方比分")?,
                    db_optional_usize(battle_match.down_result, "下方比分")?,
                    battle_match.status,
                ],
            )
            .map_err(|error| format!("无法保存对战场次：{error}"))?;
    }
    let topology = battle_tmp_topology_in(&transaction)?;
    for battle_match in &state.matches {
        for source in [
            battle_tmp_slot_source(&topology, battle_match, true)?,
            battle_tmp_slot_source(&topology, battle_match, false)?,
        ]
        .into_iter()
        .flatten()
        {
            if load_battle_tmp_match_in(&transaction, &source.match_id)?.is_none() {
                return Err(format!("固定路线缺少上游场次 {}", source.match_id));
            }
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交对战临时状态：{error}"))
}

fn load_battle_tmp_state_in(
    connection: &Connection,
    variant: &str,
) -> Result<Option<BattleTmpSnapshot>, String> {
    let variant = validate_variant(variant)?;
    if !battle_tmp_table_exists(connection)? {
        return Ok(None);
    }
    let metadata = connection
        .query_row(
            "SELECT rules_version, updated_at, format, order_mode, participant_count, bracket_size, fixed_seed_count
             FROM battle_tmp WHERE id = 1 AND variant = ?1",
            params![variant],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("无法读取对战临时状态：{error}"))?;
    let Some((
        rules_version,
        updated_at,
        format,
        order_mode,
        participant_count,
        bracket_size,
        fixed_seed_count,
    )) = metadata
    else {
        return Ok(None);
    };
    let participants = load_battle_tmp_participants(connection)?;
    let matches = load_battle_tmp_matches(connection)?;
    Ok(Some(BattleTmpSnapshot {
        version: 1,
        rules_version: u8::try_from(rules_version)
            .map_err(|_| "对战临时状态规则版本不合法".to_string())?,
        kind: "battle-tmp".to_string(),
        variant: variant.to_string(),
        updated_at: u64::try_from(updated_at).map_err(|_| "对战临时状态时间不合法".to_string())?,
        format,
        order_mode,
        participant_count: db_to_usize(participant_count, "参赛人数")?,
        bracket_size: db_to_usize(bracket_size, "签位数量")?,
        fixed_seed_count: db_to_usize(fixed_seed_count, "固定人数")?,
        participants,
        matches,
    }))
}

fn load_battle_tmp_participants(
    connection: &Connection,
) -> Result<Vec<BattleTmpParticipant>, String> {
    let mut statement = connection
        .prepare(
            "SELECT participant_id, name, source_index, seed, group_index, group_rank
             FROM battle_tmp_participant WHERE state_id = 1 ORDER BY participant_id",
        )
        .map_err(|error| format!("无法准备读取对战参赛者：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|error| format!("无法读取对战参赛者：{error}"))?;
    rows.map(|row| {
        let (id, name, source_index, seed, group_index, group_rank) =
            row.map_err(|error| format!("无法解析对战参赛者：{error}"))?;
        Ok(BattleTmpParticipant {
            id: db_to_usize(id, "参赛者编号")?,
            name,
            source_index: db_to_usize(source_index, "参赛者来源位置")?,
            seed: db_to_usize(seed, "参赛者顺位")?,
            group_index: db_optional_to_usize(group_index, "参赛者组号")?,
            group_rank: group_rank
                .map(|value| u8::try_from(value).map_err(|_| "参赛者组内名次不合法".to_string()))
                .transpose()?,
        })
    })
    .collect()
}

fn load_battle_tmp_matches(connection: &Connection) -> Result<Vec<BattleTmpMatch>, String> {
    let mut statement = connection
        .prepare(
            "SELECT match_id, stage, level, position, up, down, up_result, down_result, status
             FROM battle_tmp_match
             WHERE state_id = 1
             ORDER BY CASE stage
               WHEN 'pairing' THEN 0 WHEN 'single' THEN 1 WHEN 'winner' THEN 2
               WHEN 'loser' THEN 3 ELSE 4 END,
               level, position",
        )
        .map_err(|error| format!("无法准备读取对战场次：{error}"))?;
    let rows = statement
        .query_map([], battle_tmp_match_from_row)
        .map_err(|error| format!("无法读取对战场次：{error}"))?;
    rows.map(|row| row.map_err(|error| format!("无法解析对战场次：{error}")))
        .collect()
}

fn battle_tmp_match_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BattleTmpMatch> {
    Ok(BattleTmpMatch {
        match_id: row.get(0)?,
        stage: row.get(1)?,
        level: usize::try_from(row.get::<_, i64>(2)?).unwrap_or(usize::MAX),
        position: usize::try_from(row.get::<_, i64>(3)?).unwrap_or(usize::MAX),
        up: row
            .get::<_, Option<i64>>(4)?
            .and_then(|value| usize::try_from(value).ok()),
        down: row
            .get::<_, Option<i64>>(5)?
            .and_then(|value| usize::try_from(value).ok()),
        up_result: row
            .get::<_, Option<i64>>(6)?
            .and_then(|value| usize::try_from(value).ok()),
        down_result: row
            .get::<_, Option<i64>>(7)?
            .and_then(|value| usize::try_from(value).ok()),
        status: row.get(8)?,
    })
}

fn load_battle_tmp_match_in(
    connection: &Connection,
    match_id: &str,
) -> Result<Option<BattleTmpMatch>, String> {
    connection
        .query_row(
            "SELECT match_id, stage, level, position, up, down, up_result, down_result, status
             FROM battle_tmp_match
             WHERE state_id = 1 AND match_id = ?1",
            params![match_id],
            battle_tmp_match_from_row,
        )
        .optional()
        .map_err(|error| format!("无法读取对战场次：{error}"))
}

#[derive(Clone, Copy)]
/// 下游签位需要读取上游的胜者还是败者。
enum BattleTmpSourceOutcome {
    Winner,
    Loser,
}

/// 一个签位的固定上游来源。
struct BattleTmpSource {
    match_id: String,
    outcome: BattleTmpSourceOutcome,
}

/// 从当前签表汇总出的拓扑边界，用于计算各阶段的固定路线。
struct BattleTmpTopology {
    bracket_size: usize,
    single_max_level: usize,
    winner_max_level: usize,
    loser_max_level: usize,
}

fn battle_tmp_topology_in(connection: &Connection) -> Result<BattleTmpTopology, String> {
    connection
        .query_row(
            "SELECT bracket_size,
                    COALESCE(MAX(CASE WHEN battle_tmp_match.stage = 'single' THEN level END), 0),
                    COALESCE(MAX(CASE WHEN battle_tmp_match.stage = 'winner' THEN level END), 0),
                    COALESCE(MAX(CASE WHEN battle_tmp_match.stage = 'loser' THEN level END), 0)
             FROM battle_tmp
             LEFT JOIN battle_tmp_match ON battle_tmp_match.state_id = battle_tmp.id
             WHERE battle_tmp.id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|error| format!("无法读取对战固定路线：{error}"))
        .and_then(
            |(bracket_size, single_max_level, winner_max_level, loser_max_level)| {
                Ok(BattleTmpTopology {
                    bracket_size: db_to_usize(bracket_size, "签位数量")?,
                    single_max_level: db_to_usize(single_max_level, "单败最大层级")?,
                    winner_max_level: db_to_usize(winner_max_level, "胜者组最大层级")?,
                    loser_max_level: db_to_usize(loser_max_level, "败者组最大层级")?,
                })
            },
        )
}

/// 根据赛制、轮次和位置计算指定签位的唯一上游来源。
fn battle_tmp_slot_source(
    topology: &BattleTmpTopology,
    battle_match: &BattleTmpMatch,
    up_slot: bool,
) -> Result<Option<BattleTmpSource>, String> {
    let slot_offset = usize::from(!up_slot);
    let source = match battle_match.stage.as_str() {
        "pairing" => None,
        "single" | "winner" if battle_match.level == 1 => None,
        "single" | "winner" => {
            let prefix = if battle_match.stage == "single" {
                "S"
            } else {
                "W"
            };
            Some(BattleTmpSource {
                match_id: format!(
                    "{}{level}-M{}",
                    prefix,
                    (battle_match.position - 1) * 2 + slot_offset + 1,
                    level = battle_match.level - 1,
                ),
                outcome: BattleTmpSourceOutcome::Winner,
            })
        }
        "loser" if topology.bracket_size == 2 && battle_match.level == 1 => {
            up_slot.then(|| BattleTmpSource {
                match_id: "W1-M1".to_string(),
                outcome: BattleTmpSourceOutcome::Loser,
            })
        }
        "loser" if battle_match.level == 1 => Some(BattleTmpSource {
            match_id: format!("W1-M{}", (battle_match.position - 1) * 2 + slot_offset + 1),
            outcome: BattleTmpSourceOutcome::Loser,
        }),
        "loser" if battle_match.level.is_multiple_of(2) && up_slot => Some(BattleTmpSource {
            match_id: format!("L{}-M{}", battle_match.level - 1, battle_match.position),
            outcome: BattleTmpSourceOutcome::Winner,
        }),
        "loser" if battle_match.level.is_multiple_of(2) => {
            let winner_level = battle_match.level / 2 + 1;
            let winner_match_count = (topology.bracket_size >> winner_level).max(1);
            let crossed_position = if winner_match_count == 1 {
                battle_match.position
            } else if battle_match.position % 2 == 1 {
                battle_match.position + 1
            } else {
                battle_match.position - 1
            };
            Some(BattleTmpSource {
                match_id: format!("W{winner_level}-M{crossed_position}"),
                outcome: BattleTmpSourceOutcome::Loser,
            })
        }
        "loser" => Some(BattleTmpSource {
            match_id: format!(
                "L{}-M{}",
                battle_match.level - 1,
                (battle_match.position - 1) * 2 + slot_offset + 1
            ),
            outcome: BattleTmpSourceOutcome::Winner,
        }),
        "final" if battle_match.level == 1 && up_slot => Some(BattleTmpSource {
            match_id: format!("W{}-M1", topology.winner_max_level),
            outcome: BattleTmpSourceOutcome::Winner,
        }),
        "final" if battle_match.level == 1 => Some(BattleTmpSource {
            match_id: format!("L{}-M1", topology.loser_max_level),
            outcome: BattleTmpSourceOutcome::Winner,
        }),
        "final" if battle_match.level == 2 => Some(BattleTmpSource {
            match_id: "GF-M1".to_string(),
            outcome: if up_slot {
                BattleTmpSourceOutcome::Winner
            } else {
                BattleTmpSourceOutcome::Loser
            },
        }),
        _ => return Err("对战场次层级不符合固定路线".to_string()),
    };
    Ok(source)
}

fn battle_tmp_source_value_in(
    connection: &Connection,
    static_value: Option<usize>,
    source: Option<&BattleTmpSource>,
) -> Result<(bool, Option<usize>), String> {
    let Some(source) = source else {
        return Ok((true, static_value));
    };
    let source_match = load_battle_tmp_match_in(connection, &source.match_id)?
        .ok_or_else(|| "对战场次引用了不存在的上游".to_string())?;
    if source_match.status == "skipped" {
        return Ok((true, None));
    }
    if source_match.status != "completed" {
        return Ok((false, None));
    }
    match source.outcome {
        BattleTmpSourceOutcome::Winner => Ok((true, battle_tmp_winner(&source_match)?)),
        BattleTmpSourceOutcome::Loser => Ok((true, battle_tmp_loser(&source_match)?)),
    }
}

fn battle_tmp_winner(battle_match: &BattleTmpMatch) -> Result<Option<usize>, String> {
    if battle_match.status != "completed" {
        return Ok(None);
    }
    if battle_match.up.is_none() || battle_match.down.is_none() {
        return Ok(battle_match.up.or(battle_match.down));
    }
    match (battle_match.up_result, battle_match.down_result) {
        (Some(up_result), Some(down_result)) if up_result > down_result => Ok(battle_match.up),
        (Some(up_result), Some(down_result)) if down_result > up_result => Ok(battle_match.down),
        _ => Err("已完成的对战场次缺少有效比分".to_string()),
    }
}

fn battle_tmp_loser(battle_match: &BattleTmpMatch) -> Result<Option<usize>, String> {
    let Some(winner) = battle_tmp_winner(battle_match)? else {
        return Ok(None);
    };
    Ok(if battle_match.up == Some(winner) {
        battle_match.down
    } else {
        battle_match.up
    })
}

/// 从上游结果重算一场比赛；返回值表示数据库内容是否发生变化。
fn recompute_battle_tmp_match_in(
    connection: &Connection,
    topology: &BattleTmpTopology,
    match_id: &str,
) -> Result<bool, String> {
    let current = load_battle_tmp_match_in(connection, match_id)?
        .ok_or_else(|| "找不到需要重算的对战场次".to_string())?;
    let mut next = current.clone();
    let up_source = battle_tmp_slot_source(topology, &current, true)?;
    let down_source = battle_tmp_slot_source(topology, &current, false)?;

    let activation = if current.stage == "final" && current.level == 2 {
        let source = load_battle_tmp_match_in(connection, "GF-M1")?
            .ok_or_else(|| "对战场次引用了不存在的激活来源".to_string())?;
        if source.status != "completed" {
            "pending"
        } else if source.down.is_some() && battle_tmp_winner(&source)? == source.down {
            "active"
        } else {
            "skipped"
        }
    } else {
        "active"
    };

    if activation != "active" {
        if up_source.is_some() {
            next.up = None;
        }
        if down_source.is_some() {
            next.down = None;
        }
        next.up_result = None;
        next.down_result = None;
        next.status = activation.to_string();
    } else {
        let (up_ready, up) =
            battle_tmp_source_value_in(connection, current.up, up_source.as_ref())?;
        let (down_ready, down) =
            battle_tmp_source_value_in(connection, current.down, down_source.as_ref())?;
        let participants_changed = next.up != up || next.down != down;
        next.up = up;
        next.down = down;
        if participants_changed {
            next.up_result = None;
            next.down_result = None;
        }
        if !up_ready || !down_ready {
            next.up_result = None;
            next.down_result = None;
            next.status = "pending".to_string();
        } else if up.is_none() && down.is_none() {
            // 空场也表示来源已经确定，必须继续把空值传播给下游。
            next.up_result = None;
            next.down_result = None;
            next.status = "skipped".to_string();
        } else if up.is_none() || down.is_none() {
            next.up_result = None;
            next.down_result = None;
            next.status = "completed".to_string();
        } else if matches!(
            (next.up_result, next.down_result),
            (Some(up_result), Some(down_result)) if up_result != down_result
        ) {
            next.status = "completed".to_string();
        } else {
            next.status = "ready".to_string();
        }
    }

    if next == current {
        return Ok(false);
    }
    connection
        .execute(
            "UPDATE battle_tmp_match
             SET up = ?1, down = ?2, up_result = ?3, down_result = ?4, status = ?5
             WHERE state_id = 1 AND match_id = ?6",
            params![
                db_optional_usize(next.up, "上方参赛者")?,
                db_optional_usize(next.down, "下方参赛者")?,
                db_optional_usize(next.up_result, "上方比分")?,
                db_optional_usize(next.down_result, "下方比分")?,
                next.status,
                match_id,
            ],
        )
        .map_err(|error| format!("无法更新下游对战场次：{error}"))?;
    Ok(true)
}

/// 列出一场比赛可能影响的直接下游，传播层由调用方按队列逐层推进。
fn battle_tmp_dependents_in(
    connection: &Connection,
    topology: &BattleTmpTopology,
    source_match_id: &str,
) -> Result<Vec<String>, String> {
    let source = load_battle_tmp_match_in(connection, source_match_id)?
        .ok_or_else(|| "找不到需要传播的对战场次".to_string())?;
    let mut candidates = match source.stage.as_str() {
        "pairing" => Vec::new(),
        "single" if source.level < topology.single_max_level => vec![format!(
            "S{}-M{}",
            source.level + 1,
            source.position.div_ceil(2)
        )],
        "single" => Vec::new(),
        "winner" => {
            let winner_target = if source.level < topology.winner_max_level {
                format!("W{}-M{}", source.level + 1, source.position.div_ceil(2))
            } else {
                "GF-M1".to_string()
            };
            let loser_target = if source.level == 1 {
                format!("L1-M{}", source.position.div_ceil(2))
            } else {
                let loser_level = source.level * 2 - 2;
                let winner_match_count = (topology.bracket_size >> source.level).max(1);
                let crossed_position = if winner_match_count == 1 {
                    source.position
                } else if source.position % 2 == 1 {
                    source.position + 1
                } else {
                    source.position - 1
                };
                format!("L{loser_level}-M{crossed_position}")
            };
            vec![winner_target, loser_target]
        }
        "loser" if source.level == topology.loser_max_level => vec!["GF-M1".to_string()],
        "loser" if source.level % 2 == 1 => {
            vec![format!("L{}-M{}", source.level + 1, source.position)]
        }
        "loser" => vec![format!(
            "L{}-M{}",
            source.level + 1,
            source.position.div_ceil(2)
        )],
        "final" if source.level == 1 => vec!["GF-RESET-M1".to_string()],
        "final" => Vec::new(),
        _ => return Err("对战场次阶段不符合固定路线".to_string()),
    };
    candidates.sort();
    candidates.dedup();
    let mut existing_candidates = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if load_battle_tmp_match_in(connection, &candidate)?.is_none() {
            if source.stage == "final" && source.level == 1 && candidate == "GF-RESET-M1" {
                continue;
            }
            return Err(format!("固定路线缺少下游场次 {candidate}"));
        }
        existing_candidates.push(candidate);
    }
    Ok(existing_candidates)
}

/// 下游已经录入比分时锁定对应的上游结果，防止签表产生矛盾。
fn battle_tmp_score_locked_in(
    connection: &Connection,
    topology: &BattleTmpTopology,
    source: &BattleTmpMatch,
    up_slot: bool,
) -> Result<bool, String> {
    let participant = if up_slot { source.up } else { source.down };
    let Some(participant) = participant else {
        return Ok(false);
    };
    let outcome = if battle_tmp_winner(source)? == Some(participant) {
        BattleTmpSourceOutcome::Winner
    } else if battle_tmp_loser(source)? == Some(participant) {
        BattleTmpSourceOutcome::Loser
    } else {
        return Ok(false);
    };
    for dependent_id in battle_tmp_dependents_in(connection, topology, &source.match_id)? {
        let Some(dependent) = load_battle_tmp_match_in(connection, &dependent_id)? else {
            continue;
        };
        for dependent_up_slot in [true, false] {
            let dependent_source = battle_tmp_slot_source(topology, &dependent, dependent_up_slot)?;
            let result = if dependent_up_slot {
                dependent.up_result
            } else {
                dependent.down_result
            };
            if dependent_source.is_some_and(|candidate| {
                candidate.match_id == source.match_id
                    && std::mem::discriminant(&candidate.outcome)
                        == std::mem::discriminant(&outcome)
            }) && result.is_some()
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// 原子更新赛果并沿固定拓扑传播，最终返回数据库中的完整最新快照。
fn update_battle_tmp_result_in(
    connection: &Connection,
    variant: &str,
    match_id: &str,
    up_result: Option<usize>,
    down_result: Option<usize>,
    updated_at: u64,
) -> Result<BattleTmpSnapshot, String> {
    let variant = validate_variant(variant)?;
    if updated_at == 0 || !battle_tmp_table_exists(connection)? {
        return Err("当前没有可更新的对战临时状态".to_string());
    }
    let current_variant = connection
        .query_row("SELECT variant FROM battle_tmp WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|error| format!("无法读取对战临时状态版本：{error}"))?;
    if current_variant.as_deref() != Some(variant) {
        return Err("当前没有可更新的对战临时状态".to_string());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("无法开始更新对战结果：{error}"))?;
    let selected = load_battle_tmp_match_in(&transaction, match_id)?
        .ok_or_else(|| "找不到对战场次".to_string())?;
    if matches!(selected.status.as_str(), "pending" | "skipped") {
        return Err("当前场次尚不能填写赛果".to_string());
    }
    if (selected.up.is_none() && up_result.is_some())
        || (selected.down.is_none() && down_result.is_some())
    {
        return Err("等待上游的签位不能填写比分".to_string());
    }
    let topology = battle_tmp_topology_in(&transaction)?;
    if (battle_tmp_score_locked_in(&transaction, &topology, &selected, true)?
        && up_result != selected.up_result)
        || (battle_tmp_score_locked_in(&transaction, &topology, &selected, false)?
            && down_result != selected.down_result)
    {
        return Err("下游已有比分，不能修改上游".to_string());
    }
    transaction
        .execute(
            "UPDATE battle_tmp_match SET up_result = ?1, down_result = ?2
             WHERE state_id = 1 AND match_id = ?3",
            params![
                db_optional_usize(up_result, "上方比分")?,
                db_optional_usize(down_result, "下方比分")?,
                match_id,
            ],
        )
        .map_err(|error| format!("无法更新对战结果：{error}"))?;

    let match_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM battle_tmp_match WHERE state_id = 1",
            [],
            |row| row.get::<_, usize>(0),
        )
        .map_err(|error| format!("无法统计对战场次：{error}"))?;
    let mut queue = VecDeque::from([match_id.to_string()]);
    let mut processed = 0usize;
    while let Some(current_match_id) = queue.pop_front() {
        processed += 1;
        if processed > match_count.saturating_mul(8).max(8) {
            return Err("对战场次来源形成循环，无法更新赛果".to_string());
        }
        let changed = recompute_battle_tmp_match_in(&transaction, &topology, &current_match_id)?;
        if changed || current_match_id == match_id {
            queue.extend(battle_tmp_dependents_in(
                &transaction,
                &topology,
                &current_match_id,
            )?);
        }
    }
    transaction
        .execute(
            "UPDATE battle_tmp SET updated_at = ?1, history_saved = 0 WHERE id = 1",
            params![db_u64(updated_at, "对战临时状态时间")?],
        )
        .map_err(|error| format!("无法更新对战临时状态时间：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交对战结果：{error}"))?;
    load_battle_tmp_state_in(connection, variant)?
        .ok_or_else(|| "更新后无法读取对战临时状态".to_string())
}

fn battle_tmp_history_status_in(
    connection: &Connection,
    variant: &str,
) -> Result<Option<(u64, bool)>, String> {
    let variant = validate_variant(variant)?;
    if !battle_tmp_table_exists(connection)? {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT updated_at, history_saved FROM battle_tmp WHERE id = 1 AND variant = ?1",
            params![variant],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("无法读取对战历史保存状态：{error}"))?
        .map(|(updated_at, history_saved)| {
            Ok((
                u64::try_from(updated_at).map_err(|_| "对战临时状态时间不合法".to_string())?,
                history_saved,
            ))
        })
        .transpose()
}

fn mark_battle_tmp_history_saved_in(
    connection: &Connection,
    variant: &str,
    updated_at: u64,
) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    let changed = connection
        .execute(
            "UPDATE battle_tmp SET history_saved = 1
             WHERE id = 1 AND variant = ?1 AND updated_at = ?2",
            params![variant, db_u64(updated_at, "对战临时状态时间")?],
        )
        .map_err(|error| format!("无法标记对战历史保存状态：{error}"))?;
    if changed == 0 {
        return Err("当前对战临时状态已改变，无法标记历史".to_string());
    }
    Ok(())
}

fn clear_battle_tmp_state_in(connection: &Connection, variant: &str) -> Result<(), String> {
    let variant = validate_variant(variant)?;
    if !battle_tmp_table_exists(connection)? {
        return Ok(());
    }
    connection
        .execute(
            "DELETE FROM battle_tmp WHERE id = 1 AND variant = ?1",
            params![variant],
        )
        .map_err(|error| format!("无法清空对战临时状态：{error}"))?;
    Ok(())
}

#[tauri::command]
fn load_battle_tmp_history_status(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<Option<serde_json::Value>, String> {
    with_app_database(&app, &database, |connection| {
        battle_tmp_history_status_in(connection, &variant)
            .map(|status| status.map(|(updated_at, history_saved)| {
                serde_json::json!({ "updatedAt": updated_at, "historySaved": history_saved })
            }))
            .map_err(database_file_error)
    })
}

#[tauri::command]
fn mark_battle_tmp_history_saved(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    updated_at: u64,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        mark_battle_tmp_history_saved_in(connection, &variant, updated_at)
            .map_err(database_file_error)
    })
}

#[tauri::command]
fn save_battle_tmp_state(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    state: BattleTmpSnapshot,
    history_saved: Option<bool>,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        save_battle_tmp_state_with_history_in(
            connection,
            &variant,
            &state,
            history_saved.unwrap_or(false),
        )
        .map_err(database_file_error)
    })
}

#[tauri::command]
fn load_battle_tmp_state(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<Option<BattleTmpSnapshot>, String> {
    with_app_database(&app, &database, |connection| {
        load_battle_tmp_state_in(connection, &variant).map_err(database_file_error)
    })
}

#[tauri::command]
fn update_battle_tmp_result(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
    match_id: String,
    up_result: Option<usize>,
    down_result: Option<usize>,
    updated_at: u64,
) -> Result<BattleTmpSnapshot, String> {
    with_app_database(&app, &database, |connection| {
        update_battle_tmp_result_in(
            connection,
            &variant,
            &match_id,
            up_result,
            down_result,
            updated_at,
        )
        .map_err(database_file_error)
    })
}

fn db_usize(value: usize, label: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{label}不合法"))
}

fn db_u64(value: u64, label: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{label}不合法"))
}

fn db_optional_usize(value: Option<usize>, label: &str) -> Result<Option<i64>, String> {
    value.map(|item| db_usize(item, label)).transpose()
}

fn db_to_usize(value: i64, label: &str) -> Result<usize, String> {
    usize::try_from(value).map_err(|_| format!("{label}不合法"))
}

fn db_optional_to_usize(value: Option<i64>, label: &str) -> Result<Option<usize>, String> {
    value.map(|item| db_to_usize(item, label)).transpose()
}

#[tauri::command]
fn clear_battle_tmp_state(
    app: AppHandle,
    database: State<'_, DatabaseState>,
    variant: String,
) -> Result<(), String> {
    with_app_database(&app, &database, |connection| {
        clear_battle_tmp_state_in(connection, &variant).map_err(database_file_error)
    })
}
