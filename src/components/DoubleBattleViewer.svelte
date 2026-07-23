<script lang="ts">
  import type { BattleTmpSnapshot } from '../lib/battle';
  import type { BattleBracketLayout } from '../lib/battle-bracket-layout';
  import DoubleBattleBracket from './DoubleBattleBracket.svelte';
  export let snapshot: BattleTmpSnapshot;
  export let layout: BattleBracketLayout;
  export let maskUnfixed = false;
</script>

<DoubleBattleBracket {snapshot} {layout} readOnly maskUnfixed={maskUnfixed} />
