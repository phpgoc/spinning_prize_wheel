import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export interface RuntimeCapabilities {
  tauri: boolean;
  persistentDatabase: boolean;
  nativeWindow: boolean;
  nativeFolders: boolean;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown; metadata?: { currentWindow?: unknown } };
  }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' && internals.metadata?.currentWindow !== undefined;
}

/** 浏览器和 Tauri 共用的命令入口，页面不再直接依赖具体运行时。 */
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (isTauriRuntime()) return tauriInvoke<T>(command, args);
  const { invokeWebCommand } = await import('./web-database');
  return invokeWebCommand<T>(command, args);
}

export function runtimeCapabilities(): RuntimeCapabilities {
  const tauri = isTauriRuntime();
  return {
    tauri,
    persistentDatabase: typeof window !== 'undefined' && (tauri || 'indexedDB' in window),
    nativeWindow: tauri,
    nativeFolders: tauri,
  };
}
