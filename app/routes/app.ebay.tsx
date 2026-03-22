import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const account = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });

  const listingCount = await db.marketplaceListing.count({
    where: { shopId: shop, marketplace: "ebay", status: "active" },
  });

  return { connected: !!account, listingCount };
};

export default function EbaySettings() {
  const { connected, listingCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="eBay Integration" backAction={{ url: "/app" }}>
      <s-section heading="Connection">
        {connected ? (
          <s-banner tone="success">
            eBay account connected. {listingCount} active listings.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Connect your eBay seller account to automatically sync products
              with correct shipping, payment, and return policies.
            </s-paragraph>
            <s-button variant="primary" disabled>
              Connect eBay Account (Coming Soon)
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Business Policies">
        <s-paragraph>
          Configure default shipping, payment, and return policies that will be
          automatically attached to every new eBay listing. No more manual
          policy assignment.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text variant="headingSm">Fulfillment Policy</s-text>
              <s-text tone="subdued">
                USPS Ground Advantage + First Class + Priority. 1 business day
                handling. Free shipping over $75.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text variant="headingSm">Payment Policy</s-text>
              <s-text tone="subdued">
                Immediate payment required. eBay managed payments.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text variant="headingSm">Return Policy</s-text>
              <s-text tone="subdued">
                30-day returns. Buyer pays return shipping.
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
