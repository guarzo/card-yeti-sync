export interface SyncRules {
  productTypes: string[];
  excludeTags: string[];
  priceMin: number | null;
  priceMax: number | null;
  autoSyncNew: boolean;
}

export const PRODUCT_TYPES = [
  "Graded Card",
  "Graded Slab",
  "Raw Single",
  "Sealed Product",
  "Curated Lot",
] as const;

export const DEFAULT_SYNC_RULES: SyncRules = {
  productTypes: ["Graded Card", "Raw Single", "Sealed Product", "Curated Lot"],
  excludeTags: [],
  priceMin: null,
  priceMax: null,
  autoSyncNew: true,
};
