import crypto from "crypto";
import { useEffect } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData, useSearchParams, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthorizationUrl } from "../lib/ebay-client.server";
import db from "../db.server";
import { daysUntil } from "../lib/ui-helpers";
import { generateHmacState } from "../lib/hmac-state.server";
import { ConnectionCard } from "../components/ConnectionCard";
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";
import { DisconnectButton } from "../components/DisconnectButton";

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
  productTitles: Record<string, string>;
}

export const meta: MetaFunction = () => [{ title: "eBay | Card Yeti Sync" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const account = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });

  const statusCounts = await db.marketplaceListing.groupBy({
    by: ["status"],
    where: {
      shopId: shop,
      marketplace: "ebay",
      status: { in: ["active", "error", "pending", "delisted"] },
    },
    _count: { id: true },
  });
  let listingCount = 0,
    errorCount = 0,
    pendingCount = 0,
    delistedCount = 0;
  for (const row of statusCounts) {
    if (row.status === "active") listingCount = row._count.id;
    else if (row.status === "error") errorCount = row._count.id;
    else if (row.status === "pending") pendingCount = row._count.id;
    else if (row.status === "delisted") delistedCount = row._count.id;
  }

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

  // Look up product titles for error display (non-critical — don't crash loader)
  const productTitles: Record<string, string> = {};
  if (recentErrors.length > 0) {
    const ids = recentErrors
      .map((e) => e.shopifyProductId)
      .filter((id) => id.startsWith("gid://"));
    if (ids.length > 0) {
      try {
        const titleResponse = await admin.graphql(
          `#graphql
          query getProductTitles($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
              }
            }
          }`,
          { variables: { ids } },
        );
        const titleData = await titleResponse.json();
        for (const node of titleData.data?.nodes ?? []) {
          if (node?.id && node?.title) {
            productTitles[node.id] = node.title;
          }
        }
      } catch (err) {
        console.warn("Failed to fetch product titles for error display:", err);
      }
    }
  }

  // Generate HMAC-signed OAuth state with nonce for CSRF/replay protection
  const nonce = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Clean up expired nonces, then store new one
  await db.oAuthNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthNonce.create({ data: { shopId: shop, nonce, expiresAt } });

  const state = generateHmacState(shop, nonce);
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
    productTitles,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disconnect") {
    // eBay OAuth2 does not support API token revocation;
    // users must revoke via eBay account settings.
    await db.$transaction([
      db.marketplaceListing.deleteMany({
        where: { shopId: shop, marketplace: "ebay" },
      }),
      db.marketplaceAccount.deleteMany({
        where: { shopId: shop, marketplace: "ebay" },
      }),
    ]);
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
    productTitles,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  const tokenExpired =
    tokenExpiry != null && new Date(tokenExpiry).getTime() <= Date.now();
  const tokenDays =
    tokenExpiry && !tokenExpired ? daysUntil(tokenExpiry) : null;

  // Clean up URL params after reading
  useEffect(() => {
    if (success || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [success, error]);

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
        <ConnectionCard
          marketplace="eBay"
          connected={connected}
          icon="connect"
          connectDescription="Link your eBay account to automatically create and manage listings. Card Yeti will use your business policies and map all card metafields to eBay item specifics."
          connectAction={
            <a href={authUrl} target="_top">
              <s-button variant="primary">Connect eBay Account</s-button>
            </a>
          }
          disconnectAction={<DisconnectButton marketplace="eBay" />}
        >
          <s-grid gap="base">
            <s-grid-item>
              <StatCard label="Active Listings" value={listingCount} />
            </s-grid-item>
            <s-grid-item>
              <StatCard label="Pending" value={pendingCount} />
            </s-grid-item>
            <s-grid-item>
              <StatCard
                label="Errors"
                value={
                  errorCount > 0 ? (
                    <s-badge tone="critical">{errorCount}</s-badge>
                  ) : (
                    "0"
                  )
                }
              />
            </s-grid-item>
            <s-grid-item>
              <StatCard
                label="Token Expires"
                value={
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <span>
                      {tokenExpired
                        ? "Expired"
                        : tokenDays !== null
                          ? `${tokenDays} days`
                          : "Unknown"}
                    </span>
                    {tokenExpired ? (
                      <s-badge tone="critical">Reconnect</s-badge>
                    ) : (
                      tokenDays !== null &&
                      tokenDays <= 7 && (
                        <s-badge tone="warning">Renew soon</s-badge>
                      )
                    )}
                  </s-stack>
                }
              />
            </s-grid-item>
          </s-grid>
        </ConnectionCard>
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
                      {productTitles[listing.shopifyProductId] ??
                        listing.shopifyProductId.split("/").pop()}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone="critical">
                      {listing.errorMessage ?? "Unknown error"}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <RelativeTime date={listing.updatedAt} />
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
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
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
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
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
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
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
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small">
              <s-text type="strong">Auto-sync new products</s-text>
              <s-text color="subdued">
                Automatically list new Shopify products on eBay when created.
              </s-text>
            </s-stack>
            <s-switch label="Auto-sync new products" disabled />
          </s-stack>

          <s-divider />

          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small">
              <s-text type="strong">Inventory sync</s-text>
              <s-text color="subdued">
                Delist from eBay when inventory reaches zero.
              </s-text>
            </s-stack>
            <s-switch label="Inventory sync" disabled />
          </s-stack>

          <s-divider />

          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
