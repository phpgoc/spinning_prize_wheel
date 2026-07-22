<script lang="ts">
  import type { BattleTmpSnapshot } from '../lib/battle';
  import BattleBracketCore from './BattleBracketCore.svelte';

  export let snapshot: BattleTmpSnapshot;
  export let maskUnfixed = false;
  /** 未抽签时仅展示已可确定的首轮签位。 */
  export let previewOnly = false;
</script>

<BattleBracketCore {snapshot} readOnly {maskUnfixed} {previewOnly} />
