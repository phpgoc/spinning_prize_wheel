import { describe, expect, test } from 'bun:test';
import {
  logicalRouteFromHtmlPath,
  staticPageHref,
  staticVariantHref,
} from './file-navigation';

describe('静态网页版导航', () => {
  test('物理 HTML 路径映射为普通版和猜蜜版逻辑路由', () => {
    expect(logicalRouteFromHtmlPath('/D:/release/index.html')).toBe('/wheel');
    expect(logicalRouteFromHtmlPath('/D:/release/battle.html')).toBe('/battle');
    expect(logicalRouteFromHtmlPath('/D:/release/caimi.html')).toBe('/caimi/wheel');
    expect(logicalRouteFromHtmlPath('/D:/release/caimi/grouping.html')).toBe('/caimi/grouping');
    expect(logicalRouteFromHtmlPath('D:\\release\\caimi\\battle.html')).toBe('/caimi/battle');
    expect(logicalRouteFromHtmlPath('/battle')).toBeNull();
  });

  test('同版本切页和跨版本切换都使用正确的相对文件', () => {
    expect(staticPageHref('grouping')).toBe('grouping.html');
    expect(staticVariantHref('standard', 'caimi', 'battle')).toBe('caimi/battle.html');
    expect(staticVariantHref('caimi', 'standard', 'battle')).toBe('../battle.html');
  });
});
