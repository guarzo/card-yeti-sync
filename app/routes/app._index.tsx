import { useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  formatAction,
  actionIcon,
  actionTone,
} from "../lib/ui-helpers";
import {
  MARKETPLACE_CONFIG,
  SHOPIFY_CONFIG,
  marketplaceLabel,
  type MarketplaceKey,
} from "../lib/marketplace-config";
import { EmptyState } from "../components/EmptyState";
import { RelativeTime } from "../components/RelativeTime";
import { AttentionZone } from "../components/dashboard/AttentionZone";
import { MarketplaceTile } from "../components/dashboard/MarketplaceTile";
import { SyncSummary } from "../components/dashboard/SyncSummary";
import { ProductsSyncTable } from "../components/dashboard/ProductsSyncTable";
import { BulkApproveModal } from "../components/dashboard/BulkApproveModal";

interface Product {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  productType: string;
  featuredImage: { url: string } | null;
  price: string | null;
}

interface SyncLogEntry {
  id: string;
  marketplace: string;
  action: string;
  status: string;
  productTitle: string | null;
  createdAt: string;
}

interface MarketplaceInfo {
  connected: boolean;
  activeCount: number;
  errorCount: number;
  pendingCount: number;
  tokenExpiry: string | null;
}

interface PriceSuggestionEntry {
  id: string;
  shopifyProductId: string;
  currentPrice: string;
  suggestedPrice: string;
  reason: string | null;
  productTitle?: string;
}

