import { dirname, relative, resolve } from 'node:path';
import { copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readProjectVersion, releaseArtifactName, webBundleDirectory, type BuildVariant } from './project-version';

const workspace = resolve(import.meta.dir, '..');
const variant: BuildVariant = Bun.argv[2] === 'caimi' ? 'caimi' : 'standard';
const version = await readProjectVersion();
const outDir = webBundleDirectory(version, variant);
const arguments_ = ['bun', 'x', 'vite', 'build'];
if (variant === 'caimi') arguments_.push('--mode', 'caimi');

await run(arguments_);
await createFileModeBundle(resolve(workspace, outDir));
await copyFile(resolve(import.meta.dir, 'web-launcher.bat'), resolve(workspace, outDir, '启动网页版.bat'));
await copyFile(resolve(import.meta.dir, 'web-launcher.ps1'), resolve(workspace, outDir, 'web-launcher.ps1'));

console.log(`Web 产物：${outDir}`);
if (variant === 'standard') {
  const archiveName = releaseArtifactName(version, 'web');
  await createWebArchive(
    resolve(workspace, outDir),
    resolve(workspace, archiveName),
  );
  console.log(`Web ZIP：${archiveName}`);
}

async function run(command: string[], cwd = workspace) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, WEB_BUILD_OUT_DIR: outDir },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`构建命令失败：${command.join(' ')}`);
}

async function createWebArchive(bundleDirectory: string, archivePath: string) {
  if (process.platform !== 'win32') {
    // Linux/WSL 的自动化环境没有 powershell.exe，使用系统 zip 保持压缩包内容与 Windows 一致。
    await run(['zip', '-q', '-r', archivePath, '.'], bundleDirectory);
    return;
  }
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

/** 把 SvelteKit 的模块图合并成 file:// 可以执行的单脚本，并内联构建 CSS。 */
async function createFileModeBundle(bundleDirectory: string) {
  const entryDirectory = resolve(bundleDirectory, '_app', 'immutable', 'entry');
  const [startEntry, appEntry] = await Promise.all([
    findSingleFile(entryDirectory, /^start\..+\.js$/u),
    findSingleFile(entryDirectory, /^app\..+\.js$/u),
  ]);
  const htmlPath = resolve(bundleDirectory, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  const marker = html.match(/__sveltekit_[A-Za-z0-9_]+/u)?.[0];
  if (!marker) throw new Error('无法读取 SvelteKit 启动标识');

  const bootstrapPath = resolve(bundleDirectory, '.file-bootstrap.ts');
  const bundlePath = resolve(bundleDirectory, 'file-mode.js');
  const bootstrap = `
import { start } from './_app/immutable/entry/${startEntry}';
import * as app from './_app/immutable/entry/${appEntry}';

globalThis.${marker} = { base: '', data: {} };
const element = document.querySelector('body > div');
if (!element) throw new Error('找不到 SvelteKit 根节点');
start(app, element);
`;
  await writeFile(bootstrapPath, bootstrap, 'utf8');
  const result = await Bun.build({
    entrypoints: [bootstrapPath],
    outfile: bundlePath,
    format: 'iife',
    target: 'browser',
    minify: true,
    plugins: [{
      name: 'inline-file-mode-dependencies',
      setup(build) {
        build.onLoad({ filter: /\.js$/u }, async (args) => {
          if (!args.path.startsWith(bundleDirectory)) return undefined;
          const contents = await readFile(args.path, 'utf8');
          return {
            // Bun 已把动态模块合并进单脚本，CSS 也会内联，禁止 Vite 再预加载 file:// 外部模块。
            contents: contents.replace(/__vite__mapDeps\(\[[\d,\s]*\]\)/gu, '[]'),
            loader: 'js',
          };
        });
      },
    }],
  });
  await rm(bootstrapPath, { force: true });
  if (!result.success) {
    throw new Error(`无法生成 file:// 单脚本：${result.logs.map((log) => log.message).join('；')}`);
  }
  const output = result.outputs[0];
  if (!output) throw new Error('file:// 单脚本没有生成输出');
  const bundle = (await new Response(output.stream()).text())
    .replaceAll('import.meta.url', 'document.baseURI');
  if (/\.\.\/(?:assets|chunks|nodes)\//u.test(bundle) || bundle.includes('_app/immutable/')) {
    throw new Error('file:// 单脚本仍引用外部构建模块');
  }
  await writeFile(bundlePath, bundle, 'utf8');

  const cssDirectory = resolve(bundleDirectory, '_app', 'immutable', 'assets');
  const cssFiles = (await readdir(cssDirectory)).filter((file) => file.endsWith('.css')).sort();
  const css = (await Promise.all(cssFiles.map((file) => readFile(resolve(cssDirectory, file), 'utf8')))).join('\n');
  const htmlFiles = await findHtmlFiles(bundleDirectory);
  for (const file of htmlFiles) {
    const source = await readFile(file, 'utf8');
    const rootPrefix = relative(dirname(file), bundleDirectory).replaceAll('\\', '/');
    const assetPrefix = rootPrefix ? `${rootPrefix}/` : './';
    const rewritten = source
      .replace(/\s*<link[^>]+rel="modulepreload"[^>]*>/gu, '')
      .replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/gu, '')
      .replace(/<link data-app-favicon([^>]+)href="\/(?:favicon\.ico)"/u, `<link data-app-favicon$1href="${assetPrefix}favicon.ico"`)
      .replace(/<script>\s*\{\s*__sveltekit_[\s\S]*?<\/script>/u, `<script src="${assetPrefix}file-mode.js"></script>`)
      .replace('</head>', `<style data-file-mode-css>${css}</style></head>`);
    await writeFile(file, rewritten, 'utf8');
  }
  await rm(resolve(bundleDirectory, '_app'), { recursive: true, force: true });
  await rm(resolve(bundleDirectory, '200.html'), { force: true });
}

async function findSingleFile(directory: string, pattern: RegExp): Promise<string> {
  const files = (await readdir(directory)).filter((file) => pattern.test(file));
  if (files.length !== 1) throw new Error(`无法定位构建入口：${pattern}`);
  return files[0];
}

async function findHtmlFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await findHtmlFiles(path));
    else if (entry.name.endsWith('.html')) result.push(path);
  }
  return result;
}
