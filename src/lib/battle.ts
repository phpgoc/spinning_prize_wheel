import type { AppVariant } from './app-variant';
import { isCaimiFavoredName } from './caimi';

export type BattleFormat = 'avoid-first-pair' | 'single-elimination' | 'double-elimination';
export type BattleOrderMode = 'rank' | 'input';
export type BattleBracket = 'pairing' | 'single' | 'winner' | 'loser' | 'final';

export interface BattleParticipant {
  name: string;
  sourceIndex: number;
  seed: number;
  groupIndex?: number;
  groupRank?: 1 | 2;
}

export interface BattlePosition {
  index: number;
  seedNumber: number;
  participant: BattleParticipant | null;
  fixed: boolean;
}

export type BattleEntrySource =
  | { kind: 'participant'; participant: BattleParticipant }
  | { kind: 'winner'; matchId: string }
  | { kind: 'loser'; matchId: string }
  | null;

export interface BattleMatch {
  id: string;
  bracket: BattleBracket;
  round: number;
  index: number;
  entries: [BattleEntrySource, BattleEntrySource];
}

export interface BattleRound {
  id: string;
  label: string;
  bracket: BattleBracket;
  round: number;
  matches: BattleMatch[];
}

export interface BattlePlan {
  version: 1;
  format: BattleFormat;
  orderMode: BattleOrderMode;
  participantCount: number;
  bracketSize: number;
  fixedSeedCount: number;
  positions: BattlePosition[];
  rounds: BattleRound[];
}

export type BattleTmpStatus = 'pending' | 'ready' | 'completed' | 'skipped';

export interface BattleTmpParticipant {
  id: number;
  name: string;
  sourceIndex: number;
  seed: number;
  groupIndex: number | null;
  groupRank: 1 | 2 | null;
}

export interface BattleTmpMatch {
  matchId: string;
  stage: BattleBracket;
  level: number;
  position: number;
  up: number | null;
  down: number | null;
  upResult: number | null;
  downResult: number | null;
  status: BattleTmpStatus;
}

export interface BattleTmpSnapshot {
  version: 1;
  rulesVersion: 1;
  kind: 'battle-tmp';
  createdAt: number;
  updatedAt: number;
  format: BattleFormat;
  orderMode: BattleOrderMode;
  participantCount: number;
  bracketSize: number;
  fixedSeedCount: number;
  participants: BattleTmpParticipant[];
  matches: BattleTmpMatch[];
}

/** 已保存的对战历史记录；签表内容与临时表共用同一份快照格式。 */
export interface BattleHistory {
  id: string;
  createdAt: number;
  /** 保存历史时临时签表的更新时间，存放在历史 payload 中。 */
  updatedAt: number;
  title?: string | null;
  snapshot: BattleTmpSnapshot;
}

export interface BattleHistoryListItem {
  id: string;
  createdAt: number;
  displayName: string;
  /** 仅兼容旧版运行时或测试 mock；正式列表接口不返回此字段。 */
  snapshot?: BattleTmpSnapshot;
  updatedAt?: number;
  title?: string | null;
}

/** 生成历史列表名称；保存时写入 display_name，避免列表读取签表 JSON。 */
export function battleHistoryTitle(snapshot: BattleTmpSnapshot, customTitle?: string | null): string {
  const title = customTitle?.trim();
  if (title) return title;
  const format = snapshot.format === 'avoid-first-pair'
    ? '同组不对战1对2'
    : snapshot.format === 'single-elimination'
      ? '单败'
      : '双败';
  return `${snapshot.participantCount} 人 · ${format}`;
}

export interface BattleTmpSlotOrigin {
  matchId: string;
  outcome: 'winner' | 'loser';
}

/** 根据赛制和签表层级生成用户可读的轮次名称。 */
export function battleRoundLabel(
  format: BattleFormat,
  stage: BattleBracket,
  level: number,
  matchCount: number,
): string {
  if (stage === 'pairing' || (format === 'avoid-first-pair' && stage === 'single' && level === 1)) {
    return '1对2';
  }
  if (stage === 'final') return level === 2 ? '重赛' : '总决赛';
  if (format === 'double-elimination' && (stage === 'winner' || stage === 'loser')) {
    return `第 ${level} 轮`;
  }
  if (matchCount === 1) return '决赛';
  if (matchCount === 2) return '半决赛';
  return `1/${matchCount}`;
}

export interface SeededBattleOptions {
  format: 'single-elimination' | 'double-elimination';
  orderMode: BattleOrderMode;
  fixedSeedCount: number;
  doubleGrandFinal?: boolean;
  caimiRankScores?: readonly number[];
  random?: () => number;
}

