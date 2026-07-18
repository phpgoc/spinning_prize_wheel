import { copyFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const workspace = resolve(import.meta.dir, '..');
const releaseDirectory = join(workspace, 'src-tauri', 'target', 'release');
const source = join(releaseDirectory, '转盘-猜蜜版.exe');
const sidecar = join(
  workspace,
  'src-tauri',
  'binaries',
  '转盘-猜蜜版-x86_64-pc-windows-msvc.exe',
);

// Tauri 会去掉目标三元组后缀，并把完整的猜蜜版程序放到主安装目录。
await mkdir(dirname(sidecar), { recursive: true });
await copyFile(source, sidecar);

// 清掉旧安装包，保证正式构建目录最终只留下一个双程序安装包。
const installerDirectory = join(releaseDirectory, 'bundle', 'nsis');
try {
  const entries = await readdir(installerDirectory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-setup.exe'))
    .map((entry) => unlink(join(installerDirectory, entry.name))));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

console.log(`已准备猜蜜版程序：${sidecar}`);
