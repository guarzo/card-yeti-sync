import crypto from "crypto";
import { useEffect } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { Form, useLoaderData, useSearchParams, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthorizationUrl } from "../lib/ebay-client.server";
import db from "../db.server";
import { generateHmacState } from "../lib/hmac-state.server";
import { ConnectionCard } from "../components/ConnectionCard";
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";
import { DisconnectButton } from "../components/DisconnectButton";
import { getAccountSettings } from "../lib/account-settings.server";
import { getInventoryItem, getOffersForSku } from "../lib/adapters/ebay.server";
import { getAllProducts } from "../lib/shopify-helpers.server";
import { reconcileShop } from "../lib/sync-engine.server";

interface ErrorListing {
  id: string;
  shopifyProductId: string;
  errorMessage: string | null;
  updatedAt: string;
}

interface ShadowLogEntry {
  action: string;
  productId: string | null;
  status: string;
  details: string | null;
  createdAt: string;
}

interface ShadowStats {
  total: number;
  matches: number;
  discrepancies: number;
  recent: ShadowLogEntry[];
}

interface Policy {
  id: string;
  name: string;
}

interface PolicySet {
  fulfillment: Policy[];
  payment: Policy[];
  return: Policy[];
}

interface LoaderData {
  connected: boolean;
  authUrl: string;
  listingCount: number;
  errorCount: number;
  pendingCount: number;
  delistedCount: number;
  recentErrors: ErrorListing[];
  productTitles: Record<string, string>;
  shadowMode: boolean;
  shadowStats: ShadowStats;
  inventorySyncEnabled: boolean;
  crossChannelDelistEnabled: boolean;
  policies: PolicySet;
  selectedPolicies: {
    fulfillmentPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
  };
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

  const settings = account ? getAccountSettings(account) : null;
  const shadowMode = settings?.shadowMode ?? false;
  const inventorySyncEnabled = settings?.inventorySyncEnabled ?? true;
  const crossChannelDelistEnabled = settings?.crossChannelDelistEnabled ?? true;

  // Fetch eBay business policies for the connected account
  let policies: PolicySet = { fulfillment: [], payment: [], return: [] };
  if (account) {
    try {
      const { getExistingPolicies } = await import("../lib/ebay-policies.server");
      policies = await getExistingPolicies(account);
    } catch (err) {
      console.warn("Failed to fetch eBay policies:", err);
    }
  }
  const accountSettings = (account?.settings ?? {}) as Record<string, string | null>;
  const selectedPolicies = {
    fulfillmentPolicyId: accountSettings.fulfillmentPolicyId ?? null,
    paymentPolicyId: accountSettings.paymentPolicyId ?? null,
    returnPolicyId: accountSettings.returnPolicyId ?? null,
  };

  let shadowStats: ShadowStats = { total: 0, matches: 0, discrepancies: 0, recent: [] };
  if (shadowMode) {
    const shadowLogs = await db.syncLog.findMany({
      where: { shopId: shop, marketplace: "ebay", action: { startsWith: "shadow_" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, productId: true, status: true, details: true, createdAt: true },
    });

    shadowStats = {
      total: shadowLogs.length,
      matches: shadowLogs.filter((l) => l.status === "success").length,
      discrepancies: shadowLogs.filter((l) => l.status === "error").length,
      recent: shadowLogs.slice(0, 10).map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  return {
    connected: !!account,
    listingCount,
    errorCount,
    pendingCount,
    delistedCount,
    authUrl,
    recentErrors: recentErrors.map((e) => ({
      ...e,
      updatedAt: e.updatedAt.toISOString(),
    })),
    productTitles,
    shadowMode,
    shadowStats,
    inventorySyncEnabled,
    crossChannelDelistEnabled,
    policies,
    selectedPolicies,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
    return Response.json({ disconnected: true });
  }

  if (intent === "reconcile") {
    try {
      const result = await reconcileShop(shop, admin);
      return Response.json({
        success: true,
        message: `Reconciled: ${result.delisted} delisted, ${result.relisted} relisted, ${result.errors} errors`,
        ...result,
      });
    } catch (err) {
      console.error("Reconciliation failed:", err);
      return Response.json(
        { error: err instanceof Error ? err.message : "Reconciliation failed" },
        { status: 500 },
      );
    }
  }

  // All remaining intents require a connected eBay account
  const account = await db.marketplaceAccount.findFirst({
    where: { shopId: shop, marketplace: "ebay" },
  });
  if (!account) return Response.json({ error: "Not connected" }, { status: 400 });

  if (intent === "create-policies") {
    const { createFulfillmentPolicy, createPaymentPolicy, createReturnPolicy } =
      await import("../lib/ebay-policies.server");

    const fulfillment = await createFulfillmentPolicy(account);
    const payment = await createPaymentPolicy(account);
    const returnPolicy = await createReturnPolicy(account);

    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        settings: {
          ...currentSettings,
          fulfillmentPolicyId: fulfillment.policyId,
          paymentPolicyId: payment.policyId,
          returnPolicyId: returnPolicy.policyId,
        },
      },
    });

    return Response.json({ success: true });
  }

