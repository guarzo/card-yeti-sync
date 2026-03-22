import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { relativeTime, daysUntil, formatAction, actionIcon } from "../lib/ui-helpers";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch products from Shopify
  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50, sortKey: CREATED_AT, reverse: true) {
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
      }`,
  );

  const data = await response.json();
  const products: Product[] = data.data?.products?.nodes ?? [];
  const productCount: number = data.data?.productsCount?.count ?? 0;
  const activeProductCount = products.filter((p) => p.status === "ACTIVE").length;

  // Fetch marketplace accounts for connection status
  const accounts = await db.marketplaceAccount.findMany({
    where: { shopId: shop },
    select: { marketplace: true, tokenExpiry: true },
  });

  // Fetch listing counts grouped by marketplace and status
  const [activeCounts, errorCounts, pendingCounts] = await Promise.all([
    db.marketplaceListing.groupBy({
      by: ["marketplace"],
      where: { shopId: shop, status: "active" },
      _count: { id: true },
    }),
    db.marketplaceListing.groupBy({
      by: ["marketplace"],
      where: { shopId: shop, status: "error" },
      _count: { id: true },
    }),
    db.marketplaceListing.groupBy({
      by: ["marketplace"],
      where: { shopId: shop, status: "pending" },
      _count: { id: true },
    }),
  ]);

  // Build marketplace info map
  const marketplaceNames = ["ebay", "whatnot", "helix"];
  const marketplaces: Record<string, MarketplaceInfo> = {};
  for (const name of marketplaceNames) {
    const account = accounts.find((a) => a.marketplace === name);
    marketplaces[name] = {
      connected: !!account,
      activeCount: activeCounts.find((r) => r.marketplace === name)?._count.id ?? 0,
      errorCount: errorCounts.find((r) => r.marketplace === name)?._count.id ?? 0,
      pendingCount: pendingCounts.find((r) => r.marketplace === name)?._count.id ?? 0,
      tokenExpiry: account?.tokenExpiry?.toISOString() ?? null,
    };
  }

  // Fetch recent sync logs
  const recentLogs = await db.syncLog.findMany({
    where: { shopId: shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Fetch per-product marketplace listings
  const productIds = products.map((p) => p.id);
  const listings = await db.marketplaceListing.findMany({
    where: {
      shopId: shop,
      shopifyProductId: { in: productIds },
      status: "active",
    },
    select: { shopifyProductId: true, marketplace: true },
  });
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

const MARKETPLACE_CONFIG = {
  ebay: { label: "eBay", icon: "globe" as const, href: "/app/ebay" },
  whatnot: { label: "Whatnot", icon: "cart" as const, href: "/app/whatnot" },
  helix: { label: "Helix", icon: "bolt" as const, href: "/app/helix" },
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
  const totalErrors = Object.values(marketplaces).reduce((sum, m) => sum + m.errorCount, 0);
  const expiringTokens = Object.entries(marketplaces)
    .filter(([, m]) => m.connected && m.tokenExpiry && daysUntil(m.tokenExpiry) <= 7)
    .map(([name]) => MARKETPLACE_CONFIG[name as keyof typeof MARKETPLACE_CONFIG]?.label ?? name);

  return (
    <s-page heading="Dashboard">
      {/* Attention Banners */}
      {totalErrors > 0 && (
        <s-banner tone="critical" dismissible>
          {totalErrors} listing{totalErrors !== 1 ? "s" : ""} with errors across your marketplaces. Review and retry from each marketplace page.
        </s-banner>
      )}
      {expiringTokens.length > 0 && (
        <s-banner tone="warning" dismissible>
          {expiringTokens.join(", ")} token{expiringTokens.length > 1 ? "s" : ""} expire{expiringTokens.length === 1 ? "s" : ""} within 7 days. Reconnect to avoid sync interruption.
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
                    <s-stack direction="inline" gap="small" alignItems="center">
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
                          <s-badge tone="success">{info.activeCount} active</s-badge>
                          {info.errorCount > 0 && (
                            <s-badge tone="critical">{info.errorCount} errors</s-badge>
                          )}
                          {info.pendingCount > 0 && (
                            <s-badge tone="caution">{info.pendingCount} pending</s-badge>
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
          <s-box padding="large" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="clock" color="subdued" />
              <s-text type="strong">No sync activity yet</s-text>
              <s-paragraph color="subdued">
                Connect a marketplace and sync products to see activity here.
              </s-paragraph>
            </s-stack>
          </s-box>
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
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-icon type={actionIcon(log.action) as "circle"} size="small" />
                      <s-text>{formatAction(log.action)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{log.marketplace}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={log.status === "success" ? "success" : "critical"}
                      icon={log.status === "success" ? "check-circle" : "alert-circle" as const}
                    >
                      {log.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">{relativeTime(log.createdAt)}</s-text>
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
          <s-box padding="large" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="product" color="subdued" />
              <s-text type="strong">No products found</s-text>
              <s-paragraph color="subdued">
                Add Pokemon cards to your Shopify store to start syncing across
                marketplaces. Products with card metafields (pokemon, set name,
                grade) will get rich listings on every channel.
              </s-paragraph>
              <s-button variant="primary" href="shopify://admin/products/new">
                Add a product
              </s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Qty</s-table-header>
              <s-table-header>Marketplaces</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.slice(0, 25).map((product) => {
                const productMarketplaces = listingsByProduct[product.id] ?? [];
                return (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="base" alignItems="center">
                        {product.featuredImage && (
                          <s-thumbnail
                            src={product.featuredImage.url}
                            alt={product.title}
                            size="small"
                          />
                        )}
                        <s-stack direction="block" gap="small">
                          <s-link href={`shopify://admin/products/${product.id.split("/").pop()}`}>
                            <s-text type="strong">{product.title}</s-text>
                          </s-link>
                          <s-badge
                            tone={product.status === "ACTIVE" ? "success" : "caution"}
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
                              {MARKETPLACE_CONFIG[mp as keyof typeof MARKETPLACE_CONFIG]?.label ?? mp}
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
