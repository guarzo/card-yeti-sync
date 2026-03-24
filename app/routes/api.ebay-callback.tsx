import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { exchangeCodeForTokens } from "../lib/ebay-client.server";
import { validateHmacStateStandalone } from "../lib/hmac-state.server";
import db from "../db.server";

/**
 * eBay OAuth callback handler.
 *
 * This endpoint is hit by a direct browser redirect from eBay — NOT inside the
 * Shopify admin iframe — so we cannot use authenticate.admin(). Instead we
 * extract and verify the shop from the HMAC-signed state parameter we created.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  // Validate HMAC-signed state to get the shop (no Shopify session available)
  const state = url.searchParams.get("state");
  const stateResult = validateHmacStateStandalone(state);
  if (!stateResult.valid) {
    console.error("eBay OAuth state validation failed");
    return new Response(
      "eBay authorization failed: invalid state. Please return to your Shopify admin and try connecting again.",
      { status: 400, headers: { "Content-Type": "text/plain" } },
    );
  }

  const shop = stateResult.shop;

  if (error || !code) {
    console.error("eBay OAuth denied or missing code:", error);
    return redirect(buildAdminRedirect(shop, "error=oauth_denied"));
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
    return redirect(buildAdminRedirect(shop, "error=oauth_denied"));
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

  return redirect(buildAdminRedirect(shop, "success=connected"));
};

/**
 * Build a redirect URL into the Shopify admin for our embedded app.
 * Since the callback is outside the admin iframe, we redirect to the
 * admin URL which will re-open the app in the embedded context.
 */
function buildAdminRedirect(shop: string, query: string): string {
  const storeSlug = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeSlug}/apps/card-yeti-sync/app/ebay?${query}`;
}