export function createBattleTmpSnapshot(
  _variant: AppVariant,
  plan: BattlePlan,
  updatedAt = Date.now(),
): BattleTmpSnapshot {
  const participants = plan.positions.flatMap((position) => position.participant ? [position.participant] : []);
  const uniqueParticipants = [...new Map(participants.map((participant) => [
    participant.sourceIndex,
    participant,
  ])).values()]
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((participant): BattleTmpParticipant => ({
      id: participant.sourceIndex + 1,
      name: participant.name,
      sourceIndex: participant.sourceIndex,
      seed: participant.seed,
      groupIndex: participant.groupIndex ?? null,
      groupRank: participant.groupRank ?? null,
    }));
  const snapshot: BattleTmpSnapshot = {
    version: 1,
    rulesVersion: 1,
    kind: 'battle-tmp',
    createdAt: updatedAt,
    updatedAt,
    format: plan.format,
    orderMode: plan.orderMode,
    participantCount: plan.participantCount,
    bracketSize: plan.bracketSize,
    fixedSeedCount: plan.fixedSeedCount,
    participants: uniqueParticipants,
    matches: plan.rounds.flatMap((round) => round.matches.map((match) => {
      const up = battleTmpParticipantId(match.entries[0]);
      const down = battleTmpParticipantId(match.entries[1]);
      return {
        matchId: match.id,
        stage: match.bracket,
        level: match.round,
        position: match.index + 1,
        up,
        down,
        upResult: null,
        downResult: null,
        status: 'pending',
      } satisfies BattleTmpMatch;
    })),
  };
  return recomputeBattleTmpSnapshot(snapshot);
}

export function parseBattleTmpSnapshot(
  value: unknown,
  _expectedVariant?: AppVariant,
): BattleTmpSnapshot {
  if (
    !isRecord(value)
    || value.version !== 1
    || value.rulesVersion !== 1
    || value.kind !== 'battle-tmp'
    || !isSafeIntegerAtLeast(value.createdAt, 1)
    || !isSafeIntegerAtLeast(value.updatedAt, 1)
    || !['avoid-first-pair', 'single-elimination', 'double-elimination'].includes(String(value.format))
    || !['rank', 'input'].includes(String(value.orderMode))
    || !isSafeIntegerAtLeast(value.participantCount, 4)
    || !isSafeIntegerAtLeast(value.bracketSize, 4)
    || !isSafeIntegerAtLeast(value.fixedSeedCount, 0)
    || !Array.isArray(value.participants)
    || !Array.isArray(value.matches)
  ) {
    throw new Error('对战临时状态格式不正确');
  }
  if (value.createdAt > value.updatedAt) {
    throw new Error('对战临时状态格式不正确');
  }

  const snapshot = value as unknown as BattleTmpSnapshot;
  if (!isValidBattleTmpMetadata(snapshot)
    || !isValidBattleTmpParticipants(snapshot)
    || !isValidBattleTmpMatches(snapshot)) {
    throw new Error('对战临时状态格式不正确');
  }
  return snapshot;
}

/** 历史 JSON 来自用户文件，必须在进入查看区和临时表前完整校验。 */
function isValidBattleTmpMetadata(snapshot: BattleTmpSnapshot): boolean {
  let expectedBracketSize = 2;
  while (expectedBracketSize < snapshot.participantCount) expectedBracketSize *= 2;
  if (snapshot.bracketSize !== expectedBracketSize) return false;
  if (snapshot.format === 'avoid-first-pair') {
    return snapshot.participantCount === 8
      && snapshot.bracketSize === 8
      && snapshot.orderMode === 'input'
      && snapshot.fixedSeedCount === 0;
  }
  return snapshot.fixedSeedCount === 0
    || battleFixedSeedOptions(snapshot.participantCount).includes(snapshot.fixedSeedCount);
}

function isValidBattleTmpParticipants(snapshot: BattleTmpSnapshot): boolean {
  if (snapshot.participants.length !== snapshot.participantCount) return false;
  const ids = new Set<number>();
  const sourceIndexes = new Set<number>();
  const seeds = new Set<number>();
  const names = new Set<string>();
  for (const participant of snapshot.participants as unknown[]) {
    if (!isRecord(participant)
      || !isSafeIntegerAtLeast(participant.id, 1)
      || typeof participant.name !== 'string'
      || participant.name.trim() !== participant.name
      || participant.name.length === 0
      || !isSafeIntegerAtLeast(participant.sourceIndex, 0)
      || Number(participant.sourceIndex) >= snapshot.participantCount
      || !isSafeIntegerAtLeast(participant.seed, 1)
      || Number(participant.seed) > snapshot.participantCount
      || !isNullableSafeIntegerAtLeast(participant.groupIndex, 0)
      || ![null, 1, 2].includes(participant.groupRank as null | number)) {
      return false;
    }
    const id = Number(participant.id);
    const sourceIndex = Number(participant.sourceIndex);
    const seed = Number(participant.seed);
    const normalizedName = participant.name.toLocaleLowerCase('zh-CN');
    if (id !== sourceIndex + 1
      || ids.has(id)
      || sourceIndexes.has(sourceIndex)
      || seeds.has(seed)
      || names.has(normalizedName)) {
      return false;
    }
    if (snapshot.format === 'avoid-first-pair') {
      if (participant.groupIndex !== Math.floor(sourceIndex / 2)
        || participant.groupRank !== sourceIndex % 2 + 1) return false;
    } else if (participant.groupIndex !== null || participant.groupRank !== null) {
      return false;
    }
    ids.add(id);
    sourceIndexes.add(sourceIndex);
    seeds.add(seed);
    names.add(normalizedName);
  }
  return true;
}

