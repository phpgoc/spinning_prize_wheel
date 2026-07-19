export type CsvCell = string | number | boolean | null | undefined;

/** 生成带 UTF-8 BOM 的 CSV，保证 Windows Excel 直接打开时中文不乱码。 */
export function createCsv(rows: readonly (readonly CsvCell[])[]): string {
  const content = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');
  return `\uFEFF${content}`;
}

export function downloadCsv(prefix: string, rows: readonly (readonly CsvCell[])[]): Promise<string> {
  return downloadFile(prefix, 'csv', createCsv(rows), 'text/csv;charset=utf-8');
}

export function downloadFormattedJson(prefix: string, value: unknown): Promise<string> {
  return downloadFile(
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

async function downloadFile(
  prefix: string,
  extension: string,
  content: string,
  type: string,
): Promise<string> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('export_text_file', { prefix, extension, content });
  }

  const filename = `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}
