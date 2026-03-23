import type { MarketplaceAccount } from "@prisma/client";

import db from "../db.server";
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
 * Delist a product from all marketplaces except the one where it sold.
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
 * Relist a product on all marketplaces where it was previously delisted.
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
