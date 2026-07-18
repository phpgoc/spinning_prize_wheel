const OPTION_LIMIT = 100;
const NAME_LIMIT = 18;

/**
 * 解析从纯文本、逗号分隔内容或 Excel 单元格粘贴的选项名称。
 * 空白字符和常见中英文分隔符都视为选项边界。
 */
export function parseOptionText(input: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const raw of input.split(/[\s,，、;；|]+/u)) {
    const name = raw.trim().slice(0, NAME_LIMIT);
    const key = name.toLocaleLowerCase('zh-CN');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push(name);
    if (options.length >= OPTION_LIMIT) break;
  }

  return options;
}