function isValidBattleTmpMatches(snapshot: BattleTmpSnapshot): boolean {
  const participantIds = new Set(snapshot.participants.map((participant) => participant.id));
  const hasResetFinal = snapshot.matches.some((match) => (
    isRecord(match) && match.matchId === 'GF-RESET-M1'
  ));
  const expectedMatches = expectedBattleTmpMatches(snapshot.format, snapshot.bracketSize, hasResetFinal);
  if (snapshot.matches.length !== expectedMatches.size) return false;

  const matchIds = new Set<string>();
  const coordinates = new Set<string>();
  for (const match of snapshot.matches as unknown[]) {
    if (!isRecord(match)
      || typeof match.matchId !== 'string'
      || !['pairing', 'single', 'winner', 'loser', 'final'].includes(String(match.stage))
      || !isSafeIntegerAtLeast(match.level, 1)
      || !isSafeIntegerAtLeast(match.position, 1)
      || !isNullableSafeIntegerAtLeast(match.up, 1)
      || !isNullableSafeIntegerAtLeast(match.down, 1)
      || !isNullableSafeIntegerAtLeast(match.upResult, 0)
      || !isNullableSafeIntegerAtLeast(match.downResult, 0)
      || !['pending', 'ready', 'completed', 'skipped'].includes(String(match.status))) {
      return false;
    }
    const expected = expectedMatches.get(match.matchId);
    const coordinate = `${match.stage}:${match.level}:${match.position}`;
    if (!expected
      || expected.stage !== match.stage
      || expected.level !== match.level
      || expected.position !== match.position
      || matchIds.has(match.matchId)
      || coordinates.has(coordinate)
      || (match.up !== null && !participantIds.has(Number(match.up)))
      || (match.down !== null && !participantIds.has(Number(match.down)))
      || (match.up !== null && match.up === match.down)
      || (match.up === null && match.upResult !== null)
      || (match.down === null && match.downResult !== null)) {
      return false;
    }
    matchIds.add(match.matchId);
    coordinates.add(coordinate);
  }

  const openingStage = snapshot.format === 'double-elimination' ? 'winner' : 'single';
  const openingParticipants = snapshot.matches
    .filter((match) => match.stage === openingStage && match.level === 1)
    .flatMap((match) => [match.up, match.down])
    .filter((id): id is number => id !== null);
  if (openingParticipants.length !== snapshot.participantCount
    || new Set(openingParticipants).size !== snapshot.participantCount) return false;

  const recomputed = recomputeBattleTmpSnapshot({
    ...snapshot,
    participants: snapshot.participants.map((participant) => ({ ...participant })),
    matches: snapshot.matches.map((match) => ({ ...match })),
  });
  const recomputedById = new Map(recomputed.matches.map((match) => [match.matchId, match]));
  return snapshot.matches.every((match) => {
    const expected = recomputedById.get(match.matchId);
    return expected !== undefined
      && match.up === expected.up
      && match.down === expected.down
      && match.upResult === expected.upResult
      && match.downResult === expected.downResult
      && match.status === expected.status;
  });
}

function expectedBattleTmpMatches(
  format: BattleFormat,
  bracketSize: number,
  hasResetFinal: boolean,
): Map<string, { stage: BattleBracket; level: number; position: number }> {
  const expected = new Map<string, { stage: BattleBracket; level: number; position: number }>();
  const addRound = (stage: BattleBracket, level: number, matchCount: number) => {
    for (let position = 1; position <= matchCount; position += 1) {
      const matchId = expectedBattleTmpMatchId(stage, level, position);
      expected.set(matchId, { stage, level, position });
    }
  };
  const winnerStage: BattleBracket = format === 'double-elimination' ? 'winner' : 'single';
  let winnerLevelCount = 0;
  for (let level = 1, matchCount = bracketSize / 2; matchCount >= 1; level += 1, matchCount /= 2) {
    addRound(winnerStage, level, matchCount);
    winnerLevelCount = level;
  }
  if (format !== 'double-elimination') return expected;

  let loserLevel = 1;
  addRound('loser', loserLevel, bracketSize / 4);
  for (let winnerLevel = 2; winnerLevel <= winnerLevelCount; winnerLevel += 1) {
    const droppingMatchCount = bracketSize / (2 ** winnerLevel);
    loserLevel += 1;
    addRound('loser', loserLevel, droppingMatchCount);
    if (winnerLevel < winnerLevelCount) {
      loserLevel += 1;
      addRound('loser', loserLevel, droppingMatchCount / 2);
    }
  }
  addRound('final', 1, 1);
  if (hasResetFinal) addRound('final', 2, 1);
  return expected;
}

function expectedBattleTmpMatchId(stage: BattleBracket, level: number, position: number): string {
  if (stage === 'pairing') return `P-R${level}-M${position}`;
  if (stage === 'single') return `S${level}-M${position}`;
  if (stage === 'winner') return `W${level}-M${position}`;
  if (stage === 'loser') return `L${level}-M${position}`;
  return level === 1 ? `GF-M${position}` : `GF-RESET-M${position}`;
}

function isSafeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isNullableSafeIntegerAtLeast(value: unknown, minimum: number): value is number | null {
  return value === null || isSafeIntegerAtLeast(value, minimum);
}

