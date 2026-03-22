import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { useLoaderData, useSearchParams, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthorizationUrl } from "../lib/ebay-client.server";
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

  // Generate OAuth URL with shop as state for CSRF check
  const state = Buffer.from(shop).toString("base64url");
  const authUrl = getAuthorizationUrl(state);

  return {
    connected: !!account,
    listingCount,
    authUrl,
    tokenExpiry: account?.tokenExpiry?.toISOString() ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disconnect") {
    await db.marketplaceAccount.delete({
      where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
    });
    return { disconnected: true };
  }

  return null;
};

export default function EbaySettings() {
  const { connected, listingCount, authUrl, tokenExpiry } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  return (
    <s-page heading="eBay Integration">
      {success === "connected" && (
        <s-banner tone="success" dismissible>
          eBay account connected successfully.
        </s-banner>
      )}
      {error === "oauth_denied" && (
        <s-banner tone="critical" dismissible>
          eBay authorization was denied or failed. Please try again.
        </s-banner>
      )}

      <s-section heading="Connection">
        {connected ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="success">
              eBay account connected. {listingCount} active listing
              {listingCount !== 1 ? "s" : ""}.
            </s-banner>
            {tokenExpiry && (
              <s-text color="subdued">
                Token expires: {new Date(tokenExpiry).toLocaleDateString()}
              </s-text>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <s-button variant="tertiary" tone="critical" type="submit">
                Disconnect eBay Account
              </s-button>
            </Form>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Connect your eBay seller account to automatically sync products
              with correct shipping, payment, and return policies.
            </s-paragraph>
            <a href={authUrl} target="_top">
              <s-button variant="primary">Connect eBay Account</s-button>
            </a>
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
            <s-stack direction="block" gap="small">
              <s-text type="strong">Fulfillment Policy</s-text>
              <s-text color="subdued">
                USPS Ground Advantage + First Class + Priority. 1 business day
                handling. Free shipping over $75.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Payment Policy</s-text>
              <s-text color="subdued">
                Immediate payment required. eBay managed payments.
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Return Policy</s-text>
              <s-text color="subdued">
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
