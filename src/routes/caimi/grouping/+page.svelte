<script lang="ts">
  import { onMount } from 'svelte';
  import GroupingWorkspace from '../../../components/GroupingWorkspace.svelte';

  let desktopRuntime = false;

  onMount(() => {
    desktopRuntime = '__TAURI_INTERNALS__' in window;
  });
</script>

<GroupingWorkspace {desktopRuntime} variant="caimi" />
