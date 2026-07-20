import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

await makeLocalFileCompatible(resolve(workspace, outDir, 'index.html'));
console.log(`Web 产物：${outDir}`);

async function makeLocalFileCompatible(indexPath: string) {
  const moduleScript = /<script type="module" crossorigin src="([^"]+)"><\/script>/u;
  const stylesheet = /<link rel="stylesheet" crossorigin href="([^"]+)">/u;
  let html = await readFile(indexPath, 'utf8');
  const scriptMatch = html.match(moduleScript);
  if (!scriptMatch) {
    throw new Error('Web 产物中没有找到 Vite 入口脚本，无法生成本地可打开版本');
  }

  const scriptPath = resolve(dirname(indexPath), scriptMatch[1]);
  const script = (await readFile(scriptPath, 'utf8')).replaceAll('</script', '<\\/script');
  html = html.replace(moduleScript, () => '');
  html = html.replace('</body>', () => `    <script>${script}</script>\n  </body>`);
  await rm(scriptPath, { force: true });

  let styleMatch = html.match(stylesheet);
  while (styleMatch) {
    const stylePath = resolve(dirname(indexPath), styleMatch[1]);
    const style = await readFile(stylePath, 'utf8');
    html = html.replace(stylesheet, () => `<style>${style}</style>`);
    await rm(stylePath, { force: true });
    styleMatch = html.match(stylesheet);
  }

  if (html.includes('/assets/') || html.includes('type="module"')) {
    throw new Error('Web 产物仍包含根目录资源或 ES module，不能直接从本地打开');
  }
  // 让桌面 WebView 在脚本完全启动前也显示正确的版本标题。
  const initialTitle = variant === 'caimi' ? '猜蜜版 · 转盘抽签 · 转盘' : '转盘抽签 · 转盘';
  html = html.replace('<title>转盘</title>', `<title>${initialTitle}</title>`);
  await writeFile(indexPath, html, 'utf8');
  await rm(resolve(dirname(indexPath), 'assets'), { recursive: true, force: true });
}
