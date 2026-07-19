import { describe, expect, test } from 'bun:test';
import { createRankingTransfer, parseRankingTransfer } from './ranking-transfer';
import type { RankedUser } from './types';

describe('排名同步文件', () => {
  test('导出后可以完整读回名称、排名和其他别名', () => {
    const users: RankedUser[] = [{
      id: 1,
      name: '甲',
      rank: 1,
      aliases: [
        { id: 1, name: '甲', userId: 1 },
        { id: 2, name: '小甲', userId: 1 },
      ],
    }];
    const file = createRankingTransfer(users);
    expect(parseRankingTransfer(JSON.stringify(file))).toEqual([
      { name: '甲', rank: 1, aliases: ['小甲'] },
    ]);
  });

  test('拒绝重复名称、别名和不连续排名', () => {
    const base = { version: 1, kind: 'wheel-ranking', exportedAt: '', users: [] };
    expect(() => parseRankingTransfer(JSON.stringify({
      ...base,
      users: [
        { name: '甲', rank: 1, aliases: ['共享'] },
        { name: '乙', rank: 2, aliases: ['共享'] },
      ],
    }))).toThrow('重复');
    expect(() => parseRankingTransfer(JSON.stringify({
      ...base,
      users: [{ name: '甲', rank: 2, aliases: [] }],
    }))).toThrow('连续');
  });
});
