import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Product updated: ${payload.id} — ${payload.title}`);

  // TODO (Phase 2): Sync product changes to connected marketplaces
  // 1. Fetch marketplace accounts for this shop
  // 2. For each connected marketplace with sync enabled:
  //    a. Check if product matches sync rules (collection, type, tags)
  //    b. Map Shopify product data to marketplace format
  //    c. Create or update listing via marketplace adapter

  return new Response();
};
