import { useEffect, useState } from "react";
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
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";
import { BulkApproveModal } from "../components/dashboard/BulkApproveModal";
import { isPricingApiConfigured } from "../lib/pricing-api.server";
import { fetchAndCreatePriceSuggestions } from "../lib/fetch-price-suggestions.server";
import { approvePriceSuggestion } from "../lib/approve-price.server";
import type { PriceSuggestion } from "../types/dashboard";
import { getAllProducts } from "../lib/shopify-helpers.server";
import { generateHelixCSV } from "../lib/mappers/helix-mapper";
import { downloadCSV } from "../lib/csv-download";
import { generatePricesCSV } from "./api.prices";

interface LoaderData {
  gradedCount: number;
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

  const { typeCounts } = await fetchProductTypeCounts(admin);

  let gradedCount = 0;
  for (const { type, count } of typeCounts) {
    const lower = type.toLowerCase();
    if (lower.includes("graded") || lower.includes("slab")) {
      gradedCount += count;
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

  // Batch-fetch product titles for all suggestions in a single GraphQL call
  const productIds = [
    ...new Set(pendingSuggestionsRaw.map((s) => s.shopifyProductId)),
  ];
  const titleMap = new Map<string, string>();
  if (productIds.length > 0) {
    try {
      const response = await admin.graphql(
        `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } } }`,
        { variables: { ids: productIds } },
      );
      const data = await response.json();
      for (const node of data.data?.nodes ?? []) {
        if (node?.id && node?.title) {
          titleMap.set(node.id, node.title);
        }
      }
    } catch (err) {
      console.error("Failed to fetch product titles for price suggestions:", err);
      // Fall back to using product IDs as titles
    }
  }

  const pendingSuggestions: PriceSuggestion[] = pendingSuggestionsRaw.map(
    (s) => ({
      id: s.id,
      shopifyProductId: s.shopifyProductId,
      currentPrice: s.currentPrice.toString(),
      suggestedPrice: s.suggestedPrice.toString(),
      reason: s.reason,
      productTitle: titleMap.get(s.shopifyProductId) ?? s.shopifyProductId,
      source: s.source,
      certNumber: s.certNumber ?? undefined,
    }),
  );

  const lastFetch = await db.syncLog.findFirst({
    where: { shopId: shop, marketplace: "helix", action: "price_fetch" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return {
    gradedCount,
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

  if (intent === "export-csv") {
    const mode = (formData.get("mode") as string) ?? "all";

    const products = await getAllProducts(admin, { query: "status:active" });
    let exportProducts = products.filter((p) => p.variant !== null);

    if (mode === "new") {
      const exportedIds = await db.marketplaceListing.findMany({
        where: { shopId: shop, marketplace: "helix" },
        select: { shopifyProductId: true },
      });
      const exportedSet = new Set(exportedIds.map((e) => e.shopifyProductId));
      exportProducts = exportProducts.filter(
        (p) => !exportedSet.has(p.product.id as string),
      );
    }

    const csvData = exportProducts.map((p) => ({
      product: p.product as { id: string; title: string; descriptionHtml?: string; productType?: string },
      metafields: p.metafields,
      images: p.images,
      variant: p.variant as {
        price: string;
        compareAtPrice: string | null;
        sku: string;
        inventoryQuantity: number;
      },
    }));

    const csv = generateHelixCSV(csvData);

    await db.syncLog.create({
      data: {
        shopId: shop,
        marketplace: "helix",
        action: "list",
        status: "success",
        details: JSON.stringify({ type: "csv_export", mode, productCount: csvData.length }),
      },
    });

    const BATCH_SIZE = 25;
    for (let i = 0; i < exportProducts.length; i += BATCH_SIZE) {
      await Promise.all(
        exportProducts.slice(i, i + BATCH_SIZE).map((p) => {
          const productId = p.product.id as string;
          return db.marketplaceListing.upsert({
            where: {
              shopId_shopifyProductId_marketplace: {
                shopId: shop,
                shopifyProductId: productId,
                marketplace: "helix",
              },
            },
            create: {
              shopId: shop,
              shopifyProductId: productId,
              marketplace: "helix",
              status: "active",
              lastSyncedAt: new Date(),
            },
            update: { lastSyncedAt: new Date() },
          });
        }),
      );
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    return { csv, filename: `helix-export-${timestamp}.csv`, productCount: csvData.length };
  }

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
    try {
      const result = await approvePriceSuggestion(admin, shop, suggestionId);
      if (!result.success) return { error: result.error };
      return { approved: 1 };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  if (intent === "bulk-approve-prices") {
    const suggestionIds = formData.getAll("suggestionIds") as string[];
    if (suggestionIds.length === 0) return { error: "No suggestions selected" };

    const BATCH_SIZE = 5;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (let i = 0; i < suggestionIds.length; i += BATCH_SIZE) {
      const batch = suggestionIds.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await Promise.all(
          batch.map((id) => approvePriceSuggestion(admin, shop, id)),
        );
        results.push(...batchResults);
      } catch (err) {
        results.push(
          ...batch.map((id) => ({
            id,
            success: false,
            error: String(err),
          })),
        );
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

  if (intent === "reject-price") {
    const suggestionId = formData.get("suggestionId") as string;
    if (!suggestionId) return { error: "Missing suggestion ID" };
    const { count } = await db.priceSuggestion.updateMany({
      where: { id: suggestionId, shopId: shop, status: "pending" },
      data: { status: "rejected", reviewedAt: new Date() },
    });
    if (count === 0) return { error: "Suggestion not found or already reviewed" };
    return { rejected: 1 };
  }

  if (intent === "download-prices") {
    const csv = await generatePricesCSV(admin);
    const timestamp = new Date().toISOString().slice(0, 10);
    return { csv, filename: `prices-${timestamp}.csv` };
  }

  return null;
};

export default function HelixSettings() {
  const {
    gradedCount,
    lastExportDate,
    lastPriceUpdateDate,
    pricingApiConfigured,
    pendingSuggestions,
    pendingCount,
    lastFetchDate,
  } = useLoaderData<typeof loader>();

  const exportFetcher = useFetcher();
  const isExporting = exportFetcher.state === "submitting";
  const fetchPricesFetcher = useFetcher();
  const isFetching = fetchPricesFetcher.state === "submitting";
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Trigger CSV download when export action completes
  useEffect(() => {
    const data = exportFetcher.data as { csv?: string; filename?: string } | null;
    if (data?.csv && data?.filename) {
      downloadCSV(data.csv, data.filename);
    }
  }, [exportFetcher.data]);

  const fetchResult = (fetchPricesFetcher.data as Record<string, unknown>)?.fetchResult as
    | { created: number; updated: number; notFound: number; total: number }
    | undefined;
  const fetchError = (fetchPricesFetcher.data as Record<string, unknown>)?.error as
    | string
    | undefined;

  return (
    <s-page heading="Helix">
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
                  label="Exportable Products"
                  value={gradedCount}
                  description="Graded cards with inventory"
                />
              </s-grid-item>
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
              <exportFetcher.Form method="post">
                <input type="hidden" name="intent" value="export-csv" />
                <input type="hidden" name="mode" value="all" />
                <s-button variant="primary" type="submit" disabled={isExporting || undefined}>
                  {isExporting ? "Exporting..." : "Export All Products"}
                </s-button>
              </exportFetcher.Form>
              <exportFetcher.Form method="post">
                <input type="hidden" name="intent" value="export-csv" />
                <input type="hidden" name="mode" value="new" />
                <s-button type="submit" disabled={isExporting || undefined}>
                  {isExporting ? "Exporting..." : "Export New Only"}
                </s-button>
              </exportFetcher.Form>
            </s-stack>

            <s-text color="subdued">
              Exports include category, title, description (from card metafields), price, shipping, and images.
            </s-text>
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
              <exportFetcher.Form method="post">
                <input type="hidden" name="intent" value="download-prices" />
                <s-button variant="primary" type="submit" disabled={isExporting || undefined}>
                  Download Prices
                </s-button>
              </exportFetcher.Form>
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

        {pricingApiConfigured && (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
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
            </s-stack>
          </s-box>
        )}

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

  const approveError = (approveFetcher.data as Record<string, unknown>)?.error as
    | string
    | undefined;
  const rejectError = (rejectFetcher.data as Record<string, unknown>)?.error as
    | string
    | undefined;
  const inlineError = approveError || rejectError;

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
        {inlineError && (
          <s-text tone="critical">{inlineError}</s-text>
        )}
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
