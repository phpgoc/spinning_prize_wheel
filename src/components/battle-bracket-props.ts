import type { BattleTmpMatch, BattleTmpSnapshot } from '../lib/battle';

export type BattleSide = 'up' | 'down';
export type BattleScorePosition = 'left' | 'right';

export interface BattleBracketProps {
  snapshot: BattleTmpSnapshot;
  readOnly?: boolean;
  maskUnfixed?: boolean;
  hiddenSlotKeys?: ReadonlySet<string>;
  saving?: boolean;
  onMatchKeydown?: (event: KeyboardEvent) => void;
  onScoreFocus?: (event: FocusEvent) => void;
  onScoreKeydown?: (match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void;
  onScoreChange?: (match: BattleTmpMatch, side: BattleSide, event: Event) => void;
  onReveal?: (match: BattleTmpMatch, side: BattleSide) => void;
}
