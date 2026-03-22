export const MARKETPLACE_CONFIG = {
  ebay: { label: "eBay", icon: "globe", href: "/app/ebay" },
  whatnot: { label: "Whatnot", icon: "cart", href: "/app/whatnot" },
  helix: { label: "Helix", icon: "bolt", href: "/app/helix" },
} as const;

export type MarketplaceKey = keyof typeof MARKETPLACE_CONFIG;

export function marketplaceLabel(key: string): string {
  return MARKETPLACE_CONFIG[key as MarketplaceKey]?.label ?? key;
}
