import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { exchangeCodeForTokens } from "../lib/ebay-client.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    console.error("eBay OAuth denied or missing code:", error);
    return redirect("/app/ebay?error=oauth_denied");
  }

  const tokens = await exchangeCodeForTokens(code);

  await db.marketplaceAccount.upsert({
    where: {
      shopId_marketplace: { shopId: shop, marketplace: "ebay" },
    },
    create: {
      shopId: shop,
      marketplace: "ebay",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
    },
    update: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
    },
  });

  return redirect("/app/ebay?success=connected");
};
