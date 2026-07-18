import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 650,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
