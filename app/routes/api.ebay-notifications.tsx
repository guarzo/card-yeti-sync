import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { delistFromAllExcept } from "../lib/sync-engine.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");

  if (!challengeCode) {
    return new Response("Missing challenge_code", { status: 400 });
  }

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN ?? "";
  const endpoint = process.env.EBAY_NOTIFICATION_ENDPOINT ?? url.origin + url.pathname;

  const encoder = new TextEncoder();
  const data = encoder.encode(challengeCode + verificationToken + endpoint);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challengeResponse = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return Response.json({ challengeResponse });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN ?? "";
  if (!verificationToken) {
    console.error("EBAY_VERIFICATION_TOKEN not configured — rejecting notification");
    return new Response("Server misconfigured", { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const metadata = payload.metadata as Record<string, unknown> | undefined;
  const topic = typeof metadata?.topic === "string" ? metadata.topic : "";

  if (!topic) {
    return new Response("Invalid notification format", { status: 400 });
  }

  console.log(`eBay notification received: ${topic}`);

  if (topic !== "MARKETPLACE.ACCOUNT_DELETION" && topic !== "ORDER.ORDER_CONFIRMATION") {
    return new Response("Unhandled topic", { status: 200 });
  }

  if (topic === "ORDER.ORDER_CONFIRMATION") {
    const notificationData = payload.notification as Record<string, unknown> | undefined;
    const resourceId = (notificationData?.data as Record<string, unknown>)?.resourceId as string | undefined;
    if (!resourceId) return new Response("Missing resourceId", { status: 200 });

    // eBay resourceId for ORDER topics may be the order ID or item ID depending
    // on notification type. Try matching as item ID (marketplaceId).
    const listing = await db.marketplaceListing.findFirst({
      where: { marketplace: "ebay", marketplaceId: resourceId },
    });

    if (!listing) {
      console.warn(
        `eBay ORDER notification: no listing found for resourceId=${resourceId}. ` +
        `May be an order ID rather than an item ID — no cross-channel delist triggered.`
      );
      return new Response("OK", { status: 200 });
    }

    // Delist from all other channels (eBay listing sold, others need removal)
    await delistFromAllExcept(listing.shopId, listing.shopifyProductId, "ebay");

    // Mark the eBay listing itself as sold/delisted (not handled by delistFromAllExcept
    // since eBay is the excluded marketplace — the item was sold, not withdrawn)
    await db.marketplaceListing.update({
      where: { id: listing.id },
      data: { status: "delisted", lastSyncedAt: new Date() },
    });

    await db.syncLog.create({
      data: {
        shopId: listing.shopId,
        marketplace: "ebay",
        action: "delist",
        productId: listing.shopifyProductId,
        status: "success",
        details: JSON.stringify({ reason: "sold_on_ebay", ebayItemId: resourceId }),
      },
    });

    console.log(`  Sold on eBay: ${resourceId} — cross-channel delist triggered`);
  }

  return new Response("OK", { status: 200 });
};
