import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  // Delete all data for this shop (48 hours after uninstall per Shopify requirements)
  await db.syncLog.deleteMany({ where: { shopId: shop } });
  await db.marketplaceListing.deleteMany({ where: { shopId: shop } });
  await db.marketplaceAccount.deleteMany({ where: { shopId: shop } });

  console.log(`Deleted all marketplace sync data for ${shop}`);

  return new Response();
};
