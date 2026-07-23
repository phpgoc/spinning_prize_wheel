import {
  battleRoundLabel,
  type BattleTmpMatch,
  type BattleTmpSnapshot,
} from './battle';

export interface BattleRoundGroup {
  id: string;
  label: string;
  stage: BattleTmpMatch['stage'];
  matches: BattleTmpMatch[];
}

export interface BattleBracketLayout {
  groups: BattleRoundGroup[];
  winner: BattleRoundGroup[];
  loser: BattleRoundGroup[];
  final: BattleRoundGroup[];
  single: {
    left: BattleRoundGroup[];
    right: BattleRoundGroup[];
    final: BattleTmpMatch | null;
  };
}

export function createBattleBracketLayout(snapshot: BattleTmpSnapshot): BattleBracketLayout {
  const groups = groupBattleTmpMatches(snapshot);
  return {
    groups,
    winner: groups.filter((group) => group.stage === 'winner'),
    loser: groups.filter((group) => group.stage === 'loser'),
    final: groups.filter((group) => group.stage === 'final'),
    single: createSingleBattleLayout(snapshot, groups),
  };
}

function groupBattleTmpMatches(snapshot: BattleTmpSnapshot): BattleRoundGroup[] {
  const groups = new Map<string, BattleRoundGroup>();
  for (const match of snapshot.matches) {
    const id = `${match.stage}-${match.level}`;
    const group = groups.get(id) ?? { id, label: '', stage: match.stage, matches: [] };
    group.matches.push(match);
    groups.set(id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    label: battleRoundLabel(snapshot.format, group.stage, group.matches[0].level, group.matches.length),
  }));
}

function createSingleBattleLayout(
  snapshot: BattleTmpSnapshot,
  groups: BattleRoundGroup[],
): BattleBracketLayout['single'] {
  if (snapshot.format !== 'single-elimination' && snapshot.format !== 'avoid-first-pair') {
    return { left: [], right: [], final: null };
  }
  const levels = groups.filter((group) => group.stage === 'single');
  const finalGroup = levels.at(-1);
  const sideLevels = levels.slice(0, -1);
  const left = sideLevels.map((group) => ({
    ...group,
    matches: group.matches.slice(0, Math.ceil(group.matches.length / 2)),
  }));
  const right = sideLevels.map((group) => ({
    ...group,
    matches: group.matches.slice(Math.ceil(group.matches.length / 2)),
  })).reverse();
  return { left, right, final: finalGroup?.matches[0] ?? null };
}
