import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // Web 发布包刻意生成单文件，体积告警按完整离线包计算。
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
