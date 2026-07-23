<script lang="ts">
  import { page } from '$app/state';
  import App from '../App.svelte';
  import '../app.css';

  let { children } = $props();
</script>

<App pathname={page.url.pathname}>
  {@render children()}
</App>