export function updateBattleTmpResult(
  snapshot: BattleTmpSnapshot,
  matchId: string,
  upResult: number | null,
  downResult: number | null,
  updatedAt = Date.now(),
): BattleTmpSnapshot {
  const next: BattleTmpSnapshot = {
    ...snapshot,
    updatedAt,
    matches: snapshot.matches.map((match) => ({ ...match })),
  };
  const battleMatch = next.matches.find((match) => match.matchId === matchId);
  if (!battleMatch) throw new Error('找不到对战场次');
  if (![upResult, downResult].every((score) => (
    score === null || Number.isSafeInteger(score) && score >= 0
  ))) {
    throw new Error('对战比分必须是非负整数');
  }
  if ((battleMatch.up === null && upResult !== null) || (battleMatch.down === null && downResult !== null)) {
    throw new Error('等待上游的签位不能填写比分');
  }
  if (
    (battleTmpScoreLocked(snapshot, battleMatch, 'up') && upResult !== battleMatch.upResult)
    || (battleTmpScoreLocked(snapshot, battleMatch, 'down') && downResult !== battleMatch.downResult)
  ) {
    throw new Error('下游已有比分，不能修改上游');
  }
  battleMatch.upResult = upResult;
  battleMatch.downResult = downResult;
  return recomputeBattleTmpSnapshot(next);
}

export function battleTmpScoresWithMagicFill(
  snapshot: BattleTmpSnapshot,
  matchId: string,
  side: 'up' | 'down',
  score: number | null,
): { upResult: number | null; downResult: number | null } {
  const match = snapshot.matches.find((candidate) => candidate.matchId === matchId);
  if (!match) throw new Error('找不到对战场次');

  let upResult = side === 'up' ? score : match.upResult;
  let downResult = side === 'down' ? score : match.downResult;
  const oppositeResult = side === 'up' ? downResult : upResult;
  if (score === null || oppositeResult !== null) return { upResult, downResult };

  // 同阶段、同层已经录完的场次才能定义本层胜分，避免胜者组规则误套到败者组。
  const winningScores = new Set(snapshot.matches.flatMap((candidate) => {
    if (
      candidate.matchId === matchId
      || candidate.stage !== match.stage
      || candidate.level !== match.level
      || candidate.status !== 'completed'
      || candidate.upResult === null
      || candidate.downResult === null
      || candidate.upResult === candidate.downResult
    ) return [];
    return [Math.max(candidate.upResult, candidate.downResult)];
  }));
  if (winningScores.size !== 1) return { upResult, downResult };

  const winningScore = [...winningScores][0];
  if (score >= winningScore) return { upResult, downResult };
  if (side === 'up') downResult = winningScore;
  else upResult = winningScore;
  return { upResult, downResult };
}

export function battleTmpSlotOrigin(
  snapshot: BattleTmpSnapshot,
  match: BattleTmpMatch,
  slot: 'up' | 'down',
): BattleTmpSlotOrigin | null {
  return battleTmpSlotSource(snapshot, match, slot);
}

/** 页面与导出共用的场次编号。 */
export function battleTmpMatchCode(match: BattleTmpMatch): string {
  const stage = match.stage === 'pairing' ? 'P'
    : match.stage === 'single' ? 'S'
      : match.stage === 'winner' ? 'W'
        : match.stage === 'loser' ? 'L'
          : 'F';
  return `${stage}${match.level} P${match.position}`;
}

/** 下游对应签位已录分时，只锁定会影响该签位的当前选手。 */
export function battleTmpScoreLocked(
  snapshot: BattleTmpSnapshot,
  match: BattleTmpMatch,
  side: 'up' | 'down',
): boolean {
  const participantId = side === 'up' ? match.up : match.down;
  if (participantId === null || match.status !== 'completed') return false;
  const outcome = battleTmpWinnerId(match) === participantId
    ? 'winner'
    : battleTmpLoserId(match) === participantId ? 'loser' : null;
  if (!outcome) return false;
  return snapshot.matches.some((candidate) => (
    (['up', 'down'] as const).some((candidateSide) => {
      const origin = battleTmpSlotSource(snapshot, candidate, candidateSide);
      const result = candidateSide === 'up' ? candidate.upResult : candidate.downResult;
      return origin?.matchId === match.matchId
        && origin.outcome === outcome
        && result !== null;
    })
  ));
}

export function battleTmpWinnerId(match: BattleTmpMatch): number | null {
  if (match.status !== 'completed') return null;
  if (match.up === null || match.down === null) return match.up ?? match.down;
  if (match.upResult === null || match.downResult === null || match.upResult === match.downResult) return null;
  return match.upResult > match.downResult ? match.up : match.down;
}

export function battleTmpLoserId(match: BattleTmpMatch): number | null {
  const winner = battleTmpWinnerId(match);
  if (winner === null) return null;
  return match.up === winner ? match.down : match.up;
}

export function battleTmpExcelRows(snapshot: BattleTmpSnapshot): (string | number)[][] {
  const nameById = new Map(snapshot.participants.map((participant) => [participant.id, participant.name]));
  return [
    ['阶段', '层级', '位置', '上方', '上方比分', '下方', '下方比分', '胜者', '状态', '场次'],
    ...snapshot.matches.map((match) => [
      battleBracketLabel(match.stage),
      match.level,
      match.position,
      match.up === null ? '' : nameById.get(match.up) ?? `#${match.up}`,
      match.upResult ?? '',
      match.down === null ? '' : nameById.get(match.down) ?? `#${match.down}`,
      match.downResult ?? '',
      battleTmpWinnerId(match) === null ? '' : nameById.get(battleTmpWinnerId(match)!) ?? `#${battleTmpWinnerId(match)}`,
      match.status,
      match.matchId,
    ]),
  ];
}

