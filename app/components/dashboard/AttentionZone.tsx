import { useMemo } from "react";
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

  const { expiredTokens, expiringTokens } = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- Date.now() drift is irrelevant for a 7-day threshold
    const now = Date.now();
    const expired: { name: string; label: string; href: string }[] = [];
    const expiring: { name: string; label: string; href: string }[] = [];
    for (const [name, m] of Object.entries(marketplaces)) {
      if (!m.tokenExpiry) continue;
      const daysUntilExpiry = (new Date(m.tokenExpiry).getTime() - now) / (1000 * 60 * 60 * 24);
      const entry = {
        name,
        label: MARKETPLACE_CONFIG[name as MarketplaceKey]?.label ?? name,
        href: MARKETPLACE_CONFIG[name as MarketplaceKey]?.href ?? `/app/${name}`,
      };
      if (daysUntilExpiry < 0) {
        expired.push(entry);
      } else if (daysUntilExpiry < 7) {
        expiring.push(entry);
      }
    }
    return { expiredTokens: expired, expiringTokens: expiring };
  }, [marketplaces]);

  const hasBanners =
    totalErrors > 0 || pendingPriceReviews > 0 || expiredTokens.length > 0 || expiringTokens.length > 0;

  if (!hasBanners) return null;

  return (
    <>
      {expiredTokens.map(({ name, label, href }) => (
        <s-banner key={name} tone="critical" dismissible>
          {label} token has expired.{" "}
          <s-link href={href}>Reconnect →</s-link>
        </s-banner>
      ))}

      {expiringTokens.map(({ name, label, href }) => (
        <s-banner key={name} tone="warning" dismissible>
          {label} token expires soon.{" "}
          <s-link href={href}>Reconnect →</s-link>
        </s-banner>
      ))}

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
