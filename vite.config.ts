import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  clearScreen: false,
  optimizeDeps: {
    // 工程位于 Windows 挂载盘时，全量扫描 Svelte 页面会让冷启动卡住很久。
    // ExcelJS 是唯一必须预构建的 CommonJS 依赖，其余依赖均可直接按 ESM 提供。
    noDiscovery: true,
    include: ['exceljs'],
  },
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