export function battleFixedSeedOptions(participantCount: number): number[] {
  const options: number[] = [];
  for (let value = 2; value < participantCount; value *= 2) options.push(value);
  return options;
}

export function nextBattleBracketSize(participantCount: number): number {
  if (!Number.isInteger(participantCount) || participantCount < 2) {
    throw new Error('至少需要 2 名参赛者');
  }
  let size = 2;
  while (size < participantCount) size *= 2;
  return size;
}

/** 标准签位顺序会让高顺位均匀分布在上下半区。 */
export function standardBracketSeedOrder(size: number): number[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('签位数量必须是至少为 2 的 2 次幂');
  }
  let order = [1, 2];
  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    const mirroredTotal = currentSize + 1;
    order = order.flatMap((seed) => [seed, mirroredTotal - seed]);
  }
  return order;
}

export function createFixedBattlePositions(
  names: readonly string[],
  fixedSeedCount: number,
): BattlePosition[] {
  const participants = createParticipants(names);
  validateFixedSeedCount(participants.length, fixedSeedCount);
  return fixedPositionsForParticipants(participants, fixedSeedCount);
}

export function createSeededBattlePlan(
  names: readonly string[],
  options: SeededBattleOptions,
): BattlePlan {
  const participants = createParticipants(names);
  if (participants.length < 4) throw new Error('单败、双败至少需要 4 名有效参赛者');
  validateFixedSeedCount(participants.length, options.fixedSeedCount);
  const bracketSize = nextBattleBracketSize(participants.length);
  const positions = fixedPositionsForParticipants(participants, options.fixedSeedCount);

  const random = options.random ?? Math.random;
  const remaining = shuffled(participants.slice(options.fixedSeedCount), random);
  const emptyMatchAnchors = shuffled(
    positions.flatMap((_, positionIndex) => {
      if (positionIndex % 2 !== 0) return [];
      if (positions[positionIndex].participant || positions[positionIndex + 1].participant) return [];
      return [positionIndex + (randomValue(random) < 0.5 ? 0 : 1)];
    }),
    random,
  );

  for (const positionIndex of emptyMatchAnchors) {
    positions[positionIndex].participant = remaining.shift() ?? null;
  }
  const openPositions = shuffled(
    positions.filter((position) => !position.participant).map((position) => position.index),
    random,
  );
  remaining.forEach((participant, index) => {
    positions[openPositions[index]].participant = participant;
  });
  if (options.fixedSeedCount > 0 && options.caimiRankScores) {
    applyCaimiWeakOpponents(positions, options.caimiRankScores);
  }

  return {
    version: 1,
    format: options.format,
    orderMode: options.orderMode,
    participantCount: participants.length,
    bracketSize,
    fixedSeedCount: options.fixedSeedCount,
    positions,
    rounds: createEliminationRounds(options.format, positions, options.doubleGrandFinal ?? false),
  };
}

/** 猜蜜版让固定特权项优先轮空，否则首轮匹配已有排名中最弱的普通对手。 */
function applyCaimiWeakOpponents(
  positions: BattlePosition[],
  rankScores: readonly number[],
) {
  const favoredPositionIndexes = positions.flatMap((position) => (
    position.fixed
    && position.participant
    && isCaimiFavoredName(position.participant.name)
      ? [position.index]
      : []
  ));
  const reservedOpponentIndexes = new Set<number>();

  for (const favoredPositionIndex of favoredPositionIndexes) {
    const opponentIndex = favoredPositionIndex ^ 1;
    const opponent = positions[opponentIndex];
    // 已经轮空时保留当前签位。
    if (!opponent?.participant) continue;
    const bye = positions.find((position) => (
      !position.fixed
      && !position.participant
      && !reservedOpponentIndexes.has(position.index)
      && positions[position.index ^ 1]?.participant
    ));
    if (bye) {
      // 把原对手移入空签位，既给特权项轮空，也不会制造双方都空缺的首轮。
      bye.participant = opponent.participant;
      opponent.participant = null;
      reservedOpponentIndexes.add(opponentIndex);
      continue;
    }
    const weakest = positions
      .filter((position) => (
        position.participant
        && !position.fixed
        && !reservedOpponentIndexes.has(position.index)
        && !isCaimiFavoredName(position.participant.name)
        && Number.isFinite(rankScores[position.participant.sourceIndex])
        && rankScores[position.participant.sourceIndex] < 10_000
      ))
      .sort((left, right) => (
        rankScores[right.participant!.sourceIndex] - rankScores[left.participant!.sourceIndex]
        || left.index - right.index
      ))[0];
    if (!weakest) continue;
    [opponent.participant, weakest.participant] = [weakest.participant, opponent.participant];
    reservedOpponentIndexes.add(opponentIndex);
  }
}

function validateFixedSeedCount(participantCount: number, fixedSeedCount: number) {
  if (fixedSeedCount === 0) return;
  const fixedOptions = battleFixedSeedOptions(participantCount);
  if (fixedOptions.includes(fixedSeedCount)) return;
  throw new Error(`前 ${fixedSeedCount} 固定不适用于当前人数`);
}

