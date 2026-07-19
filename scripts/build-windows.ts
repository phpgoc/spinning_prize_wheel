import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readProjectVersion, webBundleDirectory } from './project-version';

type BuildStage = 'full' | 'caimi' | 'installer';

const workspace = resolve(import.meta.dir, '..');
const tauriDirectory = join(workspace, 'src-tauri');
const releaseDirectory = join(tauriDirectory, 'target', 'release');
const generatedCaimiConfig = join(tauriDirectory, 'tauri.version-caimi.conf.json');
const generatedInstallerConfig = join(tauriDirectory, 'tauri.version-installer.conf.json');
const stage = (Bun.argv[2] ?? 'full') as BuildStage;
if (!['full', 'caimi', 'installer'].includes(stage)) {
  throw new Error('Windows 构建阶段只支持 full、caimi 或 installer');
}

const version = await readProjectVersion();
const caimiConfig = JSON.parse(
  await readFile(join(tauriDirectory, 'tauri.caimi.conf.json'), 'utf8'),
) as Record<string, unknown> & { build?: Record<string, unknown> };
const versionedCaimiConfig = {
  ...caimiConfig,
  version,
  build: {
    ...caimiConfig.build,
    frontendDist: `../${webBundleDirectory(version, 'caimi')}`,
  },
};
const versionedInstallerConfig = {
  version,
  build: {
    frontendDist: `../${webBundleDirectory(version, 'standard')}`,
  },
  bundle: {
    externalBin: ['binaries/转盘-猜蜜版'],
  },
};

await writeFile(generatedCaimiConfig, `${JSON.stringify(versionedCaimiConfig, null, 2)}\n`, 'utf8');
await writeFile(generatedInstallerConfig, `${JSON.stringify(versionedInstallerConfig, null, 2)}\n`, 'utf8');

try {
  if (stage !== 'installer') {
    await run(['bun', 'x', 'tauri', 'build', '--no-bundle', '--config', generatedCaimiConfig]);
    await prepareCaimiSidecar();
  }
  if (stage !== 'caimi') {
    await clearOldInstallers();
    await run(['bun', 'x', 'tauri', 'build', '--config', generatedInstallerConfig]);
    await renameInstaller();
  }
} finally {
  await Promise.all([
    rm(generatedCaimiConfig, { force: true }),
    rm(generatedInstallerConfig, { force: true }),
  ]);
}

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: workspace,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`构建命令失败：${command.join(' ')}`);
}

async function prepareCaimiSidecar() {
  const source = join(releaseDirectory, '转盘-猜蜜版.exe');
  const sidecar = join(
    tauriDirectory,
    'binaries',
    '转盘-猜蜜版-x86_64-pc-windows-msvc.exe',
  );
  await mkdir(dirname(sidecar), { recursive: true });
  await copyFile(source, sidecar);
}

async function clearOldInstallers() {
  const installerDirectory = join(releaseDirectory, 'bundle', 'nsis');
  const entries = await readdir(installerDirectory, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('zh-CN').endsWith('.exe'))
    .map((entry) => rm(join(installerDirectory, entry.name), { force: true })));
}

async function renameInstaller() {
  const installerDirectory = join(releaseDirectory, 'bundle', 'nsis');
  const entries = await readdir(installerDirectory, { withFileTypes: true });
  const installers = entries.filter(
    (entry) => entry.isFile() && entry.name.toLocaleLowerCase('zh-CN').endsWith('.exe'),
  );
  if (installers.length !== 1) {
    throw new Error(`NSIS 目录中应当只有一个安装包，实际为 ${installers.length} 个`);
  }
  const targetName = `转盘-${version}-setup.exe`;
  if (installers[0].name !== targetName) {
    await rename(join(installerDirectory, installers[0].name), join(installerDirectory, targetName));
  }
  console.log(`Windows 安装包：src-tauri/target/release/bundle/nsis/${targetName}`);
}
