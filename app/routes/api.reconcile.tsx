import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { reconcileShop } from "../lib/sync-engine.server";
import { unauthenticated } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const expectedToken = process.env.QSTASH_SECRET ?? "";
  const expectedFull = `Bearer ${expectedToken}`;

  const authValid =
    expectedToken.length > 0 &&
    authHeader.length === expectedFull.length &&
    crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedFull));

  if (!authValid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Reconciliation cron started");

  const shops = await db.marketplaceAccount.findMany({
    select: { shopId: true },
    distinct: ["shopId"],
  });

  let totalDelisted = 0;
  let totalRelisted = 0;
  let totalErrors = 0;

  for (const { shopId } of shops) {
    let admin;
    try {
      const ctx = await unauthenticated.admin(shopId);
      admin = ctx.admin;
    } catch {
      console.error(`  No offline session for ${shopId} — skipping`);
      totalErrors++;
      continue;
    }

    const result = await reconcileShop(shopId, admin);
    totalDelisted += result.delisted;
    totalRelisted += result.relisted;
    totalErrors += result.errors;
  }

  console.log(`Reconciliation complete: ${totalDelisted} delisted, ${totalRelisted} relisted, ${totalErrors} errors`);

  return Response.json({
    delisted: totalDelisted,
    relisted: totalRelisted,
    errors: totalErrors,
    shops: shops.length,
  });
};
