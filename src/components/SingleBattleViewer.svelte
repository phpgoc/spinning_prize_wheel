<script lang="ts">
  import type { BattleTmpSnapshot } from '../lib/battle';
  import type { BattleBracketLayout } from '../lib/battle-bracket-layout';
  import SingleBattleBracket from './SingleBattleBracket.svelte';
  export let snapshot: BattleTmpSnapshot;
  export let layout: BattleBracketLayout['single'];
  export let maskUnfixed = false;
</script>

<SingleBattleBracket {snapshot} {layout} readOnly maskUnfixed={maskUnfixed} />
