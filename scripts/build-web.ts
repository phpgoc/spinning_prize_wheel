import { resolve } from 'node:path';
import { readProjectVersion, releaseArtifactName, webBundleDirectory, type BuildVariant } from './project-version';

const workspace = resolve(import.meta.dir, '..');
const variant: BuildVariant = Bun.argv[2] === 'caimi' ? 'caimi' : 'standard';
const version = await readProjectVersion();
const outDir = webBundleDirectory(version, variant);
const arguments_ = ['bun', 'x', 'vite', 'build'];
if (variant === 'caimi') arguments_.push('--mode', 'caimi');

await run(arguments_);

console.log(`Web 产物：${outDir}`);
if (variant === 'standard') {
  const archiveName = releaseArtifactName(version, 'web');
  await createWebArchive(
    resolve(workspace, outDir),
    resolve(workspace, archiveName),
  );
  console.log(`Web ZIP：${archiveName}`);
}

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: workspace,
    env: { ...process.env, WEB_BUILD_OUT_DIR: outDir },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`构建命令失败：${command.join(' ')}`);
}

async function createWebArchive(bundleDirectory: string, archivePath: string) {
  const script = [
    `$bundleDirectory = ${powerShellLiteral(bundleDirectory)}`,
    `$archivePath = ${powerShellLiteral(archivePath)}`,
    'Compress-Archive -Path (Join-Path $bundleDirectory "*") -DestinationPath $archivePath -Force',
  ].join('; ');
  await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script]);
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
