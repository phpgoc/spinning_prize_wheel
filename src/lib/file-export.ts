export type CsvCell = string | number | boolean | null | undefined;

/** 生成带 UTF-8 BOM 的 CSV，保证 Windows Excel 直接打开时中文不乱码。 */
export function createExcelCsv(rows: readonly (readonly CsvCell[])[]): string {
  const content = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');
  return `\uFEFF${content}`;
}

export function downloadExcelCsv(prefix: string, rows: readonly (readonly CsvCell[])[]) {
  downloadFile(prefix, 'csv', createExcelCsv(rows), 'text/csv;charset=utf-8');
}

export function downloadFormattedJson(prefix: string, value: unknown) {
  downloadFile(
    prefix,
    'json',
    JSON.stringify(value, null, 2),
    'application/json;charset=utf-8',
  );
}

function escapeCsvCell(value: CsvCell): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadFile(prefix: string, extension: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
