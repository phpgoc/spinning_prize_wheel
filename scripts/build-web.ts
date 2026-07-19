import { resolve } from 'node:path';
import { readProjectVersion, webBundleDirectory, type BuildVariant } from './project-version';

const workspace = resolve(import.meta.dir, '..');
const variant: BuildVariant = Bun.argv[2] === 'caimi' ? 'caimi' : 'standard';
const version = await readProjectVersion();
const outDir = webBundleDirectory(version, variant);
const arguments_ = ['bun', 'x', 'vite', 'build', '--outDir', outDir];
if (variant === 'caimi') arguments_.push('--mode', 'caimi');

const child = Bun.spawn(arguments_, {
  cwd: workspace,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);

console.log(`Web 产物：${outDir}`);
