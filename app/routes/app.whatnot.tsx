import { useEffect } from "react";
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
import { getAllProducts } from "../lib/shopify-helpers.server";
import { generateWhatnotCSV } from "../lib/mappers/whatnot-mapper";
import { downloadCSV } from "../lib/csv-download";
import { generatePricesCSV } from "./api.prices";
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";

interface ExportHistoryEntry {
  createdAt: string;
  mode: string;
  productCount: number;
}

interface LoaderData {
  lastExportDate: string | null;
  productCount: number;
  productTypes: Array<{ type: string; count: number }>;
  recentExports: ExportHistoryEntry[];
}

export const meta: MetaFunction = () => [
  { title: "Whatnot | Card Yeti Sync" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [lastExport, productData, recentExportLogs] = await Promise.all([
    db.syncLog.findFirst({
      where: { shopId: shop, marketplace: "whatnot", action: "list" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, details: true },
    }),
    fetchProductTypeCounts(admin),
    db.syncLog.findMany({
      where: { shopId: shop, marketplace: "whatnot", action: "list" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { createdAt: true, details: true },
    }),
  ]);

  const { totalProducts: productCount, typeCounts: productTypes } = productData;

  const recentExports: ExportHistoryEntry[] = recentExportLogs.map((log) => {
    let mode = "all";
    let exportProductCount = 0;
    if (log.details) {
      try {
        const parsed = JSON.parse(log.details);
        mode = parsed.mode ?? "all";
        exportProductCount = parsed.productCount ?? 0;
      } catch {
        // ignore
      }
    }
    return {
      createdAt: log.createdAt.toISOString(),
      mode,
      productCount: exportProductCount,
    };
  });

  return {
    lastExportDate: lastExport?.createdAt?.toISOString() ?? null,
    productCount,
    productTypes,
    recentExports,
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
        where: { shopId: shop, marketplace: "whatnot" },
        select: { shopifyProductId: true },
      });
      const exportedSet = new Set(exportedIds.map((e) => e.shopifyProductId));
      exportProducts = exportProducts.filter(
        (p) => !exportedSet.has(p.product.id as string),
      );
    }

    const csvData = exportProducts.map((p) => ({
      product: p.product as { title: string; productType: string },
      metafields: p.metafields,
      images: p.images,
      variant: p.variant as {
        price: string;
        compareAtPrice: string | null;
        sku: string;
        inventoryQuantity: number;
      },
    }));

    const csv = generateWhatnotCSV(csvData);

    // Ensure a MarketplaceAccount exists for whatnot (CSV-only, no real token)
    await db.marketplaceAccount.upsert({
      where: { shopId_marketplace: { shopId: shop, marketplace: "whatnot" } },
      update: {},
      create: { shopId: shop, marketplace: "whatnot", accessToken: "csv-export-only" },
    });

    // Persist exported product IDs so "Export New Only" excludes them next time
    if (exportProducts.length > 0) {
      await db.marketplaceListing.createMany({
        data: exportProducts.map((p) => ({
          shopId: shop,
          shopifyProductId: p.product.id as string,
          marketplace: "whatnot",
          status: "active",
        })),
        skipDuplicates: true,
      });
    }

    await db.syncLog.create({
      data: {
        shopId: shop,
        marketplace: "whatnot",
        action: "list",
        status: "success",
        details: JSON.stringify({ type: "csv_export", mode, productCount: csvData.length }),
      },
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    return { csv, filename: `whatnot-export-${timestamp}.csv`, productCount: csvData.length };
  }

  if (intent === "download-prices") {
    const csv = await generatePricesCSV(admin);
    const timestamp = new Date().toISOString().slice(0, 10);
    return { csv, filename: `prices-${timestamp}.csv` };
  }

  return null;
};

const SUPPORTED_TYPES = ["Graded Card", "Graded Slab"];

export default function WhatnotSettings() {
  const { lastExportDate, productTypes, recentExports } =
    useLoaderData<typeof loader>();
  const exportAllFetcher = useFetcher();
  const exportNewFetcher = useFetcher();
  const pricesFetcher = useFetcher();
  const isExporting =
    exportAllFetcher.state === "submitting" ||
    exportNewFetcher.state === "submitting" ||
    pricesFetcher.state === "submitting";

  const exportableCount = productTypes
    .filter((t) => SUPPORTED_TYPES.includes(t.type))
    .reduce((sum, t) => sum + t.count, 0);

  const exportAllResult = exportAllFetcher.data as { csv?: string; filename?: string; productCount?: number } | null;
  const exportNewResult = exportNewFetcher.data as { csv?: string; filename?: string; productCount?: number } | null;

  // Trigger CSV download when each export action completes
  useEffect(() => {
    if (exportAllResult?.csv && exportAllResult?.filename) downloadCSV(exportAllResult.csv, exportAllResult.filename);
  }, [exportAllResult]);

  useEffect(() => {
    if (exportNewResult?.csv && exportNewResult?.filename) downloadCSV(exportNewResult.csv, exportNewResult.filename);
  }, [exportNewResult]);

  useEffect(() => {
    const data = pricesFetcher.data as { csv?: string; filename?: string } | null;
    if (data?.csv && data?.filename) downloadCSV(data.csv, data.filename);
  }, [pricesFetcher.data]);

  return (
    <s-page heading="Whatnot">
      {/* Success banners */}
      {exportAllResult?.productCount != null && (
        <s-banner tone="success" dismissible>
          Exported {exportAllResult.productCount} products to CSV.
        </s-banner>
      )}
      {exportNewResult?.productCount != null && (
        <s-banner tone="success" dismissible>
          Exported {exportNewResult.productCount} new products to CSV.
        </s-banner>
      )}

      {/* Section 1: Overview */}
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          <s-grid-item>
            <StatCard
              label="Exportable Products"
              value={exportableCount}
              tone="success"
              description="Graded cards & slabs"
            />
          </s-grid-item>
          <s-grid-item>
            <StatCard
              label="Product Types"
              value={productTypes.length}
              tone="info"
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
        </s-grid>
      </s-section>

      {/* Section 2: Product Breakdown */}
      <s-section heading="Product Breakdown">
        <s-paragraph color="subdued">
          Product types in your Shopify store. Only Graded Card and Graded Slab types are included in Whatnot exports.
        </s-paragraph>
        {productTypes.length === 0 ? (
          <s-box padding="large">
            <s-text color="subdued">No products found. Import or create products in Shopify to get started.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Type</s-table-header>
              <s-table-header>Count</s-table-header>
              <s-table-header>Exportable</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {productTypes.map(({ type, count }) => (
                <s-table-row key={type}>
                  <s-table-cell>
                    <s-text type="strong">{type}</s-text>
                  </s-table-cell>
                  <s-table-cell>{count}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={SUPPORTED_TYPES.includes(type) ? "success" : undefined}>
                      {SUPPORTED_TYPES.includes(type) ? "Yes" : "No"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {/* Section 3: Export */}
      <s-section heading="Export">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Export All Products</s-text>
                <s-text color="subdued">Full CSV of all exportable products for Seller Hub upload.</s-text>
              </s-stack>
              <exportAllFetcher.Form method="post">
                <input type="hidden" name="intent" value="export-csv" />
                <input type="hidden" name="mode" value="all" />
                <s-button variant="primary" type="submit" disabled={isExporting || undefined}>
                  {exportAllFetcher.state === "submitting" ? "Exporting..." : "Export All"}
                </s-button>
              </exportAllFetcher.Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Export New Only</s-text>
                <s-text color="subdued">Products not previously exported to Whatnot.</s-text>
              </s-stack>
              <exportNewFetcher.Form method="post">
                <input type="hidden" name="intent" value="export-csv" />
                <input type="hidden" name="mode" value="new" />
                <s-button type="submit" disabled={isExporting || undefined}>
                  {exportNewFetcher.state === "submitting" ? "Exporting..." : "Export New"}
                </s-button>
              </exportNewFetcher.Form>
            </s-stack>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Download Prices</s-text>
                <s-text color="subdued">Price list CSV for all active products.</s-text>
              </s-stack>
              <pricesFetcher.Form method="post">
                <input type="hidden" name="intent" value="download-prices" />
                <s-button type="submit" disabled={isExporting || undefined}>
                  {pricesFetcher.state === "submitting" ? "Downloading..." : "Download"}
                </s-button>
              </pricesFetcher.Form>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* Section 4: Export History */}
      <s-section heading="Export History">
        {recentExports.length === 0 ? (
          <s-box padding="large">
            <s-text color="subdued">No exports yet. Use the buttons above to generate your first CSV.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Products</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentExports.map((exp, i) => (
                <s-table-row key={i}>
                  <s-table-cell>
                    <RelativeTime date={exp.createdAt} />
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{exp.mode === "new" ? "New Only" : "Full Export"}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{exp.productCount}</s-table-cell>
                </s-table-row>
              ))}
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
