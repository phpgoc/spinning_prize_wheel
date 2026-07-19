import type { RankedUser } from './types';

export interface RankedUserTransfer {
  name: string;
  rank: number;
  aliases: string[];
}

export interface RankingTransferFile {
  version: 1;
  kind: 'wheel-ranking';
  exportedAt: string;
  users: RankedUserTransfer[];
}

const USER_LIMIT = 5_000;
const ALIAS_LIMIT = 100_000;
const NAME_LIMIT = 80;

export function createRankingTransfer(users: readonly RankedUser[]): RankingTransferFile {
  return {
    version: 1,
    kind: 'wheel-ranking',
    exportedAt: new Date().toISOString(),
    users: users.map((user) => ({
      name: user.name,
      rank: user.rank,
      aliases: user.aliases
        .map((alias) => alias.name)
        .filter((alias) => alias.toLocaleLowerCase('zh-CN') !== user.name.toLocaleLowerCase('zh-CN')),
    })),
  };
}

export function parseRankingTransfer(content: string): RankedUserTransfer[] {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error('排名 JSON 格式不正确');
  }
  if (!isRecord(value) || value.kind !== 'wheel-ranking' || value.version !== 1 || !Array.isArray(value.users)) {
    throw new Error('不是转盘导出的排名文件');
  }
  if (value.users.length > USER_LIMIT) throw new Error(`排名文件最多允许 ${USER_LIMIT} 项`);

  const namespace = new Set<string>();
  let aliasCount = 0;
  const users = value.users.map((item, index) => {
    if (!isRecord(item)) throw new Error(`第 ${index + 1} 项排名格式不正确`);
    const name = normalizeName(item.name, `第 ${index + 1} 项名称`);
    const rank = Number(item.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > 10_000) {
      throw new Error(`“${name}”的排名不正确`);
    }
    if (!Array.isArray(item.aliases)) throw new Error(`“${name}”的别名格式不正确`);

    addUniqueName(namespace, name);
    const aliases: string[] = [];
    for (const rawAlias of item.aliases) {
      const alias = normalizeName(rawAlias, `“${name}”的别名`);
      addUniqueName(namespace, alias);
      aliases.push(alias);
      aliasCount += 1;
      if (aliasCount > ALIAS_LIMIT) throw new Error(`排名文件最多允许 ${ALIAS_LIMIT} 个别名`);
    }
    return { name, rank, aliases };
  });

  const ranks = users.filter((user) => user.rank < 10_000).map((user) => user.rank).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) {
    throw new Error('已排名项必须从第 1 名开始连续排列');
  }
  return users;
}

function normalizeName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  const name = value.trim();
  if (!name) throw new Error(`${label}不能为空`);
  if (name.length > NAME_LIMIT) throw new Error(`${label}不能超过 ${NAME_LIMIT} 个字符`);
  return name;
}

function addUniqueName(namespace: Set<string>, name: string) {
  const key = name.toLocaleLowerCase('zh-CN');
  if (namespace.has(key)) throw new Error(`名称或别名“${name}”重复`);
  namespace.add(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
