import { variantRoute, type AppPage, type AppVariant } from './app-variant';

/** 把静态发布目录中的物理 HTML 路径映射回应用逻辑路由。 */
export function logicalRouteFromHtmlPath(pathname: string): string | null {
  const normalized = pathname.replaceAll('\\', '/');
  const filename = normalized.slice(normalized.lastIndexOf('/') + 1).toLocaleLowerCase('en-US');
  if (!filename.endsWith('.html')) return null;

  const page: AppPage = filename === 'battle.html'
    ? 'battle'
    : filename === 'grouping.html'
      ? 'grouping'
      : 'wheel';
  const variant: AppVariant = normalized.toLocaleLowerCase('en-US').includes('/caimi/')
    || filename === 'caimi.html'
    ? 'caimi'
    : 'standard';
  return variantRoute(variant, page);
}

/** 同一静态目录内切换业务页面时只跳到对应物理 HTML。 */
export function staticPageHref(page: AppPage): string {
  return `${page}.html`;
}

/** 普通版位于根目录，猜蜜版位于 caimi 子目录。 */
export function staticVariantHref(
  currentVariant: AppVariant,
  nextVariant: AppVariant,
  page: AppPage,
): string {
  if (currentVariant === nextVariant) return staticPageHref(page);
  return nextVariant === 'caimi' ? `caimi/${page}.html` : `../${page}.html`;
}
