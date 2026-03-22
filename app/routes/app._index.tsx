import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

interface Product {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  productType: string;
  featuredImage: { url: string } | null;
}

interface LoaderData {
  products: Product[];
  productCount: number;
  syncCounts: Record<string, number>;
  shop: string;
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
  const products = data.data?.products?.nodes ?? [];
  const productCount = data.data?.productsCount?.count ?? 0;

  // Fetch sync counts from our database
  const listingCounts = await db.marketplaceListing.groupBy({
    by: ["marketplace"],
    where: { shopId: shop, status: "active" },
    _count: { id: true },
  });

  const syncCounts: Record<string, number> = {};
  for (const row of listingCounts) {
    syncCounts[row.marketplace] = row._count.id;
  }

  return { products, productCount, syncCounts, shop } satisfies LoaderData;
};

export default function Dashboard() {
  const { products, productCount, syncCounts } =
    useLoaderData<typeof loader>();

  const activeProducts = products.filter(
    (p: Product) => p.status === "ACTIVE",
  );

  return (
    <s-page heading="Marketplace Sync">
      <s-section heading="Overview">
        <s-stack direction="inline" gap="loose">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="headingMd">Shopify Products</s-text>
              <s-text variant="heading2xl">{productCount}</s-text>
              <s-text tone="subdued">
                {activeProducts.length} active (showing first 50)
              </s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="headingMd">eBay Listings</s-text>
              <s-text variant="heading2xl">{syncCounts.ebay ?? 0}</s-text>
              <s-text tone="subdued">
                <s-link href="/app/ebay">Configure</s-link>
              </s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="headingMd">Whatnot</s-text>
              <s-text variant="heading2xl">{syncCounts.whatnot ?? 0}</s-text>
              <s-text tone="subdued">
                <s-link href="/app/whatnot">Configure</s-link>
              </s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="headingMd">Helix</s-text>
              <s-text variant="heading2xl">
                {syncCounts.helix ?? 0}
              </s-text>
              <s-text tone="subdued">
                <s-link href="/app/helix">Configure</s-link>
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Recent Products">
        {products.length === 0 ? (
          <s-paragraph>
            No products found. Add products to your Shopify store to get
            started.
          </s-paragraph>
        ) : (
          <s-resource-list>
            {products.slice(0, 20).map((product: Product) => (
              <s-resource-item
                key={product.id}
                url={`shopify://admin/products/${product.id.split("/").pop()}`}
              >
                <s-stack direction="inline" gap="base" blockAlign="center">
                  {product.featuredImage && (
                    <s-thumbnail
                      src={product.featuredImage.url}
                      alt={product.title}
                    />
                  )}
                  <s-stack direction="block" gap="tight">
                    <s-text variant="bodyMd" fontWeight="semibold">
                      {product.title}
                    </s-text>
                    <s-stack direction="inline" gap="tight">
                      <s-badge
                        tone={
                          product.status === "ACTIVE" ? "success" : "attention"
                        }
                      >
                        {product.status.toLowerCase()}
                      </s-badge>
                      {product.productType && (
                        <s-badge>{product.productType}</s-badge>
                      )}
                      <s-text tone="subdued">
                        Qty: {product.totalInventory}
                      </s-text>
                    </s-stack>
                  </s-stack>
                </s-stack>
              </s-resource-item>
            ))}
          </s-resource-list>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
