<script lang="ts">
  import GroupingWorkspace from '../../components/GroupingWorkspace.svelte';
  import { isTauriRuntime } from '../../lib/runtime';

  const desktopRuntime = isTauriRuntime();
  const businessRuntime = true;
</script>

<GroupingWorkspace {desktopRuntime} {businessRuntime} variant="standard" />
