import type { MarketplaceAccount } from "@prisma/client";
import db from "../../db.server";
import { ebayApiCall } from "../ebay-client.server";
import {
  mapToInventoryItem,
  mapToOffer,
  type EbayPolicyIds,
} from "../mappers/ebay-mapper";
import { isShadowMode, compareWithEbayState, logShadowAction } from "../shadow-mode.server";
import type { CardMetafields } from "../shopify-helpers.server";
import { sleep } from "../timing";

/**
 * Wrapper around ebayApiCall that persists refreshed tokens to the database.
 * Returns just the Response for cleaner call-site destructuring.
 */
async function ebayApiCallWithPersist(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  account: MarketplaceAccount,
): Promise<Response> {
  const { response, updatedTokens } = await ebayApiCall(method, path, body, account);
  if (updatedTokens) {
    try {
      await db.marketplaceAccount.update({
        where: { id: account.id },
        data: {
          accessToken: updatedTokens.accessToken,
          tokenExpiry: updatedTokens.tokenExpiry,
        },
      });
    } catch (err) {
      console.error(
        `Failed to persist refreshed eBay token for account ${account.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return response;
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

  if (isShadowMode(account)) {
    const comparison = await compareWithEbayState(sku, "list", {
      title: product.title,
      sku,
      price: variant.price,
    }, account);
    await logShadowAction(account.shopId, product.id, "list", comparison);
    console.log(`[SHADOW] Would list ${product.title} (SKU: ${sku}) — match: ${comparison.match}`);
    return {
      marketplaceId: `shadow-${Date.now()}`,
      offerId: `shadow-${Date.now()}`,
      url: "",
      status: "active",
    };
  }

  // Step 1: Create or replace inventory item
  const itemResponse = await ebayApiCallWithPersist(
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    inventoryItem as unknown as Record<string, unknown>,
    account,
  );

  if (!itemResponse.ok && itemResponse.status !== 204) {
    const err = await itemResponse.text();
    return { marketplaceId: "", offerId: "", url: "", status: "error", error: err };
  }

  await sleep(200);

  // Step 2: Create offer
  const offerResponse = await ebayApiCallWithPersist(
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

  await sleep(200);

  // Step 3: Publish offer
  const publishResponse = await ebayApiCallWithPersist(
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
  if (isShadowMode(account)) {
    const comparison = await compareWithEbayState(sku, "update", {
      title: product.title,
      sku,
      offerId,
      price: variant.price,
    }, account);
    await logShadowAction(account.shopId, undefined, "update", comparison);
    console.log(`[SHADOW] Would update SKU ${sku} — match: ${comparison.match}`);
    return { status: "active" };
  }

  const inventoryItem = mapToInventoryItem(product, metafields, images);

  const itemResponse = await ebayApiCallWithPersist(
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

  const offerResponse = await ebayApiCallWithPersist(
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
  if (isShadowMode(account)) {
    await logShadowAction(account.shopId, undefined, "delist", {
      intended: "delist",
      intendedParams: { offerId },
      actualState: null,
      match: true,
      discrepancies: [],
    });
    console.log(`[SHADOW] Would delist offer ${offerId}`);
    return { status: "delisted" };
  }

  const response = await ebayApiCallWithPersist(
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
  if (isShadowMode(account)) {
    console.log(`[SHADOW] Would bulk update ${updates.length} price/qty entries`);
    await db.syncLog.create({
      data: {
        shopId: account.shopId,
        marketplace: "ebay",
        action: "shadow_bulk_update",
        status: "success",
        details: JSON.stringify({
          shadow: true,
          intended: "bulk_update",
          count: updates.length,
          updates: updates.map((u) => ({ offerId: u.offerId, sku: u.sku, price: u.price, quantity: u.quantity })),
        }),
      },
    });
    return { successCount: updates.length, errorCount: 0 };
  }

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

  const response = await ebayApiCallWithPersist(
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

/**
 * Check if an inventory item exists on eBay for the given SKU.
 * Returns null if not found (404). Throws for other API errors.
 */
export async function getInventoryItem(
  sku: string,
  account: MarketplaceAccount,
): Promise<{ sku: string } | null> {
  const response = await ebayApiCallWithPersist(
    "GET",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    null,
    account,
  );

  if (response.ok) return { sku };
  if (response.status === 404) return null;

  const text = await response.text().catch(() => "");
  throw new Error(
    `eBay inventory item check failed for SKU "${sku}": ${response.status} ${text}`,
  );
}

/**
 * Get offers for a SKU. Returns the first offer's ID and listing ID if found.
 * Returns null if no offers exist (404). Throws for other API errors.
 */
export async function getOffersForSku(
  sku: string,
  account: MarketplaceAccount,
): Promise<{ offerId: string; listingId: string } | null> {
  const response = await ebayApiCallWithPersist(
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=1`,
    null,
    account,
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `eBay offers lookup failed for SKU "${sku}": ${response.status} ${text}`,
    );
  }

  const data = await response.json();
  const offer = data.offers?.[0];
  if (!offer) return null;

  return {
    offerId: offer.offerId ?? "",
    listingId: offer.listing?.listingId ?? "",
  };
}
