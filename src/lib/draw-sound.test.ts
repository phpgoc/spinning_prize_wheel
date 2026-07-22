import { describe, expect, test } from 'bun:test';
import { resultNotes, spinMusicPlan } from './draw-sound';

describe('转盘音效', () => {
  test('默认四秒有清晰的四段编曲结构', () => {
    const plan = spinMusicPlan(4000);
    const sections = plan.map((step) => step.section);

    expect(plan.length).toBeGreaterThanOrEqual(15);
    expect(sections[0]).toBe('intro');
    expect(new Set(sections)).toEqual(new Set(['intro', 'groove', 'build', 'brake']));
    expect(sections.indexOf('groove')).toBeGreaterThan(sections.indexOf('intro'));
    expect(sections.indexOf('build')).toBeGreaterThan(sections.indexOf('groove'));
    expect(sections.indexOf('brake')).toBeGreaterThan(sections.indexOf('build'));
  });

  test('主段和推进段逐层增加旋律与鼓组密度', () => {
    const plan = spinMusicPlan(4000);
    const intro = plan.filter((step) => step.section === 'intro');
    const groove = plan.filter((step) => step.section === 'groove');
    const build = plan.filter((step) => step.section === 'build');

    expect(intro.some((step) => step.melodyFrequency === null)).toBe(true);
    expect(groove.every((step) => step.melodyFrequency !== null)).toBe(true);
    expect(build.every((step) => step.melodyFrequency !== null)).toBe(true);
    expect(build.some((step) => step.snare)).toBe(true);
    expect(build.every((step) => step.intensity > 1)).toBe(true);
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
