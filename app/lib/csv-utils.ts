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
 * Parse a CSV string into rows of fields (RFC 4180 compliant).
 * Handles quoted fields with escaped double-quotes.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r") i++;
    } else {
      field += ch;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
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
