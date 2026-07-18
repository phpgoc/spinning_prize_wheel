import { describe, expect, mock, test } from 'bun:test';
import { changeAutoSaveHistory } from './auto-save';

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

  test('空统计开启时直接生效', async () => {
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
