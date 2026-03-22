import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const lastExport = await db.syncLog.findFirst({
    where: { shopId: shop, marketplace: "whatnot", action: "list" },
    orderBy: { createdAt: "desc" },
  });

  return { lastExportDate: lastExport?.createdAt ?? null };
};

export default function WhatnotSettings() {
  const { lastExportDate } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Whatnot Integration" backAction={{ url: "/app" }}>
      <s-section heading="CSV Export">
        <s-paragraph>
          Generate a Whatnot-compatible CSV for bulk upload to Seller Hub.
          Includes graded cards, raw singles, and sealed product with rich
          descriptions built from your card metafields.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {lastExportDate && (
            <s-text tone="subdued">
              Last export: {new Date(lastExportDate).toLocaleDateString()}
            </s-text>
          )}
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" disabled>
              Export All Products (Coming Soon)
            </s-button>
            <s-button disabled>Export New Only (Coming Soon)</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="API Integration">
        <s-banner tone="info">
          Whatnot's Seller API is currently in Developer Preview and not
          accepting new applicants. When access opens, this app will support
          real-time sync directly through their GraphQL API.
        </s-banner>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
