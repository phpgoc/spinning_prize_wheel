import { describe, expect, test } from 'bun:test';
import { resultNotes, spinTickShape } from './draw-sound';

describe('转盘音效', () => {
  test('转动接近结束时节拍明显放慢并降低音高', () => {
    const start = spinTickShape(0, 1);
    const middle = spinTickShape(0.5, 2);
    const end = spinTickShape(1, 3);

    expect(start.intervalMs).toBeLessThan(middle.intervalMs);
    expect(middle.intervalMs).toBeLessThan(end.intervalMs);
    expect(start.frequency).toBeGreaterThan(end.frequency);
    expect(end.intervalMs).toBeGreaterThanOrEqual(260);
  });

  test('每四个触点保留一个轻重拍', () => {
    expect(spinTickShape(0.3, 0).accent).toBe(true);
    expect(spinTickShape(0.3, 1).accent).toBe(false);
    expect(spinTickShape(0.3, 4).volume).toBeGreaterThan(spinTickShape(0.3, 5).volume);
  });

  test('三种结果使用不同方向和长度的旋律', () => {
    const success = resultNotes('success');
    const retry = resultNotes('retry');
    const eliminated = resultNotes('eliminated');

    expect(success).toHaveLength(4);
    expect(success.at(-1)!.frequency).toBeGreaterThan(success[0].frequency);
    expect(retry.at(-1)!.frequency).toBeGreaterThan(retry[0].frequency);
    expect(eliminated.at(-1)!.frequency).toBeLessThan(eliminated[0].frequency);
    expect(new Set([success.length, retry.length, eliminated.length]).size).toBe(3);
  });

  test('返回旋律副本，不会污染后续播放', () => {
    const notes = resultNotes('success');
    notes[0].frequency = 1;
    expect(resultNotes('success')[0].frequency).toBe(523.25);
  });
});
