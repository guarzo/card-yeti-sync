import { MARKETPLACE_CONFIG, type MarketplaceKey } from "../../lib/marketplace-config";
import type { MarketplaceInfo } from "../../types/dashboard";

interface AttentionZoneProps {
  marketplaces: Record<string, MarketplaceInfo>;
  totalErrors: number;
  pendingPriceReviews: number;
}

export function AttentionZone({
  marketplaces,
  totalErrors,
  pendingPriceReviews,
}: AttentionZoneProps) {
  const firstErrorMarketplace = Object.entries(marketplaces)
    .filter(([, m]) => m.errorCount > 0)
    .map(([name]) => MARKETPLACE_CONFIG[name as MarketplaceKey]?.href ?? `/app/${name}`)[0];

  const hasBanners = totalErrors > 0 || pendingPriceReviews > 0;

  if (!hasBanners) return null;

  return (
    <>
      {totalErrors > 0 && (
        <s-banner tone="critical" dismissible>
          {totalErrors} listing{totalErrors !== 1 ? "s" : ""} failed to sync.{" "}
          {firstErrorMarketplace && (
            <s-link href={firstErrorMarketplace}>View errors →</s-link>
          )}
        </s-banner>
      )}

      {pendingPriceReviews > 0 && (
        <s-banner tone="info">
          {pendingPriceReviews} price suggestion
          {pendingPriceReviews !== 1 ? "s" : ""} ready for review.{" "}
          <s-link href="?filter=price_reviews#products-sync">Review →</s-link>
        </s-banner>
      )}
    </>
  );
}
