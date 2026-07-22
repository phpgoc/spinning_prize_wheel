<script lang="ts">
  import type { BattleTmpSnapshot } from './battle';
  import BattleBracketCore from './BattleBracketCore.svelte';

  export let snapshot: BattleTmpSnapshot;
  export let maskUnfixed = false;
</script>

<BattleBracketCore {snapshot} readOnly {maskUnfixed} />
