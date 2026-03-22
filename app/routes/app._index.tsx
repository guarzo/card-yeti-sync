import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { daysUntil, formatAction, actionIcon } from "../lib/ui-helpers";
import {
  MARKETPLACE_CONFIG,
  marketplaceLabel,
  type MarketplaceKey,
} from "../lib/marketplace-config";
import { EmptyState } from "../components/EmptyState";
import { RelativeTime } from "../components/RelativeTime";

interface Product {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  productType: string;
  featuredImage: { url: string } | null;
}

interface SyncLogEntry {
  id: string;
  marketplace: string;
  action: string;
  status: string;
  createdAt: string;
}

interface MarketplaceInfo {
  connected: boolean;
  activeCount: number;
  errorCount: number;
  pendingCount: number;
  tokenExpiry: string | null;
}

interface LoaderData {
  products: Product[];
  productCount: number;
  activeProductCount: number;
  marketplaces: Record<string, MarketplaceInfo>;
  recentLogs: SyncLogEntry[];
  listingsByProduct: Record<string, string[]>;
}

export const meta: MetaFunction = () => [
  { title: "Dashboard | Card Yeti Sync" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Phase 1: Run independent queries in parallel
  const [graphqlResponse, accounts, statusCounts, recentLogs] =
    await Promise.all([
      admin.graphql(
        `#graphql
        query getProducts {
          products(first: 25, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              title
              status
              totalInventory
              productType
              featuredImage {
                url
              }
            }
          }
          productsCount {
            count
          }
          activeProductsCount: productsCount(query: "status:active") {
            count
          }
        }`,
      ),
      db.marketplaceAccount.findMany({
        where: { shopId: shop },
        select: { marketplace: true, tokenExpiry: true },
      }),
      db.marketplaceListing.groupBy({
        by: ["marketplace", "status"],
        where: { shopId: shop, status: { in: ["active", "error", "pending"] } },
        _count: { id: true },
      }),
      db.syncLog.findMany({
        where: { shopId: shop },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  // Parse GraphQL response
  const data = await graphqlResponse.json();
  if (!graphqlResponse.ok || (data as { errors?: unknown }).errors || !data.data) {
    throw new Response("Failed to load products from Shopify", { status: 502 });
  }
  const products: Product[] = data.data.products?.nodes ?? [];
  const productCount: number = data.data.productsCount?.count ?? 0;
  const activeProductCount: number =
    data.data.activeProductsCount?.count ?? 0;

  // Phase 2: Fetch per-product listings (depends on productIds from GraphQL)
  const productIds = products.map((p) => p.id);
  const listings = await db.marketplaceListing.findMany({
    where: {
      shopId: shop,
      shopifyProductId: { in: productIds },
      status: "active",
    },
    select: { shopifyProductId: true, marketplace: true },
  });

  // Build marketplace info map from combined statusCounts
  const marketplaceNames = Object.keys(MARKETPLACE_CONFIG);
  const marketplaces: Record<string, MarketplaceInfo> = {};
  for (const name of marketplaceNames) {
    const account = accounts.find((a) => a.marketplace === name);
    marketplaces[name] = {
      connected: !!account,
      activeCount: 0,
      errorCount: 0,
      pendingCount: 0,
      tokenExpiry: account?.tokenExpiry?.toISOString() ?? null,
    };
  }
  for (const row of statusCounts) {
    const mp = marketplaces[row.marketplace];
    if (!mp) continue;
    if (row.status === "active") mp.activeCount = row._count.id;
    else if (row.status === "error") mp.errorCount = row._count.id;
    else if (row.status === "pending") mp.pendingCount = row._count.id;
  }

  // Build per-product listing map
  const listingsByProduct: Record<string, string[]> = {};
  for (const l of listings) {
    (listingsByProduct[l.shopifyProductId] ??= []).push(l.marketplace);
  }

  return {
    products,
    productCount,
    activeProductCount,
    marketplaces,
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      marketplace: l.marketplace,
      action: l.action,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
    })),
    listingsByProduct,
  } satisfies LoaderData;
};

export default function Dashboard() {
  const {
    products,
    productCount,
    activeProductCount,
    marketplaces,
    recentLogs,
    listingsByProduct,
  } = useLoaderData<typeof loader>();

  // Check for attention-worthy items
  const totalErrors = Object.values(marketplaces).reduce(
    (sum, m) => sum + m.errorCount,
    0,
  );
  const expiredTokens = Object.entries(marketplaces)
    .filter(
      ([, m]) => m.connected && m.tokenExpiry && daysUntil(m.tokenExpiry) <= 0,
    )
    .map(
      ([name]) => MARKETPLACE_CONFIG[name as MarketplaceKey]?.label ?? name,
    );
  const expiringTokens = Object.entries(marketplaces)
    .filter(
      ([, m]) =>
        m.connected &&
        m.tokenExpiry &&
        daysUntil(m.tokenExpiry) > 0 &&
        daysUntil(m.tokenExpiry) <= 7,
    )
    .map(
      ([name]) => MARKETPLACE_CONFIG[name as MarketplaceKey]?.label ?? name,
    );

  return (
    <s-page heading="Dashboard">
      {/* Attention Banners */}
      {totalErrors > 0 && (
        <s-banner tone="critical" dismissible>
          {totalErrors} listing{totalErrors !== 1 ? "s" : ""} with errors across
          your marketplaces. Review and retry from each marketplace page.
        </s-banner>
      )}
      {expiredTokens.length > 0 && (
        <s-banner tone="critical" dismissible>
          {expiredTokens.join(", ")} token
          {expiredTokens.length > 1 ? "s have" : " has"} expired. Reconnect to
          resume syncing.
        </s-banner>
      )}
      {expiringTokens.length > 0 && (
        <s-banner tone="warning" dismissible>
          {expiringTokens.join(", ")} token
          {expiringTokens.length > 1 ? "s" : ""} expire
          {expiringTokens.length === 1 ? "s" : ""} within 7 days. Reconnect to
          avoid sync interruption.
        </s-banner>
      )}
      {Object.values(marketplaces).every((m) => !m.connected) && (
        <s-banner tone="info">
          Get started by connecting your first marketplace. Card Yeti will sync
          your Shopify products automatically.
        </s-banner>
      )}

      {/* Marketplace Overview */}
      <s-section heading="Marketplace Overview">
        <s-grid gap="base">
          {/* Shopify Card */}
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-icon type="store" tone="info" />
                  <s-text type="strong">Shopify</s-text>
                </s-stack>
                <s-text type="strong">{productCount}</s-text>
                <s-stack direction="inline" gap="small">
                  <s-badge tone="success">{activeProductCount} active</s-badge>
                </s-stack>
                <s-text color="subdued">Source of truth</s-text>
              </s-stack>
            </s-box>
          </s-grid-item>

          {/* Marketplace Cards */}
          {Object.entries(MARKETPLACE_CONFIG).map(([key, config]) => {
            const info = marketplaces[key];
            return (
              <s-grid-item key={key}>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <s-icon
                        type={config.icon}
                        tone={info.connected ? "success" : undefined}
                      />
                      <s-text type="strong">{config.label}</s-text>
                    </s-stack>
                    <s-text type="strong">
                      {info.connected ? info.activeCount : "--"}
                    </s-text>
                    <s-stack direction="inline" gap="small">
                      {info.connected ? (
                        <>
                          <s-badge tone="success">
                            {info.activeCount} active
                          </s-badge>
                          {info.errorCount > 0 && (
                            <s-badge tone="critical">
                              {info.errorCount} errors
                            </s-badge>
                          )}
                          {info.pendingCount > 0 && (
                            <s-badge tone="caution">
                              {info.pendingCount} pending
                            </s-badge>
                          )}
                        </>
                      ) : (
                        <s-badge tone="info">Not connected</s-badge>
                      )}
                    </s-stack>
                    <s-link href={config.href}>
                      {info.connected ? "Manage" : "Set up"} →
                    </s-link>
                  </s-stack>
                </s-box>
              </s-grid-item>
            );
          })}
        </s-grid>
      </s-section>

      {/* Recent Activity */}
      <s-section heading="Recent Activity">
        {recentLogs.length === 0 ? (
          <EmptyState
            icon="clock"
            heading="No sync activity yet"
            description="Connect a marketplace and sync products to see activity here."
          />
        ) : (
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Action</s-table-header>
              <s-table-header>Marketplace</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Time</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentLogs.map((log) => (
                <s-table-row key={log.id}>
                  <s-table-cell>
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <s-icon type={actionIcon(log.action)} size="small" />
                      <s-text>{formatAction(log.action)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{marketplaceLabel(log.marketplace)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={log.status === "success" ? "success" : "critical"}
                      icon={
                        log.status === "success"
                          ? "check-circle"
                          : "alert-circle"
                      }
                    >
                      {log.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <RelativeTime date={log.createdAt} />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {/* Products */}
      <s-section heading="Products">
        {products.length === 0 ? (
          <EmptyState
            icon="product"
            heading="No products found"
            description="Add Pokemon cards to your Shopify store to start syncing across marketplaces. Products with card metafields (pokemon, set name, grade) will get rich listings on every channel."
            action={
              <s-button variant="primary" href="shopify://admin/products/new">
                Add a product
              </s-button>
            }
          />
        ) : (
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Qty</s-table-header>
              <s-table-header>Marketplaces</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => {
                const productMarketplaces =
                  listingsByProduct[product.id] ?? [];
                return (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                      >
                        {product.featuredImage && (
                          <s-thumbnail
                            src={product.featuredImage.url}
                            alt={product.title}
                            size="small"
                          />
                        )}
                        <s-stack direction="block" gap="small">
                          <s-link
                            href={`shopify://admin/products/${product.id.split("/").pop()}`}
                          >
                            <s-text type="strong">{product.title}</s-text>
                          </s-link>
                          <s-badge
                            tone={
                              product.status === "ACTIVE"
                                ? "success"
                                : "caution"
                            }
                          >
                            {product.status.toLowerCase()}
                          </s-badge>
                        </s-stack>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {product.productType ? (
                        <s-badge>{product.productType}</s-badge>
                      ) : (
                        <s-text color="subdued">--</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{product.totalInventory}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {productMarketplaces.length > 0 ? (
                        <s-stack direction="inline" gap="small">
                          {productMarketplaces.map((mp) => (
                            <s-badge key={mp} tone="success">
                              {marketplaceLabel(mp)}
                            </s-badge>
                          ))}
                        </s-stack>
                      ) : (
                        <s-text color="subdued">--</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
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
