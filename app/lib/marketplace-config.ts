export const SHOPIFY_CONFIG = {
  label: "Shopify",
  icon: "store",
} as const;

export const MARKETPLACE_CONFIG = {
  ebay: { label: "eBay", icon: "globe", href: "/app/ebay", ctaLabel: "Connect eBay" },
  whatnot: { label: "Whatnot", icon: "cart", href: "/app/whatnot", ctaLabel: "Export to Whatnot" },
  helix: { label: "Helix", icon: "bolt", href: "/app/helix", ctaLabel: "Export to Helix" },
} as const;

export type MarketplaceKey = keyof typeof MARKETPLACE_CONFIG;

export function marketplaceLabel(key: string): string {
  return MARKETPLACE_CONFIG[key as MarketplaceKey]?.label ?? key;
}
