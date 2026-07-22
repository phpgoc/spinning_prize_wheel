export type AppVariant = 'standard' | 'caimi';
export type AppPage = 'wheel' | 'grouping' | 'battle';

export const BUILD_VARIANT: AppVariant = import.meta.env.VITE_APP_VARIANT === 'caimi'
  ? 'caimi'
  : 'standard';

export function variantFromHash(hash: string): AppVariant {
  if (BUILD_VARIANT === 'caimi') return 'caimi';
  return hash.startsWith('#/caimi/') || hash === '#/caimi' ? 'caimi' : 'standard';
}

export function variantRoute(variant: AppVariant, page: AppPage): string {
  return variant === 'caimi' ? `#/caimi/${page}` : `#/${page}`;
}
