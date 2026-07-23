<script lang="ts">
  import type { BattleTmpSnapshot } from '../lib/battle';
  import BattleBracketCore from './BattleBracketCore.svelte';

  export let snapshot: BattleTmpSnapshot;
  export let maskUnfixed = false;
  /** 查看模式只显示签表，不提供比分编辑。 */
  export let viewOnly = false;
</script>

<BattleBracketCore {snapshot} readOnly {maskUnfixed} {viewOnly} />
