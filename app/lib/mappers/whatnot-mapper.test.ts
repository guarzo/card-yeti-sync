import { describe, it, expect } from "vitest";
import {
  buildWhatnotDescription,
  mapToWhatnotRow,
  generateWhatnotCSV,
  WHATNOT_HEADERS,
} from "./whatnot-mapper";

const GRADED_METAFIELDS = {
  pokemon: "Charizard",
  set_name: "Base Set",
  number: "4/102",
  grading_company: "PSA",
  grade: "9",
  cert_number: "12345678",
  language: "English",
  ebay_comp: "900",
};

const PRODUCT = {
  title: "Charizard Holo - Base Set #4/102 PSA 9",
  productType: "Graded Card",
};

const VARIANT = {
  price: "855.00",
  compareAtPrice: "900.00",
  sku: "PSA-12345678",
  inventoryQuantity: 1,
};

describe("buildWhatnotDescription", () => {
  it("builds a multi-line description from metafields", () => {
    const desc = buildWhatnotDescription(GRADED_METAFIELDS);
    expect(desc).toContain("Charizard - Base Set - #4/102");
    expect(desc).toContain("PSA 9 | Cert: 12345678");
    expect(desc).toContain("Language: English");
    expect(desc).toContain("eBay Comp: $900");
    expect(desc).toContain("cardyeti.com");
  });
});

describe("mapToWhatnotRow", () => {
  it("produces a row matching WHATNOT_HEADERS length", () => {
    const row = mapToWhatnotRow(PRODUCT, GRADED_METAFIELDS, [], VARIANT);
    expect(row).toHaveLength(WHATNOT_HEADERS.length);
  });

  it("sets category and subcategory", () => {
    const row = mapToWhatnotRow(PRODUCT, GRADED_METAFIELDS, [], VARIANT);
    expect(row[0]).toBe("Trading Card Games");
    expect(row[1]).toBe("Pokémon Cards");
  });

  it("uses compareAtPrice ceiled to whole dollar for BIN price", () => {
    const row = mapToWhatnotRow(PRODUCT, GRADED_METAFIELDS, [], VARIANT);
    expect(row[6]).toBe("900");
  });

  it("sets condition to Graded for graded cards", () => {
    const row = mapToWhatnotRow(PRODUCT, GRADED_METAFIELDS, [], VARIANT);
    expect(row[10]).toBe("Graded");
  });

  it("sets shipping profile based on product type", () => {
    const row = mapToWhatnotRow(PRODUCT, GRADED_METAFIELDS, [], VARIANT);
    expect(row[7]).toBe("4-8 oz");
  });
});

describe("generateWhatnotCSV", () => {
  it("generates valid CSV with headers", () => {
    const csv = generateWhatnotCSV([
      { product: PRODUCT, metafields: GRADED_METAFIELDS, images: [], variant: VARIANT },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Category");
    expect(lines).toHaveLength(2);
  });
});
