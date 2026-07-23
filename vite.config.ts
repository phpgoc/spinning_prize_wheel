import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), sveltekit()],
  clearScreen: false,
  optimizeDeps: {
    // 工程位于 Windows 挂载盘时，全量扫描 Svelte 页面会让冷启动卡住很久。
    // 开发服务仍预构建 ExcelJS，确保 CommonJS 互操作稳定；生产构建则保持按需加载。
    noDiscovery: true,
    ...(command === 'serve' ? { include: ['exceljs'] } : {}),
  },
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // 静态资源内联，ExcelJS 仍拆成导出时才请求的独立 chunk。
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/exceljs/')) return 'exceljs';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