function fixedPositionsForParticipants(
  participants: readonly BattleParticipant[],
  fixedSeedCount: number,
): BattlePosition[] {
  const bracketSize = nextBattleBracketSize(participants.length);
  const seedOrder = standardBracketSeedOrder(bracketSize);
  const positions: BattlePosition[] = seedOrder.map((seedNumber, index) => ({
    index,
    seedNumber,
    participant: null,
    fixed: false,
  }));
  const positionBySeed = new Map(seedOrder.map((seed, index) => [seed, index]));
  for (const participant of participants.slice(0, fixedSeedCount)) {
    const position = positions[positionBySeed.get(participant.seed)!];
    position.participant = participant;
    position.fixed = true;
  }
  return positions;
}

/** 名单每相邻两项为一组，依次视为该组第 1 和第 2。 */
export function createAvoidSameGroupPlan(
  names: readonly string[],
  random: () => number = Math.random,
): BattlePlan {
  const participants = createParticipants(names);
  if (participants.length !== 8) {
    throw new Error('同组不对战1对2固定需要 8 人');
  }
  const groupCount = participants.length / 2;
  const firstPlaces = participants.filter((_, index) => index % 2 === 0).map((participant, groupIndex) => ({
    ...participant,
    groupIndex,
    groupRank: 1 as const,
  }));
  const secondPlaces = participants.filter((_, index) => index % 2 === 1).map((participant, groupIndex) => ({
    ...participant,
    groupIndex,
    groupRank: 2 as const,
  }));
  const firstOrder = shuffled(firstPlaces, random);
  const secondOrder = matchOtherGroupSeconds(firstOrder, secondPlaces, random);
  // 每场上方固定为第 1、下方固定为异组第 2；具体哪位第 1 落在哪一场仍然随机。
  const positionParticipants = firstOrder.flatMap((first, index) => [first, secondOrder[index]]);
  const positions = positionParticipants.map((participant, index) => ({
    index,
    seedNumber: index + 1,
    participant,
    fixed: false,
  }));

  return {
    version: 1,
    format: 'avoid-first-pair',
    orderMode: 'input',
    participantCount: participants.length,
    bracketSize: participants.length,
    fixedSeedCount: 0,
    positions,
    rounds: createWinnerRounds('single-elimination', positions),
  };
}

/** 随机寻找完整的跨组匹配；增广路径会处理最后两人只剩唯一合法选择的情况。 */
function matchOtherGroupSeconds(
  firstPlaces: readonly (BattleParticipant & { groupIndex: number; groupRank: 1 })[],
  secondPlaces: readonly (BattleParticipant & { groupIndex: number; groupRank: 2 })[],
  random: () => number,
): (BattleParticipant & { groupIndex: number; groupRank: 2 })[] {
  const candidates = firstPlaces.map((first) => shuffled(
    secondPlaces.filter((second) => second.groupIndex !== first.groupIndex),
    random,
  ));
  const ownerBySecondGroup = new Map<number, number>();
  const selected = Array<(BattleParticipant & { groupIndex: number; groupRank: 2 }) | undefined>(
    firstPlaces.length,
  );

  function assign(firstIndex: number, visitedSecondGroups: Set<number>): boolean {
    for (const second of candidates[firstIndex]) {
      if (visitedSecondGroups.has(second.groupIndex)) continue;
      visitedSecondGroups.add(second.groupIndex);
      const previousOwner = ownerBySecondGroup.get(second.groupIndex);
      if (previousOwner !== undefined && !assign(previousOwner, visitedSecondGroups)) continue;
      ownerBySecondGroup.set(second.groupIndex, firstIndex);
      selected[firstIndex] = second;
      return true;
    }
    return false;
  }

  for (let firstIndex = 0; firstIndex < firstPlaces.length; firstIndex += 1) {
    if (!assign(firstIndex, new Set())) throw new Error('无法生成跨组的1对2签位');
  }
  return selected as (BattleParticipant & { groupIndex: number; groupRank: 2 })[];
}

function createParticipants(names: readonly string[]): BattleParticipant[] {
  const normalized = names.map((name) => name.trim());
  if (normalized.length < 2 || normalized.some((name) => !name)) {
    throw new Error('至少需要 2 名有效参赛者');
  }
  const uniqueNames = new Set(normalized.map((name) => name.toLocaleLowerCase('zh-CN')));
  if (uniqueNames.size !== normalized.length) throw new Error('参赛者名称不能重复');
  return normalized.map((name, sourceIndex) => ({ name, sourceIndex, seed: sourceIndex + 1 }));
}

function createEliminationRounds(
  format: 'single-elimination' | 'double-elimination',
  positions: readonly BattlePosition[],
  doubleGrandFinal: boolean,
): BattleRound[] {
  const winnerRounds = createWinnerRounds(format, positions);
  if (format === 'single-elimination') return winnerRounds;
  const loserRounds = createLoserRounds(winnerRounds, positions.length);
  const winnerFinal = winnerRounds.at(-1)!.matches[0];
  const loserFinal = loserRounds.at(-1)!.matches[0];
  const grandFinal = createRound('GF', '总决赛', 'final', 1, [[
    winnerSource(winnerFinal.id),
    winnerSource(loserFinal.id),
  ]]);
  if (!doubleGrandFinal) return [...winnerRounds, ...loserRounds, grandFinal];
  const resetFinal = createRound('GF-RESET', '总决赛（必要时重赛）', 'final', 2, [[
    winnerSource(grandFinal.matches[0].id),
    loserSource(grandFinal.matches[0].id),
  ]]);
  return [...winnerRounds, ...loserRounds, grandFinal, resetFinal];
}

