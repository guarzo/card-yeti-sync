import { describe, it, expect } from "vitest";
import { isShadowMode } from "./shadow-mode.server";
import type { MarketplaceAccount } from "@prisma/client";

function makeAccount(settings: Record<string, unknown> = {}): MarketplaceAccount {
  return {
    id: "test",
    shopId: "test.myshopify.com",
    marketplace: "ebay",
    accessToken: "",
    refreshToken: null,
    tokenExpiry: new Date(),
    settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MarketplaceAccount;
}

describe("isShadowMode", () => {
  it("returns true when account settings has shadowMode: true", () => {
    expect(isShadowMode(makeAccount({ shadowMode: true }))).toBe(true);
  });

  it("returns false when account settings has no shadowMode", () => {
    expect(isShadowMode(makeAccount({}))).toBe(false);
  });

  it("returns false when account settings has shadowMode: false", () => {
    expect(isShadowMode(makeAccount({ shadowMode: false }))).toBe(false);
  });

  it("returns false when account settings is null", () => {
    expect(isShadowMode(makeAccount())).toBe(false);
  });
});
