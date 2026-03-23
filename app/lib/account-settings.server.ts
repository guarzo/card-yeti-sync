import type { MarketplaceAccount } from "@prisma/client";

export interface AccountSettings {
  shadowMode: boolean;
  inventorySyncEnabled: boolean;
  crossChannelDelistEnabled: boolean;
  discountPercent: number;
}

const DEFAULTS: AccountSettings = {
  shadowMode: false,
  inventorySyncEnabled: true,
  crossChannelDelistEnabled: true,
  discountPercent: 5,
};

export function getAccountSettings(
  account: Pick<MarketplaceAccount, "settings">,
): AccountSettings {
  const raw = (account.settings ?? {}) as Record<string, unknown>;
  return {
    shadowMode: raw.shadowMode === true,
    inventorySyncEnabled: raw.inventorySyncEnabled !== false,
    crossChannelDelistEnabled: raw.crossChannelDelistEnabled !== false,
    discountPercent:
      typeof raw.discountPercent === "number" && Number.isFinite(raw.discountPercent)
        ? Math.max(0, Math.min(100, raw.discountPercent))
        : DEFAULTS.discountPercent,
  };
}
