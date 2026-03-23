import db from "../db.server";

export interface ApproveResult {
  id: string;
  success: boolean;
  error?: string;
}

const GET_VARIANTS = `#graphql
  query getVariants($productId: ID!) {
    product(id: $productId) {
      variants(first: 250) { nodes { id } }
    }
  }`;

const BULK_UPDATE_PRICE = `#graphql
  mutation bulkUpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`;

interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export async function approvePriceSuggestion(
  admin: AdminClient,
  shop: string,
  suggestionId: string,
): Promise<ApproveResult> {
  const suggestion = await db.priceSuggestion.findFirst({
    where: { id: suggestionId, shopId: shop, status: "pending" },
  });
  if (!suggestion) {
    return { id: suggestionId, success: false, error: "Suggestion not found" };
  }

  const variantResponse = await admin.graphql(GET_VARIANTS, {
    variables: { productId: suggestion.shopifyProductId },
  });
  const variantData = await variantResponse.json();
  const variants = variantData.data?.product?.variants?.nodes ?? [];
  if (variants.length === 0) {
    return { id: suggestionId, success: false, error: "No variants found" };
  }

  const mutationResponse = await admin.graphql(BULK_UPDATE_PRICE, {
    variables: {
      productId: suggestion.shopifyProductId,
      variants: variants.map((v: { id: string }) => ({
        id: v.id,
        price: suggestion.suggestedPrice.toString(),
      })),
    },
  });
  const mutationData = await mutationResponse.json();
  const userErrors =
    mutationData.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      id: suggestionId,
      success: false,
      error: `Shopify error: ${userErrors[0].message}`,
    };
  }

  await db.priceSuggestion.update({
    where: { id: suggestionId },
    data: { status: "approved", reviewedAt: new Date() },
  });

  return { id: suggestionId, success: true };
}
