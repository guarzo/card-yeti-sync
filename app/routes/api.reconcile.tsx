import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { delistFromAllExcept, relistAll } from "../lib/sync-engine.server";
import { unauthenticated } from "../shopify.server";

const INVENTORY_QUERY = `
  query productInventory($id: ID!) {
    product(id: $id) {
      totalInventory
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const expectedToken = process.env.QSTASH_SECRET ?? "";
  const expectedFull = `Bearer ${expectedToken}`;

  const authValid =
    expectedToken.length > 0 &&
    authHeader.length === expectedFull.length &&
    crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedFull));

  if (!authValid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Reconciliation cron started");

  const shops = await db.marketplaceAccount.findMany({
    select: { shopId: true },
    distinct: ["shopId"],
  });

  let totalDelisted = 0;
  let totalRelisted = 0;
  let totalErrors = 0;

  for (const { shopId } of shops) {
    let admin;
    try {
      const ctx = await unauthenticated.admin(shopId);
      admin = ctx.admin;
    } catch {
      console.error(`  No offline session for ${shopId} — skipping`);
      totalErrors++;
      continue;
    }

    let shopDelisted = 0;
    let shopRelisted = 0;
    let shopErrors = 0;

    // Active listings that may need delisting (inventory dropped to 0)
    const activeListings = await db.marketplaceListing.findMany({
      where: { shopId, status: "active" },
      select: { shopifyProductId: true, marketplace: true, id: true },
    });

    // Delisted listings that may need relisting (inventory restored)
    const delistedListings = await db.marketplaceListing.findMany({
      where: { shopId, status: "delisted" },
      select: { shopifyProductId: true, marketplace: true, id: true },
    });

    // Dedupe product IDs across all listings
    const productIds = [
      ...new Set([
        ...activeListings.map((l) => l.shopifyProductId),
        ...delistedListings.map((l) => l.shopifyProductId),
      ]),
    ];

    // Fetch current inventory for each product
    const inventoryByProduct = new Map<string, number>();
    for (const productId of productIds) {
      try {
        const response = await admin.graphql(INVENTORY_QUERY, {
          variables: { id: productId },
        });
        const { data } = (await response.json()) as {
          data: { product: { totalInventory: number } | null };
        };
        inventoryByProduct.set(
          productId,
          data.product?.totalInventory ?? 0,
        );
      } catch {
        // Product may have been deleted — treat as 0 inventory
        inventoryByProduct.set(productId, 0);
      }
    }

    // Delist active listings where inventory = 0
    for (const listing of activeListings) {
      const qty = inventoryByProduct.get(listing.shopifyProductId) ?? 0;
      if (qty === 0) {
        try {
          const results = await delistFromAllExcept(shopId, listing.shopifyProductId);
          shopDelisted += results.filter((r) => r.success).length;
          shopErrors += results.filter((r) => !r.success).length;
        } catch {
          shopErrors++;
        }
      }
    }

    // Relist delisted listings where inventory > 0
    for (const listing of delistedListings) {
      const qty = inventoryByProduct.get(listing.shopifyProductId) ?? 0;
      if (qty > 0) {
        try {
          const results = await relistAll(shopId, listing.shopifyProductId);
          shopRelisted += results.filter((r) => r.success).length;
          shopErrors += results.filter((r) => !r.success).length;
        } catch {
          shopErrors++;
        }
      }
    }

    totalDelisted += shopDelisted;
    totalRelisted += shopRelisted;
    totalErrors += shopErrors;

    await db.syncLog.create({
      data: {
        shopId,
        marketplace: "all",
        action: "reconcile",
        status: shopErrors > 0 ? "error" : "success",
        details: JSON.stringify({
          checked: productIds.length,
          delisted: shopDelisted,
          relisted: shopRelisted,
          errors: shopErrors,
        }),
      },
    });
  }

  console.log(`Reconciliation complete: ${totalDelisted} delisted, ${totalRelisted} relisted, ${totalErrors} errors`);

  return Response.json({
    delisted: totalDelisted,
    relisted: totalRelisted,
    errors: totalErrors,
    shops: shops.length,
  });
};
