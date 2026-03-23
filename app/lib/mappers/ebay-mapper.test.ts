import { describe, it, expect } from "vitest";
import {
  mapToInventoryItem,
  mapToOffer,
  buildItemSpecifics,
} from "./ebay-mapper";
import type { CardMetafields } from "../shopify-helpers.server";

const GRADED_METAFIELDS: CardMetafields = {
  pokemon: "Charizard",
  set_name: "Base Set",
  number: "4/102",
  grading_company: "PSA",
  grade: "9",
  cert_number: "12345678",
  language: "English",
  year: "1999",
  rarity: "Holo Rare",
};

const RAW_METAFIELDS: CardMetafields = {
  pokemon: "Umbreon",
  set_name: "Neo Discovery",
  number: "32/75",
  language: "English",
  year: "2001",
  rarity: "Rare",
  condition: "Near Mint",
};

const PRODUCT = {
  title: "Charizard Holo - Base Set #4/102 PSA 9",
  descriptionHtml: "<p>Beautiful holo bleed.</p>",
};

const VARIANT = {
  price: "855.00",
  compareAtPrice: "900.00",
  sku: "PSA-12345678",
  inventoryQuantity: 1,
};

describe("buildItemSpecifics", () => {
  it("maps graded card metafields to eBay name-value pairs", () => {
    const aspects = buildItemSpecifics(GRADED_METAFIELDS);
    expect(aspects["Pokémon Character"]).toEqual(["Charizard"]);
    expect(aspects["Set"]).toEqual(["Base Set"]);
    expect(aspects["Card Number"]).toEqual(["4/102"]);
    expect(aspects["Professional Grader"]).toEqual(["PSA"]);
    expect(aspects["Grade"]).toEqual(["9"]);
    expect(aspects["Certification Number"]).toEqual(["12345678"]);
    expect(aspects["Language"]).toEqual(["English"]);
    expect(aspects["Year Manufactured"]).toEqual(["1999"]);
    expect(aspects["Rarity"]).toEqual(["Holo Rare"]);
  });

  it("omits absent metafields", () => {
    const aspects = buildItemSpecifics(RAW_METAFIELDS);
    expect(aspects["Professional Grader"]).toBeUndefined();
    expect(aspects["Grade"]).toBeUndefined();
    expect(aspects["Certification Number"]).toBeUndefined();
    expect(aspects["Card Condition"]).toEqual(["Near Mint"]);
  });
});

describe("mapToInventoryItem", () => {
  it("maps a graded card to eBay inventory item shape", () => {
    const item = mapToInventoryItem(PRODUCT, GRADED_METAFIELDS);
    expect(item.condition).toBe("USED_EXCELLENT");
    expect(item.product.title).toBe(PRODUCT.title);
    expect(item.product.aspects["Pokémon Character"]).toEqual(["Charizard"]);
    expect(item.availability.shipToLocationAvailability.quantity).toBe(1);
  });

  it("maps a raw card with condition notes", () => {
    const item = mapToInventoryItem(
      { ...PRODUCT, title: "Umbreon - Neo Discovery" },
      RAW_METAFIELDS,
    );
    expect(item.condition).toBe("USED_EXCELLENT");
  });
});

describe("mapToOffer", () => {
  it("uses compareAtPrice for eBay listing price", () => {
    const offer = mapToOffer(PRODUCT, VARIANT, GRADED_METAFIELDS, {
      fulfillmentPolicyId: "fp-1",
      paymentPolicyId: "pp-1",
      returnPolicyId: "rp-1",
    });
    expect(offer.pricingSummary.price.value).toBe("900.00");
    expect(offer.pricingSummary.price.currency).toBe("USD");
    expect(offer.sku).toBe("PSA-12345678");
    expect(offer.listingPolicies.fulfillmentPolicyId).toBe("fp-1");
  });

  it("falls back to variant.price / 0.95 when no compareAtPrice", () => {
    const offer = mapToOffer(
      PRODUCT,
      { ...VARIANT, compareAtPrice: null },
      GRADED_METAFIELDS,
      { fulfillmentPolicyId: "fp-1", paymentPolicyId: "pp-1", returnPolicyId: "rp-1" },
    );
    // 855 / 0.95 = 900
    expect(offer.pricingSummary.price.value).toBe("900.00");
  });
});
