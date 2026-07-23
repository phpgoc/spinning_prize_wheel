import { describe, expect, test } from 'bun:test';
import { releaseArtifactName, webBundleName } from './project-version';

describe('发布产物命名', () => {
  test('上传包只使用 ASCII 名称', () => {
    const artifacts = [
      releaseArtifactName('0.2.0', 'web'),
      releaseArtifactName('0.2.0', 'setup'),
    ];
    expect(artifacts).toEqual(['wheel-0.2.0-web.zip', 'wheel-0.2.0-setup.exe']);
    expect(artifacts.every((name) => !/[^\x20-\x7e]/u.test(name))).toBe(true);
  });

  test('安装包内部使用的构建产物仍保留中文名称', () => {
    expect(webBundleName('0.2.0', 'standard')).toBe('转盘-0.2.0');
    expect(webBundleName('0.2.0', 'caimi')).toBe('转盘-猜蜜版-0.2.0');
  });
});
