import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dir, '..');

// 只清理明确的构建输出，不触碰源代码、依赖和用户数据库。
const directories = [
  '.svelte-kit',
  'build',
  'dist',
  'test-results',
  'playwright-report',
  'src-tauri/target',
  'src-tauri/binaries',
];

for (const directory of directories) {
  await rm(resolve(workspace, directory), { recursive: true, force: true });
}

const releasePattern = /^wheel-[^/\\]+-(?:web\.zip|setup\.exe)$/u;
for (const entry of await readdir(workspace)) {
  if (releasePattern.test(entry)) await rm(resolve(workspace, entry), { force: true });
}

console.log('已清理 Web、Tauri、E2E 和发布产物。');
