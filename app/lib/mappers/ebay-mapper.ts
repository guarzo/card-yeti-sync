import type { CardMetafields } from "../shopify-helpers.server";

const ASPECT_MAP: Record<string, string> = {
  pokemon: "Pokémon Character",
  set_name: "Set",
  number: "Card Number",
  grading_company: "Professional Grader",
  grade: "Grade",
  cert_number: "Certification Number",
  language: "Language",
  year: "Year Manufactured",
  rarity: "Rarity",
  condition: "Card Condition",
};

const POKEMON_CATEGORY_ID = "183454";

export function buildItemSpecifics(
  metafields: CardMetafields,
): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  for (const [key, ebayName] of Object.entries(ASPECT_MAP)) {
    const value = metafields[key as keyof CardMetafields];
    if (value) {
      aspects[ebayName] = [value];
    }
  }
  return aspects;
}

function mapCondition(metafields: CardMetafields): string {
  if (metafields.grading_company && metafields.grade) {
    return "USED_EXCELLENT";
  }
  const condition = metafields.condition?.toLowerCase() ?? "";
  if (condition.includes("near mint") || condition.includes("nm")) return "USED_EXCELLENT";
  if (condition.includes("lightly played") || condition.includes("lp")) return "USED_VERY_GOOD";
  if (condition.includes("moderately played") || condition.includes("mp")) return "USED_GOOD";
  if (condition.includes("heavily played") || condition.includes("hp")) return "USED_ACCEPTABLE";
  return "USED_EXCELLENT";
}

export interface EbayInventoryItem {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: string;
  conditionDescription?: string;
  product: {
    title: string;
    description: string;
    imageUrls: string[];
    aspects: Record<string, string[]>;
  };
}

export function mapToInventoryItem(
  product: { title: string; descriptionHtml?: string },
  metafields: CardMetafields,
  images?: string[],
): EbayInventoryItem {
  const aspects = buildItemSpecifics(metafields);
  const conditionParts: string[] = [];
  if (metafields.grading_company && metafields.grade) {
    conditionParts.push(`${metafields.grading_company} ${metafields.grade}`);
    if (metafields.cert_number) conditionParts.push(`Cert: ${metafields.cert_number}`);
  }
  if (metafields.condition) conditionParts.push(metafields.condition);

  return {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: mapCondition(metafields),
    conditionDescription: conditionParts.join(" | ") || undefined,
    product: {
      title: product.title,
      description: product.descriptionHtml ?? product.title,
      imageUrls: images ?? [],
      aspects,
    },
  };
}

export interface EbayPolicyIds {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

export interface EbayOffer {
  sku: string;
  marketplaceId: string;
  format: string;
  availableQuantity: number;
  categoryId: string;
  listingPolicies: EbayPolicyIds;
  pricingSummary: {
    price: { value: string; currency: string };
  };
}

export function mapToOffer(
  product: { title: string },
  variant: { price: string; compareAtPrice: string | null; sku: string },
  metafields: CardMetafields,
  policyIds: EbayPolicyIds,
): EbayOffer {
  const compareAt = variant.compareAtPrice
    ? parseFloat(variant.compareAtPrice)
    : parseFloat(variant.price) / 0.95;

  return {
    sku: variant.sku || `CY-${Date.now()}`,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: POKEMON_CATEGORY_ID,
    listingPolicies: policyIds,
    pricingSummary: {
      price: {
        value: compareAt.toFixed(2),
        currency: "USD",
      },
    },
  };
}
