/**
 * Duplicate detection for product imports.
 *
 * Checks for existing products first by eBay item ID metafield (if present),
 * then by product handle. When a duplicate is found, fetches the existing
 * product's key fields and compares them to identify field-level differences.
 */

import type { ParsedCard } from "./types";
import type { AdminClient } from "../../types/admin";
import { buildTitle, slugify } from "./product-builder.server";
import { sleep } from "../timing";

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 200;

/** Fragment for fields we compare against the imported card. */
const PRODUCT_COMPARE_FIELDS = `
  id
  title
  variants(first: 1) {
    edges { node { price } }
  }
  ebayItemId: metafield(namespace: "card", key: "ebay_item_id") { value }
  pokemon: metafield(namespace: "card", key: "pokemon") { value }
  setName: metafield(namespace: "card", key: "set_name") { value }
  number: metafield(namespace: "card", key: "number") { value }
  gradingCompany: metafield(namespace: "card", key: "grading_company") { value }
  grade: metafield(namespace: "card", key: "grade") { value }
  certNumber: metafield(namespace: "card", key: "cert_number") { value }
  condition: metafield(namespace: "card", key: "condition") { value }
`;

const BATCH_EBAY_ID_QUERY = `#graphql
  query batchEbayIdLookup($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          ${PRODUCT_COMPARE_FIELDS}
        }
      }
    }
  }
`;

interface ExistingProduct {
  id: string;
  title: string;
  price: string | null;
  ebayItemId: string | null;
  pokemon: string | null;
  setName: string | null;
  number: string | null;
  gradingCompany: string | null;
  grade: string | null;
  certNumber: string | null;
  condition: string | null;
}

/** Shape of the GraphQL product node returned by PRODUCT_COMPARE_FIELDS. */
interface ProductCompareNode {
  id: string;
  title?: string;
  variants?: { edges?: Array<{ node?: { price?: string } }> };
  ebayItemId?: { value?: string };
  pokemon?: { value?: string };
  setName?: { value?: string };
  number?: { value?: string };
  gradingCompany?: { value?: string };
  grade?: { value?: string };
  certNumber?: { value?: string };
  condition?: { value?: string };
}

function parseProductNode(node: ProductCompareNode): ExistingProduct {
  return {
    id: node.id,
    title: node.title ?? "",
    price: node.variants?.edges?.[0]?.node?.price ?? null,
    ebayItemId: node.ebayItemId?.value ?? null,
    pokemon: node.pokemon?.value ?? null,
    setName: node.setName?.value ?? null,
    number: node.number?.value ?? null,
    gradingCompany: node.gradingCompany?.value ?? null,
    grade: node.grade?.value ?? null,
    certNumber: node.certNumber?.value ?? null,
    condition: node.condition?.value ?? null,
  };
}

/**
 * Compare a parsed card against an existing Shopify product and return
 * a list of human-readable field differences.
 */
function compareFields(card: ParsedCard, existing: ExistingProduct): string[] {
  const diffs: string[] = [];

  const expectedTitle = buildTitle(card);
  if (normalize(existing.title) !== normalize(expectedTitle)) {
    diffs.push("title");
  }

  if (existing.price != null) {
    const existingPrice = parseFloat(existing.price);
    if (!isNaN(existingPrice) && Math.abs(existingPrice - card.finalPrice) > 0.01) {
      diffs.push("price");
    }
  }

  if (diff(existing.pokemon, card.pokemon)) diffs.push("pokemon");
  if (diff(existing.setName, card.setName)) diffs.push("set");
  if (diff(existing.number, card.number)) diffs.push("number");
  if (diff(existing.gradingCompany, card.grader)) diffs.push("grader");
  if (diff(existing.grade, card.grade)) diffs.push("grade");
  if (diff(existing.certNumber, card.certNumber)) diffs.push("cert #");
  if (diff(existing.condition, card.condition)) diffs.push("condition");

  return diffs;
}

/** Normalize a string for loose comparison (trim, lowercase, collapse whitespace). */
function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns true when two optional string values are meaningfully different. */
function diff(existing: string | null | undefined, incoming: string | null | undefined): boolean {
  return normalize(existing) !== normalize(incoming);
}

/**
 * Build a single GraphQL query that looks up multiple handles via aliases,
 * including all comparison fields.
 */
function buildBatchHandleQuery(handles: Array<{ index: number; handle: string }>): string {
  const fields = handles.map(({ index, handle }) => {
    const escaped = handle.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `h${index}: productByHandle(handle: "${escaped}") { ${PRODUCT_COMPARE_FIELDS} }`;
  });
  return `#graphql\n  query {\n    ${fields.join("\n    ")}\n  }`;
}

/**
 * Check cards for duplicates in Shopify using batched queries.
 * Mutates the isDuplicate, duplicateProductId, duplicateFieldDiffs,
 * and dedupUnavailable fields.
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
      const edges: Array<{ node: ProductCompareNode }> = data.data?.products?.edges ?? [];

      // Build a map of found eBay IDs → existing product data
      const foundProducts = new Map<string, ExistingProduct>();
      for (const edge of edges) {
        const product = parseProductNode(edge.node);
        if (product.ebayItemId) foundProducts.set(product.ebayItemId, product);
      }

      for (const card of batch) {
        const existing = foundProducts.get(card.ebayItemId);
        if (existing) {
          card.isDuplicate = true;
          card.duplicateProductId = existing.id;
          card.duplicateFieldDiffs = compareFields(card, existing);
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
        const result = data.data?.[`h${entry.index}`] as ProductCompareNode | undefined;
        if (result) {
          const existing = parseProductNode(result);
          entry.card.isDuplicate = true;
          entry.card.duplicateProductId = existing.id;
          entry.card.duplicateFieldDiffs = compareFields(entry.card, existing);
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
