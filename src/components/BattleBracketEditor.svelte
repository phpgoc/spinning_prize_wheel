<script lang="ts">
  import type { BattleTmpMatch, BattleTmpSnapshot } from '../lib/battle';
  import BattleBracketCore from './BattleBracketCore.svelte';

  type BattleSide = 'up' | 'down';

  export let snapshot: BattleTmpSnapshot;
  export let hiddenSlotKeys: ReadonlySet<string> = new Set();
  export let saving = false;
  export let onMatchKeydown: (event: KeyboardEvent) => void;
  export let onScoreFocus: (event: FocusEvent) => void;
  export let onScoreKeydown: (match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void;
  export let onScoreChange: (match: BattleTmpMatch, side: BattleSide, event: Event) => void;
  export let onReveal: (match: BattleTmpMatch, side: BattleSide) => void;
</script>

<BattleBracketCore
  {snapshot}
  {hiddenSlotKeys}
  {saving}
  {onMatchKeydown}
  {onScoreFocus}
  {onScoreKeydown}
  {onScoreChange}
  {onReveal}
/>
