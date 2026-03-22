import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { exchangeCodeForTokens } from "../lib/ebay-client.server";
import { validateHmacState } from "../lib/hmac-state.server";
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

  // Validate HMAC-signed CSRF state parameter (timing-safe)
  const state = url.searchParams.get("state");
  const stateResult = validateHmacState(state, shop);
  if (!stateResult.valid) {
    console.error("eBay OAuth state validation failed for shop:", shop);
    return redirect("/app/ebay?error=oauth_denied");
  }

  // Verify and invalidate the nonce (single-use, time-limited)
  const storedNonce = await db.oAuthNonce.findUnique({
    where: { nonce: stateResult.nonce },
  });
  if (
    !storedNonce ||
    storedNonce.shopId !== shop ||
    storedNonce.expiresAt < new Date()
  ) {
    console.error("eBay OAuth callback invalid or expired nonce");
    return redirect("/app/ebay?error=oauth_denied");
  }
  await db.oAuthNonce.delete({ where: { nonce: stateResult.nonce } });

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
