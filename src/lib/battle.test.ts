import { describe, expect, test } from 'bun:test';
import {
  battleFixedSeedOptions,
  battleTmpScoresWithMagicFill,
  battleTmpSlotOrigin,
  battleTmpExcelRows,
  createAvoidSameGroupPlan,
  createBattleTmpSnapshot,
  createFixedBattlePositions,
  createSeededBattlePlan,
  parseBattleTmpSnapshot,
  standardBracketSeedOrder,
  updateBattleTmpResult,
} from './battle';

const names = (count: number) => Array.from({ length: count }, (_, index) => `选手${index + 1}`);

describe('对战签位', () => {
  test('33 人可以选择前 2、4、8、16、32 固定', () => {
    expect(battleFixedSeedOptions(33)).toEqual([2, 4, 8, 16, 32]);
  });

  test('8 个标准签位把前四分布为 1、4 和 2、3', () => {
    expect(standardBracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test('前四固定后只随机其余位置', () => {
    const plan = createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'rank',
      fixedSeedCount: 4,
      random: () => 0,
    });
    expect(plan.positions.filter((position) => position.fixed).map((position) => position.index)).toEqual([0, 2, 4, 6]);
    expect(plan.positions.filter((position) => position.fixed).map((position) => position.participant?.seed)).toEqual([1, 4, 2, 3]);
    expect(plan.positions.filter((position) => !position.fixed).map((position) => position.participant?.seed).sort()).toEqual([5, 6, 7, 8]);
  });

  test('执行前只显示已经固定的签位', () => {
    const positions = createFixedBattlePositions(names(8), 4);
    expect(positions.map((position) => position.participant?.seed ?? null)).toEqual([
      1, null, 4, null, 2, null, 3, null,
    ]);
  });

  test('有轮空时首轮不会留下双方都空缺的对战', () => {
    const plan = createSeededBattlePlan(names(5), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    });
    const firstRound = plan.rounds[0];
    expect(firstRound.matches.every((match) => match.entries.some(Boolean))).toBe(true);
  });

  test('单败生成完整的晋级轮次', () => {
    const plan = createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0,
    });
    expect(plan.rounds.map((round) => round.matches.length)).toEqual([4, 2, 1]);
    expect(plan.rounds[1].matches[0].entries).toEqual([
      { kind: 'winner', matchId: 'S1-M1' },
      { kind: 'winner', matchId: 'S1-M2' },
    ]);
  });

  test('关系化临时状态把首层位置双方写满并保留空结果', () => {
    const plan = createSeededBattlePlan(names(2), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 0,
      random: () => 0,
    });
    const snapshot = createBattleTmpSnapshot('standard', plan, 1_700_000_000_000);
    const firstMatch = snapshot.matches[0];
    expect(firstMatch).toMatchObject({
      stage: 'single',
      level: 1,
      position: 1,
      upResult: null,
      downResult: null,
      status: 'ready',
    });
    expect([firstMatch.up, firstMatch.down].sort()).toEqual([1, 2]);
  });

  test('修改上游赛果只重算下游签位并清除失效结果', () => {
    const snapshot = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(4), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const first = snapshot.matches.find((match) => match.matchId === 'S1-M1')!;
    const second = snapshot.matches.find((match) => match.matchId === 'S1-M2')!;
    let state = setBattleWinner(snapshot, first.matchId, first.up!, 1_700_000_000_001);
    state = setBattleWinner(state, second.matchId, second.up!, 1_700_000_000_002);
    let final = state.matches.find((match) => match.matchId === 'S2-M1')!;
    expect(final).toMatchObject({ up: first.up, down: second.up, status: 'ready' });

    state = setBattleWinner(state, final.matchId, final.up!, 1_700_000_000_003);
    state = setBattleWinner(state, first.matchId, first.down!, 1_700_000_000_004);
    final = state.matches.find((match) => match.matchId === 'S2-M1')!;
    expect(final).toMatchObject({
      up: first.down,
      down: second.up,
      upResult: null,
      downResult: null,
      status: 'ready',
    });
  });

  test('魔法比分只沿用同阶段同层已经确定的胜分', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const winnerMatches = state.matches.filter((match) => match.stage === 'winner' && match.level === 1);
    state = updateBattleTmpResult(state, winnerMatches[0].matchId, 4, 1);

    expect(battleTmpScoresWithMagicFill(state, winnerMatches[1].matchId, 'down', 2)).toEqual({
      upResult: 4,
      downResult: 2,
    });
    expect(battleTmpScoresWithMagicFill(state, winnerMatches[1].matchId, 'up', 4)).toEqual({
      upResult: 4,
      downResult: null,
    });

    const nextWinnerLevel = state.matches.find((match) => match.stage === 'winner' && match.level === 2)!;
    expect(battleTmpScoresWithMagicFill(state, nextWinnerLevel.matchId, 'up', 1)).toEqual({
      upResult: 1,
      downResult: null,
    });
    const loserMatch = state.matches.find((match) => match.stage === 'loser' && match.level === 1)!;
    expect(battleTmpScoresWithMagicFill(state, loserMatch.matchId, 'down', 1)).toEqual({
      upResult: null,
      downResult: 1,
    });
  });

  test('同阶段同层胜分不一致时魔法比分不猜测', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'single-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const firstLevel = state.matches.filter((match) => match.stage === 'single' && match.level === 1);
    state = updateBattleTmpResult(state, firstLevel[0].matchId, 4, 1);
    state = updateBattleTmpResult(state, firstLevel[1].matchId, 3, 1);
    expect(battleTmpScoresWithMagicFill(state, firstLevel[2].matchId, 'down', 1)).toEqual({
      upResult: null,
      downResult: 1,
    });
  });

  test('双败包含胜者组、败者组、总决赛和必要时重赛', () => {
    const plan = createSeededBattlePlan(names(8), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0,
    });
    expect(plan.rounds.map((round) => `${round.id}:${round.matches.length}`)).toEqual([
      'W1:4', 'W2:2', 'W3:1',
      'L1:2', 'L2:2', 'L3:1', 'L4:1',
      'GF:1', 'GF-RESET:1',
    ]);
    const state = createBattleTmpSnapshot('standard', plan, 1_700_000_000_000);
    expect(parseBattleTmpSnapshot(state, 'standard')).toEqual(state);
    expect(() => parseBattleTmpSnapshot(state, 'caimi')).toThrow('格式不正确');
    expect(state.matches.find((match) => match.matchId === 'GF-RESET-M1')).toMatchObject({
      status: 'pending',
    });
    const excelRows = battleTmpExcelRows(state);
    expect(excelRows[0]).toEqual([
      '阶段', '层级', '位置', '上方', '上方比分', '下方', '下方比分', '胜者', '状态', '场次',
    ]);
    expect(excelRows.some((row) => row[0] === '败者组')).toBe(true);
  });

  test('双败把胜者和败者分别送入正确下游', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(4), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    const winnerFirst = state.matches.filter((match) => match.stage === 'winner' && match.level === 1);
    const winners = winnerFirst.map((match) => match.up!);
    const losers = winnerFirst.map((match) => match.down!);
    for (const match of winnerFirst) {
      state = setBattleWinner(state, match.matchId, match.up!);
    }
    expect(state.matches.find((match) => match.matchId === 'W2-M1')).toMatchObject({
      up: winners[0],
      down: winners[1],
    });
    expect(state.matches.find((match) => match.matchId === 'L1-M1')).toMatchObject({
      up: losers[0],
      down: losers[1],
    });
    const winnerSecond = state.matches.find((match) => match.matchId === 'W2-M1')!;
    expect(battleTmpSlotOrigin(state, winnerSecond, 'up')).toEqual({
      matchId: 'W1-M1',
      outcome: 'winner',
    });
  });

  test('胜者组败者按固定交叉位置注入败者组', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(8), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    state = completeReadyMatches(state, (match) => match.stage === 'winner' && match.level === 1);
    const winnerSecond = state.matches.filter((match) => match.stage === 'winner' && match.level === 2);
    const crossedLosers = [winnerSecond[1].down, winnerSecond[0].down];
    for (const match of winnerSecond) {
      state = setBattleWinner(state, match.matchId, match.up!);
    }
    state = completeReadyMatches(state, (match) => match.stage === 'loser' && match.level === 1);
    expect(state.matches.find((match) => match.matchId === 'L2-M1')?.down).toBe(crossedLosers[0]);
    expect(state.matches.find((match) => match.matchId === 'L2-M2')?.down).toBe(crossedLosers[1]);
  });

  test('总决赛只有败者组选手取胜时才激活重置赛', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(4), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 2,
      random: () => 0.25,
    }), 1_700_000_000_000);
    state = completeReadyMatches(state, (match) => match.stage !== 'final');
    const grandFinal = state.matches.find((match) => match.matchId === 'GF-M1')!;
    expect(grandFinal.status).toBe('ready');

    const winnerBracketWins = setBattleWinner(state, grandFinal.matchId, grandFinal.up!);
    expect(winnerBracketWins.matches.find((match) => match.matchId === 'GF-RESET-M1')?.status).toBe('skipped');

    const loserBracketWins = setBattleWinner(state, grandFinal.matchId, grandFinal.down!);
    expect(loserBracketWins.matches.find((match) => match.matchId === 'GF-RESET-M1')).toMatchObject({
      up: grandFinal.down,
      down: grandFinal.up,
      status: 'ready',
    });
  });

  test('双败的多个轮空不会阻塞后续败者组', () => {
    let state = createBattleTmpSnapshot('standard', createSeededBattlePlan(names(5), {
      format: 'double-elimination',
      orderMode: 'input',
      fixedSeedCount: 4,
      random: () => 0.25,
    }), 1_700_000_000_000);
    state = completeReadyMatches(state, (match) => match.stage !== 'final');
    expect(state.matches
      .filter((match) => match.stage === 'winner' || match.stage === 'loser')
      .every((match) => match.status === 'completed' || match.status === 'skipped')).toBe(true);
    expect(state.matches.find((match) => match.matchId === 'GF-M1')?.status).toBe('ready');
  });
});

