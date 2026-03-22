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
}

export function MarketplaceTile({
  name,
  icon,
  connected,
  isShopify,
  activeCount,
  secondaryCount,
  secondaryLabel,
  pendingCount = 0,
  errorCount = 0,
  href,
}: MarketplaceTileProps) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={!connected && !isShopify ? "subdued" : undefined}
    >
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon
            type={icon as never}
            tone={connected || isShopify ? "info" : undefined}
          />
          <s-text type="strong">{name}</s-text>
        </s-stack>

        <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
          {connected || isShopify ? activeCount : "--"}
        </div>
        <s-text color="subdued">
          {isShopify
            ? `${activeCount} product${activeCount !== 1 ? "s" : ""}`
            : connected
              ? `${activeCount} active`
              : "\u00A0"}
        </s-text>

        {isShopify && secondaryCount !== undefined && (
          <s-text color="subdued">{secondaryCount} {secondaryLabel ?? "active"}</s-text>
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
        ) : connected ? (
          <s-badge tone="success">Connected</s-badge>
        ) : (
          <s-badge>Not connected</s-badge>
        )}

        {!isShopify && href && (
          <s-link href={href}>{connected ? "Manage" : "Set up"} →</s-link>
        )}
      </s-stack>
    </s-box>
  );
}
