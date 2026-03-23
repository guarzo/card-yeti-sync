import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { delistFromAllExcept, relistAll } from "../lib/sync-engine.server";
import { getAccountSettings } from "../lib/account-settings.server";

const INVENTORY_ITEM_QUERY = `
  query inventoryItemToProduct($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        product {
          id
        }
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const available = payload.available ?? 0;
  const inventoryItemId = payload.inventory_item_id;

  if (!admin) {
    console.error("No admin client available — cannot resolve inventory item");
    return new Response();
  }

  // Resolve inventory_item_id → product_id via Admin API
  const inventoryItemGid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  let productGid: string | null = null;

  try {
    const response = await admin.graphql(INVENTORY_ITEM_QUERY, {
      variables: { id: inventoryItemGid },
    });
    const { data } = (await response.json()) as {
      data: { inventoryItem: { variant: { product: { id: string } } } | null };
    };
    productGid = data.inventoryItem?.variant?.product?.id ?? null;
  } catch (err) {
    console.error(`Failed to resolve inventory item ${inventoryItemId}:`, err);
    return new Response();
  }

  if (!productGid) {
    console.log(`  Inventory item ${inventoryItemId} has no associated product — skipping`);
    return new Response();
  }

  const ebayAccount = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });
  if (ebayAccount && !getAccountSettings(ebayAccount).inventorySyncEnabled) {
    console.log("Inventory sync disabled — skipping");
    return new Response();
  }

  // Check if we have any marketplace listings for this product
  const listings = await db.marketplaceListing.findMany({
    where: { shopId: shop, shopifyProductId: productGid },
    select: { id: true, status: true },
  });

  if (listings.length === 0) {
    return new Response();
  }

  if (available === 0) {
    // Inventory dropped to zero — delist from all marketplaces
    const results = await delistFromAllExcept(shop, productGid);
    for (const r of results) {
      console.log(
        `  ${r.success ? "OK" : "FAIL"}  Delist ${r.marketplace} for inventory=0`,
      );
    }
  } else {
    // Inventory restored — relist previously delisted listings
    const hasDelisted = listings.some((l) => l.status === "delisted");
    if (hasDelisted) {
      const results = await relistAll(shop, productGid);
      for (const r of results) {
        console.log(
          `  ${r.success ? "OK" : "FAIL"}  Relist ${r.marketplace} for inventory=${available}`,
        );
      }
    }
  }

  return new Response();
};
