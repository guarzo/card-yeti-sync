import type { MarketplaceAccount } from "@prisma/client";

import db from "../db.server";
import type { AdminClient } from "../types/admin";
import * as ebayAdapter from "./adapters/ebay.server";
import { isShadowMode } from "./shadow-mode.server";
import type { CardMetafields } from "./shopify-helpers.server";

type SyncResult = {
  marketplace: string;
  action: "delist" | "relist" | "error";
  success: boolean;
  error?: string;
};

/**
 * Delist a product from all active marketplace listings.
 * Optionally exclude a specific marketplace (e.g., the one where it sold).
 */
export async function delistFromAllExcept(
  shopId: string,
  shopifyProductId: string,
  excludeMarketplace?: string,
): Promise<SyncResult[]> {
  const listings = await db.marketplaceListing.findMany({
    where: {
      shopId,
      shopifyProductId,
      status: "active",
      ...(excludeMarketplace && { marketplace: { not: excludeMarketplace } }),
    },
    include: { account: true },
  });

  const results: SyncResult[] = [];

  for (const listing of listings) {
    try {
      let delistSuccess = false;

      if (listing.marketplace === "ebay" && listing.offerId && listing.account) {
        const result = await ebayAdapter.delistProduct(listing.offerId, listing.account);
        delistSuccess = result.status === "delisted";
        await db.marketplaceListing.update({
          where: { id: listing.id },
          data: { status: delistSuccess ? "delisted" : "error", lastSyncedAt: new Date() },
        });
        results.push({
          marketplace: "ebay",
          action: "delist",
          success: delistSuccess,
          error: result.error,
        });
      }
      // Whatnot/Helix: no API — log only, mark as delisted in DB
      if (listing.marketplace === "whatnot" || listing.marketplace === "helix") {
        delistSuccess = true;
        await db.marketplaceListing.update({
          where: { id: listing.id },
          data: { status: "delisted", lastSyncedAt: new Date() },
        });
        results.push({ marketplace: listing.marketplace, action: "delist", success: true });
      }

      await db.syncLog.create({
        data: {
          shopId,
          marketplace: listing.marketplace,
          action: "delist",
          productId: shopifyProductId,
          status: delistSuccess ? "success" : "error",
          details: JSON.stringify({ reason: "sold_on_other_channel" }),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ marketplace: listing.marketplace, action: "error", success: false, error: message });
      await db.syncLog.create({
        data: {
          shopId,
          marketplace: listing.marketplace,
          action: "delist",
          productId: shopifyProductId,
          status: "error",
          details: JSON.stringify({ error: message }),
        },
      });
    }
  }

  return results;
}

/**
 * Mark previously delisted listings as pending for relisting.
 * Note: this updates the database state only; no external marketplace API calls are made.
 */
export async function relistAll(
  shopId: string,
  shopifyProductId: string,
): Promise<SyncResult[]> {
  const listings = await db.marketplaceListing.findMany({
    where: { shopId, shopifyProductId, status: "delisted" },
    include: { account: true },
  });

  const results: SyncResult[] = [];

  for (const listing of listings) {
    await db.marketplaceListing.update({
      where: { id: listing.id },
      data: { status: "pending", lastSyncedAt: new Date() },
    });
    results.push({ marketplace: listing.marketplace, action: "relist", success: true });

    await db.syncLog.create({
      data: {
        shopId,
        marketplace: listing.marketplace,
        action: "list",
        productId: shopifyProductId,
        status: "success",
        details: JSON.stringify({ reason: "inventory_restored" }),
      },
    });
  }

  return results;
}

/**
 * Create a new eBay listing for a product and record it in the database.
 */
export async function createEbayListing(
  shopId: string,
  productGid: string,
  product: { id: string; title: string; descriptionHtml?: string },
  variant: { price: string; compareAtPrice: string | null; sku: string },
  metafields: CardMetafields,
  images: string[],
  account: MarketplaceAccount,
): Promise<void> {
  const result = await ebayAdapter.listProduct(product, variant, metafields, images, account);
  const listingStatus = isShadowMode(account) ? "pending" : result.status;

  await db.marketplaceListing.upsert({
    where: {
      shopId_shopifyProductId_marketplace: {
        shopId,
        shopifyProductId: productGid,
        marketplace: "ebay",
      },
    },
    create: {
      shopId,
      shopifyProductId: productGid,
      marketplace: "ebay",
      marketplaceId: result.marketplaceId,
      offerId: result.offerId,
      status: listingStatus,
      errorMessage: result.error ?? null,
      lastSyncedAt: new Date(),
    },
    update: {
      marketplaceId: result.marketplaceId,
      offerId: result.offerId,
      status: listingStatus,
      errorMessage: result.error ?? null,
      lastSyncedAt: new Date(),
    },
  });

  await db.syncLog.create({
    data: {
      shopId,
      marketplace: "ebay",
      action: "list",
      productId: productGid,
      status: listingStatus === "active" ? "success" : "error",
      details: JSON.stringify({ title: product.title, error: result.error }),
    },
  });
}

export interface ReconcileResult {
  delisted: number;
  relisted: number;
  errors: number;
  checked: number;
}

const INVENTORY_QUERY = `
  query productInventory($id: ID!) {
    product(id: $id) {
      totalInventory
    }
  }
`;

/**
 * Reconcile inventory state for a single shop.
 * Delists active listings with 0 inventory, relists delisted listings with restored inventory.
 */
export async function reconcileShop(
  shopId: string,
  admin: AdminClient,
): Promise<ReconcileResult> {
  let shopDelisted = 0;
  let shopRelisted = 0;
  let shopErrors = 0;

  const activeListings = await db.marketplaceListing.findMany({
    where: { shopId, status: "active" },
    select: { shopifyProductId: true, marketplace: true, id: true },
  });

  const delistedListings = await db.marketplaceListing.findMany({
    where: { shopId, status: "delisted" },
    select: { shopifyProductId: true, marketplace: true, id: true },
  });

  const productIds = [
    ...new Set([
      ...activeListings.map((l) => l.shopifyProductId),
      ...delistedListings.map((l) => l.shopifyProductId),
    ]),
  ];

  const inventoryByProduct = new Map<string, number>();
  let queryFailures = 0;
  for (const productId of productIds) {
    try {
      const response = await admin.graphql(INVENTORY_QUERY, {
        variables: { id: productId },
      });
      const payload = (await response.json()) as {
        data: { product: { totalInventory: number } | null };
        errors?: Array<{ message: string }>;
      };

      if (payload.errors?.length) {
        queryFailures++;
        console.error(
          `GraphQL errors fetching inventory for ${productId}:`,
          payload.errors.map((e) => e.message).join("; "),
        );
        continue;
      }

      if (payload.data.product === null) {
        // Product genuinely deleted — treat as 0
        inventoryByProduct.set(productId, 0);
      } else {
        inventoryByProduct.set(productId, payload.data.product.totalInventory ?? 0);
      }
    } catch (err) {
      queryFailures++;
      console.error(`Failed to fetch inventory for ${productId}:`, err);
      // Do NOT set to 0 — skip this product to avoid false delisting
    }
  }

  // Abort if too many queries failed (likely systemic issue like API outage)
  if (queryFailures > 0 && queryFailures >= productIds.length * 0.5) {
    throw new Error(
      `Reconciliation aborted: ${queryFailures}/${productIds.length} inventory queries failed. Possible API outage.`,
    );
  }

  const activeProductIds = new Set(activeListings.map((l) => l.shopifyProductId));
  for (const productId of activeProductIds) {
    const qty = inventoryByProduct.get(productId);
    if (qty === undefined) continue; // Query failed — skip rather than falsely delist
    if (qty === 0) {
      try {
        const results = await delistFromAllExcept(shopId, productId);
        shopDelisted += results.filter((r) => r.success).length;
        shopErrors += results.filter((r) => !r.success).length;
      } catch (err) {
        shopErrors++;
        console.error(
          `Failed to delist product ${productId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const delistedProductIds = new Set(delistedListings.map((l) => l.shopifyProductId));
  for (const productId of delistedProductIds) {
    const qty = inventoryByProduct.get(productId);
    if (qty === undefined) continue; // Query failed — skip
    if (qty > 0) {
      try {
        const results = await relistAll(shopId, productId);
        shopRelisted += results.filter((r) => r.success).length;
        shopErrors += results.filter((r) => !r.success).length;
      } catch (err) {
        shopErrors++;
        console.error(
          `Failed to relist product ${productId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const totalErrors = shopErrors + queryFailures;

  await db.syncLog.create({
    data: {
      shopId,
      marketplace: "all",
      action: "reconcile",
      status: totalErrors > 0 ? "error" : "success",
      details: JSON.stringify({
        checked: productIds.length,
        delisted: shopDelisted,
        relisted: shopRelisted,
        errors: totalErrors,
        queryFailures,
      }),
    },
  });

  return { delisted: shopDelisted, relisted: shopRelisted, errors: totalErrors, checked: productIds.length };
}
