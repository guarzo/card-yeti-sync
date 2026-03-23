import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { delistFromAllExcept } from "../lib/sync-engine.server";
import db from "../db.server";
import { getAccountSettings } from "../lib/account-settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const ebayAccount = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
  });
  if (ebayAccount && !getAccountSettings(ebayAccount).crossChannelDelistEnabled) {
    console.log("Cross-channel delisting disabled — skipping");
    return new Response();
  }

  const lineItems = payload.line_items ?? [];

  for (const item of lineItems) {
    if (!item.product_id) continue;

    const productGid = `gid://shopify/Product/${item.product_id}`;

    const results = await delistFromAllExcept(shop, productGid, "shopify");

    for (const r of results) {
      console.log(
        `  ${r.success ? "OK" : "FAIL"}  Delist ${r.marketplace} for product ${item.product_id}`,
      );
    }
  }

  return new Response();
};
