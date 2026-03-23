export interface ParsedCard {
  sourceId: string;
  sourceType: "csv" | "ebay";

  // Card data
  title: string;
  pokemon: string;
  setName: string;
  number: string;
  grader: string | null;
  grade: string | null;
  isGraded: boolean;
  certNumber: string;
  language: string;
  year: string;
  rarity: string;
  condition: string;
  description: string;
  imageUrls: string[];
  isJapanese: boolean;
  customLabel: string;
  ebayItemId: string;

  // Pricing
  ebayPrice: number;
  apiSuggestedPrice: number | null;
  finalPrice: number;

  // Status
  isDuplicate: boolean;
  duplicateProductId: string | null;
  parseErrors: string[];
  selected: boolean;
}

export interface ImportResult {
  sourceId: string;
  title: string;
  status: "created" | "failed" | "skipped";
  shopifyProductId: string | null;
  error: string | null;
}

export interface ParseResponse {
  cards: ParsedCard[];
  totalRows: number;
  skippedRows: number;
  pricingApiUsed: boolean;
  errors: string[];
}

export interface CreateResponse {
  results: ImportResult[];
  created: number;
  failed: number;
  skipped: number;
}
