/**
 * Orchestrates fetching price suggestions from the Pricing API
 * and creating PriceSuggestion records for graded cards.
 */

import db from "../db.server";
import { getAllProducts } from "./shopify-helpers.server";
import { fetchPriceBatch } from "./pricing-api.server";
import { getAccountSettings } from "./account-settings.server";
import type { AdminClient } from "../types/admin";

export interface FetchPriceResult {
  created: number;
  updated: number;
  skipped: number;
  notFound: number;
  total: number;
}

/**
 * Fetch all graded products with cert numbers, look up market comp prices,
 * and upsert PriceSuggestion records.
 */
export async function fetchAndCreatePriceSuggestions(
  admin: AdminClient,
  shop: string,
): Promise<FetchPriceResult> {
  // 1. Fetch all active products with metafields
  const products = await getAllProducts(admin, { query: "status:active" });

  // 2. Filter to graded cards with cert numbers
  const gradedWithCerts = products.filter(
    ({ metafields }) =>
      metafields.grading_company && metafields.grade && metafields.cert_number,
  );

  if (gradedWithCerts.length === 0) {
    return { created: 0, updated: 0, skipped: 0, notFound: 0, total: 0 };
  }

  // 3. Build cert → product map (deduplicate by cert number)
  const certMap = new Map<
    string,
    { shopifyProductId: string; currentPrice: string; title: string }
  >();
  for (const { product, metafields, variant } of gradedWithCerts) {
    const cert = metafields.cert_number!;
    if (!certMap.has(cert)) {
      certMap.set(cert, {
        shopifyProductId: product.id as string,
        currentPrice: (variant?.price as string) ?? "0.00",
        title: (product.title as string) ?? "",
      });
    }
  }

  // 4. Call pricing API
  const certNumbers = Array.from(certMap.keys());
  const batchResponse = await fetchPriceBatch(certNumbers);

  // 5. Determine discount rate from the Helix account
  const account = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: shop, marketplace: "helix" } },
  });
  const discountPercent = account
    ? getAccountSettings(account).discountPercent
    : 5;
  const discount = discountPercent / 100;

  // 6. Batch-fetch existing pending suggestions to avoid N+1 queries
  const productIdsFromCertMap = [
    ...new Set(Array.from(certMap.values()).map((v) => v.shopifyProductId)),
  ];
  const existingSuggestions = await db.priceSuggestion.findMany({
    where: {
      shopId: shop,
      shopifyProductId: { in: productIdsFromCertMap },
      status: "pending",
    },
  });
  const existingByProductId = new Map(
    existingSuggestions.map((s) => [s.shopifyProductId, s]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const result of batchResponse.results) {
    const productInfo = certMap.get(result.certNumber);
    if (!productInfo) {
      skipped++;
      continue;
    }

    const suggestedPrice = parseFloat(
      (result.suggestedPrice * (1 - discount)).toFixed(2),
    );

    const currentPriceNum = parseFloat(productInfo.currentPrice);
    const existing = existingByProductId.get(productInfo.shopifyProductId);

    // Skip when suggested price matches current price
    if (suggestedPrice === currentPriceNum) {
      if (existing) {
        await db.priceSuggestion.update({
          where: { id: existing.id },
          data: {
            status: "approved",
            reviewedAt: new Date(),
            currentPrice: currentPriceNum,
            suggestedPrice,
            certNumber: result.certNumber,
            source: "api",
          },
        });
      }
      skipped++;
      continue;
    }

    if (existing) {
      await db.priceSuggestion.update({
        where: { id: existing.id },
        data: {
          currentPrice: parseFloat(productInfo.currentPrice),
          suggestedPrice,
          source: "api",
          certNumber: result.certNumber,
        },
      });
      updated++;
    } else {
      await db.priceSuggestion.create({
        data: {
          shopId: shop,
          shopifyProductId: productInfo.shopifyProductId,
          currentPrice: parseFloat(productInfo.currentPrice),
          suggestedPrice,
          source: "api",
          certNumber: result.certNumber,
        },
      });
      created++;
    }
  }

  // 7. Log the operation
  await db.syncLog.create({
    data: {
      shopId: shop,
      marketplace: "helix",
      action: "price_fetch",
      status: "success",
      details: JSON.stringify({
        total: certNumbers.length,
        found: batchResponse.totalFound,
        notFound: batchResponse.notFound.length,
        created,
        updated,
        skipped,
      }),
    },
  });

  return {
    created,
    updated,
    skipped,
    notFound: batchResponse.notFound.length,
    total: certNumbers.length,
  };
}
