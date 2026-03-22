import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const account = await db.marketplaceAccount.findUnique({
    where: {
      shopId_marketplace: { shopId: shop, marketplace: "helix" },
    },
  });

  const listingCount = await db.marketplaceListing.count({
    where: { shopId: shop, marketplace: "helix", status: "active" },
  });

  return { connected: !!account, listingCount };
};

export default function HelixSettings() {
  const { connected, listingCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Helix Integration">
      <s-section heading="Connection">
        {connected ? (
          <s-banner tone="success">
            Helix account connected. {listingCount} active listings.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Connect your Helix seller account to sync your inventory to
              the Pokemon card marketplace with the lowest fees (4.9%).
            </s-paragraph>
            <s-button variant="primary" disabled>
              Connect Helix Account (Coming Soon)
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section heading="About Helix">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Helix is a Pokemon-exclusive marketplace featuring real-time
            bid/ask pricing, AI-powered card scanning, and advanced market
            analytics. At 4.9% seller fees (vs 12.9% on eBay), it offers the
            lowest cost channel for selling Pokemon cards.
          </s-paragraph>
          <s-stack direction="block" gap="small">
            <s-text type="strong">Integration Features (Planned)</s-text>
            <s-unordered-list>
              <s-list-item>
                Automatic inventory sync from Shopify to Helix
              </s-list-item>
              <s-list-item>
                Rich structured data: set, number, grade, cert, population
              </s-list-item>
              <s-list-item>
                Cross-channel delisting when cards sell on any platform
              </s-list-item>
              <s-list-item>
                Helix market pricing data to inform pricing across all
                channels
              </s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
