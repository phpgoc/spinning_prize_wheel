export interface AutoSaveChange {
  enabled: boolean;
  archived: boolean;
  applied: boolean;
}

export interface AutoSaveCloseHooks {
  enabled: () => boolean;
  effectiveResultCount: () => number;
  stopContinuous: () => void;
  waitForSpin: () => Promise<void>;
  waitForSaving: () => Promise<void>;
  saveCurrent: () => Promise<boolean>;
}

/** 只有开启自动保存，且当前或即将产生有效统计时，才需要拦截窗口关闭。 */
export function shouldHandleAutoSaveClose(
  enabled: boolean,
  effectiveResultCount: number,
  spinning: boolean,
  saving: boolean,
): boolean {
  return enabled && (
    spinning
    || saving
    || Math.max(0, Math.floor(Number(effectiveResultCount) || 0)) > 0
  );
}

/** 等待当前抽奖自然结束，并在退出前完成自动归档。 */
export async function prepareAutoSaveClose(hooks: AutoSaveCloseHooks): Promise<boolean> {
  if (!hooks.enabled()) return true;
  hooks.stopContinuous();
  await hooks.waitForSpin();
  await hooks.waitForSaving();
  if (!hooks.enabled() || hooks.effectiveResultCount() <= 0) return true;
  return hooks.saveCurrent();
}

/**
 * 统一设置按钮和快捷键的自动保存切换流程，只有保存成功后才清空当前统计。
 */
export async function changeAutoSaveHistory(
  currentlyEnabled: boolean,
  effectiveResultCount: number,
  saveCurrent: () => Promise<boolean>,
  resetCurrent: () => void,
): Promise<AutoSaveChange> {
  if (currentlyEnabled) {
    return { enabled: false, archived: false, applied: true };
  }

  if (Math.max(0, Math.floor(Number(effectiveResultCount) || 0)) === 0) {
    return { enabled: true, archived: false, applied: true };
  }

  if (!await saveCurrent()) {
    return { enabled: false, archived: false, applied: false };
  }

  resetCurrent();
  return { enabled: true, archived: true, applied: true };
}
