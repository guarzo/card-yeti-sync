import type { CardMetafields } from "../shopify-helpers.server";
import { generateCSV } from "../csv-utils";

export const WHATNOT_HEADERS = [
  "Category", "Sub Category", "Title", "Description", "Quantity", "Type",
  "Price", "Shipping Profile", "Offerable", "Hazmat", "Condition",
  "Cost Per Item", "SKU",
  "Image URL 1", "Image URL 2", "Image URL 3", "Image URL 4",
  "Image URL 5", "Image URL 6", "Image URL 7", "Image URL 8",
] as const;

const SHIPPING_PROFILES: Record<string, string> = {
  "Graded Card": "4-8 oz",
  "Graded Slab": "4-8 oz",
  "Raw Single": "0-1 oz",
  "Curated Lot": "4-8 oz",
  "Sealed Product": "9 oz - 1 lb",
};

export function buildWhatnotDescription(metafields: CardMetafields): string {
  const lines: string[] = [];

  const parts: string[] = [];
  if (metafields.pokemon) parts.push(metafields.pokemon);
  if (metafields.set_name) parts.push(metafields.set_name);
  if (metafields.number) parts.push(`#${metafields.number}`);
  if (parts.length > 0) lines.push(parts.join(" - "));

  if (metafields.grading_company && metafields.grade) {
    let gradeLine = `${metafields.grading_company} ${metafields.grade}`;
    if (metafields.cert_number) gradeLine += ` | Cert: ${metafields.cert_number}`;
    lines.push(gradeLine);
  }

  const condParts: string[] = [];
  if (metafields.condition) condParts.push(`Condition: ${metafields.condition}`);
  if (metafields.language) condParts.push(`Language: ${metafields.language}`);
  if (condParts.length > 0) lines.push(condParts.join(" | "));

  if (metafields.ebay_comp) lines.push(`eBay Comp: $${metafields.ebay_comp}`);

  lines.push("cardyeti.com");

  return lines.join("\n");
}

export function mapToWhatnotRow(
  product: { title: string; productType: string },
  metafields: CardMetafields,
  images: string[],
  variant: { price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number },
  options?: { shippingProfile?: string },
): string[] {
  const description = buildWhatnotDescription(metafields);
  const quantity = variant.inventoryQuantity > 0 ? String(variant.inventoryQuantity) : "1";

  const rawPrice = parseFloat(variant.compareAtPrice ?? "") || parseFloat(variant.price) || 0;
  const price = String(Math.ceil(rawPrice));

  const shippingProfile =
    options?.shippingProfile ?? SHIPPING_PROFILES[product.productType] ?? "Standard";

  const condition =
    product.productType === "Graded Card" || product.productType === "Graded Slab"
      ? "Graded"
      : product.productType === "Sealed Product"
        ? "Brand New"
        : "Used";

  const imageSlots: string[] = [];
  for (let i = 0; i < 8; i++) {
    imageSlots.push(images[i] ?? "");
  }

  return [
    "Trading Card Games",
    "Pokémon Cards",
    product.title,
    description,
    quantity,
    "Buy it Now",
    price,
    shippingProfile,
    "TRUE",
    "Not Hazmat",
    condition,
    "",
    variant.sku,
    ...imageSlots,
  ];
}

export function generateWhatnotCSV(
  products: {
    product: { title: string; productType: string };
    metafields: CardMetafields;
    images: string[];
    variant: { price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number };
  }[],
): string {
  const rows = products.map((p) =>
    mapToWhatnotRow(p.product, p.metafields, p.images, p.variant),
  );
  return generateCSV(WHATNOT_HEADERS, rows, { flattenNewlines: true });
}
