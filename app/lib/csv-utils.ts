// app/lib/csv-utils.ts

interface EscapeOptions {
  flattenNewlines?: boolean;
}

/**
 * Escape a value for RFC 4180 CSV.
 * If flattenNewlines is true, replaces \n with " | " before escaping
 * (used by Whatnot to keep records on a single line).
 */
export function escapeCSVField(value: string, options?: EscapeOptions): string {
  let str = String(value ?? "");
  if (options?.flattenNewlines) {
    str = str.replace(/\n/g, " | ");
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate a CSV string from headers and rows of unescaped field strings.
 */
export function generateCSV(
  headers: readonly string[],
  rows: string[][],
  options?: EscapeOptions,
): string {
  const headerLine = headers.map((h) => escapeCSVField(h, options)).join(",");
  const dataLines = rows.map(
    (row) => row.map((field) => escapeCSVField(field, options)).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}
