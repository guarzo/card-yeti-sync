import type { MarketplaceAccount } from "@prisma/client";
import { ebayApiCall } from "../ebay-client.server";
import {
  mapToInventoryItem,
  mapToOffer,
  type EbayPolicyIds,
} from "../mappers/ebay-mapper";
import type { CardMetafields } from "../shopify-helpers.server";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ListResult {
  marketplaceId: string;
  offerId: string;
  url: string;
  status: "active" | "error";
  error?: string;
}

export async function listProduct(
  product: { id: string; title: string; descriptionHtml?: string },
  variant: { price: string; compareAtPrice: string | null; sku: string },
  metafields: CardMetafields,
  images: string[],
  account: MarketplaceAccount,
): Promise<ListResult> {
  const settings = (account.settings ?? {}) as Record<string, string>;
  const policyIds: EbayPolicyIds = {
    fulfillmentPolicyId: settings.fulfillmentPolicyId ?? "",
    paymentPolicyId: settings.paymentPolicyId ?? "",
    returnPolicyId: settings.returnPolicyId ?? "",
  };

  const sku = variant.sku || `CY-${product.id.split("/").pop()}`;
  const inventoryItem = mapToInventoryItem(product, metafields, images);
  const offer = mapToOffer(product, variant, metafields, policyIds);

  // Step 1: Create or replace inventory item
  const { response: itemResponse } = await ebayApiCall(
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    inventoryItem as unknown as Record<string, unknown>,
    account,
  );

  if (!itemResponse.ok && itemResponse.status !== 204) {
    const err = await itemResponse.text();
    return { marketplaceId: "", offerId: "", url: "", status: "error", error: err };
  }

  await delay(200);

  // Step 2: Create offer
  const { response: offerResponse } = await ebayApiCall(
    "POST",
    "/sell/inventory/v1/offer",
    offer as unknown as Record<string, unknown>,
    account,
  );

  if (!offerResponse.ok) {
    const err = await offerResponse.text();
    return { marketplaceId: "", offerId: "", url: "", status: "error", error: err };
  }

  const offerData = await offerResponse.json();
  const offerId = offerData.offerId;

  await delay(200);

  // Step 3: Publish offer
  const { response: publishResponse } = await ebayApiCall(
    "POST",
    `/sell/inventory/v1/offer/${offerId}/publish`,
    null,
    account,
  );

  if (!publishResponse.ok) {
    const err = await publishResponse.text();
    return { marketplaceId: "", offerId, url: "", status: "error", error: err };
  }

  const publishData = await publishResponse.json();
  const listingId = publishData.listingId;
  const url = `https://www.ebay.com/itm/${listingId}`;

  return { marketplaceId: listingId, offerId, url, status: "active" };
}

export async function updateProduct(
  sku: string,
  offerId: string,
  product: { title: string; descriptionHtml?: string },
  variant: { price: string; compareAtPrice: string | null; sku: string },
  metafields: CardMetafields,
  images: string[],
  account: MarketplaceAccount,
): Promise<{ status: "active" | "error"; error?: string }> {
  const inventoryItem = mapToInventoryItem(product, metafields, images);

  const { response: itemResponse } = await ebayApiCall(
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    inventoryItem as unknown as Record<string, unknown>,
    account,
  );

  if (!itemResponse.ok && itemResponse.status !== 204) {
    const err = await itemResponse.text();
    return { status: "error", error: err };
  }

  const settings = (account.settings ?? {}) as Record<string, string>;
  const offer = mapToOffer(product, variant, metafields, {
    fulfillmentPolicyId: settings.fulfillmentPolicyId ?? "",
    paymentPolicyId: settings.paymentPolicyId ?? "",
    returnPolicyId: settings.returnPolicyId ?? "",
  });

  const { response: offerResponse } = await ebayApiCall(
    "PUT",
    `/sell/inventory/v1/offer/${offerId}`,
    offer as unknown as Record<string, unknown>,
    account,
  );

  if (!offerResponse.ok) {
    const err = await offerResponse.text();
    return { status: "error", error: err };
  }

  return { status: "active" };
}

export async function delistProduct(
  offerId: string,
  account: MarketplaceAccount,
): Promise<{ status: "delisted" | "error"; error?: string }> {
  const { response } = await ebayApiCall(
    "POST",
    `/sell/inventory/v1/offer/${offerId}/withdraw`,
    null,
    account,
  );

  if (response.ok || response.status === 404) {
    return { status: "delisted" };
  }

  const err = await response.text();
  return { status: "error", error: err };
}

export async function bulkUpdatePriceQuantity(
  updates: { offerId: string; sku: string; price?: string; quantity?: number }[],
  account: MarketplaceAccount,
): Promise<{ successCount: number; errorCount: number }> {
  const requests = updates.map((u) => ({
    offerId: u.offerId,
    sku: u.sku,
    ...(u.price && {
      price: { value: u.price, currency: "USD" },
    }),
    ...(u.quantity !== undefined && {
      availableQuantity: u.quantity,
    }),
  }));

  const { response } = await ebayApiCall(
    "POST",
    "/sell/inventory/v1/bulk_update_price_quantity",
    { requests },
    account,
  );

  if (!response.ok) {
    return { successCount: 0, errorCount: updates.length };
  }

  const data = await response.json();
  const errors = (data.responses ?? []).filter(
    (r: { statusCode: number }) => r.statusCode !== 200,
  );

  return {
    successCount: updates.length - errors.length,
    errorCount: errors.length,
  };
}
