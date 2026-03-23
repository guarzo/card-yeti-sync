import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return Response.json({ error: "Missing productId" }, { status: 400 });
  }

  const listings = await db.marketplaceListing.findMany({
    where: { shopId: session.shop, shopifyProductId: productId },
    select: {
      marketplace: true,
      marketplaceId: true,
      status: true,
      lastSyncedAt: true,
      errorMessage: true,
    },
  });

  const accounts = await db.marketplaceAccount.findMany({
    where: { shopId: session.shop },
    select: { marketplace: true },
  });

  const connectedMarketplaces = accounts.map((a) => a.marketplace);

  return Response.json({ listings, connectedMarketplaces });
};
