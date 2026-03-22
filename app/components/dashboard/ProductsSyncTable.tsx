import { Form, useSearchParams } from "react-router";
import { RelativeTime } from "../RelativeTime";
import { EmptyState } from "../EmptyState";
import {
  marketplaceLabel,
  type MarketplaceKey,
} from "../../lib/marketplace-config";

interface Product {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  productType: string;
  featuredImage: { url: string } | null;
  price: string | null;
}

interface PriceSuggestion {
  id: string;
  shopifyProductId: string;
  currentPrice: string;
  suggestedPrice: string;
  reason: string | null;
}

interface ListingStatus {
  marketplace: string;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

interface ProductsSyncTableProps {
  products: Product[];
  connectedMarketplaces: MarketplaceKey[];
  listingsByProduct: Record<string, ListingStatus[]>;
  priceSuggestions: Record<string, PriceSuggestion>;
  hasNextPage: boolean;
  endCursor: string | null;
  onBulkReview?: () => void;
  pendingPriceReviews: number;
}

const STATUS_ICONS: Record<string, string> = {
  active: "✓",
  error: "⚠",
  pending: "○",
};

function getListingStatus(
  listings: ListingStatus[] | undefined,
  marketplace: string,
): ListingStatus | undefined {
  return listings?.find((l) => l.marketplace === marketplace);
}

export function ProductsSyncTable({
  products,
  connectedMarketplaces,
  listingsByProduct,
  priceSuggestions,
  hasNextPage,
  endCursor,
  onBulkReview,
  pendingPriceReviews,
}: ProductsSyncTableProps) {
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get("filter") ?? "all";

  if (products.length === 0 && currentFilter === "all") {
    return (
      <EmptyState
        icon="product"
        heading="No products found"
        description="Add Pokemon cards to your Shopify store to start syncing across marketplaces. Products with card metafields (pokemon, set name, grade) will get rich listings on every channel."
        action={
          <s-button variant="primary" href="shopify://admin/products/new">
            Add a product
          </s-button>
        }
      />
    );
  }

  return (
    <s-stack direction="block" gap="base">
      {/* Filter bar + bulk review */}
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-stack direction="inline" gap="small">
          {["all", "errors", "pending", "price_reviews"].map((filter) => (
            <s-link
              key={filter}
              href={`?filter=${filter}`}
            >
              <s-badge tone={currentFilter === filter ? "info" : undefined}>
                {filter === "all"
                  ? "All"
                  : filter === "errors"
                    ? "Errors"
                    : filter === "pending"
                      ? "Pending"
                      : "Price Reviews"}
              </s-badge>
            </s-link>
          ))}
        </s-stack>
        {pendingPriceReviews > 0 && onBulkReview && (
          <s-button variant="secondary" onClick={() => onBulkReview()}>
            Review All ({pendingPriceReviews})
          </s-button>
        )}
      </s-stack>

      {/* Products table */}
      <s-table variant="list">
        <s-table-header-row>
          <s-table-header>Product</s-table-header>
          <s-table-header>Price</s-table-header>
          {pendingPriceReviews > 0 && <s-table-header>Suggested</s-table-header>}
          {connectedMarketplaces.map((mp) => (
            <s-table-header key={mp}>
              {marketplaceLabel(mp)}
            </s-table-header>
          ))}
          <s-table-header>Last Synced</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {products.map((product) => {
            const listings = listingsByProduct[product.id];
            const suggestion = priceSuggestions[product.id];
            const lastSynced = listings
              ?.map((l) => l.lastSyncedAt)
              .filter(Boolean)
              .sort()
              .reverse()[0];

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
                    <s-link
                      href={`shopify://admin/products/${product.id.split("/").pop()}`}
                    >
                      <s-text type="strong">{product.title}</s-text>
                    </s-link>
                  </s-stack>
                </s-table-cell>

                <s-table-cell>
                  <s-text>{product.price ? `$${product.price}` : "--"}</s-text>
                </s-table-cell>

                {pendingPriceReviews > 0 && (
                  <s-table-cell>
                    {suggestion ? (
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-badge tone="success">
                          ${suggestion.suggestedPrice}
                        </s-badge>
                        <Form method="post">
                          <input type="hidden" name="intent" value="approve-price" />
                          <input type="hidden" name="suggestionId" value={suggestion.id} />
                          <s-button variant="primary" type="submit">
                            Approve
                          </s-button>
                        </Form>
                      </s-stack>
                    ) : (
                      <s-text color="subdued">--</s-text>
                    )}
                  </s-table-cell>
                )}

                {connectedMarketplaces.map((mp) => {
                  const listing = getListingStatus(listings, mp);
                  if (!listing) {
                    return (
                      <s-table-cell key={mp}>
                        <s-text color="subdued">—</s-text>
                      </s-table-cell>
                    );
                  }
                  return (
                    <s-table-cell key={mp}>
                      <s-badge
                        tone={
                          listing.status === "active"
                            ? "success"
                            : listing.status === "error"
                              ? "critical"
                              : "caution"
                        }
                      >
                        {STATUS_ICONS[listing.status] ?? "?"}{" "}
                        {listing.status}
                      </s-badge>
                    </s-table-cell>
                  );
                })}

                <s-table-cell>
                  {lastSynced ? (
                    <RelativeTime date={lastSynced} />
                  ) : (
                    <s-text color="subdued">--</s-text>
                  )}
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>

      {hasNextPage && endCursor && (
        <s-stack direction="inline" alignItems="center">
          <s-link href={`?after=${endCursor}&filter=${currentFilter}`}>
            <s-button variant="secondary">Load more</s-button>
          </s-link>
        </s-stack>
      )}

      {products.length === 0 && currentFilter !== "all" && (
        <s-box padding="large">
          <s-stack direction="block" gap="base" alignItems="center">
            <s-text color="subdued">
              No products match the &quot;{currentFilter}&quot; filter.
            </s-text>
            <s-link href="?filter=all">
              <s-button variant="secondary">Show all products</s-button>
            </s-link>
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
}
