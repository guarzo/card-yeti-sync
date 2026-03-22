import { MARKETPLACE_CONFIG } from "../../lib/marketplace-config";

interface MarketplaceInfo {
  connected: boolean;
  activeCount: number;
}

interface SyncSummaryProps {
  marketplaces: Record<string, MarketplaceInfo>;
  productsAwaitingSync: number;
}

export function SyncSummary({
  marketplaces,
  productsAwaitingSync,
}: SyncSummaryProps) {
  const connectedMarketplaces = Object.entries(MARKETPLACE_CONFIG).filter(
    ([key]) => marketplaces[key]?.connected,
  );

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-text type="strong">Listings by Marketplace</s-text>
        <s-divider />

        {connectedMarketplaces.length === 0 ? (
          <s-text color="subdued">No marketplaces connected</s-text>
        ) : (
          connectedMarketplaces.map(([key, config]) => (
            <s-stack
              key={key}
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type={config.icon as never} size="small" />
                <s-text>{config.label}</s-text>
              </s-stack>
              <s-text type="strong">
                {marketplaces[key]?.activeCount ?? 0}
              </s-text>
            </s-stack>
          ))
        )}

        {productsAwaitingSync > 0 && (
          <>
            <s-divider />
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-text color="subdued">Awaiting first sync</s-text>
              <s-badge tone="caution">{productsAwaitingSync}</s-badge>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-box>
  );
}
