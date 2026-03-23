import crypto from "crypto";

function getApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("Missing SHOPIFY_API_SECRET environment variable");
  }
  return secret;
}

export function generateHmacState(shop: string, nonce: string): string {
  const hmac = crypto
    .createHmac("sha256", getApiSecret())
    .update(`${shop}:${nonce}`)
    .digest("base64url");
  return Buffer.from(JSON.stringify({ shop, nonce, hmac })).toString(
    "base64url",
  );
}

interface ValidState {
  valid: true;
  shop: string;
  nonce: string;
}

interface InvalidState {
  valid: false;
}

export function validateHmacState(
  state: string | null,
  expectedShop: string,
): ValidState | InvalidState {
  if (!state) return { valid: false };

  let stateShop: string;
  let stateNonce: string;
  let stateHmac: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    if (
      typeof parsed.shop !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.hmac !== "string"
    ) {
      return { valid: false };
    }
    stateShop = parsed.shop;
    stateNonce = parsed.nonce;
    stateHmac = parsed.hmac;
  } catch {
    return { valid: false };
  }

  if (stateShop !== expectedShop) return { valid: false };

  const expectedHmac = crypto
    .createHmac("sha256", getApiSecret())
    .update(`${stateShop}:${stateNonce}`)
    .digest("base64url");

  const a = Buffer.from(stateHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length) return { valid: false };
  if (!crypto.timingSafeEqual(a, b)) return { valid: false };

  return { valid: true, shop: stateShop, nonce: stateNonce };
}
