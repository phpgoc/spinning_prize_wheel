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

export interface SeededBattleOptions {
  format: 'single-elimination' | 'double-elimination';
  orderMode: BattleOrderMode;
  fixedSeedCount: number;
  random?: () => number;
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

  return {
    version: 1,
    format: options.format,
    orderMode: options.orderMode,
    participantCount: participants.length,
    bracketSize,
    fixedSeedCount: options.fixedSeedCount,
    positions,
    rounds: createEliminationRounds(options.format, positions),
  };
}

function validateFixedSeedCount(participantCount: number, fixedSeedCount: number) {
  const fixedOptions = battleFixedSeedOptions(participantCount);
  if (fixedOptions.includes(fixedSeedCount)) return;
  if (participantCount === 2 && fixedSeedCount === 0) return;
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

/** 前半名单视为各组第 1，后半视为相同顺序的各组第 2。 */
export function createAvoidSameGroupPlan(
  names: readonly string[],
  random: () => number = Math.random,
): BattlePlan {
  const participants = createParticipants(names);
  if (participants.length < 4 || participants.length % 2 !== 0) {
    throw new Error('同组不对战1对2需要偶数名单，且至少包含 2 个组');
  }
  const groupCount = participants.length / 2;
  const firstPlaces = participants.slice(0, groupCount).map((participant, groupIndex) => ({
    ...participant,
    groupIndex,
    groupRank: 1 as const,
  }));
  const secondPlaces = participants.slice(groupCount).map((participant, groupIndex) => ({
    ...participant,
    groupIndex,
    groupRank: 2 as const,
  }));
  const offset = 1 + Math.floor(randomValue(random) * (groupCount - 1));
  const matches = firstPlaces.map((participant, index): BattleMatch => ({
    id: `P-R1-M${index + 1}`,
    bracket: 'pairing',
    round: 1,
    index,
    entries: [
      { kind: 'participant', participant },
      { kind: 'participant', participant: secondPlaces[(index + offset) % groupCount] },
    ],
  }));

  return {
    version: 1,
    format: 'avoid-first-pair',
    orderMode: 'input',
    participantCount: participants.length,
    bracketSize: participants.length,
    fixedSeedCount: 0,
    positions: participants.map((participant, index) => ({
      index,
      seedNumber: index + 1,
      participant: index < groupCount ? firstPlaces[index] : secondPlaces[index - groupCount],
      fixed: true,
    })),
    rounds: [{
      id: 'pairing-1',
      label: '1对2',
      bracket: 'pairing',
      round: 1,
      matches,
    }],
  };
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
        loserSource(match.id),
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
