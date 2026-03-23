/**
 * Duplicate detection for product imports.
 *
 * Checks for existing products by handle (for CSV imports) and
 * by eBay item ID metafield (for eBay Browse API imports).
 */

import type { ParsedCard } from "./types";
import { buildTitle, slugify, sleep, DELAY_MS } from "./product-builder.server";

interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query productByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
    }
  }
`;

const PRODUCTS_BY_EBAY_ID_QUERY = `#graphql
  query productsByEbayId($query: String!) {
    products(first: 1, query: $query) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

/**
 * Check each card for duplicates in Shopify.
 * Mutates the isDuplicate and duplicateProductId fields on each card.
 */
export async function checkDuplicates(
  admin: AdminClient,
  cards: ParsedCard[],
): Promise<ParsedCard[]> {
  for (const card of cards) {
    try {
      // Strategy 1: Check by eBay item ID metafield (most reliable for eBay imports)
      if (card.ebayItemId) {
        const res = await admin.graphql(PRODUCTS_BY_EBAY_ID_QUERY, {
          variables: {
            query: `metafields.card.ebay_item_id:"${card.ebayItemId}"`,
          },
        });
        const data = await res.json();
        const edges = data.data?.products?.edges ?? [];
        if (edges.length > 0) {
          card.isDuplicate = true;
          card.duplicateProductId = edges[0].node.id;
          card.selected = false;
          await sleep(DELAY_MS);
          continue;
        }
      }

      // Strategy 2: Check by product handle
      const title = buildTitle(card);
      const handle = card.customLabel
        ? slugify(card.customLabel)
        : slugify(title);

      const res = await admin.graphql(PRODUCT_BY_HANDLE_QUERY, {
        variables: { handle },
      });
      const data = await res.json();
      if (data.data?.productByHandle) {
        card.isDuplicate = true;
        card.duplicateProductId = data.data.productByHandle.id;
        card.selected = false;
      }
    } catch {
      // Non-fatal: if dedup check fails, treat as non-duplicate
    }

    await sleep(DELAY_MS);
  }

  return cards;
}