function createWinnerRounds(
  format: 'single-elimination' | 'double-elimination',
  positions: readonly BattlePosition[],
): BattleRound[] {
  const bracket: BattleBracket = format === 'single-elimination' ? 'single' : 'winner';
  const prefix = format === 'single-elimination' ? 'S' : 'W';
  const rounds: BattleRound[] = [];
  let previousMatches: BattleMatch[] = [];
  for (let round = 1, matchCount = positions.length / 2; matchCount >= 1; round += 1, matchCount /= 2) {
    const entries: [BattleEntrySource, BattleEntrySource][] = Array.from(
      { length: matchCount },
      (_, index) => round === 1
        ? [participantSource(positions[index * 2]), participantSource(positions[index * 2 + 1])]
        : [winnerSource(previousMatches[index * 2].id), winnerSource(previousMatches[index * 2 + 1].id)],
    );
    const created = createRound(`${prefix}${round}`, `第 ${round} 轮`, bracket, round, entries);
    rounds.push(created);
    previousMatches = created.matches;
  }
  return rounds;
}

function createLoserRounds(winnerRounds: readonly BattleRound[], bracketSize: number): BattleRound[] {
  if (bracketSize === 2) {
    return [createRound('L1', '败者组第 1 轮', 'loser', 1, [[
      loserSource(winnerRounds[0].matches[0].id),
      null,
    ]])];
  }

  const rounds: BattleRound[] = [];
  let loserRoundNumber = 1;
  let previous = createRound(
    'L1',
    '败者组第 1 轮',
    'loser',
    loserRoundNumber,
    pairSources(winnerRounds[0].matches.map((match) => loserSource(match.id))),
  );
  rounds.push(previous);

  for (let winnerRoundIndex = 1; winnerRoundIndex < winnerRounds.length; winnerRoundIndex += 1) {
    loserRoundNumber += 1;
    const droppingMatches = winnerRounds[winnerRoundIndex].matches;
    const cross = createRound(
      `L${loserRoundNumber}`,
      `败者组第 ${loserRoundNumber} 轮`,
      'loser',
      loserRoundNumber,
      droppingMatches.map((match, index) => [
        winnerSource(previous.matches[index].id),
        // 相邻交换胜者组掉落位置，避免选手刚进入败者组就立刻重赛。
        loserSource(droppingMatches.length === 1
          ? match.id
          : droppingMatches[index ^ 1].id),
      ]),
    );
    rounds.push(cross);
    previous = cross;

    if (winnerRoundIndex < winnerRounds.length - 1) {
      loserRoundNumber += 1;
      previous = createRound(
        `L${loserRoundNumber}`,
        `败者组第 ${loserRoundNumber} 轮`,
        'loser',
        loserRoundNumber,
        pairSources(cross.matches.map((match) => winnerSource(match.id))),
      );
      rounds.push(previous);
    }
  }
  return rounds;
}

function createRound(
  id: string,
  label: string,
  bracket: BattleBracket,
  round: number,
  entries: readonly [BattleEntrySource, BattleEntrySource][],
): BattleRound {
  return {
    id,
    label,
    bracket,
    round,
    matches: entries.map((matchEntries, index) => ({
      id: `${id}-M${index + 1}`,
      bracket,
      round,
      index,
      entries: matchEntries,
    })),
  };
}

function participantSource(position: BattlePosition): BattleEntrySource {
  return position.participant ? { kind: 'participant', participant: position.participant } : null;
}

function winnerSource(matchId: string): BattleEntrySource {
  return { kind: 'winner', matchId };
}

function loserSource(matchId: string): BattleEntrySource {
  return { kind: 'loser', matchId };
}

function pairSources(sources: readonly BattleEntrySource[]): [BattleEntrySource, BattleEntrySource][] {
  return Array.from({ length: sources.length / 2 }, (_, index) => [
    sources[index * 2],
    sources[index * 2 + 1],
  ]);
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(randomValue(random) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function randomValue(random: () => number): number {
  return Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0));
}

function battleBracketLabel(bracket: BattleBracket): string {
  if (bracket === 'pairing') return '1对2';
  if (bracket === 'single') return '单败';
  if (bracket === 'winner') return '胜者组';
  if (bracket === 'loser') return '败者组';
  return '总决赛';
}

function battleTmpParticipantId(entry: BattleEntrySource): number | null {
  return entry?.kind === 'participant' ? entry.participant.sourceIndex + 1 : null;
}

