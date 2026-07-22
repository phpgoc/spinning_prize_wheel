import { describe, expect, test } from 'bun:test';
import { resultNotes, spinMusicPlan } from './draw-sound';

describe('转盘音效', () => {
  test('默认四秒包含完整四和弦配乐', () => {
    const plan = spinMusicPlan(4000);
    const chords = plan.filter((step) => step.chordFrequencies.length > 0);

    expect(plan.length).toBeGreaterThanOrEqual(15);
    expect(chords).toHaveLength(4);
    expect(new Set(chords.map((step) => step.chordFrequencies[0])).size).toBe(4);
  });

  test('配乐同时包含旋律、低音和鼓组', () => {
    const plan = spinMusicPlan(4000);
    expect(plan.every((step) => step.melodyFrequency > 0)).toBe(true);
    expect(plan.some((step) => step.bassFrequency !== null)).toBe(true);
    expect(plan.some((step) => step.kick)).toBe(true);
    expect(plan.some((step) => step.snare)).toBe(true);
    expect(plan.some((step) => step.hat)).toBe(true);
  });

  test('末段节拍随转盘减速并在动画结束前收束', () => {
    const plan = spinMusicPlan(6000);
    const openingGap = plan[1].offset - plan[0].offset;
    const endingGap = plan.at(-1)!.offset - plan.at(-2)!.offset;
    expect(endingGap).toBeGreaterThan(openingGap);
    expect(plan.at(-1)!.offset + plan.at(-1)!.duration).toBeLessThanOrEqual(6);
    expect(plan.at(-1)!.hat).toBe(false);
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
