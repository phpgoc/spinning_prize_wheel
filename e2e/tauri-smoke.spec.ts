import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect, test, type Browser } from '@playwright/test';

const applications = [
  { name: '普通版', path: process.env.TAURI_E2E_STANDARD_APP, title: '转盘' },
  { name: '猜蜜版', path: process.env.TAURI_E2E_CAIMI_APP, title: '猜蜜版 · 转盘' },
];

for (const application of applications) {
  test(`真实 Tauri ${application.name}可启动并进入分组页`, async ({}, testInfo) => {
    if (!application.path) throw new Error(`缺少 ${application.name}程序路径`);

    const port = await availablePort();
    const endpoint = `http://127.0.0.1:${port}`;
    const browserArguments = [
      process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
      `--remote-debugging-port=${port}`,
    ].filter(Boolean).join(' ');
    const appProcess = spawn(application.path, [], {
      env: {
        ...globalThis.process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments,
        WHEEL_TEST_DATA_DIR: testInfo.outputPath('data'),
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    let browser: Browser | null = null;

    try {
      await waitForWebView(endpoint, appProcess);
      browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0];
      if (!context) throw new Error('Tauri 没有创建 WebView2 上下文');
      const page = context.pages()[0] ?? await context.waitForEvent('page');

      await expect(page).toHaveTitle(application.title);
      await expect(page.locator('.app-shell.desktop-runtime')).toBeVisible();
      await expect(page.getByRole('button', { name: '转盘', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '分组', exact: true }).click();
      await expect(page).toHaveURL(/#\/(?:caimi\/)?lineup$/);
      await expect(page.locator('.desktop-accordion-toggle').filter({ hasText: '排名' })).toBeVisible();
    } finally {
      await browser?.close().catch(() => undefined);
      await stopProcess(appProcess);
    }
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法分配 WebView2 调试端口'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForWebView(endpoint: string, process: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Tauri 提前退出，退出码 ${process.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {
      // WebView2 启动期间端口尚未开放，继续短间隔轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('等待 Tauri WebView2 调试端口超时');
}

async function stopProcess(process: ChildProcess) {
  if (process.exitCode !== null) return;
  process.kill();
  await Promise.race([
    new Promise((resolve) => process.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
