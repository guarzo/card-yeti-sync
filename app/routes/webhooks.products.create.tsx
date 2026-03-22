import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Product created: ${payload.id} — ${payload.title}`);

  // TODO (Phase 2): Sync new product to connected marketplaces
  // Same flow as products/update but always creates (never updates)

  return new Response();
};
