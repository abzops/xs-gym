// CSV export. Cells starting with = + - @ are prefixed with ' so spreadsheet
// apps never run them as formulas (CSV injection).

function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCSV(filename: string, headers: string[], rows: unknown[][]) {
  const blob = new Blob(['﻿' + toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Paise → "1234.50" for spreadsheets (no symbol, no grouping). */
export function csvAmount(paise: number) {
  return `${Math.floor(paise / 100)}.${String(Math.abs(paise) % 100).padStart(2, '0')}`;
}
