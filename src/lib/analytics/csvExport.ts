// CSV export helper for Conversion Analytics.
//
// Emits RFC 4180-style CSV: fields that contain quote/comma/newline are wrapped
// in double quotes and inner double quotes are doubled. Values that are `null`
// or `undefined` are written as an empty cell, and `unknown` sentinel strings
// are preserved as-is so viewers can see when a dimension is not tracked.

export type CsvValue = string | number | boolean | null | undefined;

export type CsvRow = Record<string, CsvValue>;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv(rows: CsvRow[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const cols = columns ?? Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const header = cols.map(escapeCell).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCell(row[c])).join(","))
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}