interface ListingStatusEntry {
  marketplace: string;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

interface LoaderData {
  products: Product[];
  productCount: number;
  activeProductCount: number;
  marketplaces: Record<string, MarketplaceInfo>;
  recentLogs: SyncLogEntry[];
  listingsByProduct: Record<string, ListingStatusEntry[]>;
  priceSuggestions: Record<string, PriceSuggestionEntry>;
  pendingPriceReviews: number;
  connectedMarketplaces: MarketplaceKey[];
  productsAwaitingSync: number;
  totalActiveListings: number;
  totalPendingSyncs: number;
  totalErrors: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

export const meta: MetaFunction = () => [
  { title: "Dashboard | Card Yeti Sync" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "all";
  const afterCursor = url.searchParams.get("after") ?? null;

  // Phase 1: Run independent queries in parallel
  const [graphqlResponse, accounts, statusCounts, recentLogs, pendingSuggestions] =
    await Promise.all([
      admin.graphql(
        `#graphql
        query getProducts($cursor: String) {
          products(first: 25, after: $cursor, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              title
              status
              totalInventory
              productType
              featuredImage { url }
              priceRangeV2 { minVariantPrice { amount } }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
          productsCount { count }
          activeProductsCount: productsCount(query: "status:active") { count }
        }`,
        { variables: { cursor: afterCursor } },
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
        take: 15,
      }),
      db.priceSuggestion.findMany({
        where: { shopId: shop, status: "pending" },
      }),
    ]);

  // Parse GraphQL response
  const data = await graphqlResponse.json();
  if (!graphqlResponse.ok || (data as { errors?: unknown }).errors || !data.data) {
    throw new Response("Failed to load products from Shopify", { status: 502 });
  }
  const products: Product[] = (data.data.products?.nodes ?? []).map(
    (p: Record<string, unknown>) => ({
      id: p.id as string,
      title: p.title as string,
      status: p.status as string,
      totalInventory: p.totalInventory as number,
      productType: p.productType as string,
      featuredImage: p.featuredImage as { url: string } | null,
      price:
        (p.priceRangeV2 as { minVariantPrice?: { amount?: string } })
          ?.minVariantPrice?.amount ?? null,
    }),
  );
  const productCount: number = data.data.productsCount?.count ?? 0;
  const activeProductCount: number = data.data.activeProductsCount?.count ?? 0;
  const hasNextPage: boolean = data.data.products?.pageInfo?.hasNextPage ?? false;
  const endCursor: string | null = data.data.products?.pageInfo?.endCursor ?? null;

  // Phase 2: Fetch per-product listings (depends on productIds from GraphQL)
  const productIds = products.map((p) => p.id);
  const listings = await db.marketplaceListing.findMany({
    where: {
      shopId: shop,
      shopifyProductId: { in: productIds },
    },
    select: {
      shopifyProductId: true,
      marketplace: true,
      status: true,
      errorMessage: true,
      lastSyncedAt: true,
    },
  });

  // Build marketplace info map
  const marketplaceNames = Object.keys(MARKETPLACE_CONFIG) as MarketplaceKey[];
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
  let totalActiveListings = 0;
  let totalPendingSyncs = 0;
  let totalErrors = 0;
  for (const row of statusCounts) {
    const mp = marketplaces[row.marketplace];
    if (!mp) continue;
    if (row.status === "active") {
      mp.activeCount = row._count.id;
      totalActiveListings += row._count.id;
    } else if (row.status === "error") {
      mp.errorCount = row._count.id;
      totalErrors += row._count.id;
    } else if (row.status === "pending") {
      mp.pendingCount = row._count.id;
      totalPendingSyncs += row._count.id;
    }
  }

  // Connected marketplaces list (for dynamic table columns)
  const connectedMarketplaces = marketplaceNames.filter(
    (name) => marketplaces[name].connected,
  );

  // Build per-product listing map (full status info, not just marketplace names)
  const listingsByProduct: Record<string, ListingStatusEntry[]> = {};
  for (const l of listings) {
    (listingsByProduct[l.shopifyProductId] ??= []).push({
      marketplace: l.marketplace,
      status: l.status,
      errorMessage: l.errorMessage,
      lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
    });
  }

  // Build price suggestions map (keyed by product ID)
  const priceSuggestions: Record<string, PriceSuggestionEntry> = {};
  for (const s of pendingSuggestions) {
    priceSuggestions[s.shopifyProductId] = {
      id: s.id,
      shopifyProductId: s.shopifyProductId,
      currentPrice: s.currentPrice.toString(),
      suggestedPrice: s.suggestedPrice.toString(),
      reason: s.reason,
    };
  }

  // Count products with no marketplace listings (global, not page-scoped)
  const totalProductsWithListings = await db.marketplaceListing.groupBy({
    by: ["shopifyProductId"],
    where: { shopId: shop },
  });
  const productsAwaitingSync = Math.max(
    0,
    productCount - totalProductsWithListings.length,
  );

  // Server-side filtering: narrow products based on filter param
  let filteredProducts = products;
  if (filter === "errors") {
    const errorProductIds = new Set(
      listings.filter((l) => l.status === "error").map((l) => l.shopifyProductId),
    );
    filteredProducts = products.filter((p) => errorProductIds.has(p.id));
  } else if (filter === "pending") {
    const pendingProductIds = new Set(
      listings.filter((l) => l.status === "pending").map((l) => l.shopifyProductId),
    );
    filteredProducts = products.filter((p) => pendingProductIds.has(p.id));
  } else if (filter === "price_reviews") {
    const priceReviewProductIds = new Set(
      pendingSuggestions.map((s) => s.shopifyProductId),
    );
    filteredProducts = products.filter((p) => priceReviewProductIds.has(p.id));
  }

  // Sort products by most recently synced first (spec requirement)
  // Build a map of product -> latest sync timestamp for sorting
  const latestSyncByProduct: Record<string, string> = {};
  for (const l of listings) {
    if (l.lastSyncedAt) {
      const iso = l.lastSyncedAt.toISOString();
      if (!latestSyncByProduct[l.shopifyProductId] || iso > latestSyncByProduct[l.shopifyProductId]) {
        latestSyncByProduct[l.shopifyProductId] = iso;
      }
    }
  }
  filteredProducts.sort((a, b) => {
    const aSync = latestSyncByProduct[a.id] ?? "";
    const bSync = latestSyncByProduct[b.id] ?? "";
    return bSync.localeCompare(aSync); // most recent first, unsynced at bottom
  });

  // Parse SyncLog details for product titles
  const parsedLogs: SyncLogEntry[] = recentLogs.map((l) => {
    let productTitle: string | null = null;
    if (l.details) {
      try {
        const parsed = JSON.parse(l.details);
        productTitle = parsed.productTitle ?? null;
      } catch {
        // details is not valid JSON, skip
      }
    }
    return {
      id: l.id,
      marketplace: l.marketplace,
      action: l.action,
      status: l.status,
      productTitle,
      createdAt: l.createdAt.toISOString(),
    };
  });

  return {
    products: filteredProducts,
    productCount,
    activeProductCount,
    marketplaces,
    recentLogs: parsedLogs,
    listingsByProduct,
    priceSuggestions,
    pendingPriceReviews: pendingSuggestions.length,
    connectedMarketplaces,
    productsAwaitingSync,
    totalActiveListings,
    totalPendingSyncs,
    totalErrors,
    hasNextPage,
    endCursor,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "approve-price") {
    const suggestionId = formData.get("suggestionId") as string;
    if (!suggestionId) return { error: "Missing suggestion ID" };

    const suggestion = await db.priceSuggestion.findFirst({
      where: { id: suggestionId, shopId: shop, status: "pending" },
    });
    if (!suggestion) return { error: "Suggestion not found" };

    // Look up variant IDs for this product (required for price update)
    const variantResponse = await admin.graphql(
      `#graphql
      query getVariants($productId: ID!) {
        product(id: $productId) {
          variants(first: 10) {
            nodes { id }
          }
        }
      }`,
      { variables: { productId: suggestion.shopifyProductId } },
    );
    const variantData = await variantResponse.json();
    const variants = variantData.data?.product?.variants?.nodes ?? [];
    if (variants.length === 0) {
      return { error: "No variants found for this product" };
    }

    // Update all variant prices via productVariantsBulkUpdate
    const mutationResponse = await admin.graphql(
      `#graphql
      mutation bulkUpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId: suggestion.shopifyProductId,
          variants: variants.map((v: { id: string }) => ({
            id: v.id,
            price: suggestion.suggestedPrice.toString(),
          })),
        },
      },
    );
    const mutationData = await mutationResponse.json();
    const userErrors = mutationData.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { error: `Shopify error: ${userErrors[0].message}` };
    }

    // Mark suggestion as approved
    await db.priceSuggestion.update({
      where: { id: suggestionId },
      data: { status: "approved", reviewedAt: new Date() },
    });

    // TODO: Queue marketplace price syncs (eBay, Whatnot, Helix) for this product.
    // The marketplace adapter pattern will handle propagating the new price.

    return { approved: true };
  }

  if (intent === "bulk-approve-prices") {
    const suggestionIds = formData.getAll("suggestionIds") as string[];
    if (suggestionIds.length === 0) return { error: "No suggestions selected" };

    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of suggestionIds) {
      try {
        const suggestion = await db.priceSuggestion.findFirst({
          where: { id, shopId: shop, status: "pending" },
        });
        if (!suggestion) {
          results.push({ id, success: false, error: "Not found" });
          continue;
        }

        // Look up variant IDs
        const variantResponse = await admin.graphql(
          `#graphql
          query getVariants($productId: ID!) {
            product(id: $productId) {
              variants(first: 10) { nodes { id } }
            }
          }`,
          { variables: { productId: suggestion.shopifyProductId } },
        );
        const variantData = await variantResponse.json();
        const variants = variantData.data?.product?.variants?.nodes ?? [];
        if (variants.length === 0) {
          results.push({ id, success: false, error: "No variants found" });
          continue;
        }

        const mutationResponse = await admin.graphql(
          `#graphql
          mutation bulkUpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants { id }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              productId: suggestion.shopifyProductId,
              variants: variants.map((v: { id: string }) => ({
                id: v.id,
                price: suggestion.suggestedPrice.toString(),
              })),
            },
          },
        );
        const mutationData = await mutationResponse.json();
        const userErrors = mutationData.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (userErrors.length > 0) {
          results.push({ id, success: false, error: userErrors[0].message });
          continue;
        }

