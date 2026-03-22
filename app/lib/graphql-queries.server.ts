interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ProductTypeNode {
  productType: string;
}

interface ProductTypeCounts {
  totalProducts: number;
  typeCounts: Array<{ type: string; count: number }>;
}

const GET_PRODUCT_TYPES = `#graphql
  query getProductTypes($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      nodes {
        productType
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

const GET_ACTIVE_PRODUCTS_COUNT = `#graphql
  query getActiveProductsCount {
    productsCount(query: "status:active") {
      count
    }
  }`;

export async function fetchProductTypeCounts(
  admin: AdminClient,
): Promise<ProductTypeCounts> {
  // Fetch total count once, separately from pagination
  const countResponse = await admin.graphql(GET_ACTIVE_PRODUCTS_COUNT);
  if (!countResponse.ok) {
    throw new Error(`Shopify productsCount query failed: ${countResponse.status}`);
  }
  const countData = await countResponse.json();
  if (countData.errors) {
    throw new Error(`Shopify productsCount query error: ${JSON.stringify(countData.errors)}`);
  }
  const totalProducts: number = countData.data?.productsCount?.count ?? 0;

  // Paginate product types
  const counts: Record<string, number> = {};
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(GET_PRODUCT_TYPES, {
      variables: { cursor },
    });
    if (!response.ok) {
      throw new Error(`Shopify productTypes query failed: ${response.status}`);
    }
    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopify productTypes query error: ${JSON.stringify(data.errors)}`);
    }

    const products = data.data?.products;
    if (!products) {
      throw new Error("Unexpected response: missing products field");
    }

    const nodes: ProductTypeNode[] = products.nodes;
    for (const p of nodes) {
      const type = p.productType || "Uncategorized";
      counts[type] = (counts[type] ?? 0) + 1;
    }

    hasNextPage = products.pageInfo?.hasNextPage ?? false;
    cursor = products.pageInfo?.endCursor ?? null;
  }

  const typeCounts = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { totalProducts, typeCounts };
}
