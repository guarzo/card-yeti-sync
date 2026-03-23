import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getProductWithMetafields } from "../lib/shopify-helpers.server";
import * as ebayAdapter from "../lib/adapters/ebay.server";
import { createEbayListing } from "../lib/sync-engine.server";
import { getSyncRules, productPassesSyncRules } from "../lib/sync-rules.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    console.error("No admin client available in webhook context");
    return new Response();
  }

  const ebayAccount = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });

  if (!ebayAccount) {
    console.log("No eBay account connected — skipping sync");
    return new Response();
  }

  const productGid = `gid://shopify/Product/${payload.id}`;

  const productData = await getProductWithMetafields(admin, productGid);
  if (!productData) {
    console.log(`Product ${payload.id} not found — may have been deleted`);
    return new Response();
  }

  const { product, metafields, variant, images } = productData;
  if (!variant) {
    console.log(`Product ${payload.id} has no variants — skipping`);
    return new Response();
  }

  const existingListing = await db.marketplaceListing.findUnique({
    where: {
      shopId_shopifyProductId_marketplace: {
        shopId: shop,
        shopifyProductId: productGid,
        marketplace: "ebay",
      },
    },
  });

  try {
    if (existingListing?.offerId) {
      const result = await ebayAdapter.updateProduct(
        variant.sku,
        existingListing.offerId,
        product as { title: string; descriptionHtml?: string },
        variant as { price: string; compareAtPrice: string | null; sku: string },
        metafields,
        images,
        ebayAccount,
      );

      await db.marketplaceListing.update({
        where: { id: existingListing.id },
        data: {
          status: result.status,
          errorMessage: result.error ?? null,
          lastSyncedAt: new Date(),
        },
      });

      await db.syncLog.create({
        data: {
          shopId: shop,
          marketplace: "ebay",
          action: "update",
          productId: productGid,
          status: result.status === "active" ? "success" : "error",
          details: JSON.stringify({ title: product.title, error: result.error }),
        },
      });
    } else {
      const rules = getSyncRules(ebayAccount);
      if (!rules.autoSyncNew) {
        console.log("Auto-sync disabled — skipping new eBay listing for updated product");
        return new Response();
      }

      const price = parseFloat(variant.compareAtPrice ?? variant.price ?? "0");
      const tags =
        typeof payload.tags === "string"
          ? payload.tags.split(", ").filter(Boolean)
          : [];
      if (
        !productPassesSyncRules(rules, {
          productType: (product as { productType?: string }).productType,
          tags,
          price,
        })
      ) {
        console.log(`Product ${payload.id} excluded by sync rules — skipping`);
        return new Response();
      }

      await createEbayListing(
        shop,
        productGid,
        product as { id: string; title: string; descriptionHtml?: string },
        variant as { price: string; compareAtPrice: string | null; sku: string },
        metafields,
        images,
        ebayAccount,
      );
    }
  } catch (err) {
    console.error(`eBay sync failed for product ${payload.id}:`, err);
    await db.syncLog.create({
      data: {
        shopId: shop,
        marketplace: "ebay",
        action: existingListing ? "update" : "list",
        productId: productGid,
        status: "error",
        details: JSON.stringify({
          title: product.title,
          error: err instanceof Error ? err.message : String(err),
        }),
      },
    });
  }

  return new Response();
};
