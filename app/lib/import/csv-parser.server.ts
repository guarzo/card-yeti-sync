/**
 * eBay File Exchange CSV parser.
 *
 * Parses structured card data from eBay export CSVs into normalized ParsedCard objects.
 */

import type { ParsedCard } from "./types";
import { parseCSV } from "../csv-utils";

// ── Constants ────────────────────────────────────────────────────────────────

export const GRADERS = ["PSA", "CGC", "TAG", "BGS", "SGC", "ACE", "GMA", "MNT"];

export function buildColumnIndex(headers: string[]): Record<string, number> {
  const col: Record<string, number> = {};
  headers.forEach((h, i) => {
    col[h] = i;
  });
  return col;
}

// ── Transform Helpers ────────────────────────────────────────────────────────

export function removeTCGAutomateAds(html: string): string {
  if (!html) return html;
  html = html.replace(
    /\s*<p><img[^>]*TCG Automate[^>]*\/?><\/p>/gi,
    "",
  );
  html = html.replace(
    /\s*<p><strong>This listing was created with TCG Automate[^<]*<\/strong><\/p>/gi,
    "",
  );
  html = html.replace(
    /\s*<p><strong>Use code EBAY[^<]*<\/strong><\/p>/gi,
    "",
  );
  html = html.replace(
    /\s*<div[^>]*>[\s\S]*?TCG Automate[\s\S]*?<\/div>\s*<\/div>/gi,
    "",
  );
  return html.trim();
}

/** Parse grade from eBay format: "10 - (ID: 275020)" → "10" */
export function parseGrade(raw: string): string {
  if (!raw) return "";
  return raw.split(" - (ID:")[0].trim();
}

/** Parse grader abbreviation: "Professional Sports Authenticator (PSA) - (ID: 275010)" → "PSA" */
export function parseGrader(raw: string): string | null {
  if (!raw) return null;
  const before = raw.split(" - (ID:")[0];
  const match = before.match(/\(([A-Z]{2,5})\)/);
  return match ? match[1] : null;
}

/** Split pipe-separated image URLs from eBay's PicURL field. */
export function parseImageUrls(picUrlField: string): string[] {
  if (!picUrlField) return [];
  return picUrlField
    .split("|")
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Strip "Pokemon [Language] " prefix from eBay set names. */
export function cleanSetName(rawSet: string): string {
  if (!rawSet) return "";
  return rawSet
    .replace(
      /^Pok[eé]mon\s+(?:Japanese|Simplified Chinese|Korean|Chinese|English)?\s*/i,
      "",
    )
    .trim();
}

/** Detect language from set name prefix and title. */
export function detectLanguage(rawSet: string, title: string): string {
  const source = `${rawSet} ${title}`;
  if (/japanese/i.test(source)) return "Japanese";
  if (/simplified chinese/i.test(source)) return "Chinese";
  if (/korean/i.test(source)) return "Korean";
  if (/chinese/i.test(source)) return "Chinese";
  return "English";
}

/** Clean pokemon name: strip holo/variant suffixes. */
export function cleanPokemonName(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/-(Holo|Rev\.?Foil|Reverse|Full|Alt|Secret|Special)\b.*/i, "")
    .trim();
}

/** Parse grader from title as fallback (e.g., "... PSA 9" → PSA / 9). */
export function parseGraderFromTitle(title: string): {
  grader: string | null;
  grade: string | null;
  isGraded: boolean;
} {
  const regex = new RegExp(
    `\\b(${GRADERS.join("|")})\\s+(\\d+\\.?\\d*)\\s*$`,
    "i",
  );
  const match = title.match(regex);
  if (match) {
    return { grader: match[1].toUpperCase(), grade: match[2], isGraded: true };
  }
  return { grader: null, grade: null, isGraded: false };
}

// ── eBay File Exchange Row Parser ────────────────────────────────────────────

