import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { delistFromAllExcept } from "../lib/sync-engine.server";
import db from "../db.server";
import { getAccountSettings } from "../lib/account-settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Check if any connected marketplace account has cross-channel delisting enabled
  const accounts = await db.marketplaceAccount.findMany({
    where: { shopId: shop },
  });
  const anyCrossChannelEnabled = accounts.some(
    (a) => getAccountSettings(a).crossChannelDelistEnabled,
  );
  if (accounts.length > 0 && !anyCrossChannelEnabled) {
    console.log("Cross-channel delisting disabled on all accounts — skipping");
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
