<script lang="ts">
  import BattlePage from '../../BattlePage.svelte';
  import { isTauriRuntime } from '../../../lib/runtime';

  const desktopRuntime = isTauriRuntime();
  const businessRuntime = true;
</script>

<BattlePage {desktopRuntime} {businessRuntime} variant="caimi" />
