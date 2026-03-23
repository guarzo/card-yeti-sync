import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { fetchProductTypeCounts } from "../lib/graphql-queries.server";
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

const SUPPORTED_TYPES = ["Graded Card", "Graded Slab"];

export default function WhatnotSettings() {
  const { lastExportDate, lastPriceUpdateDate, productTypes } =
    useLoaderData<typeof loader>();

  const exportableCount = productTypes
    .filter((t) => SUPPORTED_TYPES.includes(t.type))
    .reduce((sum, t) => sum + t.count, 0);

  return (
    <s-page heading="Whatnot">
      {/* CSV Export */}
      <s-section heading="CSV Export">
        <s-paragraph color="subdued">
          Generate Whatnot-compatible CSVs for bulk upload to Seller Hub.
          Includes rich descriptions built from your card metafields.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-grid gap="base">
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
              <s-grid-item>
                <StatCard label="Format" value="Whatnot Seller Hub CSV" />
              </s-grid-item>
            </s-grid>

            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <a href="/api/export-whatnot?mode=all" download>
                <s-button variant="primary">Export All Products</s-button>
              </a>
              <a href="/api/export-whatnot?mode=new" download>
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

      {/* Export Preview */}
      <s-section heading="Export Preview">
        <s-paragraph color="subdued">
          What your Whatnot CSV export will include for each product.
        </s-paragraph>

        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Column Mapping</s-text>
              <s-paragraph color="subdued">
                Based on your product data structure
              </s-paragraph>
            </s-stack>

            <s-divider />

            <s-grid gap="base">
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Category</s-text>
                  <s-text>Trading Card Games &gt; Pokemon Cards</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Title</s-text>
                  <s-text>Your Shopify product title</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Description</s-text>
                  <s-text>Auto-built from card metafields</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Price</s-text>
                  <s-text>eBay comp price or Shopify price</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Shipping</s-text>
                  <s-text>Auto-detected by product type</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Images</s-text>
                  <s-text>Up to 8 from Shopify product</s-text>
                </s-stack>
              </s-grid-item>
            </s-grid>
          </s-stack>
        </s-box>
      </s-section>

      {/* API Integration */}
      <s-section heading="API Integration">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-icon type="clock" tone="info" />
              <s-stack direction="block" gap="small">
                <s-text type="strong">
                  Whatnot Seller API — Developer Preview
                </s-text>
                <s-paragraph color="subdued">
                  Whatnot&apos;s API is currently in Developer Preview and not
                  accepting new applicants. When access opens, Card Yeti will
                  support real-time sync directly through their GraphQL API.
                </s-paragraph>
              </s-stack>
            </s-stack>

            <s-divider />

            <s-text type="strong">Planned API Features</s-text>
            <s-unordered-list>
              <s-list-item>
                Real-time inventory sync (no more CSV uploads)
              </s-list-item>
              <s-list-item>
                Automatic delisting when cards sell on other channels
              </s-list-item>
              <s-list-item>
                Live listing status tracking in the dashboard
              </s-list-item>
              <s-list-item>Buy It Now price management</s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-box>
      </s-section>

      {/* Inventory by Type */}
      <s-section heading="Inventory by Type">
        <s-paragraph color="subdued">
          Currently, only Graded Cards are exported to Whatnot. Support for other
          types is planned.
        </s-paragraph>
        <s-stack direction="block" gap="small">
          {productTypes.map(({ type, count }) => (
            <s-box
              key={type}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-icon
                    type="product"
                    tone={
                      SUPPORTED_TYPES.includes(type) ? "success" : undefined
                    }
                  />
                  <s-text type="strong">{type}</s-text>
                </s-stack>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text>{count} products</s-text>
                  {SUPPORTED_TYPES.includes(type) ? (
                    <s-badge tone="success">Supported</s-badge>
                  ) : (
                    <s-badge>Planned</s-badge>
                  )}
                </s-stack>
              </s-stack>
            </s-box>
          ))}
          {productTypes.length === 0 && (
            <s-paragraph color="subdued">
              No active products found. Add products to your Shopify store to see
              inventory breakdown.
            </s-paragraph>
          )}
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
