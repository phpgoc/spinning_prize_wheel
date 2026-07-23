<script lang="ts">
  import { onMount } from 'svelte';
  import BattlePage from '../BattlePage.svelte';

  let desktopRuntime = false;

  onMount(() => {
    desktopRuntime = '__TAURI_INTERNALS__' in window;
  });
</script>

<BattlePage {desktopRuntime} variant="standard" />
