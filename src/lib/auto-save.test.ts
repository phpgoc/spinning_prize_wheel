import { describe, expect, mock, test } from 'bun:test';
import {
  changeAutoSaveHistory,
  prepareAutoSaveClose,
  shouldHandleAutoSaveClose,
} from './auto-save';

describe('自动保存历史开关', () => {
  test('关闭开关时不保存也不清空', async () => {
    const save = mock(async () => true);
    const reset = mock(() => {});

    expect(await changeAutoSaveHistory(true, 8, save, reset)).toEqual({
      enabled: false,
      archived: false,
      applied: true,
    });
    expect(save).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  test('没有有效结果时开启但不保存', async () => {
    const save = mock(async () => true);
    const reset = mock(() => {});

    expect(await changeAutoSaveHistory(false, 0, save, reset)).toEqual({
      enabled: true,
      archived: false,
      applied: true,
    });
    expect(save).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  test('有统计时保存成功后才清空', async () => {
    const calls: string[] = [];
    const save = mock(async () => {
      calls.push('save');
      return true;
    });
    const reset = mock(() => calls.push('reset'));

    expect(await changeAutoSaveHistory(false, 6, save, reset)).toEqual({
      enabled: true,
      archived: true,
      applied: true,
    });
    expect(calls).toEqual(['save', 'reset']);
  });

  test('保存失败时保留关闭状态和当前统计', async () => {
    const save = mock(async () => false);
    const reset = mock(() => {});

    expect(await changeAutoSaveHistory(false, 6, save, reset)).toEqual({
      enabled: false,
      archived: false,
      applied: false,
    });
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('关闭窗口自动归档', () => {
  test('未开启自动保存时不拦截也不执行退出准备', async () => {
    const stop = mock(() => {});
    const wait = mock(async () => {});
    const save = mock(async () => true);

    expect(shouldHandleAutoSaveClose(false, 3, true, false)).toBe(false);
    expect(await prepareAutoSaveClose({
      enabled: () => false,
      effectiveResultCount: () => 3,
      stopContinuous: stop,
      waitForSpin: wait,
      waitForSaving: wait,
      saveCurrent: save,
    })).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test('开启后等待当前旋转结束，再保存新产生的有效统计', async () => {
    const calls: string[] = [];
    let completed = 0;

    expect(shouldHandleAutoSaveClose(true, completed, true, false)).toBe(true);
    expect(await prepareAutoSaveClose({
      enabled: () => true,
      effectiveResultCount: () => completed,
      stopContinuous: () => calls.push('stop'),
      waitForSpin: async () => {
        calls.push('spin');
        completed = 1;
      },
      waitForSaving: async () => { calls.push('saving'); },
      saveCurrent: async () => {
        calls.push('save');
        return true;
      },
    })).toBe(true);
    expect(calls).toEqual(['stop', 'spin', 'saving', 'save']);
  });

  test('退出保存失败时拒绝关闭', async () => {
    expect(await prepareAutoSaveClose({
      enabled: () => true,
      effectiveResultCount: () => 2,
      stopContinuous: () => {},
      waitForSpin: async () => {},
      waitForSaving: async () => {},
      saveCurrent: async () => false,
    })).toBe(false);
  });
});
