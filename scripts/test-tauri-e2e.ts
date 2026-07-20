import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readProjectVersion, webBundleDirectory } from './project-version';

const workspace = resolve(import.meta.dir, '..');
const tauriDirectory = join(workspace, 'src-tauri');
const debugDirectory = join(tauriDirectory, 'target', 'debug');
const generatedStandardConfig = join(tauriDirectory, 'tauri.e2e-standard.conf.json');
const generatedCaimiConfig = join(tauriDirectory, 'tauri.e2e-caimi.conf.json');
const version = await readProjectVersion();

const caimiConfig = JSON.parse(
  await readFile(join(tauriDirectory, 'tauri.caimi.conf.json'), 'utf8'),
) as Record<string, unknown> & { build?: Record<string, unknown> };

await Promise.all([
  writeJson(generatedStandardConfig, {
    version,
    build: { frontendDist: `../${webBundleDirectory(version, 'standard')}` },
    bundle: { active: false },
  }),
  writeJson(generatedCaimiConfig, {
    ...caimiConfig,
    version,
    build: {
      ...caimiConfig.build,
      frontendDist: `../${webBundleDirectory(version, 'caimi')}`,
    },
    bundle: { active: false },
  }),
]);

try {
  await run(['bun', 'x', 'tauri', 'build', '--debug', '--no-bundle', '--config', generatedCaimiConfig]);
  await run(['bun', 'x', 'tauri', 'build', '--debug', '--no-bundle', '--config', generatedStandardConfig]);

  await run(
    ['bun', 'x', 'playwright', 'test', '--config', 'playwright.tauri.config.ts'],
    {
      TAURI_E2E_STANDARD_APP: join(debugDirectory, '转盘.exe'),
      TAURI_E2E_CAIMI_APP: join(debugDirectory, '转盘-猜蜜版.exe'),
    },
  );
} finally {
  await Promise.all([
    rm(generatedStandardConfig, { force: true }),
    rm(generatedCaimiConfig, { force: true }),
  ]);
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function run(command: string[], extraEnvironment: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    cwd: workspace,
    env: { ...Bun.env, ...extraEnvironment },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`命令执行失败：${command.join(' ')}`);
}
