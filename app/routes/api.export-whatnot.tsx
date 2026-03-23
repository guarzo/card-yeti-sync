import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getAllProducts } from "../lib/shopify-helpers.server";
import { generateWhatnotCSV } from "../lib/mappers/whatnot-mapper";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "all";

  const products = await getAllProducts(admin, {
    query: "status:active",
  });

  let exportProducts = products.filter((p) => p.variant !== null);

  if (mode === "new") {
    const exportedIds = await db.marketplaceListing.findMany({
      where: { shopId: session.shop, marketplace: "whatnot" },
      select: { shopifyProductId: true },
    });
    const exportedSet = new Set(exportedIds.map((e) => e.shopifyProductId));
    exportProducts = exportProducts.filter(
      (p) => !exportedSet.has(p.product.id as string),
    );
  }

  const csvData = exportProducts.map((p) => ({
    product: p.product as { title: string; productType: string },
    metafields: p.metafields,
    images: p.images,
    variant: p.variant as {
      price: string;
      compareAtPrice: string | null;
      sku: string;
      inventoryQuantity: number;
    },
  }));

  const csv = generateWhatnotCSV(csvData);

  await db.syncLog.create({
    data: {
      shopId: session.shop,
      marketplace: "whatnot",
      action: "list",
      status: "success",
      details: JSON.stringify({ type: "csv_export", mode, productCount: csvData.length }),
    },
  });

  const BATCH_SIZE = 25;
  for (let i = 0; i < exportProducts.length; i += BATCH_SIZE) {
    await Promise.all(
      exportProducts.slice(i, i + BATCH_SIZE).map((p) => {
        const productId = p.product.id as string;
        return db.marketplaceListing.upsert({
          where: {
            shopId_shopifyProductId_marketplace: {
              shopId: session.shop,
              shopifyProductId: productId,
              marketplace: "whatnot",
            },
          },
          create: {
            shopId: session.shop,
            shopifyProductId: productId,
            marketplace: "whatnot",
            status: "active",
            lastSyncedAt: new Date(),
          },
          update: { lastSyncedAt: new Date() },
        });
      }),
    );
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="whatnot-export-${timestamp}.csv"`,
    },
  });
};
