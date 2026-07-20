import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  clearScreen: false,
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // Web 发布包刻意生成单文件，体积告警按完整离线包计算。
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
