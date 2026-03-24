import type { CardMetafields } from "../shopify-helpers.server";
import { generateCSV } from "../csv-utils";

/**
 * Helix uses the TCGPlayer CSV import format.
 * We populate TCGplayer Id with Shopify product IDs since this is
 * used as a data interchange format, not uploaded to TCGPlayer directly.
 */
export const HELIX_HEADERS = [
  "TCGplayer Id",
  "Product Line",
  "Set Name",
  "Product Name",
  "Title",
  "Number",
  "Rarity",
  "Condition",
  "TCG Market Price",
  "TCG Direct Low",
  "TCG Low Price With Shipping",
  "TCG Marketplace Price",
  "Add to Quantity",
  "Total Quantity",
] as const;

function mapCondition(metafields: CardMetafields, productType?: string): string {
  const isGraded = !!(metafields.grading_company && metafields.grade);
  if (isGraded) {
    const grade = metafields.grade ?? "";
    const gradeNum = parseFloat(grade);
    if (gradeNum >= 9) return "Near Mint";
    if (gradeNum >= 7) return "Lightly Played";
    if (gradeNum >= 5) return "Moderately Played";
    return "Heavily Played";
  }
  if (productType === "Sealed Product") return "Near Mint";
  const raw = (metafields.condition ?? "").toLowerCase();
  if (raw.includes("near mint") || raw.includes("nm")) return "Near Mint";
  if (raw.includes("lightly") || raw.includes("lp")) return "Lightly Played";
  if (raw.includes("moderately") || raw.includes("mp")) return "Moderately Played";
  if (raw.includes("heavily") || raw.includes("hp")) return "Heavily Played";
  if (raw.includes("damaged") || raw.includes("dmg")) return "Damaged";
  return "Near Mint";
}

export function mapToHelixRow(
  product: { id: string; title: string; descriptionHtml?: string; productType?: string },
  metafields: CardMetafields,
  images: string[],
  variant: { price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number },
): string[] {
  const price = variant.compareAtPrice ?? variant.price ?? "0.00";
  const quantity = variant.inventoryQuantity > 0 ? variant.inventoryQuantity : 1;

  // Build a descriptive title: "Pokemon - Set Name #Number Grade"
  const titleParts: string[] = [];
  if (metafields.pokemon) titleParts.push(metafields.pokemon);
  if (metafields.set_name) titleParts.push(`- ${metafields.set_name}`);
  if (metafields.number) titleParts.push(`#${metafields.number}`);
  if (metafields.grading_company && metafields.grade) {
    titleParts.push(`${metafields.grading_company} ${metafields.grade}`);
  }
  const title = titleParts.length > 0 ? titleParts.join(" ") : product.title;

  return [
    product.id.split("/").pop() ?? product.id, // TCGplayer Id (Shopify numeric ID)
    "Pokemon",                                  // Product Line
    metafields.set_name ?? "",                  // Set Name
    metafields.pokemon ?? product.title,        // Product Name
    title,                                      // Title
    metafields.number ?? "",                    // Number
    metafields.rarity ?? "",                    // Rarity
    mapCondition(metafields, product.productType), // Condition
    price,                                      // TCG Market Price
    "",                                         // TCG Direct Low
    "",                                         // TCG Low Price With Shipping
    price,                                      // TCG Marketplace Price
    String(quantity),                           // Add to Quantity
    String(quantity),                           // Total Quantity
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
