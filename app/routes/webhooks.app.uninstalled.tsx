import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  // Clean up all app data in FK-safe order (all use deleteMany for idempotency).
  if (session) {
    await db.$transaction([
      db.syncLog.deleteMany({ where: { shopId: shop } }),
      db.marketplaceListing.deleteMany({ where: { shopId: shop } }),
      db.marketplaceAccount.deleteMany({ where: { shopId: shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
