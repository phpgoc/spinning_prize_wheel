import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readProjectVersion, webBundleDirectory } from './project-version';

const workspace = resolve(import.meta.dir, '..');
const tauriDirectory = join(workspace, 'src-tauri');
// 真实桌面测试使用独立构建目录，避免 tauri:dev 正在运行时锁住调试程序。
const e2eTargetDirectory = join(tauriDirectory, 'target', 'e2e');
const debugDirectory = join(e2eTargetDirectory, 'debug');
const generatedStandardConfig = join(tauriDirectory, 'tauri.e2e-standard.conf.json');
const generatedCaimiConfig = join(tauriDirectory, 'tauri.e2e-caimi.conf.json');
const version = await readProjectVersion();
const commandArguments = process.argv.slice(2).filter((argument) => argument !== '--');
const fixedBattleMode = commandArguments.includes('--fixed');
const requestedBattleCount = commandArguments.find((argument) => argument === 'all' || /^\d+$/u.test(argument));

if (fixedBattleMode && requestedBattleCount && requestedBattleCount !== 'all') {
  const count = Number(requestedBattleCount);
  if (!Number.isInteger(count) || count < 8 || count > 33) {
    throw new Error(`前 N 固定 E2E 的人数必须在 8 到 33 之间，收到 ${requestedBattleCount}`);
  }
}
if (!fixedBattleMode && requestedBattleCount) {
  throw new Error('人数参数只适用于 bun run test:e2e:tauri:fixed -- <8-33|all>');
}

const caimiConfig = JSON.parse(
  await readFile(join(tauriDirectory, 'tauri.caimi.conf.json'), 'utf8'),
) as Record<string, unknown> & { build?: Record<string, unknown> };

await Promise.all([
  writeJson(generatedStandardConfig, {
    version,
    identifier: 'com.phpgoc.wheel.e2e',
    build: { frontendDist: `../${webBundleDirectory(version, 'standard')}` },
    bundle: { active: false },
  }),
  writeJson(generatedCaimiConfig, {
    ...caimiConfig,
    version,
    identifier: 'com.phpgoc.wheel.caimi.e2e',
    build: {
      ...caimiConfig.build,
      frontendDist: `../${webBundleDirectory(version, 'caimi')}`,
    },
    bundle: { active: false },
  }),
]);

try {
  const buildEnvironment = { CARGO_TARGET_DIR: e2eTargetDirectory };
  if (!fixedBattleMode) {
    await run(['bun', 'x', 'tauri', 'build', '--debug', '--no-bundle', '--config', generatedCaimiConfig], buildEnvironment);
  }
  await run(['bun', 'x', 'tauri', 'build', '--debug', '--no-bundle', '--config', generatedStandardConfig], buildEnvironment);

  const playwrightArguments = ['bun', 'x', 'playwright', 'test', '--config', 'playwright.tauri.config.ts'];
  if (fixedBattleMode) {
    // 真实桌面窗口本身保持可见；--headed 让命令语义和人工观察模式一致。
    playwrightArguments.push('--headed', '--grep', '慢速检查前 N 固定签位');
  }
  await run(
    playwrightArguments,
    {
      TAURI_E2E_STANDARD_APP: join(debugDirectory, '转盘.exe'),
      TAURI_E2E_CAIMI_APP: join(debugDirectory, '转盘-猜蜜版.exe'),
      ...(fixedBattleMode ? { TAURI_BATTLE_COUNT: requestedBattleCount ?? 'all' } : {}),
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
