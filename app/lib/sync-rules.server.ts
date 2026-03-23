import type { MarketplaceAccount } from "@prisma/client";
import { type SyncRules, DEFAULT_SYNC_RULES } from "./sync-rules";

export type { SyncRules };
export { DEFAULT_SYNC_RULES };

export function getSyncRules(account: Pick<MarketplaceAccount, "settings">): SyncRules {
  const settings = (account.settings ?? {}) as Record<string, unknown>;
  const raw: unknown = settings.syncRules;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SYNC_RULES };
  }
  const obj = raw as Record<string, unknown>;
  return {
    productTypes: Array.isArray(obj.productTypes) ? obj.productTypes.filter((v): v is string => typeof v === "string") : DEFAULT_SYNC_RULES.productTypes,
    excludeTags: Array.isArray(obj.excludeTags) ? obj.excludeTags.filter((v): v is string => typeof v === "string") : DEFAULT_SYNC_RULES.excludeTags,
    priceMin: typeof obj.priceMin === "number" && Number.isFinite(obj.priceMin) ? obj.priceMin : DEFAULT_SYNC_RULES.priceMin,
    priceMax: typeof obj.priceMax === "number" && Number.isFinite(obj.priceMax) ? obj.priceMax : DEFAULT_SYNC_RULES.priceMax,
    autoSyncNew: typeof obj.autoSyncNew === "boolean" ? obj.autoSyncNew : DEFAULT_SYNC_RULES.autoSyncNew,
  };
}

/**
 * Evaluate whether a product passes the sync rules for a marketplace.
 * Returns true if the product should be synced.
 */
export function productPassesSyncRules(
  rules: SyncRules,
  product: { productType?: string; tags?: string[]; price: number },
): boolean {
  if (
    rules.productTypes.length > 0 &&
    (!product.productType || !rules.productTypes.includes(product.productType))
  ) {
    return false;
  }

  if (rules.excludeTags.length > 0 && product.tags) {
    const lowerTags = product.tags.map((t) => t.toLowerCase());
    if (rules.excludeTags.some((t) => lowerTags.includes(t.toLowerCase()))) {
      return false;
    }
  }

  if (rules.priceMin !== null && product.price < rules.priceMin) return false;
  if (rules.priceMax !== null && product.price > rules.priceMax) return false;

  return true;
}
