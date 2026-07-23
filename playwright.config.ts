import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: /tauri-.*\.spec\.ts$/u,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 4,
  reporter: 'line',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env.CI !== 'true',
    timeout: 60_000,
  },
});
