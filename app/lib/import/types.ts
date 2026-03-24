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
  /**
   * The price that will be set on the Shopify product.
   * Initialized to ebayPrice, potentially overridden by the pricing API,
   * and may be manually edited by the user during import review.
   */
  finalPrice: number;

  // Status
  isDuplicate: boolean;
  duplicateProductId: string | null;
  /** Fields that differ between the imported card and the existing Shopify product. Empty = exact match. */
  duplicateFieldDiffs: string[];
  /** True when the duplicate check could not be completed (API error). */
  dedupUnavailable: boolean;
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
