/**
 * Shopify product creation logic for card imports.
 *
 * Builds productSet inputs from ParsedCard data and handles
 * Shopify GraphQL mutations via the embedded app admin client.
 */

import type { ParsedCard, ImportResult } from "./types";
import type { AdminClient } from "../../types/admin";
import { sleep } from "../timing";

export interface StoreData {
  collectionMap: Record<string, string>;
  locationId: string | null;
  publicationInputs: Array<{ publicationId: string }>;
}

export interface CreateProductOptions extends StoreData {
  status: "active" | "draft";
  rotateNewArrivals: boolean;
  existingId?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const VENDOR = "The Pokémon Company";
const GRADED_WEIGHT_G = 85;
const RAW_WEIGHT_G = 28;
export const DELAY_MS = 500;

export const CERT_URL_BUILDERS: Record<string, (cert: string) => string> = {
  PSA: (cert) => `https://www.psacard.com/cert/${cert}`,
  CGC: (cert) => `https://www.cgccards.com/certlookup/${cert}`,
  BGS: (cert) =>
    `https://www.beckett.com/grading/card-lookup?cert_number=${cert}`,
  SGC: (cert) => `https://www.gosgc.com/card-lookup?CertNo=${cert}`,
};

const JAPANESE_COLLECTION = "japanese-cards";

const VINTAGE_SETS = [
  "base set",
  "jungle",
  "fossil",
  "team rocket",
  "gym heroes",
  "gym challenge",
  "neo genesis",
  "neo discovery",
  "neo revelation",
  "neo destiny",
  "legendary collection",
  "expedition",
  "aquapolis",
  "skyridge",
  "base set 2",
  "southern islands",
];

// ── GraphQL ──────────────────────────────────────────────────────────────────

const PRODUCT_SET_MUTATION = `#graphql
  mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product {
        id
        title
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  {
    collections(first: 250) {
      edges {
        node {
          id
          handle
        }
      }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  {
    locations(first: 1) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

const PUBLICATIONS_QUERY = `#graphql
  {
    publications(first: 20) {
      edges {
        node { id name }
      }
    }
  }
`;

const PUBLISH_MUTATION = `#graphql
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const PRODUCTS_BY_TAG_QUERY = `#graphql
  query productsByTag($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const TAGS_REMOVE_MUTATION = `#graphql
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

export { sleep } from "../timing";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

function isVintageSet(setName: string): boolean {
  if (!setName) return false;
  const lower = setName.toLowerCase();
  return VINTAGE_SETS.some((s) => lower.includes(s));
}

// ── Card → Shopify Builders ─────────────────────────────────────────────────

export function buildTitle(card: ParsedCard): string {
  const parts: string[] = [];
  if (card.pokemon) parts.push(card.pokemon);
  if (card.setName) parts.push(card.setName);
  if (card.number) parts.push(`#${card.number}`);

  // No structured parts available — use the raw title as-is
  if (parts.length === 0) return card.title;

  let title = parts.join(" - ");

  if (card.language !== "English") {
    title += ` [${card.language}]`;
  }

  if (card.isGraded && card.grader && card.grade) {
    title += ` ${card.grader} ${card.grade}`;
  }

  return title;
}

export function buildTags(
  card: ParsedCard,
  addNewArrivalTag: boolean,
): string[] {
  const tags: string[] = [];

  if (card.pokemon) tags.push(card.pokemon);
  if (card.setName) tags.push(card.setName);
  if (card.rarity) tags.push(card.rarity);
  if (card.year) tags.push(card.year);

  if (card.isGraded) {
    tags.push("Graded");
    if (card.grader) tags.push(`Grader:${card.grader}`);
    if (card.grade) tags.push(`Grade:${card.grade}`);
  } else {
    tags.push("Raw");
  }

  if (card.isJapanese) tags.push("Japanese");

  if (addNewArrivalTag && !tags.includes("new-arrival")) {
    tags.push("new-arrival");
  }

  return [...new Set(tags)];
}

interface Metafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export function buildMetafields(card: ParsedCard): Metafield[] {
  const metafields: Metafield[] = [];

  function add(key: string, value: string | number | null | undefined, type: string) {
    if (value !== null && value !== undefined && value !== "") {
      metafields.push({
        namespace: "card",
        key,
        value: String(value),
        type,
      });
    }
  }

