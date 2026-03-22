import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(
    `Inventory updated: item ${payload.inventory_item_id}, available: ${payload.available}`,
  );

  // TODO (Phase 3): Propagate inventory changes
  // 1. Look up product by inventory_item_id
  // 2. If available = 0: delist from all marketplaces
  // 3. If available > 0 and was previously delisted: relist

  return new Response();
};
