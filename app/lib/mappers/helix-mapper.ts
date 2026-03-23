import type { CardMetafields } from "../shopify-helpers.server";
import { generateCSV } from "../csv-utils";

export const HELIX_HEADERS = [
  "Title", "Description", "Price (cents)", "Listing Type", "Condition",
  "Quantity", "Image URL 1", "Image URL 2", "Image URL 3", "Image URL 4",
  "Pokémon", "Set Name", "Card Number", "Language", "Year", "Rarity",
  "Grading Company", "Grade", "Cert Number", "Cert URL",
  "Population", "Pop Higher", "Subgrades",
  "Raw Condition", "Centering", "Condition Notes",
  "Shopify Product ID", "eBay Item ID", "SKU",
] as const;

export function mapToHelixRow(
  product: { id: string; title: string; descriptionHtml?: string; productType?: string },
  metafields: CardMetafields,
  images: string[],
  variant: { price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number },
): string[] {
  const priceCents = Math.round(
    (parseFloat(variant.compareAtPrice ?? "") || parseFloat(variant.price) || 0) * 100,
  );

  const isGraded = !!(metafields.grading_company && metafields.grade);
  const condition = isGraded ? "graded"
    : product.productType === "Sealed Product" ? "sealed"
    : "raw";

  const imageSlots: string[] = [];
  for (let i = 0; i < 4; i++) {
    imageSlots.push(images[i] ?? "");
  }

  return [
    product.title,
    product.descriptionHtml ?? "",
    String(priceCents),
    "fixed_price",
    condition,
    String(variant.inventoryQuantity > 0 ? variant.inventoryQuantity : 1),
    ...imageSlots,
    metafields.pokemon ?? "",
    metafields.set_name ?? "",
    metafields.number ?? "",
    metafields.language ?? "",
    metafields.year ?? "",
    metafields.rarity ?? "",
    metafields.grading_company ?? "",
    metafields.grade ?? "",
    metafields.cert_number ?? "",
    metafields.cert_url ?? "",
    metafields.population ?? "",
    metafields.pop_higher ?? "",
    metafields.subgrades ?? "",
    isGraded ? "" : (metafields.condition ?? ""),
    isGraded ? "" : (metafields.centering ?? ""),
    isGraded ? "" : (metafields.condition_notes ?? ""),
    product.id,
    metafields.ebay_item_id ?? "",
    variant.sku ?? "",
  ];
}

export function generateHelixCSV(
  products: {
    product: { id: string; title: string; descriptionHtml?: string; productType?: string };
    metafields: CardMetafields;
    images: string[];
    variant: { price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number };
  }[],
): string {
  const rows = products.map((p) =>
    mapToHelixRow(p.product, p.metafields, p.images, p.variant),
  );
  return generateCSV(HELIX_HEADERS, rows);
}