function recomputeBattleTmpSnapshot(snapshot: BattleTmpSnapshot): BattleTmpSnapshot {
  for (let iteration = 0; iteration < snapshot.matches.length * 3; iteration += 1) {
    let changed = false;
    for (const match of snapshot.matches) {
      const before = [match.up, match.down, match.upResult, match.downResult, match.status].join('|');
      const activation = battleTmpActivation(snapshot, match);
      if (activation === 'pending' || activation === 'skipped') {
        if (battleTmpSlotSource(snapshot, match, 'up')) match.up = null;
        if (battleTmpSlotSource(snapshot, match, 'down')) match.down = null;
        match.upResult = null;
        match.downResult = null;
        match.status = activation;
      } else {
        const up = battleTmpSourceValue(snapshot, match.up, battleTmpSlotSource(snapshot, match, 'up'));
        const down = battleTmpSourceValue(snapshot, match.down, battleTmpSlotSource(snapshot, match, 'down'));
        const participantsChanged = match.up !== up.value || match.down !== down.value;
        match.up = up.value;
        match.down = down.value;
        if (participantsChanged) {
          match.upResult = null;
          match.downResult = null;
        }
        if (!up.ready || !down.ready) {
          match.upResult = null;
          match.downResult = null;
          match.status = 'pending';
        } else if (match.up === null && match.down === null) {
          // 双败遇到多个首轮轮空时，空场也必须向下游传播“无人晋级”。
          match.upResult = null;
          match.downResult = null;
          match.status = 'skipped';
        } else if (match.up === null || match.down === null) {
          match.upResult = null;
          match.downResult = null;
          match.status = 'completed';
        } else if (
          match.upResult !== null
          && match.downResult !== null
          && match.upResult !== match.downResult
        ) {
          match.status = 'completed';
        } else {
          match.status = 'ready';
        }
      }
      if (before !== [match.up, match.down, match.upResult, match.downResult, match.status].join('|')) changed = true;
    }
    if (!changed) break;
  }
  return snapshot;
}

function battleTmpActivation(
  snapshot: BattleTmpSnapshot,
  match: BattleTmpMatch,
): 'active' | 'pending' | 'skipped' {
  if (match.stage !== 'final' || match.level !== 2) return 'active';
  const source = snapshot.matches.find((candidate) => candidate.matchId === 'GF-M1');
  if (!source || source.status !== 'completed') return 'pending';
  return source.down !== null && battleTmpWinnerId(source) === source.down ? 'active' : 'skipped';
}

function battleTmpSourceValue(
  snapshot: BattleTmpSnapshot,
  staticValue: number | null,
  source: { matchId: string; outcome: 'winner' | 'loser' } | null,
): { ready: boolean; value: number | null } {
  if (!source) return { ready: true, value: staticValue };
  const sourceMatch = snapshot.matches.find((match) => match.matchId === source.matchId);
  if (!sourceMatch || (sourceMatch.status !== 'completed' && sourceMatch.status !== 'skipped')) {
    return { ready: false, value: null };
  }
  if (sourceMatch.status === 'skipped') return { ready: true, value: null };
  const participant = source.outcome === 'winner'
    ? battleTmpWinnerId(sourceMatch)
    : battleTmpLoserId(sourceMatch);
  return { ready: participant !== null || sourceMatch.up === null || sourceMatch.down === null, value: participant };
}

/** 固定双败规则可由层级和位置恢复，不需要把来源冗余写入临时表。 */
function battleTmpSlotSource(
  snapshot: BattleTmpSnapshot,
  match: BattleTmpMatch,
  slot: 'up' | 'down',
): { matchId: string; outcome: 'winner' | 'loser' } | null {
  const offset = slot === 'up' ? 0 : 1;
  if (match.stage === 'pairing') return null;
  if (match.stage === 'single' || match.stage === 'winner') {
    if (match.level === 1) return null;
    const prefix = match.stage === 'single' ? 'S' : 'W';
    return {
      matchId: `${prefix}${match.level - 1}-M${(match.position - 1) * 2 + offset + 1}`,
      outcome: 'winner',
    };
  }
  if (match.stage === 'loser') {
    if (snapshot.bracketSize === 2 && match.level === 1) {
      return slot === 'up' ? { matchId: 'W1-M1', outcome: 'loser' } : null;
    }
    if (match.level === 1) {
      return {
        matchId: `W1-M${(match.position - 1) * 2 + offset + 1}`,
        outcome: 'loser',
      };
    }
    if (match.level % 2 === 0) {
      if (slot === 'up') {
        return { matchId: `L${match.level - 1}-M${match.position}`, outcome: 'winner' };
      }
      const winnerLevel = match.level / 2 + 1;
      const winnerMatchCount = snapshot.matches.filter((candidate) => (
        candidate.stage === 'winner' && candidate.level === winnerLevel
      )).length;
      const crossedPosition = winnerMatchCount === 1
        ? match.position
        : match.position % 2 === 1 ? match.position + 1 : match.position - 1;
      return { matchId: `W${winnerLevel}-M${crossedPosition}`, outcome: 'loser' };
    }
    return {
      matchId: `L${match.level - 1}-M${(match.position - 1) * 2 + offset + 1}`,
      outcome: 'winner',
    };
  }
  if (match.level === 1) {
    const winnerLevel = Math.max(...snapshot.matches
      .filter((candidate) => candidate.stage === 'winner')
      .map((candidate) => candidate.level));
    const loserLevel = Math.max(...snapshot.matches
      .filter((candidate) => candidate.stage === 'loser')
      .map((candidate) => candidate.level));
    return slot === 'up'
      ? { matchId: `W${winnerLevel}-M1`, outcome: 'winner' }
      : { matchId: `L${loserLevel}-M1`, outcome: 'winner' };
  }
  return {
    matchId: 'GF-M1',
    outcome: slot === 'up' ? 'winner' : 'loser',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
