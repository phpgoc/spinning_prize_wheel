export type AppVariant = 'standard' | 'caimi';
export type AppPage = 'wheel' | 'grouping' | 'battle';

export const BUILD_VARIANT: AppVariant = import.meta.env.VITE_APP_VARIANT === 'caimi'
  ? 'caimi'
  : 'standard';

export function variantFromPath(pathname: string): AppVariant {
  if (BUILD_VARIANT === 'caimi') return 'caimi';
  return pathname.startsWith('/caimi/') || pathname === '/caimi' ? 'caimi' : 'standard';
}

export function variantRoute(variant: AppVariant, page: AppPage): string {
  return variant === 'caimi' ? `/caimi/${page}` : `/${page}`;
}
