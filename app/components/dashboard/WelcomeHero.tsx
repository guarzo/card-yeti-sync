import { Link } from "react-router";
import { MARKETPLACE_CONFIG, type MarketplaceKey } from "../../lib/marketplace-config";

const MARKETPLACE_DESCRIPTIONS: Record<MarketplaceKey, string> = {
  ebay: "Full API sync — automatic listing creation and inventory management.",
  whatnot: "CSV bulk upload to Seller Hub with rich descriptions from your card data.",
  helix: "CSV export with smart pricing based on real-time market data.",
};

interface WelcomeHeroProps {
  productCount: number;
}

export function WelcomeHero({ productCount }: WelcomeHeroProps) {
  const productLabel =
    productCount === 0
      ? "your products"
      : productCount === 1
        ? "your 1 product"
        : `your ${productCount} products`;

  return (
    <s-box paddingBlock="large">
      <s-stack direction="block" gap="large" alignItems="center">
        <s-stack direction="block" gap="small" alignItems="center">
          <s-text type="strong">
            <span style={{ fontSize: "1.25rem" }}>Get started with Card Yeti</span>
          </s-text>
          <s-paragraph color="subdued">
            Connect a marketplace to start syncing {productLabel}.
          </s-paragraph>
        </s-stack>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
          gap="base"
        >
          {(Object.entries(MARKETPLACE_CONFIG) as [MarketplaceKey, (typeof MARKETPLACE_CONFIG)[MarketplaceKey]][]).map(([key, config], i) => (
            <s-grid-item key={key}>
              <Link to={config.href} style={{ textDecoration: "none", color: "inherit" }}>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base" alignItems="center">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <s-icon type={config.icon as any} tone="info" />
                    <s-text type="strong">{config.label}</s-text>
                    <s-paragraph color="subdued">
                      {MARKETPLACE_DESCRIPTIONS[key]}
                    </s-paragraph>
                    <s-button variant={i === 0 ? "primary" : undefined}>
                      {config.ctaLabel}
                    </s-button>
                  </s-stack>
                </s-box>
              </Link>
            </s-grid-item>
          ))}
        </s-grid>
      </s-stack>
    </s-box>
  );
}
