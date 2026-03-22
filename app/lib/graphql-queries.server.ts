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

export async function fetchProductTypeCounts(
  admin: AdminClient,
): Promise<ProductTypeCounts> {
  const counts: Record<string, number> = {};
  let totalProducts = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
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
          productsCount(query: "status:active") {
            count
          }
        }`,
      { variables: { cursor } },
    );

    const data = await response.json();
    const nodes: ProductTypeNode[] = data.data?.products?.nodes ?? [];

    for (const p of nodes) {
      const type = p.productType || "Uncategorized";
      counts[type] = (counts[type] ?? 0) + 1;
    }

    totalProducts = data.data?.productsCount?.count ?? totalProducts;
    hasNextPage = data.data?.products?.pageInfo?.hasNextPage ?? false;
    cursor = data.data?.products?.pageInfo?.endCursor ?? null;
  }

  const typeCounts = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { totalProducts, typeCounts };
}
