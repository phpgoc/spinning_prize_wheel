import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/** 启动真实 Tauri 程序，并通过 WebView2 调试端口交给 Playwright 操作。 */
export async function launchTauri(path: string, dataDirectory: string) {
  const port = await availablePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const downloadDirectory = join(dataDirectory, 'downloads');
  const browserArguments = [
    process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(dataDirectory, 'webview2')}`,
  ].filter(Boolean).join(' ');
  const appProcess = spawn(path, [], {
    env: {
      ...globalThis.process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments,
      WHEEL_TEST_DATA_DIR: dataDirectory,
      WHEEL_TEST_DOWNLOAD_DIR: downloadDirectory,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await waitForWebView(endpoint, appProcess);
  } catch (error) {
    await stopProcess(appProcess);
    throw error;
  }
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    await stopProcess(appProcess);
    throw new Error('Tauri 没有创建 WebView2 上下文');
  }
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  return { endpoint, process: appProcess, browser, page, downloadDirectory };
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

export async function stopProcess(process: ChildProcess) {
  if (process.exitCode !== null) return;
  process.kill();
  await Promise.race([
    new Promise((resolve) => process.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
