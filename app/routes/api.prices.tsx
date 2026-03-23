import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { escapeCSVField } from "../lib/csv-utils";
import db from "../db.server";
import { getAccountSettings } from "../lib/account-settings.server";

const PRODUCTS_QUERY = `
  query products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          title
          status
          totalInventory
          certNumber: metafield(namespace: "card", key: "cert_number") { value }
          variants(first: 1) {
            edges {
              node {
                id
                price
                compareAtPrice
                sku
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_UPDATE_MUTATION = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field); field = ""; rows.push(row); row = [];
      if (ch === "\r") i++;
    } else { field += ch; }
  }

  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

interface ProductNode {
  id: string;
  handle: string;
  title: string;
  status: string;
  totalInventory: number;
  certNumber: { value: string } | null;
  variants: {
    edges: Array<{
      node: { id: string; price: string; compareAtPrice: string | null; sku: string };
    }>;
  };
}

interface ProductsQueryResponse {
  products: {
    edges: Array<{ node: ProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function fetchAllProductNodes(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
): Promise<ProductNode[]> {
  const nodes: ProductNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const gqlResponse = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: 50, after },
    });
    const { data } = (await gqlResponse.json()) as { data: ProductsQueryResponse };

    for (const edge of data.products.edges) {
      nodes.push(edge.node);
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }

  return nodes;
}

/**
 * GET: Download current prices as CSV.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const nodes = await fetchAllProductNodes(admin);
  const products = nodes.map((p) => {
    const v = p.variants.edges[0]?.node;
    return {
      productId: p.id,
      variantId: v?.id ?? "",
      handle: p.handle,
      title: p.title,
      sku: v?.sku ?? "",
      status: p.status,
      inventory: String(p.totalInventory),
      price: v?.compareAtPrice ?? v?.price ?? "0.00",
      certNumber: p.certNumber?.value ?? "",
    };
  });

  const headers = ["Product ID", "Variant ID", "Handle", "Title", "SKU", "Status", "Inventory", "Price", "Cert Number"];
  const lines = [headers.join(",")];

  for (const p of products) {
    lines.push([
      escapeCSVField(p.productId), escapeCSVField(p.variantId), escapeCSVField(p.handle),
      escapeCSVField(p.title), escapeCSVField(p.sku), escapeCSVField(p.status),
      escapeCSVField(p.inventory), escapeCSVField(p.price), escapeCSVField(p.certNumber),
    ].join(","));
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="prices-${timestamp}.csv"`,
    },
  });
};

/**
 * POST: Upload edited CSV to apply price changes.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const account = await db.marketplaceAccount.findFirst({
    where: { shopId: session.shop },
  });
  const discountPercent = account ? getAccountSettings(account).discountPercent : 5;
  const shopifyDiscount = discountPercent / 100;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const dryRun = formData.get("dryRun") === "true";

  if (!file) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCSV(text.replace(/^\uFEFF/, "")).filter((r) => r.some((f) => f.trim()));

  if (rows.length < 2) {
    return Response.json({ error: "CSV has no data rows" }, { status: 400 });
  }

  const headerRow = rows[0];
  const col: Record<string, number> = {};
  headerRow.forEach((h, i) => { col[h] = i; });

  const required = ["Product ID", "Variant ID", "Price"];
  for (const r of required) {
    if (col[r] === undefined) {
      return Response.json({ error: `Missing required column: "${r}"` }, { status: 400 });
    }
  }

  // Fetch current prices from Shopify
  const nodes = await fetchAllProductNodes(admin);
  const currentPrices = new Map<string, { price: string; compareAtPrice: string }>();
  for (const p of nodes) {
    const v = p.variants.edges[0]?.node;
    if (v) {
      currentPrices.set(v.id, {
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? "",
      });
    }
  }

  const updates: {
    productId: string;
    variantId: string;
    title: string;
    oldPrice: string;
    newPrice: string;
    newCompareAt: string;
  }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i];
    const productId = fields[col["Product ID"]]?.trim();
    const variantId = fields[col["Variant ID"]]?.trim();
    const csvPrice = fields[col["Price"]]?.trim();
    const title = col["Title"] !== undefined ? fields[col["Title"]]?.trim() : productId;

    if (!productId || !variantId || !csvPrice) continue;

    const current = currentPrices.get(variantId);
    if (!current) continue;

    const newCompareAt = csvPrice;
    const newPrice = (parseFloat(csvPrice) * (1 - shopifyDiscount)).toFixed(2);

    if (newPrice !== current.price || newCompareAt !== current.compareAtPrice) {
      updates.push({ productId, variantId, title: title ?? productId, oldPrice: current.price, newPrice, newCompareAt });
    }
  }

  if (updates.length === 0) {
    return Response.json({ message: "No price changes detected", updated: 0 });
  }

  if (dryRun) {
    return Response.json({
      message: `Dry run: ${updates.length} price change(s) found`,
      dryRun: true,
      updated: updates.length,
      changes: updates.map((u) => ({
        title: u.title,
        oldPrice: u.oldPrice,
        newPrice: u.newPrice,
        newCompareAt: u.newCompareAt,
      })),
    });
  }

  let updated = 0;
  let failed = 0;

  for (const u of updates) {
    try {
      const response = await admin.graphql(VARIANT_UPDATE_MUTATION, {
        variables: {
          productId: u.productId,
          variants: [{ id: u.variantId, price: u.newPrice, compareAtPrice: u.newCompareAt }],
        },
      });
      const { data } = await response.json();
      const errors = data.productVariantsBulkUpdate.userErrors;

      if (errors?.length > 0) {
        failed++;
      } else {
        updated++;
      }
    } catch {
      failed++;
    }
  }

  await db.syncLog.create({
    data: {
      shopId: session.shop,
      marketplace: "all",
      action: "price_update",
      status: failed === 0 ? "success" : "error",
      details: JSON.stringify({ updated, failed, total: updates.length }),
    },
  });

  return Response.json({ message: `Updated ${updated} price(s)`, updated, failed });
};