function parseEbayRow(
  row: string[],
  col: Record<string, number>,
  index: number,
): ParsedCard | null {
  const rawSet = row[col["*C:Set"]] || "";
  const title = row[col["*Title"]] || "";

  const grader = parseGrader(
    row[col["CD:Professional Grader - (ID: 27501)"]] || "",
  );
  const grade = parseGrade(row[col["CD:Grade - (ID: 27502)"]] || "");
  const isGraded = !!(grader && grade);
  const language = detectLanguage(rawSet, title);

  const rawDescription = row[col["*Description"]] || "";
  const customLabel = (row[col["CustomLabel"]] || "").trim();
  const ebayPrice = parseFloat(row[col["*StartPrice"]] || "0");

  if (!customLabel || !ebayPrice) return null;

  return {
    sourceId: `csv-${index}`,
    sourceType: "csv",
    title,
    pokemon: cleanPokemonName(row[col["*C:Card Name"]] || ""),
    setName: cleanSetName(rawSet),
    number: (row[col["*C:Card Number"]] || "").trim(),
    grader,
    grade,
    isGraded,
    certNumber: (
      row[col["CDA:Certification Number - (ID: 27503)"]] || ""
    ).trim(),
    language,
    year: (row[col["C:Year Manufactured"]] || "").trim(),
    rarity: (row[col["*C:Rarity"]] || "").trim(),
    condition: (row[col["CD:Card Condition - (ID: 40001)"]] || "").trim(),
    ebayPrice,
    imageUrls: parseImageUrls(row[col["PicURL"]] || ""),
    description: removeTCGAutomateAds(rawDescription),
    isJapanese: language === "Japanese",
    customLabel,
    ebayItemId: "",

    // Pricing — will be enriched after pricing API call
    apiSuggestedPrice: null,
    finalPrice: ebayPrice,

    // Status — will be set by dedup check
    isDuplicate: false,
    duplicateProductId: null,
    dedupUnavailable: false,
    parseErrors: [],
    selected: true,
  };
}

// ── Main Parser ──────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = [
  "CustomLabel",
  "*Title",
  "*C:Card Name",
  "*C:Set",
  "CD:Grade - (ID: 27502)",
  "CD:Professional Grader - (ID: 27501)",
  "CDA:Certification Number - (ID: 27503)",
  "*StartPrice",
  "PicURL",
];

export function parseEbayFileExchangeCSV(csvText: string): {
  cards: ParsedCard[];
  totalRows: number;
  skippedRows: number;
  errors: string[];
} {
  const errors: string[] = [];

  // Strip BOM
  const clean = csvText.replace(/^\uFEFF/, "");
  const rows = parseCSV(clean);

  // eBay File Exchange CSVs: line 1 = metadata ("Info,..."), line 2 = headers, line 3+ = data
  // Plain CSVs without the metadata row are also supported (headers + data)
  const hasMetadataRow = rows.length > 0 && rows[0][0] === "Info";
  const headerIdx = hasMetadataRow ? 1 : 0;
  const minRows = hasMetadataRow ? 3 : 2; // metadata+headers+data or headers+data

  if (rows.length < minRows) {
    return { cards: [], totalRows: 0, skippedRows: 0, errors: ["CSV has no data rows"] };
  }
  const headers = rows[headerIdx];
  const col = buildColumnIndex(headers);

  // Validate required columns
  for (const r of REQUIRED_COLUMNS) {
    if (col[r] === undefined) {
      errors.push(`Missing required column: "${r}"`);
    }
  }
  if (errors.length > 0) {
    return { cards: [], totalRows: 0, skippedRows: 0, errors };
  }

  // Find the action column — eBay uses a long compound name
  const actionCol = Object.keys(col).find((k) =>
    k.startsWith("*Action("),
  );

  const cards: ParsedCard[] = [];
  let skippedRows = 0;
  const totalRows = rows.length - headerIdx - 1;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    // Skip empty rows
    if (!row.some((f) => f.trim())) {
      skippedRows++;
      continue;
    }

    // Skip rows without an action value
    if (actionCol && !(row[col[actionCol]] || "").trim()) {
      skippedRows++;
      continue;
    }

    const card = parseEbayRow(row, col, i);
    if (!card) {
      skippedRows++;
      continue;
    }

    cards.push(card);
  }

  return { cards, totalRows, skippedRows, errors };
}
