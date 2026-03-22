import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Order created: ${payload.id}`);

  // TODO (Phase 3): Cross-channel delist
  // 1. Extract product IDs from order line items
  // 2. For each product, find active MarketplaceListings
  // 3. Call each marketplace adapter's delistProduct()
  // 4. Update listing status to "delisted"
  // 5. Log to SyncLog

  return new Response();
};
