import { describe, expect, test } from 'bun:test';
import {
  buildWheelOptions,
  pickWeighted,
  simulateRouletteBatch,
  simulateSelectedBatch,
} from './draw';
import type { Prize } from './types';

const prizes: Prize[] = [
  { id: 'a', name: 'A', weight: 1, color: '#000000', enabled: true },
  { id: 'b', name: 'B', weight: 1, color: '#ffffff', enabled: true },
];

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1];
}

describe('draw engine', () => {
  test('builds options and omits disabled or excluded prizes', () => {
    const options = buildWheelOptions(
      [...prizes, { id: 'c', name: 'C', weight: 1, color: '#f00', enabled: false }],
      true,
      2,
      new Set(['b']),
    );

    expect(options.map((option) => option.id)).toEqual(['a', '__retry__']);
    expect(options[1].weight).toBe(2);
  });

  test('selects entries according to weight boundaries', () => {
    const options = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ];

    expect(pickWeighted(options, () => 0.1).id).toBe('a');
    expect(pickWeighted(options, () => 0.3).id).toBe('b');
  });

  test('retry attempts do not consume requested selected results', () => {
    const result = simulateSelectedBatch(prizes, 2, true, 1, sequence([0.9, 0.1, 0.5]));

    expect(result.completed).toBe(2);
    expect(result.attempts).toBe(3);
    expect(result.retryCount).toBe(1);
    expect(result.prizeCounts).toEqual({ a: 1, b: 1 });
    expect(result.events.map((event) => event.outcome)).toEqual(['retry', 'selected', 'selected']);
  });

  test('rejects a batch where retry is the only available option', () => {
    const disabled = prizes.map((prize) => ({ ...prize, enabled: false }));

    expect(() => simulateSelectedBatch(disabled, 10, true, 1)).toThrow(
      '重来不能是唯一选项',
    );
  });

  test('roulette batch records retries and the surviving winner', () => {
    const result = simulateRouletteBatch(prizes, 1, true, 1, sequence([0.9, 0.1]));

    expect(result.attempts).toBe(2);
    expect(result.retryCount).toBe(1);
    expect(result.prizeCounts).toEqual({ a: 0, b: 1 });
    expect(result.events.at(-1)?.outcome).toBe('winner');
  });
});
