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
import { ConnectionCard } from "../components/ConnectionCard";
import { StatCard } from "../components/StatCard";
import { RelativeTime } from "../components/RelativeTime";

interface LoaderData {
  connected: boolean;
  listingCount: number;
  totalProducts: number;
  gradedCount: number;
  rawCount: number;
  lastExportDate: string | null;
  lastPriceUpdateDate: string | null;
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

  return {
    connected: !!account,
    listingCount,
    totalProducts,
    gradedCount,
    rawCount,
    lastExportDate: lastExport?.createdAt?.toISOString() ?? null,
    lastPriceUpdateDate: lastPriceUpdate?.createdAt?.toISOString() ?? null,
  } satisfies LoaderData;
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
  } = useLoaderData<typeof loader>();

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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
