import { MARKETPLACE_CONFIG, type MarketplaceKey } from "../../lib/marketplace-config";
import { daysUntil } from "../../lib/ui-helpers";
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
  const expiredMarketplaces = Object.entries(marketplaces)
    .filter(
      ([, m]) => m.connected && m.tokenExpiry && daysUntil(m.tokenExpiry) <= 0,
    )
    .map(([name]) => ({
      label: MARKETPLACE_CONFIG[name as MarketplaceKey]?.label ?? name,
      href: MARKETPLACE_CONFIG[name as MarketplaceKey]?.href ?? `/app/${name}`,
    }));

  const expiringMarketplaces = Object.entries(marketplaces)
    .filter(
      ([, m]) =>
        m.connected &&
        m.tokenExpiry &&
        daysUntil(m.tokenExpiry) > 0 &&
        daysUntil(m.tokenExpiry) <= 7,
    )
    .map(([name]) => ({
      label: MARKETPLACE_CONFIG[name as MarketplaceKey]?.label ?? name,
      href: MARKETPLACE_CONFIG[name as MarketplaceKey]?.href ?? `/app/${name}`,
    }));

  const disconnected = Object.entries(MARKETPLACE_CONFIG)
    .filter(([key]) => !marketplaces[key]?.connected)
    .map(([, config]) => ({ label: config.label, href: config.href }));

  const firstErrorMarketplace = Object.entries(marketplaces)
    .filter(([, m]) => m.errorCount > 0)
    .map(([name]) => MARKETPLACE_CONFIG[name as MarketplaceKey]?.href ?? `/app/${name}`)[0];

  const hasBanners =
    totalErrors > 0 ||
    expiredMarketplaces.length > 0 ||
    expiringMarketplaces.length > 0 ||
    disconnected.length > 0 ||
    pendingPriceReviews > 0;

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

      {expiredMarketplaces.length > 0 && (
        <s-banner tone="critical" dismissible>
          {expiredMarketplaces.map((m) => m.label).join(", ")} token
          {expiredMarketplaces.length > 1 ? "s have" : " has"} expired.{" "}
          <s-link href={expiredMarketplaces[0].href}>Reconnect →</s-link>
        </s-banner>
      )}

      {expiringMarketplaces.length > 0 && (
        <s-banner tone="warning" dismissible>
          {expiringMarketplaces.map((m) => m.label).join(", ")} token
          {expiringMarketplaces.length > 1 ? "s" : ""} expire
          {expiringMarketplaces.length === 1 ? "s" : ""} within 7 days.{" "}
          <s-link href={expiringMarketplaces[0].href}>Reconnect →</s-link>
        </s-banner>
      )}

      {disconnected.length > 0 && (
        <s-banner tone="info" dismissible>
          {disconnected.map((d) => d.label).join(", ")}{" "}
          {disconnected.length > 1 ? "are" : "is"} not connected.{" "}
          <s-link href={disconnected[0].href}>Set up →</s-link>
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
