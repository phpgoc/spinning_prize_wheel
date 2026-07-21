<script lang="ts">
  import type { AppVariant } from './app-variant';
  import RandomLineup from './RandomLineup.svelte';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';
</script>

<RandomLineup purpose="battle" {desktopRuntime} {variant} />
