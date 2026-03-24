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

interface LoaderData {
  lastExportDate: string | null;
  lastPriceUpdateDate: string | null;
  productCount: number;
  productTypes: Array<{ type: string; count: number }>;
}

export const meta: MetaFunction = () => [
  { title: "Whatnot | Card Yeti Sync" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const lastExport = await db.syncLog.findFirst({
    where: { shopId: shop, marketplace: "whatnot", action: "list" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, details: true },
  });

  const lastPriceUpdate = await db.syncLog.findFirst({
    where: { shopId: shop, action: "price_update" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const { totalProducts: productCount, typeCounts: productTypes } =
    await fetchProductTypeCounts(admin);

  return {
    lastExportDate: lastExport?.createdAt?.toISOString() ?? null,
    lastPriceUpdateDate: lastPriceUpdate?.createdAt?.toISOString() ?? null,
    productCount,
    productTypes,
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

    await db.syncLog.create({
      data: {
        shopId: shop,
        marketplace: "whatnot",
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
                marketplace: "whatnot",
              },
            },
            create: {
              shopId: shop,
              shopifyProductId: productId,
              marketplace: "whatnot",
              status: "active",
              lastSyncedAt: new Date(),
            },
            update: { lastSyncedAt: new Date() },
          });
        }),
      );
    }

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
  const { lastExportDate, productTypes } =
    useLoaderData<typeof loader>();
  const exportFetcher = useFetcher();
  const isExporting = exportFetcher.state === "submitting";

  const exportableCount = productTypes
    .filter((t) => SUPPORTED_TYPES.includes(t.type))
    .reduce((sum, t) => sum + t.count, 0);

  // Trigger CSV download when export action completes
  useEffect(() => {
    const data = exportFetcher.data as { csv?: string; filename?: string } | null;
    if (data?.csv && data?.filename) {
      downloadCSV(data.csv, data.filename);
    }
  }, [exportFetcher.data]);

  return (
    <s-page heading="Whatnot">
      <s-section heading="Export">
        <s-paragraph color="subdued">
          Generate Whatnot-compatible CSVs for bulk upload to Seller Hub.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
              <s-grid-item>
                <StatCard
                  label="Exportable Products"
                  value={exportableCount}
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
              <exportFetcher.Form method="post">
                <input type="hidden" name="intent" value="download-prices" />
                <s-button type="submit" disabled={isExporting || undefined}>
                  Download Prices
                </s-button>
              </exportFetcher.Form>
            </s-stack>

            <s-text color="subdued">
              Product exports include category, title, description (from card metafields), price, shipping, and up to 8 images.
            </s-text>
          </s-stack>
        </s-box>
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
