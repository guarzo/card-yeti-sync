import { Link } from "react-router";

interface WelcomeHeroProps {
  productCount: number;
}

export function WelcomeHero({ productCount }: WelcomeHeroProps) {
  return (
    <s-box paddingBlock="large">
      <s-stack direction="block" gap="large" alignItems="center">
        <s-stack direction="block" gap="small" alignItems="center">
          <s-text type="strong">
            <span style={{ fontSize: "1.25rem" }}>Get started with Card Yeti</span>
          </s-text>
          <s-paragraph color="subdued">
            Connect a marketplace to start syncing your {productCount} products.
          </s-paragraph>
        </s-stack>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
          gap="base"
        >
          <s-grid-item>
            <Link to="/app/ebay" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base" alignItems="center">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <s-icon type={"globe" as any} tone="info" />
                  <s-text type="strong">eBay</s-text>
                  <s-paragraph color="subdued">
                    Full API sync — automatic listing creation and inventory
                    management.
                  </s-paragraph>
                  <s-button variant="primary">Connect eBay</s-button>
                </s-stack>
              </s-box>
            </Link>
          </s-grid-item>

          <s-grid-item>
            <Link to="/app/whatnot" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base" alignItems="center">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <s-icon type={"cart" as any} tone="info" />
                  <s-text type="strong">Whatnot</s-text>
                  <s-paragraph color="subdued">
                    CSV bulk upload to Seller Hub with rich descriptions from
                    your card data.
                  </s-paragraph>
                  <s-button>Export to Whatnot</s-button>
                </s-stack>
              </s-box>
            </Link>
          </s-grid-item>

          <s-grid-item>
            <Link to="/app/helix" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base" alignItems="center">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <s-icon type={"bolt" as any} tone="info" />
                  <s-text type="strong">Helix</s-text>
                  <s-paragraph color="subdued">
                    CSV export with smart pricing based on real-time market data.
                  </s-paragraph>
                  <s-button>Export to Helix</s-button>
                </s-stack>
              </s-box>
            </Link>
          </s-grid-item>
        </s-grid>
      </s-stack>
    </s-box>
  );
}
