import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { fetchProductTypeCounts } from "../lib/graphql-queries.server";
import { ConnectionCard } from "../components/ConnectionCard";
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";
import { BulkApproveModal } from "../components/dashboard/BulkApproveModal";
import { isPricingApiConfigured } from "../lib/pricing-api.server";
import { fetchAndCreatePriceSuggestions } from "../lib/fetch-price-suggestions.server";
import { approvePriceSuggestion } from "../lib/approve-price.server";
import type { PriceSuggestion } from "../types/dashboard";

interface LoaderData {
  connected: boolean;
  listingCount: number;
  totalProducts: number;
  gradedCount: number;
  rawCount: number;
  lastExportDate: string | null;
  lastPriceUpdateDate: string | null;
  pricingApiConfigured: boolean;
  pendingSuggestions: PriceSuggestion[];
  pendingCount: number;
  lastFetchDate: string | null;
}

export const meta: MetaFunction = () => [{ title: "Helix | Card Yeti Sync" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const account = await db.marketplaceAccount.findUnique({
    where: {
      shopId_marketplace: { shopId: shop, marketplace: "helix" },
    },
  });

  const listingCount = await db.marketplaceListing.count({
    where: { shopId: shop, marketplace: "helix", status: "active" },
  });

  const { totalProducts, typeCounts } = await fetchProductTypeCounts(admin);

  let gradedCount = 0;
  let rawCount = 0;
  for (const { type, count } of typeCounts) {
    const lower = type.toLowerCase();
    if (lower.includes("graded") || lower.includes("slab")) {
      gradedCount += count;
    } else if (lower.includes("raw") || lower.includes("single")) {
      rawCount += count;
    }
  }

  const lastExport = await db.syncLog.findFirst({
    where: { shopId: shop, marketplace: "helix", action: "list" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, details: true },
  });

  const lastPriceUpdate = await db.syncLog.findFirst({
    where: { shopId: shop, action: "price_update" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  // Smart Pricing data
  const pendingSuggestionsRaw = await db.priceSuggestion.findMany({
    where: { shopId: shop, status: "pending", source: "api" },
    orderBy: { createdAt: "desc" },
  });

  // Fetch product titles for suggestions
  const pendingSuggestions: PriceSuggestion[] = [];
  for (const s of pendingSuggestionsRaw) {
    // We store shopifyProductId as the GID, fetch title via a lightweight query
    let productTitle = s.shopifyProductId;
    try {
      const response = await admin.graphql(
        `query ($id: ID!) { product(id: $id) { title } }`,
        { variables: { id: s.shopifyProductId } },
      );
      const data = await response.json();
      productTitle = data.data?.product?.title ?? s.shopifyProductId;
    } catch {
      // Use product ID as fallback
    }

    pendingSuggestions.push({
      id: s.id,
      shopifyProductId: s.shopifyProductId,
      currentPrice: s.currentPrice.toString(),
      suggestedPrice: s.suggestedPrice.toString(),
      reason: s.reason,
      productTitle,
      source: s.source,
      certNumber: s.certNumber ?? undefined,
    });
  }

  const lastFetch = await db.syncLog.findFirst({
    where: { shopId: shop, marketplace: "helix", action: "price_fetch" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return {
    connected: !!account,
    listingCount,
    totalProducts,
    gradedCount,
    rawCount,
    lastExportDate: lastExport?.createdAt?.toISOString() ?? null,
    lastPriceUpdateDate: lastPriceUpdate?.createdAt?.toISOString() ?? null,
    pricingApiConfigured: isPricingApiConfigured(),
    pendingSuggestions,
    pendingCount: pendingSuggestions.length,
    lastFetchDate: lastFetch?.createdAt?.toISOString() ?? null,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch-prices") {
    try {
      const result = await fetchAndCreatePriceSuggestions(admin, shop);
      return {
        fetchResult: result,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to fetch prices",
      };
    }
  }

  if (intent === "approve-price") {
    const suggestionId = formData.get("suggestionId") as string;
    if (!suggestionId) return { error: "Missing suggestion ID" };
    const result = await approvePriceSuggestion(admin, shop, suggestionId);
    if (!result.success) return { error: result.error };
    return { approved: 1 };
  }

  if (intent === "bulk-approve-prices") {
    const suggestionIds = formData.getAll("suggestionIds") as string[];
    if (suggestionIds.length === 0) return { error: "No suggestions selected" };

    const BATCH_SIZE = 5;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (let i = 0; i < suggestionIds.length; i += BATCH_SIZE) {
      const batch = suggestionIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((id) => approvePriceSuggestion(admin, shop, id)),
      );
      results.push(...batchResults);
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

  if (intent === "reject-price") {
    const suggestionId = formData.get("suggestionId") as string;
    if (!suggestionId) return { error: "Missing suggestion ID" };
    await db.priceSuggestion.update({
      where: { id: suggestionId },
      data: { status: "rejected", reviewedAt: new Date() },
    });
    return { rejected: 1 };
  }

  return null;
};

export default function HelixSettings() {
  const {
    connected,
    listingCount,
    totalProducts,
    gradedCount,
    rawCount,
    lastExportDate,
    lastPriceUpdateDate,
    pricingApiConfigured,
    pendingSuggestions,
    pendingCount,
    lastFetchDate,
  } = useLoaderData<typeof loader>();

  const fetchPricesFetcher = useFetcher();
  const isFetching = fetchPricesFetcher.state === "submitting";
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const fetchResult = (fetchPricesFetcher.data as Record<string, unknown>)?.fetchResult as
    | { created: number; updated: number; notFound: number; total: number }
    | undefined;
  const fetchError = (fetchPricesFetcher.data as Record<string, unknown>)?.error as
    | string
    | undefined;

  return (
    <s-page heading="Helix">
      {/* Status Banner */}
      <s-banner tone="info">
        Helix integration is being actively developed. Connect your account as
        soon as API access becomes available.
      </s-banner>

      {/* Connection */}
      <s-section heading="Connection">
        <ConnectionCard
          marketplace="Helix"
          connected={connected}
          icon="bolt"
          connectDescription="Link your Helix seller account to sync your Pokemon card inventory with the lowest marketplace fees (4.9%)."
          connectAction={
            <s-button variant="primary" disabled>
              Connect Helix Account
            </s-button>
          }
          connectFooter={
            <s-paragraph color="subdued">
              Available when Helix opens their Seller API.
            </s-paragraph>
          }
        >
          <s-stack direction="inline" gap="base">
            <StatCard label="Active Listings" value={listingCount} />
          </s-stack>
        </ConnectionCard>
      </s-section>

      {/* CSV Export */}
      <s-section heading="CSV Export">
        <s-paragraph color="subdued">
          Generate Helix-compatible CSVs for bulk upload. Includes rich
          descriptions built from your card metafields.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-grid gap="base">
              <s-grid-item>
                <StatCard
                  label="Last Export"
                  value={
                    lastExportDate ? (
                      <RelativeTime date={lastExportDate} />
                    ) : (
                      "Never"
                    )
                  }
                />
              </s-grid-item>
              <s-grid-item>
                <StatCard label="Format" value="Helix Seller CSV" />
              </s-grid-item>
            </s-grid>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <a href="/api/export-helix?mode=all" download>
                <s-button variant="primary">Export All Products</s-button>
              </a>
              <a href="/api/export-helix?mode=new" download>
                <s-button>Export New Only</s-button>
              </a>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* Price Management */}
      <s-section heading="Price Management">
        <s-paragraph color="subdued">
          Download current prices as a CSV or upload updated prices in bulk.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <a href="/api/prices" download>
                <s-button variant="primary">Download Prices</s-button>
              </a>
            </s-stack>

            {lastPriceUpdateDate && (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text color="subdued">Last price update:</s-text>
                <RelativeTime date={lastPriceUpdateDate} />
              </s-stack>
            )}
            {!lastPriceUpdateDate && (
              <s-text color="subdued">No price updates recorded yet.</s-text>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* Smart Pricing */}
      <s-section heading="Smart Pricing">
        <s-paragraph color="subdued">
          Fetch suggested prices for your graded inventory based on recent
          market data. Only products with certification numbers are eligible.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            {!pricingApiConfigured && (
              <s-banner tone="info">
                Set the <s-text type="strong">PRICING_API_URL</s-text> and{" "}
                <s-text type="strong">PRICING_API_KEY</s-text> environment
                variables to enable smart pricing.
              </s-banner>
            )}

            {pricingApiConfigured && (
              <>
                <s-stack direction="inline" gap="base" alignItems="center">
                  <fetchPricesFetcher.Form method="post">
                    <input type="hidden" name="intent" value="fetch-prices" />
                    <s-button
                      variant="primary"
                      type="submit"
                      disabled={isFetching || undefined}
                    >
                      {isFetching
                        ? "Fetching..."
                        : "Fetch Price Suggestions"}
                    </s-button>
                  </fetchPricesFetcher.Form>

                  {lastFetchDate && (
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text color="subdued">Last fetch:</s-text>
                      <RelativeTime date={lastFetchDate} />
                    </s-stack>
                  )}
                </s-stack>

                {fetchResult && (
                  <s-banner tone="success">
                    Found pricing for {fetchResult.created + fetchResult.updated}{" "}
                    of {fetchResult.total} graded products.
                    {fetchResult.notFound > 0 &&
                      ` ${fetchResult.notFound} had no pricing data.`}
                  </s-banner>
                )}

                {fetchError && (
                  <s-banner tone="critical">{fetchError}</s-banner>
                )}
              </>
            )}
          </s-stack>
        </s-box>

        {/* Pending Suggestions Table */}
        {pendingCount > 0 && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text type="strong">
                  {pendingCount} pending suggestion
                  {pendingCount !== 1 ? "s" : ""}
                </s-text>
                <s-button
                  variant="primary"
                  onClick={() => setBulkModalOpen(true)}
                >
                  Review All
                </s-button>
              </s-stack>

              <s-divider />

              {pendingSuggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                />
              ))}
            </s-stack>
          </s-box>
        )}

        {pricingApiConfigured && pendingCount === 0 && !fetchResult && (
          <s-text color="subdued">
            No pending price suggestions. Use the button above to fetch
            suggestions for your graded inventory.
          </s-text>
        )}
      </s-section>

      {/* Bulk Approve Modal */}
      <BulkApproveModal
        suggestions={pendingSuggestions}
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
      />

      {/* Why Helix? */}
      <s-section heading="Why Helix?">
        <s-grid gap="base">
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-icon type="cash-dollar" tone="success" />
                <s-text type="strong">4.9% seller fees</s-text>
                <s-paragraph color="subdued">
                  vs 12.9% on eBay. Keep more of every sale.
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-icon type="chart-line" tone="info" />
                <s-text type="strong">Real-time pricing</s-text>
                <s-paragraph color="subdued">
                  Live bid/ask market data and AI-powered price forecasting.
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-icon type="transfer" tone="info" />
                <s-text type="strong">Full sync</s-text>
                <s-paragraph color="subdued">
                  Automatic inventory sync with cross-channel delisting.
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-icon type="list-bulleted" tone="info" />
                <s-text type="strong">Structured data</s-text>
                <s-paragraph color="subdued">
                  Rich card metadata: set, number, grade, cert, population.
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      {/* Integration Roadmap */}
      <s-section heading="Integration Roadmap">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="info">Phase 1</s-badge>
              <s-stack direction="block" gap="small">
                <s-text type="strong">Bulk Import</s-text>
                <s-text color="subdued">
                  One-click sync of all active inventory to Helix. OAuth
                  connection, bulk listing creation.
                </s-text>
              </s-stack>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge>Phase 2</s-badge>
              <s-stack direction="block" gap="small">
                <s-text type="strong">Real-Time Sync</s-text>
                <s-text color="subdued">
                  Webhook-driven updates. Product changes in Shopify auto-update
                  on Helix. Inventory delisting on sale.
                </s-text>
              </s-stack>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge>Phase 3</s-badge>
              <s-stack direction="block" gap="small">
                <s-text type="strong">Bidirectional + Pricing</s-text>
                <s-text color="subdued">
                  Helix sales trigger cross-channel delisting. Pull Helix market
                  data to inform pricing across all channels.
                </s-text>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Inventory Readiness */}
      <s-section heading="Inventory Readiness">
        <s-paragraph color="subdued">
          Your Shopify products that will sync to Helix when connected.
        </s-paragraph>
        <s-grid gap="base">
          <s-grid-item>
            <StatCard
              label="Total Products"
              value={totalProducts}
              background="subdued"
            />
          </s-grid-item>
          <s-grid-item>
            <StatCard
              label="Graded Cards"
              value={gradedCount}
              description="Highest demand on Helix"
              background="subdued"
            />
          </s-grid-item>
          <s-grid-item>
            <StatCard
              label="Raw Singles"
              value={rawCount}
              background="subdued"
            />
          </s-grid-item>
        </s-grid>
      </s-section>
    </s-page>
  );
}

function SuggestionRow({ suggestion }: { suggestion: PriceSuggestion }) {
  const approveFetcher = useFetcher();
  const rejectFetcher = useFetcher();
  const isApproving = approveFetcher.state === "submitting";
  const isRejecting = rejectFetcher.state === "submitting";
  const isDone =
    (approveFetcher.data as Record<string, unknown>)?.approved ||
    (rejectFetcher.data as Record<string, unknown>)?.rejected;

  if (isDone) return null;

  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-stack direction="block" gap="small">
        <s-text type="strong">
          {suggestion.productTitle ?? suggestion.shopifyProductId}
        </s-text>
        <s-text color="subdued">
          ${suggestion.currentPrice} → ${suggestion.suggestedPrice}
          {suggestion.certNumber && ` · Cert: ${suggestion.certNumber}`}
        </s-text>
      </s-stack>
      <s-stack direction="inline" gap="small">
        <approveFetcher.Form method="post">
          <input type="hidden" name="intent" value="approve-price" />
          <input
            type="hidden"
            name="suggestionId"
            value={suggestion.id}
          />
          <s-button
            variant="primary"
            type="submit"
            disabled={isApproving || isRejecting || undefined}
          >
            {isApproving ? "..." : "Approve"}
          </s-button>
        </approveFetcher.Form>
        <rejectFetcher.Form method="post">
          <input type="hidden" name="intent" value="reject-price" />
          <input
            type="hidden"
            name="suggestionId"
            value={suggestion.id}
          />
          <s-button
            type="submit"
            disabled={isApproving || isRejecting || undefined}
          >
            {isRejecting ? "..." : "Reject"}
          </s-button>
        </rejectFetcher.Form>
      </s-stack>
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
