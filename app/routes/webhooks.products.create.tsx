import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getProductWithMetafields } from "../lib/shopify-helpers.server";
import { createEbayListing } from "../lib/sync-engine.server";
import { getSyncRules, productPassesSyncRules } from "../lib/sync-rules.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) return new Response();

  const ebayAccount = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });

  if (!ebayAccount) return new Response();

  const productGid = `gid://shopify/Product/${payload.id}`;
  const productData = await getProductWithMetafields(admin, productGid);
  if (!productData?.variant) return new Response();

  const { product, metafields, variant, images } = productData;

  const rules = getSyncRules(ebayAccount);
  if (!rules.autoSyncNew) {
    console.log("Auto-sync disabled for eBay — skipping new product");
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

  try {
    await createEbayListing(
      shop,
      productGid,
      product as { id: string; title: string; descriptionHtml?: string },
      variant as { price: string; compareAtPrice: string | null; sku: string },
      metafields,
      images,
      ebayAccount,
    );
  } catch (err) {
    console.error(`eBay sync failed for new product ${payload.id}:`, err);
  }

  return new Response();
};
