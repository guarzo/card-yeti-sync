// app/lib/sync-rules.test.ts
import { describe, it, expect } from "vitest";
import { productPassesSyncRules, DEFAULT_SYNC_RULES } from "./sync-rules.server";

describe("productPassesSyncRules", () => {
  it("passes when product matches all default rules", () => {
    expect(productPassesSyncRules(DEFAULT_SYNC_RULES, {
      productType: "Graded Card",
      tags: [],
      price: 100,
    })).toBe(true);
  });

  it("fails when product type is not in allowed list", () => {
    expect(productPassesSyncRules(DEFAULT_SYNC_RULES, {
      productType: "Accessory",
      tags: [],
      price: 100,
    })).toBe(false);
  });

  it("fails when product has an excluded tag (case insensitive)", () => {
    const rules = { ...DEFAULT_SYNC_RULES, excludeTags: ["do-not-sync"] };
    expect(productPassesSyncRules(rules, {
      productType: "Graded Card",
      tags: ["Do-Not-Sync"],
      price: 100,
    })).toBe(false);
  });

  it("fails when price is below priceMin", () => {
    const rules = { ...DEFAULT_SYNC_RULES, priceMin: 50 };
    expect(productPassesSyncRules(rules, {
      productType: "Graded Card",
      tags: [],
      price: 25,
    })).toBe(false);
  });

  it("fails when price is above priceMax", () => {
    const rules = { ...DEFAULT_SYNC_RULES, priceMax: 500 };
    expect(productPassesSyncRules(rules, {
      productType: "Graded Card",
      tags: [],
      price: 1000,
    })).toBe(false);
  });

  it("rejects when productType is undefined and productTypes filter is active", () => {
    expect(productPassesSyncRules(DEFAULT_SYNC_RULES, {
      tags: [],
      price: 100,
    })).toBe(false);
  });

  it("passes with permissive rules (empty lists, null ranges)", () => {
    const rules = {
      productTypes: [],
      excludeTags: [],
      priceMin: null,
      priceMax: null,
      autoSyncNew: true,
    };
    expect(productPassesSyncRules(rules, {
      productType: "Anything",
      tags: ["whatever"],
      price: 9999,
    })).toBe(true);
  });
});
