import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const available = payload.available ?? 0;
  const inventoryItemId = payload.inventory_item_id;

  // TODO: Resolve inventory_item_id → product_id via Admin API, then call
  // delistFromAllExcept (if available=0) or relistAll (if available>0).
  // Currently the reconciliation cron (Task 11) handles inventory drift.

  console.log(
    `  Inventory item ${inventoryItemId}: available = ${available}`,
  );

  return new Response();
};
