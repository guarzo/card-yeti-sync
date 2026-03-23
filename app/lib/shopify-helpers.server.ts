/**
 * Shopify Admin API helpers for fetching products with card metafields.
 * Used by adapters, webhook handlers, and CSV exports.
 */

// All 19 card-namespace metafield keys
const CARD_METAFIELD_KEYS = [
  "pokemon", "set_name", "number", "rarity", "year", "language",
  "condition", "condition_notes", "centering",
  "grading_company", "grade", "cert_number", "population", "pop_higher", "subgrades",
  "ebay_comp", "cert_url", "type_label", "ebay_item_id",
] as const;

export type CardMetafields = Partial<Record<(typeof CARD_METAFIELD_KEYS)[number], string>>;

// GraphQL fragment for card metafields
const CARD_METAFIELDS_FRAGMENT = CARD_METAFIELD_KEYS.map(
  (key) => `${key}: metafield(namespace: "card", key: "${key}") { value }`
).join("\n    ");

const PRODUCT_WITH_METAFIELDS_QUERY = `
  query productWithMetafields($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      productType
      totalInventory
      featuredImage { url }
      images(first: 8) { edges { node { url } } }
      ${CARD_METAFIELDS_FRAGMENT}
      variants(first: 1) {
        edges {
          node {
            id
            price
            compareAtPrice
            sku
            inventoryQuantity
            inventoryItem { id }
          }
        }
      }
    }
  }
`;

const ALL_PRODUCTS_QUERY = `
  query allProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          status
          productType
          totalInventory
          featuredImage { url }
          images(first: 8) {
            edges { node { url } }
          }
          ${CARD_METAFIELDS_FRAGMENT}
          variants(first: 1) {
            edges {
              node {
                id
                price
                compareAtPrice
                sku
                inventoryQuantity
                inventoryItem { id }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Extract card metafields from a product node that used inline metafield queries.
 * Converts { pokemon: { value: "Charizard" }, ... } to { pokemon: "Charizard", ... }
 */
export function extractCardMetafields(productNode: Record<string, unknown>): CardMetafields {
  const result: CardMetafields = {};
  for (const key of CARD_METAFIELD_KEYS) {
    const field = productNode[key] as { value: string } | null | undefined;
    if (field?.value) {
      result[key] = field.value;
    }
  }
  return result;
}

/**
 * Fetch a single product with all card metafields.
 */
export async function getProductWithMetafields(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  productId: string,
) {
  const response = await admin.graphql(PRODUCT_WITH_METAFIELDS_QUERY, {
    variables: { id: productId },
  });
  const { data } = await response.json();
  const product = data.product;
  if (!product) return null;

  const metafields = extractCardMetafields(product);
  const variant = product.variants.edges[0]?.node ?? null;
  const images = (product.images?.edges ?? []).map(
    (e: { node: { url: string } }) => e.node.url,
  );

  return { product, metafields, variant, images };
}

export interface ProductWithMetafields {
  product: Record<string, unknown>;
  metafields: CardMetafields;
  variant: Record<string, unknown> | null;
  images: string[];
}

/**
 * Fetch all products with pagination and optional query filter.
 */
export async function getAllProducts(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  options?: { query?: string; pageSize?: number },
): Promise<ProductWithMetafields[]> {
  const pageSize = options?.pageSize ?? 50;
  const results: ProductWithMetafields[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(ALL_PRODUCTS_QUERY, {
      variables: { first: pageSize, after, query: options?.query ?? null },
    });
    const { data } = await response.json();

    for (const edge of data.products.edges) {
      const node = edge.node;
      const metafields = extractCardMetafields(node);
      const variant = node.variants.edges[0]?.node ?? null;
      const images = (node.images?.edges ?? []).map(
        (e: { node: { url: string } }) => e.node.url,
      );
      results.push({ product: node, metafields, variant, images });
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }

  return results;
}
