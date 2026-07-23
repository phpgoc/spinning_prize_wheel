<script lang="ts">
  import type { BattleTmpSnapshot } from '../lib/battle';
  import type { BattleBracketLayout } from '../lib/battle-bracket-layout';
  import SingleBattleBracket from './SingleBattleBracket.svelte';
  import type { BattleBracketProps } from './battle-bracket-props';
  export let snapshot: BattleTmpSnapshot;
  export let layout: BattleBracketLayout['single'];
  export let hiddenSlotKeys: BattleBracketProps['hiddenSlotKeys'] = new Set();
  export let saving = false;
  export let onMatchKeydown: BattleBracketProps['onMatchKeydown'] = undefined;
  export let onScoreFocus: BattleBracketProps['onScoreFocus'] = undefined;
  export let onScoreKeydown: BattleBracketProps['onScoreKeydown'] = undefined;
  export let onScoreChange: BattleBracketProps['onScoreChange'] = undefined;
  export let onReveal: BattleBracketProps['onReveal'] = undefined;
</script>

<SingleBattleBracket {snapshot} {layout} {hiddenSlotKeys} {saving} {onMatchKeydown} {onScoreFocus} {onScoreKeydown} {onScoreChange} {onReveal} />
