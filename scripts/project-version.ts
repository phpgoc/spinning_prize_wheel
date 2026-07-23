import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dir, '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type BuildVariant = 'standard' | 'caimi';
export type ReleaseArtifactKind = 'web' | 'setup';

export async function readProjectVersion(): Promise<string> {
  const version = (await readFile(resolve(workspace, 'version'), 'utf8')).trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error('version 文件必须是有效版本号，例如 1.2.3 或 1.2.3-beta.1');
  }
  return version;
}

export function webBundleName(version: string, variant: BuildVariant): string {
  return variant === 'caimi' ? `转盘-猜蜜版-${version}` : `转盘-${version}`;
}

export function webBundleDirectory(version: string, variant: BuildVariant): string {
  return `dist/${webBundleName(version, variant)}`;
}

export function releaseArtifactName(version: string, kind: ReleaseArtifactKind): string {
  const extension = kind === 'web' ? 'web.zip' : 'setup.exe';
  const name = `wheel-${version}-${extension}`;
  if (/[^\x20-\x7e]/u.test(name)) {
    throw new Error('上传 GitHub Release 的包名只能包含 ASCII 字符');
  }
  return name;
}