  if (intent === "save-policies") {
    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        settings: {
          ...currentSettings,
          fulfillmentPolicyId: formData.get("fulfillmentPolicyId")?.toString() || null,
          paymentPolicyId: formData.get("paymentPolicyId")?.toString() || null,
          returnPolicyId: formData.get("returnPolicyId")?.toString() || null,
        },
      },
    });

    return Response.json({ success: true });
  }

  if (intent === "toggle-shadow") {
    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    const newShadowMode = currentSettings.shadowMode === false;
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        settings: { ...currentSettings, shadowMode: newShadowMode },
      },
    });

    return Response.json({ success: true, shadowMode: newShadowMode });
  }

  if (intent === "toggle-inventory-sync") {
    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    const newValue = !(currentSettings.inventorySyncEnabled !== false);
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: { settings: { ...currentSettings, inventorySyncEnabled: newValue } },
    });
    return Response.json({ success: true });
  }

  if (intent === "toggle-cross-channel-delist") {
    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    const newValue = !(currentSettings.crossChannelDelistEnabled !== false);
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: { settings: { ...currentSettings, crossChannelDelistEnabled: newValue } },
    });
    return Response.json({ success: true });
  }

  if (intent === "import-listings") {

    const products = await getAllProducts(admin, { query: "status:active" });
    const results = { imported: 0, skipped: 0, notFound: [] as string[] };

    const errors: string[] = [];
    for (const p of products) {
      if (!p.variant) continue;

      const productId = p.product.id as string;
      const sku = (p.variant.sku as string) || `CY-${productId.split("/").pop()}`;

      try {
        const existing = await db.marketplaceListing.findUnique({
          where: {
            shopId_shopifyProductId_marketplace: {
              shopId: session.shop,
              shopifyProductId: productId,
              marketplace: "ebay",
            },
          },
        });
        if (existing) {
          results.skipped++;
          continue;
        }

        const item = await getInventoryItem(sku, account);
        if (!item) {
          results.notFound.push(`${p.product.title} (SKU: ${sku})`);
          continue;
        }

        const offer = await getOffersForSku(sku, account);

        await db.marketplaceListing.create({
          data: {
            shopId: session.shop,
            shopifyProductId: productId,
            marketplace: "ebay",
            marketplaceId: offer?.listingId ?? "",
            offerId: offer?.offerId ?? "",
            status: "active",
            lastSyncedAt: new Date(),
          },
        });
        results.imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${p.product.title} (SKU: ${sku}): ${message}`);
        console.error(`Import listing failed for SKU ${sku}:`, message);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await db.syncLog.create({
      data: {
        shopId: session.shop,
        marketplace: "ebay",
        action: "import",
        status: errors.length > 0 ? "error" : "success",
        details: JSON.stringify({ ...results, errors }),
      },
    });

    const parts = [`Imported ${results.imported} listings`, `${results.skipped} already tracked`, `${results.notFound.length} not found on eBay`];
    if (errors.length > 0) parts.push(`${errors.length} errors`);
    return Response.json({
      success: errors.length === 0,
      message: parts.join(". ") + ".",
      ...results,
    });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};

export default function EbaySettings() {
  const {
    connected,
    listingCount,
    errorCount,
    pendingCount,
    delistedCount,
    authUrl,
    recentErrors,
    productTitles,
    shadowMode,
    shadowStats,
    inventorySyncEnabled,
    crossChannelDelistEnabled,
    policies,
    selectedPolicies,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");


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

      {shadowMode && (
        <s-banner tone="warning">
          <s-stack direction="block" gap="small">
            <s-text type="strong">Shadow Mode Active</s-text>
            <s-text>
              eBay write operations are disabled. Card Yeti is logging what it
              would do and comparing against actual eBay state.
              {shadowStats.total > 0 &&
                ` ${shadowStats.total} actions logged: ${shadowStats.matches} matches, ${shadowStats.discrepancies} discrepancies.`}
            </s-text>
          </s-stack>
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
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
            <s-grid-item>
              <StatCard label="Active Listings" value={listingCount} tone="success" />
            </s-grid-item>
            <s-grid-item>
              <StatCard label="Pending" value={pendingCount} tone="caution" />
            </s-grid-item>
            <s-grid-item>
              <StatCard label="Delisted" value={delistedCount} />
            </s-grid-item>
            <s-grid-item>
              <StatCard
                label="Errors"
                tone="critical"
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
                label="Status"
                value={
                  <s-badge tone="success">Connected</s-badge>
                }
              />
            </s-grid-item>
          </s-grid>
        </ConnectionCard>
      </s-section>

      {/* Shadow Activity */}
      {shadowMode && shadowStats.recent.length > 0 && (
        <s-section heading="Shadow Activity">
          <s-paragraph color="subdued">
            Recent actions Card Yeti would have taken on eBay. Matches mean
            Marketplace Connector is producing the same result.
          </s-paragraph>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Action</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Result</s-table-header>
              <s-table-header>Time</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shadowStats.recent.map((log, i) => (
                <s-table-row key={i}>
                  <s-table-cell>{log.action.replace("shadow_", "")}</s-table-cell>
                  <s-table-cell>
                    <s-text>{log.productId?.split("/").pop() ?? "—"}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {log.status === "success" ? (
                      <s-badge tone="success">Match</s-badge>
                    ) : (
                      <s-badge tone="critical">Discrepancy</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <RelativeTime date={log.createdAt} />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

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

      {/* Business Policies (only when connected) */}
      {connected && (
        <s-section heading="Business Policies">
          <s-paragraph color="subdued">
            Select the eBay business policies to use for new listings.
            These are read from your eBay seller account.
          </s-paragraph>
          {policies.fulfillment.length === 0 && policies.payment.length === 0 && policies.return.length === 0 ? (
            <s-banner tone="warning">
              No business policies found on your eBay account. Create policies in
              eBay Seller Hub before listing products.
            </s-banner>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="save-policies" />
              <s-stack direction="block" gap="base">
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Fulfillment Policy</s-text>
                    <select name="fulfillmentPolicyId" defaultValue={selectedPolicies.fulfillmentPolicyId || ""} style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}>
                      <option value="">— Select —</option>
                      {policies.fulfillment.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </s-stack>
                </s-box>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Payment Policy</s-text>
                    <select name="paymentPolicyId" defaultValue={selectedPolicies.paymentPolicyId || ""} style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}>
                      <option value="">— Select —</option>
                      {policies.payment.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </s-stack>
                </s-box>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Return Policy</s-text>
                    <select name="returnPolicyId" defaultValue={selectedPolicies.returnPolicyId || ""} style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}>
                      <option value="">— Select —</option>
                      {policies.return.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </s-stack>
                </s-box>
                <s-button variant="primary" type="submit">
                  Save Policies
                </s-button>
              </s-stack>
            </Form>
          )}
        </s-section>
      )}

      {/* Sync Settings (only when connected) */}
      {connected && (
        <s-section heading="Sync Settings">
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="block" gap="small">
                <s-text type="strong">Shadow mode</s-text>
                <s-text color="subdued">
                  Log what Card Yeti would do without writing to eBay.
                  Use while validating alongside Marketplace Connector.
                </s-text>
              </s-stack>
              <Form method="post">
                <input type="hidden" name="intent" value="toggle-shadow" />
                <s-button variant={shadowMode ? "primary" : "tertiary"} type="submit">
                  {shadowMode ? "Disable Shadow Mode" : "Enable Shadow Mode"}
                </s-button>
              </Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Inventory sync</s-text>
                <s-text color="subdued">
                  Delist from eBay when inventory reaches zero. Relist when inventory is restored.
                </s-text>
              </s-stack>
              <Form method="post">
                <input type="hidden" name="intent" value="toggle-inventory-sync" />
                <s-button variant={inventorySyncEnabled ? "primary" : "tertiary"} type="submit">
                  {inventorySyncEnabled ? "Enabled" : "Disabled"}
                </s-button>
              </Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Cross-channel delisting</s-text>
                <s-text color="subdued">
                  Remove from eBay when a card sells on another marketplace.
                </s-text>
              </s-stack>
              <Form method="post">
                <input type="hidden" name="intent" value="toggle-cross-channel-delist" />
                <s-button variant={crossChannelDelistEnabled ? "primary" : "tertiary"} type="submit">
                  {crossChannelDelistEnabled ? "Enabled" : "Disabled"}
                </s-button>
              </Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Reconciliation</s-text>
                <s-text color="subdued">
                  Check all listings against current inventory and correct any drift.
                </s-text>
              </s-stack>
              <Form method="post">
                <input type="hidden" name="intent" value="reconcile" />
                <s-button type="submit">Reconcile Now</s-button>
              </Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Import existing listings</s-text>
                <s-text color="subdued">
                  Scan eBay for listings matching your Shopify product SKUs and import
                  them into Card Yeti for tracking. Safe to run multiple times.
                </s-text>
              </s-stack>
              <Form method="post">
                <input type="hidden" name="intent" value="import-listings" />
                <s-button type="submit">Import from eBay</s-button>
              </Form>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
