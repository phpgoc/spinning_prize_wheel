export interface AutoSaveChange {
  enabled: boolean;
  archived: boolean;
  applied: boolean;
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
