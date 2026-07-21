import { describe, expect, test } from 'bun:test';
import {
  battleFixedSeedOptions,
  createAvoidSameGroupPlan,
  createFixedBattlePositions,
  createSeededBattlePlan,
  standardBracketSeedOrder,
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
  });
});

describe('同组不对战1对2', () => {
  test('每个第 1 只匹配其他组的第 2', () => {
    const plan = createAvoidSameGroupPlan([
      'A1', 'B1', 'C1', 'D1',
      'A2', 'B2', 'C2', 'D2',
    ], () => 0);
    expect(plan.rounds[0].matches.map((match) => match.entries.map((entry) => (
      entry?.kind === 'participant' ? entry.participant.name : null
    )))).toEqual([
      ['A1', 'B2'],
      ['B1', 'C2'],
      ['C1', 'D2'],
      ['D1', 'A2'],
    ]);
    expect(plan.rounds[0].matches.every((match) => {
      const [first, second] = match.entries;
      return first?.kind === 'participant'
        && second?.kind === 'participant'
        && first.participant.groupRank === 1
        && second.participant.groupRank === 2
        && first.participant.groupIndex !== second.participant.groupIndex;
    })).toBe(true);
  });

  test('奇数名单会被拒绝', () => {
    expect(() => createAvoidSameGroupPlan(names(5))).toThrow('需要偶数名单');
  });
});
