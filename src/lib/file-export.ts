import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';

export type ExcelCell = string | number | boolean | null | undefined;

export interface ExportCompletedNotice {
  location: string;
  desktop: boolean;
}

type ExportNoticeListener = (notice: ExportCompletedNotice) => void;

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const exportNoticeListeners = new Set<ExportNoticeListener>();

export function subscribeExportCompleted(listener: ExportNoticeListener): () => void {
  exportNoticeListeners.add(listener);
  return () => exportNoticeListeners.delete(listener);
}

function publishExportCompleted(notice: ExportCompletedNotice) {
  for (const listener of exportNoticeListeners) listener(notice);
}

/** 生成标准 XLSX 工作簿，桌面版和网页版共用同一份二进制内容。 */
export async function createExcelWorkbook(
  rows: readonly (readonly ExcelCell[])[],
  sheetName = '数据',
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '转盘';
  const worksheet = workbook.addWorksheet(normalizeSheetName(sheetName), {
    views: [{ state: 'frozen', ySplit: rows.length > 0 ? 1 : 0 }],
  });
  worksheet.addRows(rows.map((row) => [...row]));

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });

  if (rows.length > 0) {
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FF24251F' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EFBC' } };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  worksheet.columns.forEach((column) => {
    let width = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value === null || cell.value === undefined ? '' : String(cell.value);
      width = Math.max(width, Math.min(40, Array.from(value).length + 2));
    });
    column.width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export async function downloadExcel(
  prefix: string,
  rows: readonly (readonly ExcelCell[])[],
  sheetName = prefix,
): Promise<string> {
  const bytes = await createExcelWorkbook(rows, sheetName);
  return downloadBinaryFile(prefix, 'xlsx', bytes, EXCEL_MIME);
}

/** 下载已经排版完成的 XLSX，供签表等需要合并单元格的导出使用。 */
export function downloadExcelBytes(prefix: string, bytes: Uint8Array): Promise<string> {
  return downloadBinaryFile(prefix, 'xlsx', bytes, EXCEL_MIME);
}

export function downloadFormattedJson(prefix: string, value: unknown): Promise<string> {
  return downloadTextFile(
    prefix,
    'json',
    JSON.stringify(value, null, 2),
    'application/json;charset=utf-8',
  );
}

function normalizeSheetName(value: string): string {
  const normalized = value.trim().replace(/[\\/?*:[\]]/g, '_').slice(0, 31);
  return normalized || '数据';
}

async function downloadTextFile(
  prefix: string,
  extension: string,
  content: string,
  type: string,
): Promise<string> {
  if (isDesktopRuntime()) {
    const location = await invoke<string>('export_text_file', { prefix, extension, content });
    publishExportCompleted({ location, desktop: true });
    return location;
  }
  return downloadBrowserBlob(prefix, extension, new Blob([content], { type }));
}

async function downloadBinaryFile(
  prefix: string,
  extension: string,
  bytes: Uint8Array,
  type: string,
): Promise<string> {
  if (isDesktopRuntime()) {
    const location = await invoke<string>('export_binary_file', {
      prefix,
      extension,
      bytes: Array.from(bytes),
    });
    publishExportCompleted({ location, desktop: true });
    return location;
  }
  const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return downloadBrowserBlob(prefix, extension, new Blob([content], { type }));
}

function downloadBrowserBlob(prefix: string, extension: string, blob: Blob): string {
  const filename = `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  publishExportCompleted({ location: filename, desktop: false });
  return filename;
}

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