        await db.priceSuggestion.update({
          where: { id },
          data: { status: "approved", reviewedAt: new Date() },
        });
        results.push({ id, success: true });
      } catch (err) {
        results.push({
          id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      return {
        partialSuccess: true,
        approved: results.filter((r) => r.success).length,
        failed: failures.length,
      };
    }
    return { approved: results.length };
  }

  return null;
};

export default function Dashboard() {
  const {
    products,
    productCount,
    activeProductCount,
    marketplaces,
    recentLogs,
    listingsByProduct,
    priceSuggestions,
    pendingPriceReviews,
    connectedMarketplaces,
    productsAwaitingSync,
    totalActiveListings,
    totalPendingSyncs,
    totalErrors,
    hasNextPage,
    endCursor,
  } = useLoaderData<typeof loader>();

  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Build suggestions list with product titles for the modal
  const suggestionsWithTitles = Object.values(priceSuggestions).map((s) => ({
    ...s,
    productTitle:
      products.find((p) => p.id === s.shopifyProductId)?.title ??
      s.shopifyProductId,
  }));

  return (
    <s-page heading="Dashboard">
      {/* Zone 1: Attention Zone */}
      <AttentionZone
        marketplaces={marketplaces}
        totalErrors={totalErrors}
        pendingPriceReviews={pendingPriceReviews}
      />

      {/* Zone 2: Stat Row */}
      <s-box paddingBlock="base">
        <s-grid
          gridTemplateColumns="1fr 1fr 1fr 1fr 1fr"
          gap="base"
        >
          <s-grid-item>
            <a href="#products-sync" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Total Products</s-text>
                  <div style={{ fontSize: "1.25rem" }}>
                    <s-text type="strong">
                      {productCount}
                    </s-text>
                  </div>
                </s-stack>
              </s-box>
            </a>
          </s-grid-item>
          <s-grid-item>
            <a href="#products-sync" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Active Listings</s-text>
                  <div style={{ fontSize: "1.25rem" }}>
                    <s-text type="strong">
                      {totalActiveListings}
                    </s-text>
                  </div>
                </s-stack>
              </s-box>
            </a>
          </s-grid-item>
          <s-grid-item>
            <a href="?filter=price_reviews#products-sync" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background={pendingPriceReviews > 0 ? undefined : "subdued"}
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Price Reviews</s-text>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <div style={{ fontSize: "1.25rem" }}>
                      <s-text type="strong">
                        {pendingPriceReviews}
                      </s-text>
                    </div>
                    {pendingPriceReviews > 0 && (
                      <s-badge tone="info">new</s-badge>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            </a>
          </s-grid-item>
          <s-grid-item>
            <a href="?filter=pending#products-sync" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Pending Syncs</s-text>
                  <div style={{ fontSize: "1.25rem" }}>
                    <s-text type="strong">
                      {totalPendingSyncs}
                    </s-text>
                  </div>
                </s-stack>
              </s-box>
            </a>
          </s-grid-item>
          <s-grid-item>
            <a href="?filter=errors#products-sync" style={{ textDecoration: "none", color: "inherit" }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background={totalErrors > 0 ? undefined : "subdued"}
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Errors</s-text>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <div style={{ fontSize: "1.25rem" }}>
                      <s-text type="strong">
                        {totalErrors}
                      </s-text>
                    </div>
                    {totalErrors > 0 && (
                      <s-badge tone="critical">{totalErrors}</s-badge>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            </a>
          </s-grid-item>
        </s-grid>
      </s-box>

      {/* Zone 3: Marketplace Health Tiles */}
      <s-box paddingBlock="base">
        <s-grid
          gridTemplateColumns="1fr 1fr 1fr 1fr"
          gap="base"
        >
          {/* Shopify tile */}
          <s-grid-item>
            <MarketplaceTile
              name={SHOPIFY_CONFIG.label}
              icon={SHOPIFY_CONFIG.icon}
              connected={true}
              isShopify={true}
              activeCount={productCount}
              secondaryCount={activeProductCount}
              secondaryLabel="active"
            />
          </s-grid-item>

          {/* Marketplace tiles */}
          {Object.entries(MARKETPLACE_CONFIG).map(([key, config]) => {
            const info = marketplaces[key];
            return (
              <s-grid-item key={key}>
                <MarketplaceTile
                  name={config.label}
                  icon={config.icon}
                  connected={info.connected}
                  activeCount={info.activeCount}
                  pendingCount={info.pendingCount}
                  errorCount={info.errorCount}
                  href={config.href}
                />
              </s-grid-item>
            );
          })}
        </s-grid>
      </s-box>

      {/* Zone 4: Two-Column Middle */}
      <s-box paddingBlock="base">
        <s-grid
          gridTemplateColumns="3fr 2fr"
          gap="base"
        >
          {/* Left: Recent Activity */}
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-text type="strong">Recent Activity</s-text>
                <s-divider />
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
                      <s-table-header>Product</s-table-header>
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
                              <s-icon
                                type={actionIcon(log.action)}
                                size="small"
                                tone={actionTone(log.action)}
                              />
                              <s-text>{formatAction(log.action)}</s-text>
                            </s-stack>
                          </s-table-cell>
                          <s-table-cell>
                            <s-text>
                              {log.productTitle ?? (
                                <s-text color="subdued">--</s-text>
                              )}
                            </s-text>
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge>{marketplaceLabel(log.marketplace)}</s-badge>
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge
                              tone={
                                log.status === "success"
                                  ? "success"
                                  : "critical"
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
              </s-stack>
            </s-box>
          </s-grid-item>

          {/* Right: Sync Summary */}
          <s-grid-item>
            <SyncSummary
              marketplaces={marketplaces}
              productsAwaitingSync={productsAwaitingSync}
            />
          </s-grid-item>
        </s-grid>
      </s-box>

      {/* Zone 5: Products Sync Status */}
      <div id="products-sync" />
      <s-section heading="Products — Sync Status">
        <ProductsSyncTable
          products={products}
          connectedMarketplaces={connectedMarketplaces}
          listingsByProduct={listingsByProduct}
          priceSuggestions={priceSuggestions}
          hasNextPage={hasNextPage}
          endCursor={endCursor}
          pendingPriceReviews={pendingPriceReviews}
          onBulkReview={() => setBulkModalOpen(true)}
        />
      </s-section>

      {/* Bulk Approve Modal */}
      <BulkApproveModal
        suggestions={suggestionsWithTitles}
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
