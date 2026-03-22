interface ProductTypeNode {
  productType: string;
}

interface ProductTypeCounts {
  totalProducts: number;
  typeCounts: Array<{ type: string; count: number }>;
}

export async function fetchProductTypeCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<ProductTypeCounts> {
  const allProducts: ProductTypeNode[] = [];
  let totalProducts = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await admin.graphql(
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
    allProducts.push(...nodes);

    totalProducts = data.data?.productsCount?.count ?? totalProducts;
    hasNextPage = data.data?.products?.pageInfo?.hasNextPage ?? false;
    cursor = data.data?.products?.pageInfo?.endCursor ?? null;
  }

  const counts: Record<string, number> = {};
  for (const p of allProducts) {
    const type = p.productType || "Uncategorized";
    counts[type] = (counts[type] ?? 0) + 1;
  }

  const typeCounts = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { totalProducts, typeCounts };
}
