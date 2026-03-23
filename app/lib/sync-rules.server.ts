import type { MarketplaceAccount } from "@prisma/client";
import { type SyncRules, DEFAULT_SYNC_RULES } from "./sync-rules";

export type { SyncRules };
export { DEFAULT_SYNC_RULES };

export function getSyncRules(account: MarketplaceAccount): SyncRules {
  const settings = (account.settings ?? {}) as Record<string, unknown>;
  return (settings.syncRules as SyncRules) ?? DEFAULT_SYNC_RULES;
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
    product.productType &&
    !rules.productTypes.includes(product.productType)
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
