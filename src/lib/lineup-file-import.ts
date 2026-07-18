export type LineupFileFormat = 'csv' | 'json';

const NAME_LIMIT = 18;
const OPTION_LIMIT = 100;
const NAME_HEADERS = new Set(['名称', '姓名', '名字', '候选项', '选项', 'name']);

/** 从 CSV 或本项目导出的 JSON 中读取排阵名单。 */
export function parseLineupFile(content: string, format: LineupFileFormat): string[] {
  const values = format === 'json' ? namesFromJson(content) : namesFromCsv(content);
  const names = normalizeNames(values);
  if (names.length === 0) throw new Error('文件中没有可导入的名称');
  return names;
}

function namesFromJson(content: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error('JSON 文件格式不正确');
  }

  if (Array.isArray(value)) return value;
  if (!isRecord(value)) throw new Error('JSON 中找不到名单');
  if (Array.isArray(value.sourceNames)) return value.sourceNames;
  if (Array.isArray(value.names)) return value.names;
  if (isRecord(value.input) && Array.isArray(value.input.sourceNames)) {
    return value.input.sourceNames;
  }
  throw new Error('JSON 中找不到名单');
}

function namesFromCsv(content: string): string[] {
  const rows = parseCsv(content.replace(/^\uFEFF/u, ''));
  if (rows.length === 0) return [];

  const headers = rows[0].map((cell) => cell.trim().toLocaleLowerCase('zh-CN'));
  if (headers[0] === '档位') {
    return rows.slice(1).flatMap((row) => row.slice(1));
  }

  const nameColumn = headers.findIndex((header) => NAME_HEADERS.has(header));
  if (nameColumn >= 0) {
    return rows.slice(1).map((row) => row[nameColumn]);
  }
  return rows.flat();
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const pushRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    cell = '';
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      pushRow();
    } else if (character !== '\r') {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV 文件格式不正确');
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function normalizeNames(values: unknown[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const raw = typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.name === 'string'
        ? value.name
        : '';
    const name = raw.trim().slice(0, NAME_LIMIT);
    const key = name.toLocaleLowerCase('zh-CN');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= OPTION_LIMIT) break;
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
