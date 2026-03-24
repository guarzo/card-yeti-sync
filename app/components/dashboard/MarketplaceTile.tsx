import { Link } from "react-router";
import { RelativeTime } from "../RelativeTime";

interface MarketplaceTileProps {
  name: string;
  icon: string;
  connected: boolean;
  isShopify?: boolean;
  activeCount: number;
  secondaryCount?: number;
  secondaryLabel?: string;
  pendingCount?: number;
  errorCount?: number;
  href?: string;
  ctaLabel?: string;
  lastExportDate?: string | null;
}

export function MarketplaceTile({
  name,
  icon,
  connected,
  isShopify,
  activeCount,
  pendingCount = 0,
  errorCount = 0,
  href,
  ctaLabel,
  lastExportDate,
}: MarketplaceTileProps) {
  // Disconnected marketplace: show a centered CTA with optional last export info
  if (!connected && !isShopify) {
    const tile = (
      <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
        <s-stack direction="block" gap="base" alignItems="center">
          <s-icon
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type={icon as any}
            color="subdued"
          />
          <s-text type="strong">{name}</s-text>
          {lastExportDate && (
            <s-text color="subdued">
              Last export: <RelativeTime date={lastExportDate} />
            </s-text>
          )}
          <s-button>{ctaLabel ?? `Set up ${name}`}</s-button>
        </s-stack>
      </s-box>
    );

    if (href) {
      return (
        <Link to={href} style={{ textDecoration: "none", color: "inherit" }}>
          {tile}
        </Link>
      );
    }
    return tile;
  }

  // Connected marketplace or Shopify tile
  const tile = (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type={icon as any}
            tone="info"
          />
          <s-text type="strong">{name}</s-text>
        </s-stack>

        <s-text type="strong">
          <span style={{ fontSize: "1.5rem" }}>{activeCount}</span>
        </s-text>
        <s-text color="subdued">
          {isShopify ? "products" : "active"}
        </s-text>

        {lastExportDate && !isShopify && (
          <s-text color="subdued">
            Last export: <RelativeTime date={lastExportDate} />
          </s-text>
        )}

        {connected && !isShopify && (pendingCount > 0 || errorCount > 0) && (
          <s-stack direction="inline" gap="small">
            {pendingCount > 0 && (
              <s-badge tone="caution">{pendingCount} pending</s-badge>
            )}
            {errorCount > 0 && (
              <s-badge tone="critical">{errorCount} errors</s-badge>
            )}
          </s-stack>
        )}

        {isShopify ? (
          <s-badge tone="success">Source of truth</s-badge>
        ) : (
          <s-badge tone="success">Connected</s-badge>
        )}

        {!isShopify && href && (
          <Link to={href}>Manage →</Link>
        )}
      </s-stack>
    </s-box>
  );

  if (!isShopify && href) {
    return (
      <Link to={href} style={{ textDecoration: "none", color: "inherit" }}>
        {tile}
      </Link>
    );
  }

  return tile;
}
