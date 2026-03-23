/**
 * Duplicate detection for product imports.
 *
 * Checks for existing products first by eBay item ID metafield (if present),
 * then by product handle. Uses batched GraphQL queries to reduce API calls.
 */

import type { ParsedCard } from "./types";
import type { AdminClient } from "../../types/admin";
import { buildTitle, slugify } from "./product-builder.server";
import { sleep } from "../timing";

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 200;

const BATCH_EBAY_ID_QUERY = `#graphql
  query batchEbayIdLookup($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          id
          ebayItemId: metafield(namespace: "card", key: "ebay_item_id") {
            value
          }
        }
      }
    }
  }
`;

/**
 * Build a single GraphQL query that looks up multiple handles via aliases.
 */
function buildBatchHandleQuery(handles: Array<{ index: number; handle: string }>): string {
  const fields = handles.map(({ index, handle }) => {
    const escaped = handle.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `h${index}: productByHandle(handle: "${escaped}") { id }`;
  });
  return `#graphql\n  query {\n    ${fields.join("\n    ")}\n  }`;
}

/**
 * Check cards for duplicates in Shopify using batched queries.
 * Mutates the isDuplicate, duplicateProductId, and dedupUnavailable fields.
 */
export async function checkDuplicates(
  admin: AdminClient,
  cards: ParsedCard[],
): Promise<ParsedCard[]> {
  // Phase 1: Batch check by eBay item ID metafield
  const cardsWithEbayId = cards.filter((c) => c.ebayItemId);
  for (let i = 0; i < cardsWithEbayId.length; i += BATCH_SIZE) {
    const batch = cardsWithEbayId.slice(i, i + BATCH_SIZE);
    try {
      const queryParts = batch.map(
        (c) => `metafields.card.ebay_item_id:"${c.ebayItemId.replace(/"/g, '\\"')}"`,
      );
      const res = await admin.graphql(BATCH_EBAY_ID_QUERY, {
        variables: { query: queryParts.join(" OR ") },
      });
      const data = await res.json();
      const edges = data.data?.products?.edges ?? [];

      // Build a set of found eBay IDs for matching
      const foundIds = new Map<string, string>();
      for (const edge of edges) {
        const ebayId = edge.node.ebayItemId?.value;
        if (ebayId) foundIds.set(ebayId, edge.node.id);
      }

      for (const card of batch) {
        const productId = foundIds.get(card.ebayItemId);
        if (productId) {
          card.isDuplicate = true;
          card.duplicateProductId = productId;
          card.selected = false;
        }
      }
    } catch (err) {
      console.error("Batch dedup by eBay ID failed:", err);
      for (const card of batch) {
        card.dedupUnavailable = true;
        card.parseErrors.push(
          `Duplicate check failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    }

    if (i + BATCH_SIZE < cardsWithEbayId.length) await sleep(BATCH_DELAY_MS);
  }

  // Phase 2: Batch check by handle for cards not already resolved
  const remainingCards = cards.filter(
    (c) => !c.isDuplicate && !c.dedupUnavailable,
  );
  for (let i = 0; i < remainingCards.length; i += BATCH_SIZE) {
    const batch = remainingCards.slice(i, i + BATCH_SIZE);

    // Build handle entries, skipping empty handles (all-symbol card names)
    const handleEntries: Array<{ index: number; handle: string; card: ParsedCard }> = [];
    for (let j = 0; j < batch.length; j++) {
      const title = buildTitle(batch[j]);
      const handle = batch[j].customLabel
        ? slugify(batch[j].customLabel)
        : slugify(title);
      if (handle) {
        handleEntries.push({ index: j, handle, card: batch[j] });
      }
    }

    if (handleEntries.length === 0) continue;

    try {
      const query = buildBatchHandleQuery(handleEntries);
      const res = await admin.graphql(query);
      const data = await res.json();

      for (const entry of handleEntries) {
        const result = data.data?.[`h${entry.index}`];
        if (result) {
          entry.card.isDuplicate = true;
          entry.card.duplicateProductId = result.id;
          entry.card.selected = false;
        }
      }
    } catch (err) {
      console.error("Batch dedup by handle failed:", err);
      for (const card of batch) {
        card.dedupUnavailable = true;
        card.parseErrors.push(
          `Duplicate check failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    }

    if (i + BATCH_SIZE < remainingCards.length) await sleep(BATCH_DELAY_MS);
  }

  return cards;
}
