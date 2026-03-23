// app/lib/shadow-mode.server.ts
import type { MarketplaceAccount } from "@prisma/client";
import { ebayApiCall } from "./ebay-client.server";
import db from "../db.server";

export function isShadowMode(account: MarketplaceAccount): boolean {
  const settings = (account.settings ?? {}) as Record<string, unknown>;
  return settings.shadowMode === true;
}

interface ShadowComparison {
  intended: string;           // "list" | "update" | "delist" | "bulk_update"
  intendedParams: Record<string, unknown>;
  actualState: Record<string, unknown> | null;
  match: boolean;
  discrepancies: string[];
}

/**
 * After a shadow action, check eBay's actual state for the SKU
 * and compare against what we intended to do.
 */
export async function compareWithEbayState(
  sku: string,
  intended: string,
  intendedParams: Record<string, unknown>,
  account: MarketplaceAccount,
): Promise<ShadowComparison> {
  const discrepancies: string[] = [];
  let actualState: Record<string, unknown> | null = null;

  try {
    // Read the actual inventory item from eBay (GET is safe, no writes)
    const { response } = await ebayApiCall(
      "GET",
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      null,
      account,
    );

    if (response.ok) {
      const data = await response.json();
      actualState = {
        exists: true,
        title: data.product?.title ?? null,
        price: data.product?.aspects?.Price?.[0] ?? null,
        quantity: data.availability?.shipToLocationAvailability?.quantity ?? null,
      };

      // Compare based on intended action
      if (intended === "list" || intended === "update") {
        const intendedTitle = intendedParams.title as string | undefined;
        if (intendedTitle && actualState.title && intendedTitle !== actualState.title) {
          discrepancies.push(
            `title: intended "${intendedTitle}" vs actual "${actualState.title}"`,
          );
        }
      }

      if (intended === "delist" && actualState.exists) {
        discrepancies.push("intended delist but item still exists on eBay");
      }
    } else if (response.status === 404) {
      actualState = { exists: false };

      if (intended === "list") {
        discrepancies.push("intended list but item does not exist on eBay (MC may not have listed it yet)");
      }
      // For delist: 404 means already gone, which is consistent
    }
  } catch {
    // Read failed — don't block the shadow log
    actualState = { error: "failed to read eBay state" };
  }

  return {
    intended,
    intendedParams,
    actualState,
    match: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Log a shadow action to SyncLog with comparison data.
 */
export async function logShadowAction(
  shopId: string,
  productId: string | undefined,
  action: string,
  comparison: ShadowComparison,
): Promise<void> {
  await db.syncLog.create({
    data: {
      shopId,
      marketplace: "ebay",
      action: `shadow_${action}`,
      productId,
      status: comparison.match ? "success" : "error",
      details: JSON.stringify({
        shadow: true,
        ...comparison,
      }),
    },
  });
}
