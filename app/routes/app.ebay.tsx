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
import { daysUntil, relativeTime } from "../lib/ui-helpers";

interface ErrorListing {
  id: string;
  shopifyProductId: string;
  errorMessage: string | null;
  updatedAt: string;
}

interface LoaderData {
  connected: boolean;
  authUrl: string;
  tokenExpiry: string | null;
  listingCount: number;
  errorCount: number;
  pendingCount: number;
  delistedCount: number;
  recentErrors: ErrorListing[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const account = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });

  const [listingCount, errorCount, pendingCount, delistedCount] =
    await Promise.all([
      db.marketplaceListing.count({
        where: { shopId: shop, marketplace: "ebay", status: "active" },
      }),
      db.marketplaceListing.count({
        where: { shopId: shop, marketplace: "ebay", status: "error" },
      }),
      db.marketplaceListing.count({
        where: { shopId: shop, marketplace: "ebay", status: "pending" },
      }),
      db.marketplaceListing.count({
        where: { shopId: shop, marketplace: "ebay", status: "delisted" },
      }),
    ]);

  const recentErrors = await db.marketplaceListing.findMany({
    where: { shopId: shop, marketplace: "ebay", status: "error" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      shopifyProductId: true,
      errorMessage: true,
      updatedAt: true,
    },
  });

  // Generate OAuth URL with shop as state for CSRF check
  const state = Buffer.from(shop).toString("base64url");
  const authUrl = getAuthorizationUrl(state);

  return {
    connected: !!account,
    listingCount,
    errorCount,
    pendingCount,
    delistedCount,
    authUrl,
    tokenExpiry: account?.tokenExpiry?.toISOString() ?? null,
    recentErrors: recentErrors.map((e) => ({
      ...e,
      updatedAt: e.updatedAt.toISOString(),
    })),
  } satisfies LoaderData;
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
  const {
    connected,
    listingCount,
    errorCount,
    pendingCount,
    delistedCount,
    authUrl,
    tokenExpiry,
    recentErrors,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  const tokenDays = tokenExpiry ? daysUntil(tokenExpiry) : null;

  return (
    <s-page heading="eBay">
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

      {/* Connection */}
      <s-section heading="Connection">
        {connected ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-icon type="check-circle-filled" tone="success" />
                  <s-text type="strong">eBay account connected</s-text>
                </s-stack>
                <Form method="post">
                  <input type="hidden" name="intent" value="disconnect" />
                  <s-button variant="tertiary" tone="critical" type="submit">
                    Disconnect
                  </s-button>
                </Form>
              </s-stack>

              <s-divider />

              <s-grid gap="base">
                <s-grid-item>
                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">Active Listings</s-text>
                    <s-text type="strong">{listingCount}</s-text>
                  </s-stack>
                </s-grid-item>
                <s-grid-item>
                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">Pending</s-text>
                    <s-text type="strong">{pendingCount}</s-text>
                  </s-stack>
                </s-grid-item>
                <s-grid-item>
                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">Errors</s-text>
                    {errorCount > 0 ? (
                      <s-badge tone="critical">{errorCount}</s-badge>
                    ) : (
                      <s-text type="strong">0</s-text>
                    )}
                  </s-stack>
                </s-grid-item>
                <s-grid-item>
                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">Token Expires</s-text>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text type="strong">
                        {tokenDays !== null ? `${tokenDays} days` : "Unknown"}
                      </s-text>
                      {tokenDays !== null && tokenDays <= 7 && (
                        <s-badge tone="warning">Renew soon</s-badge>
                      )}
                    </s-stack>
                  </s-stack>
                </s-grid-item>
              </s-grid>
            </s-stack>
          </s-box>
        ) : (
          <s-box padding="large" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="connect" color="subdued" />
              <s-text type="strong">Connect your eBay seller account</s-text>
              <s-paragraph color="subdued">
                Link your eBay account to automatically create and manage
                listings. Card Yeti will use your business policies and map all
                card metafields to eBay item specifics.
              </s-paragraph>
              <a href={authUrl} target="_top">
                <s-button variant="primary">Connect eBay Account</s-button>
              </a>
            </s-stack>
          </s-box>
        )}
      </s-section>

      {/* Listing Errors */}
      {errorCount > 0 && (
        <s-section heading="Listing Errors">
          <s-banner tone="critical">
            {errorCount} listing{errorCount !== 1 ? "s" : ""} need attention.
            Review the errors below.
          </s-banner>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Error</s-table-header>
              <s-table-header>Time</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentErrors.map((listing) => (
                <s-table-row key={listing.id}>
                  <s-table-cell>
                    <s-text type="strong">
                      {listing.shopifyProductId.split("/").pop()}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone="critical">
                      {listing.errorMessage ?? "Unknown error"}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">
                      {relativeTime(listing.updatedAt)}
                    </s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {/* Business Policies */}
      <s-section heading="Business Policies">
        <s-paragraph color="subdued">
          Default policies applied to all new eBay listings.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-icon type="delivery" tone="info" />
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Fulfillment Policy</s-text>
                  <s-text color="subdued">
                    USPS Ground Advantage + First Class + Priority. 1 business
                    day handling. Free shipping over $75.
                  </s-text>
                </s-stack>
              </s-stack>
              <s-button variant="tertiary" disabled>
                Edit
              </s-button>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-icon type="credit-card" tone="info" />
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Payment Policy</s-text>
                  <s-text color="subdued">
                    Immediate payment required. eBay managed payments.
                  </s-text>
                </s-stack>
              </s-stack>
              <s-button variant="tertiary" disabled>
                Edit
              </s-button>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-icon type="return" tone="info" />
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Return Policy</s-text>
                  <s-text color="subdued">
                    30-day returns. Buyer pays return shipping.
                  </s-text>
                </s-stack>
              </s-stack>
              <s-button variant="tertiary" disabled>
                Edit
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Sync Settings */}
      <s-section heading="Sync Settings">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Auto-sync new products</s-text>
              <s-text color="subdued">
                Automatically list new Shopify products on eBay when created.
              </s-text>
            </s-stack>
            <s-switch label="Auto-sync new products" disabled />
          </s-stack>

          <s-divider />

          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Inventory sync</s-text>
              <s-text color="subdued">
                Delist from eBay when inventory reaches zero.
              </s-text>
            </s-stack>
            <s-switch label="Inventory sync" disabled />
          </s-stack>

          <s-divider />

          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Cross-channel delisting</s-text>
              <s-text color="subdued">
                Remove from eBay when a card sells on another marketplace.
              </s-text>
            </s-stack>
            <s-switch label="Cross-channel delisting" disabled />
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