function completeReadyMatches(
  initial: ReturnType<typeof createBattleTmpSnapshot>,
  include: (match: ReturnType<typeof createBattleTmpSnapshot>['matches'][number]) => boolean,
) {
  let state = initial;
  for (let iteration = 0; iteration < state.matches.length * 2; iteration += 1) {
    const ready = state.matches.find((match) => include(match) && match.status === 'ready');
    if (!ready) break;
    state = setBattleWinner(state, ready.matchId, (ready.up ?? ready.down)!);
  }
  return state;
}

function setBattleWinner(
  state: ReturnType<typeof createBattleTmpSnapshot>,
  matchId: string,
  winnerId: number,
  updatedAt = Date.now(),
) {
  const match = state.matches.find((candidate) => candidate.matchId === matchId)!;
  return updateBattleTmpResult(
    state,
    matchId,
    match.up === winnerId ? 4 : 1,
    match.down === winnerId ? 4 : 1,
    updatedAt,
  );
}

describe('同组不对战1对2', () => {
  test('每场都是随机签位的跨组第 1 对第 2', () => {
    const plan = createAvoidSameGroupPlan([
      'A1', 'A2', 'B1', 'B2',
      'C1', 'C2', 'D1', 'D2',
    ], seededRandom(7));
    expect(plan.rounds[0].matches.every((match) => {
      const [first, second] = match.entries;
      return first?.kind === 'participant'
        && second?.kind === 'participant'
        && first.participant.groupRank === 1
        && second.participant.groupRank === 2
        && first.participant.groupIndex !== second.participant.groupIndex;
    })).toBe(true);
    expect(plan.positions.map((position) => position.participant?.name)).toEqual(
      plan.rounds[0].matches.flatMap((match) => match.entries.map((entry) => (
        entry?.kind === 'participant' ? entry.participant.name : undefined
      ))),
    );
    expect(plan.positions.every((position) => !position.fixed)).toBe(true);
  });

  test('每个第 1 都能随机到不同场次并始终位于上方', () => {
    const inputs = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
    const positionsByName = new Map(['A1', 'B1', 'C1', 'D1'].map((name) => [name, new Set<number>()]));
    for (let seed = 1; seed <= 64; seed += 1) {
      const plan = createAvoidSameGroupPlan(inputs, seededRandom(seed));
      for (const position of plan.positions) {
        const seen = positionsByName.get(position.participant!.name);
        if (seen) seen.add(position.index);
      }
    }
    for (const positions of positionsByName.values()) {
      expect(new Set([...positions].map((position) => position % 2))).toEqual(new Set([0]));
      expect(new Set([...positions].map((position) => Math.floor(position / 2))).size).toBeGreaterThan(1);
    }
  });

  test('奇数名单会被拒绝', () => {
    expect(() => createAvoidSameGroupPlan(names(5))).toThrow('需要偶数名单');
  });
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
