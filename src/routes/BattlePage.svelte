<script lang="ts">
  import type { AppVariant } from '../lib/app-variant';
  import GroupingWorkspace from '../components/GroupingWorkspace.svelte';

export let desktopRuntime = false;
export let businessRuntime = true;
  export let variant: AppVariant = 'standard';
</script>

<GroupingWorkspace purpose="battle" {desktopRuntime} {businessRuntime} {variant} />
