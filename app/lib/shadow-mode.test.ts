// app/lib/shadow-mode.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { isShadowMode } from "./shadow-mode.server";

describe("isShadowMode", () => {
  const originalEnv = process.env.EBAY_SHADOW_MODE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EBAY_SHADOW_MODE;
    else process.env.EBAY_SHADOW_MODE = originalEnv;
  });

  it("returns true when EBAY_SHADOW_MODE is 'true'", () => {
    process.env.EBAY_SHADOW_MODE = "true";
    expect(isShadowMode()).toBe(true);
  });

  it("returns false when EBAY_SHADOW_MODE is unset", () => {
    delete process.env.EBAY_SHADOW_MODE;
    expect(isShadowMode()).toBe(false);
  });

  it("returns false when EBAY_SHADOW_MODE is 'false'", () => {
    process.env.EBAY_SHADOW_MODE = "false";
    expect(isShadowMode()).toBe(false);
  });
});