  add("pokemon", card.pokemon, "single_line_text_field");
  add("number", card.number, "single_line_text_field");
  add("set_name", card.setName, "single_line_text_field");
  add("language", card.language, "single_line_text_field");
  add("year", card.year, "single_line_text_field");
  add("rarity", card.rarity, "single_line_text_field");
  add(
    "type_label",
    card.isGraded ? "Graded Slab" : "Raw Single",
    "single_line_text_field",
  );

  if (card.isGraded) {
    add("grading_company", card.grader, "single_line_text_field");
    add("grade", card.grade, "single_line_text_field");
  }

  if (card.certNumber) {
    add("cert_number", card.certNumber, "single_line_text_field");
    if (card.grader && CERT_URL_BUILDERS[card.grader]) {
      add("cert_url", CERT_URL_BUILDERS[card.grader](card.certNumber), "url");
    }
  }

  if (card.ebayPrice > 0) {
    add("ebay_comp", card.ebayPrice.toFixed(2), "number_decimal");
  }

  if (!card.isGraded && card.condition) {
    add("condition", card.condition, "single_line_text_field");
  }

  if (card.ebayItemId) {
    add("ebay_item_id", card.ebayItemId, "single_line_text_field");
  }

  return metafields;
}

export function resolveCollections(
  card: ParsedCard,
  collectionMap: Record<string, string>,
): string[] {
  const handles: string[] = [];

  if (card.isGraded) {
    handles.push("graded-cards");
  }

  if (card.isJapanese) {
    handles.push(JAPANESE_COLLECTION);
  }

  if (isVintageSet(card.setName)) {
    handles.push("vintage-cards");
  } else if (card.isGraded) {
    handles.push("modern-cards");
  }

  return handles.map((h) => collectionMap[h]).filter(Boolean);
}

export function buildProductSetInput(
  card: ParsedCard,
  opts: CreateProductOptions,
): Record<string, unknown> {
  const metafields = buildMetafields(card);
  const collectionGids = resolveCollections(card, opts.collectionMap);
  const title = buildTitle(card);
  const handle = card.customLabel ? slugify(card.customLabel) : slugify(title);
  const tags = buildTags(card, opts.rotateNewArrivals);

  // finalPrice is the price to use on Shopify; ebayPrice is the original eBay listing price used for compare-at pricing
  const shopifyPrice =
    card.finalPrice > 0 ? card.finalPrice.toFixed(2) : "0.00";
  const compareAtPrice =
    card.ebayPrice > card.finalPrice && card.ebayPrice > 0
      ? card.ebayPrice.toFixed(2)
      : "";

  const templateSuffix = card.isGraded ? "graded-card" : null;

  let sku = "";
  if (card.isGraded && card.certNumber) {
    sku = `${card.grader}-${card.certNumber}`;
  } else if (card.customLabel) {
    sku = card.customLabel;
  } else if (card.ebayItemId) {
    sku = `EBAY-${card.ebayItemId}`;
  } else {
    sku = handle;
  }

  const input: Record<string, unknown> = {
    title,
    handle,
    descriptionHtml: card.description || "",
    vendor: VENDOR,
    productType: card.isGraded ? "Graded Card" : "Raw Single",
    tags,
    status: opts.status.toUpperCase(),
    templateSuffix,
    metafields,
    ...(opts.existingId ? { id: opts.existingId } : {}),
  };

  if (collectionGids.length > 0) {
    input.collections = collectionGids;
  }

  if (card.imageUrls.length > 0) {
    input.files = card.imageUrls.map((url) => ({
      originalSource: url,
      alt: title,
      contentType: "IMAGE",
    }));
  }

  const weightGrams = card.isGraded ? GRADED_WEIGHT_G : RAW_WEIGHT_G;
  const variant: Record<string, unknown> = {
    optionValues: [{ name: "Default Title", optionName: "Title" }],
    price: shopifyPrice,
    sku,
    inventoryItem: {
      measurement: {
        weight: { value: weightGrams, unit: "GRAMS" },
      },
    },
  };

  if (compareAtPrice) variant.compareAtPrice = compareAtPrice;

  if (opts.locationId) {
    variant.inventoryQuantities = [
      {
        locationId: opts.locationId,
        name: "available",
        quantity: 1,
      },
    ];
  }

  input.productOptions = [
    { name: "Title", values: [{ name: "Default Title" }] },
  ];
  input.variants = [variant];

  return input;
}

// ── Shopify Interactions ─────────────────────────────────────────────────────

export async function fetchStoreData(admin: AdminClient): Promise<StoreData> {
  const collectionMap: Record<string, string> = {};
  try {
    const colRes = await admin.graphql(COLLECTIONS_QUERY);
    const colData = await colRes.json();
    for (const edge of colData.data?.collections?.edges ?? []) {
      collectionMap[edge.node.handle] = edge.node.id;
    }
  } catch (err) {
    console.error("Failed to fetch collections from Shopify:", err);
  }

  let locationId: string | null = null;
  try {
    const locRes = await admin.graphql(LOCATIONS_QUERY);
    const locData = await locRes.json();
    const edges = locData.data?.locations?.edges ?? [];
    if (edges.length > 0) {
      locationId = edges[0].node.id;
    }
  } catch (err) {
    console.error("Failed to fetch locations from Shopify:", err);
  }

  const publicationInputs: Array<{ publicationId: string }> = [];
  try {
    const pubRes = await admin.graphql(PUBLICATIONS_QUERY);
    const pubData = await pubRes.json();
    for (const edge of pubData.data?.publications?.edges ?? []) {
      publicationInputs.push({ publicationId: edge.node.id });
    }
  } catch (err) {
    console.error("Failed to fetch publications from Shopify:", err);
  }

  return { collectionMap, locationId, publicationInputs };
}

export async function createProduct(
  admin: AdminClient,
  card: ParsedCard,
  opts: CreateProductOptions,
): Promise<ImportResult> {
  const title = buildTitle(card);

  try {
    const input = buildProductSetInput(card, opts);

    const res = await admin.graphql(PRODUCT_SET_MUTATION, {
      variables: { input, synchronous: true },
    });
    const data = await res.json();

    const errors = data.data?.productSet?.userErrors ?? [];
    if (errors.length > 0) {
      const errMsg = errors
        .map((e: { code: string; field: string; message: string }) =>
          `[${e.code}] ${e.field}: ${e.message}`,
        )
        .join("; ");
      return {
        sourceId: card.sourceId,
        title,
        status: "failed",
        shopifyProductId: null,
        error: errMsg,
      };
    }

    const product = data.data.productSet.product;

    // Publish to all sales channels
    if (opts.publicationInputs.length > 0) {
      try {
        await admin.graphql(PUBLISH_MUTATION, {
          variables: {
            id: product.id,
            input: opts.publicationInputs,
          },
        });
      } catch (publishErr) {
        console.error(
          `Product ${product.id} created but publish failed:`,
          publishErr instanceof Error ? publishErr.message : publishErr,
        );
      }
    }

    return {
      sourceId: card.sourceId,
      title,
      status: "created",
      shopifyProductId: product.id,
      error: null,
    };
  } catch (err) {
    return {
      sourceId: card.sourceId,
      title,
      status: "failed",
      shopifyProductId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removeNewArrivalTags(
  admin: AdminClient,
): Promise<number> {
  const products: Array<{ id: string; title: string }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    try {
      const res = await admin.graphql(PRODUCTS_BY_TAG_QUERY, {
        variables: { first: 50, after, query: "tag:new-arrival" },
      });
      const data = await res.json();

      const edges = data.data?.products?.edges ?? [];
      for (const edge of edges) {
        products.push(edge.node);
      }

      hasNextPage = data.data?.products?.pageInfo?.hasNextPage ?? false;
      after = data.data?.products?.pageInfo?.endCursor ?? null;
    } catch (err) {
      console.error(
        "Failed to fetch new-arrival products page:",
        err instanceof Error ? err.message : err,
      );
      break;
    }
  }

  if (products.length === 0) return 0;

  let successCount = 0;
  for (const product of products) {
    try {
      const res = await admin.graphql(TAGS_REMOVE_MUTATION, {
        variables: { id: product.id, tags: ["new-arrival"] },
      });
      const data = await res.json();
      const errors = data.data?.tagsRemove?.userErrors ?? [];
      if (errors.length === 0) {
        successCount++;
      }
    } catch (err) {
      console.error(
        `Failed to remove new-arrival tag from product ${product.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(DELAY_MS);
  }

  return successCount;
}
