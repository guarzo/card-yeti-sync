import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

/**
 * eBay Marketplace Account Deletion/Closure notification endpoint.
 *
 * Required by eBay for all Developer Program applications (GDPR compliance).
 * GET handles the challenge/response handshake for endpoint validation.
 * POST receives account deletion notifications.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");

  if (!challengeCode) {
    return new Response("Missing challenge_code", { status: 400 });
  }

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN ?? "";
  const endpoint =
    process.env.EBAY_NOTIFICATION_ENDPOINT ?? url.origin + url.pathname;

  const encoder = new TextEncoder();
  const data = encoder.encode(challengeCode + verificationToken + endpoint);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challengeResponse = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return Response.json({ challengeResponse });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const metadata = payload.metadata as Record<string, unknown> | undefined;
  const topic = typeof metadata?.topic === "string" ? metadata.topic : "unknown";
  console.log(`eBay notification: ${topic}`);

  // Acknowledge all notifications with 200.
  // Account data cleanup is handled via Shopify app/uninstalled webhook.
  return new Response("OK", { status: 200 });
};
